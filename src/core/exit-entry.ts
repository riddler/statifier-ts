// Exit and entry: the half of the algorithm that changes the configuration.
//
// Ported function for function from the reference's exit-and-entry module
// (`Statifier.Interpreter.ExitEntry` in statifier-ex at v2.9.0), itself a
// literal port of the SCXML recommendation's Appendix D. Each exported
// function names the pseudocode function it ports. Which transitions fire,
// and which states each one leaves, is the selection module's: the domain
// half (`getTransitionDomain`, `getEffectiveTargetStates`, `computeExitSet`)
// is imported from there rather than ported twice.
//
// The pseudocode reads and writes globals: the configuration, the recorded
// history, the states to invoke, the internal queue, the datamodel and the
// running flag. Here they are fields of the state passed first, and the two
// functions that move the configuration, `exitStates` and `enterStates`,
// answer the state they leave with the effects they produced, in the order
// they were produced.
//
// Exit order and entry order are never hand-sorted: the exit set goes out in
// descending index order and the entry set comes in ascending, which is
// document order, so a descendant always leaves before its ancestors and
// arrives after them.
//
// Executable content - an `<onexit>`, an `<onentry>`, an `<initial>`
// transition's content, a history's default transition's content - runs
// through the block runner, one block at a time, each against a context built
// from the state as it stands when the block starts. This module owns only
// where and in what order the blocks run.
//
// History is recorded in a full first pass over the exit set, reading the
// configuration as it stood before any state exited. A shallow history
// records the exiting state's active children; a deep one its active atomic
// descendants. The recorded value is a set: nothing reads its order, since a
// restored value is re-entered through the same walks as any other target and
// the entry set is put in document order afterwards.
//
// The entry set's three out-parameters in the pseudocode - the states to
// enter, the states entered by default, and the default history content by
// the history's parent - are one accumulator here, and the functions that
// fill it write into it as the pseudocode writes into its out-parameters.
// The default history content is recorded as the default transition's
// index, which is what running it needs.
//
// What is not here yet. An invocation is cancelled when its state exits, but
// nothing starts an invocation, so a state's live invocations are always
// empty and the cancel is not yet reachable; it is ported as the reference
// writes it. Binding a state's own `<data>` on its first entry under late
// binding, and the trace effects the reference emits for an exit set, an
// entry set and each block, land with the datamodel binding and the trace
// vocabulary.

import { Undefined, type Value } from "@riddler/predicator";
import {
  type ActiveStates,
  type EvaluateOutcome,
  type EvaluationContext,
  type Event,
  type ExecutionReason,
  type Expr,
  evaluate,
  evaluationContext,
  executionError,
  type Origin,
  type Owner,
} from "../datamodel.js";
import {
  type CompiledTransition,
  childStates,
  documentOrder,
  exitOrder,
  isAtomic,
  isCompound,
  isDescendant,
  isFinal,
  isHistory,
  isParallel,
  type Machine,
  properAncestors,
  stateAt,
  transitionAt,
} from "../machine.js";
import { type ContentNode, type Effect, executeBlock, type Invalid } from "./content.js";
import {
  computeExitSet,
  getEffectiveTargetStates,
  getTransitionDomain,
  type SelectionState,
} from "./selection.js";
import { paramsData, type SendState, textData } from "./send.js";

// ---------------------------------------------------------------------------
// The state exit and entry read and write
// ---------------------------------------------------------------------------

/**
 * What exit and entry read and write of a session, beyond what selection
 * reads: the send state a block's `<send>` moves, the states entered since
 * the invoke pass last ran, the invocations live in each state, and whether
 * the chart is still running. The recorded history, the datamodel and the
 * internal queue are selection's fields, written here.
 */
export interface ExitEntryState extends SelectionState {
  readonly sends: SendState;
  readonly statesToInvoke: ReadonlySet<number>;
  /** The id of each live invocation, keyed by `invocationKey`. */
  readonly activeInvocations: ReadonlyMap<string, string>;
  readonly running: boolean;
}

/** The key `activeInvocations` holds an invocation under: its state and its position there. */
export function invocationKey(stateIndex: number, invokeIndex: number): string {
  return `${stateIndex}:${invokeIndex}`;
}

/**
 * The cancel of a live invocation whose state exits, acting as that state's
 * last `<onexit>` handler.
 */
export interface CancelInvoke {
  readonly kind: "cancel_invoke";
  readonly invokeId: string;
  readonly stateIndex: number;
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
}

/** An effect exit or entry produced. */
export type ExitEntryEffect = Effect | CancelInvoke;

/** What a function that moves the configuration answers: the state it leaves and its effects. */
export interface Moved<S extends ExitEntryState> {
  readonly state: S;
  readonly effects: readonly ExitEntryEffect[];
}

// ---------------------------------------------------------------------------
// Exit
// ---------------------------------------------------------------------------

/**
 * `exitStates`: leaves every state the transitions exit. The exit set loses
 * its members from the states to invoke, history is recorded over the whole
 * set against the configuration as it stands, and then each state, in exit
 * order, runs its `<onexit>` blocks, cancels its live invocations and leaves
 * the configuration.
 */
export function exitStates<S extends ExitEntryState>(
  state: S,
  transitions: readonly CompiledTransition[],
): Moved<S> {
  const exitSet = computeExitSet(state, transitions);
  const statesToInvoke = new Set([...state.statesToInvoke].filter((s) => !exitSet.has(s)));
  const statesToExit = exitOrder(exitSet);
  let current: S = recordHistoryValues({ ...state, statesToInvoke }, statesToExit);
  const effects: ExitEntryEffect[] = [];
  for (const s of statesToExit) {
    const departed = depart(current, s);
    current = departed.state;
    effects.push(...departed.effects);
  }
  return { state: current, effects };
}

// The history-recording loop: every history child of every exiting state,
// each recorded value overwriting the last, all read from the configuration
// before any state leaves it.
function recordHistoryValues<S extends ExitEntryState>(
  state: S,
  statesToExit: readonly number[],
): S {
  const historyValues = new Map(state.historyValues);
  for (const s of statesToExit) {
    for (const h of stateAt(state.machine, s).historyChildren) {
      historyValues.set(h, recordedValue(state, s, h));
    }
  }
  return { ...state, historyValues };
}

// A shallow history records the state's active children; a deep one its
// active atomic descendants.
function recordedValue(state: ExitEntryState, s: number, h: number): Set<number> {
  const { machine, configuration } = state;
  const deep = stateAt(machine, h).historyType === "deep";
  const recorded = [...configuration].filter((active) =>
    deep
      ? isAtomic(machine, active) && isDescendant(machine, active, s)
      : stateAt(machine, active).parent === s,
  );
  return new Set(recorded);
}

// One state's exit: its `<onexit>` blocks, then its invocations' cancels,
// then out of the configuration.
function depart<S extends ExitEntryState>(state: S, s: number): Moved<S> {
  const onexit = runOnexitBlocks(state, s);
  const cancels = cancelInvocationsForState(onexit.state, s);
  const configuration = new Set(cancels.state.configuration);
  configuration.delete(s);
  return {
    state: { ...cancels.state, configuration },
    effects: [...onexit.effects, ...cancels.effects],
  };
}

/**
 * `exitStates`' per-state `for content in s.onexit: executeContent(content)`:
 * the state's `<onexit>` blocks in document order, each its own block.
 */
export function runOnexitBlocks<S extends ExitEntryState>(state: S, s: number): Moved<S> {
  return runBlocks(state, stateAt(state.machine, s).onexit, (ordinal) => ({
    kind: "onexit",
    stateIndex: s,
    ordinal,
  }));
}

/**
 * `exitStates`' per-state `for inv in s.invoke: cancelInvoke(inv)`: one
 * cancel for each of the state's invocations that is live, in document
 * order, each forgotten as it is cancelled. An invocation that never started
 * produces nothing.
 */
export function cancelInvocationsForState<S extends ExitEntryState>(state: S, s: number): Moved<S> {
  const activeInvocations = new Map(state.activeInvocations);
  const effects: CancelInvoke[] = [];
  for (const invoke of stateAt(state.machine, s).invoke) {
    const key = invocationKey(s, invoke.index);
    const invokeId = activeInvocations.get(key);
    if (invokeId === undefined) continue;
    activeInvocations.delete(key);
    effects.push({
      kind: "cancel_invoke",
      invokeId,
      stateIndex: s,
      macrostep: state.macrostep,
      microstep: state.microstep,
      round: state.round,
    });
  }
  if (effects.length === 0) return { state, effects };
  return { state: { ...state, activeInvocations }, effects };
}

// ---------------------------------------------------------------------------
// The entry set
// ---------------------------------------------------------------------------

/**
 * The entry set `computeEntrySet` fills: the states to enter, the compound
 * states among them entered by default (so their `<initial>` transition's
 * content runs), and, by a history's parent, the default transition whose
 * content runs because that history had recorded nothing.
 */
export interface EntrySet {
  readonly statesToEnter: Set<number>;
  readonly statesForDefaultEntry: Set<number>;
  readonly defaultHistoryContent: Map<number, number>;
}

/** An entry set with nothing in it. */
export function emptyEntrySet(): EntrySet {
  return {
    statesToEnter: new Set(),
    statesForDefaultEntry: new Set(),
    defaultHistoryContent: new Map(),
  };
}

/**
 * `computeEntrySet`: what the transitions enter. For each transition, each
 * target as written enters with its descendants; then each effective target -
 * a history resolved to what it stands for - enters its ancestors up to the
 * transition's domain.
 */
export function computeEntrySet(
  state: ExitEntryState,
  transitions: readonly CompiledTransition[],
): EntrySet {
  const entrySet = emptyEntrySet();
  for (const t of transitions) {
    for (const s of t.targets) addDescendantStatesToEnter(state, s, entrySet);
    const ancestor = getTransitionDomain(state, t);
    for (const s of getEffectiveTargetStates(state, t)) {
      addAncestorStatesToEnter(state, s, ancestor, entrySet);
    }
  }
  return entrySet;
}

/**
 * `addDescendantStatesToEnter`: the state and what enters with it. A history
 * restores its recorded value, or, having recorded nothing, follows its
 * default transition and registers that transition's content to run on its
 * parent. A compound state enters its initial targets and is marked as
 * entered by default. A parallel enters every region no state already in the
 * set covers. Any other state enters alone.
 */
export function addDescendantStatesToEnter(
  state: ExitEntryState,
  s: number,
  entrySet: EntrySet,
): void {
  const { machine } = state;
  if (isHistory(machine, s)) {
    enterHistoryTarget(state, s, entrySet);
    return;
  }
  entrySet.statesToEnter.add(s);
  if (isCompound(machine, s)) {
    entrySet.statesForDefaultEntry.add(s);
    enterTargets(state, initialTargets(machine, s), s, entrySet);
  } else if (isParallel(machine, s)) {
    enterUncoveredRegions(state, s, entrySet);
  }
}

// The history arm: the recorded value when there is one, else the default
// transition's targets with its content registered on the history's parent.
// Either way the targets enter up to that parent.
function enterHistoryTarget(state: ExitEntryState, h: number, entrySet: EntrySet): void {
  const history = stateAt(state.machine, h);
  const parent = history.parent as number;
  const recorded = state.historyValues.get(h);
  if (recorded !== undefined) {
    enterTargets(state, [...recorded], parent, entrySet);
    return;
  }
  const defaultIndex = history.historyDefault as number;
  entrySet.defaultHistoryContent.set(parent, defaultIndex);
  enterTargets(state, transitionAt(state.machine, defaultIndex).targets, parent, entrySet);
}

// Every target's descendants, then every target's ancestors up to `ancestor`.
function enterTargets(
  state: ExitEntryState,
  targets: readonly number[],
  ancestor: number,
  entrySet: EntrySet,
): void {
  for (const target of targets) addDescendantStatesToEnter(state, target, entrySet);
  for (const target of targets) addAncestorStatesToEnter(state, target, ancestor, entrySet);
}

// The targets of a compound state's default entry: its `<initial>`
// transition's when the document wrote one, else the default the compiler
// resolved from the `initial` attribute or the first child, which has no
// transition and so no content.
function initialTargets(machine: Machine, s: number): readonly number[] {
  const state = stateAt(machine, s);
  if (state.initialTransition === null) return state.initial;
  return transitionAt(machine, state.initialTransition).targets;
}

// Every region of the parallel that no state already in the set lies inside
// enters with its descendants. A history child is never a region.
function enterUncoveredRegions(state: ExitEntryState, s: number, entrySet: EntrySet): void {
  const { machine } = state;
  for (const child of childStates(machine, s)) {
    const covered = [...entrySet.statesToEnter].some((entered) =>
      isDescendant(machine, entered, child),
    );
    if (!covered) addDescendantStatesToEnter(state, child, entrySet);
  }
}

/**
 * `addAncestorStatesToEnter`: every proper ancestor of the state up to but
 * not including `ancestor` enters, and each parallel among them enters the
 * regions not yet covered. A null `ancestor` - a transition with no domain -
 * bounds nothing, and every ancestor up to the root enters.
 */
export function addAncestorStatesToEnter(
  state: ExitEntryState,
  s: number,
  ancestor: number | null,
  entrySet: EntrySet,
): void {
  const { machine } = state;
  for (const anc of properAncestors(machine, s)) {
    if (anc === ancestor) return;
    entrySet.statesToEnter.add(anc);
    if (isParallel(machine, anc)) enterUncoveredRegions(state, anc, entrySet);
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/**
 * `enterStates`: enters what the transitions enter, in document order. Each
 * state joins the configuration and the states to invoke, runs its
 * `<onentry>` blocks, then its `<initial>` transition's content when it was
 * entered by default and its history's default transition content when one
 * was registered on it, and then, when it is a final state, raises what its
 * entry completes.
 */
export function enterStates<S extends ExitEntryState>(
  state: S,
  transitions: readonly CompiledTransition[],
): Moved<S> {
  const entrySet = computeEntrySet(state, transitions);
  let current = state;
  const effects: ExitEntryEffect[] = [];
  for (const s of documentOrder(entrySet.statesToEnter)) {
    const arrived = arrive(current, s, entrySet);
    current = arrived.state;
    effects.push(...arrived.effects);
  }
  return { state: current, effects };
}

// One state's entry, in the pseudocode's order.
function arrive<S extends ExitEntryState>(state: S, s: number, entrySet: EntrySet): Moved<S> {
  const configuration = new Set(state.configuration).add(s);
  const statesToInvoke = new Set(state.statesToInvoke).add(s);
  const onentry = runOnentryBlocks({ ...state, configuration, statesToInvoke }, s);
  const defaults = runDefaultEntry(onentry.state, s, entrySet);
  return {
    state: raiseCompletionEvents(defaults.state, s),
    effects: [...onentry.effects, ...defaults.effects],
  };
}

function runOnentryBlocks<S extends ExitEntryState>(state: S, s: number): Moved<S> {
  return runBlocks(state, stateAt(state.machine, s).onentry, (ordinal) => ({
    kind: "onentry",
    stateIndex: s,
    ordinal,
  }));
}

// The `<initial>` transition's content when the state was entered by default
// and wrote one, then the default history content registered on the state.
function runDefaultEntry<S extends ExitEntryState>(
  state: S,
  s: number,
  entrySet: EntrySet,
): Moved<S> {
  let current = state;
  const effects: ExitEntryEffect[] = [];
  const initialTransition = stateAt(state.machine, s).initialTransition;
  if (entrySet.statesForDefaultEntry.has(s) && initialTransition !== null) {
    const ran = runTransitionContent(current, initialTransition);
    current = ran.state;
    effects.push(...ran.effects);
  }
  const historyDefault = entrySet.defaultHistoryContent.get(s);
  if (historyDefault !== undefined) {
    const ran = runTransitionContent(current, historyDefault);
    current = ran.state;
    effects.push(...ran.effects);
  }
  return { state: current, effects };
}

function runTransitionContent<S extends ExitEntryState>(state: S, tIndex: number): Moved<S> {
  const { content } = transitionAt(state.machine, tIndex);
  return runBlock(state, content, { kind: "transition", tIndex });
}

// A final state's entry: a final whose parent is the root stops the chart and
// raises nothing; any other raises `done.state.<parent id>` with its
// donedata, then, when that completes a parallel, `done.state.<parallel id>`.
function raiseCompletionEvents<S extends ExitEntryState>(state: S, s: number): S {
  const { machine } = state;
  if (!isFinal(machine, s)) return state;
  const parent = stateAt(machine, s).parent as number;
  if (parent === 0) return { ...state, running: false };
  return raiseParentCompletion(state, s, parent);
}

// The parent's event, skipped when the parent has no id. Its donedata is
// evaluated first, so a failure there is queued ahead of the event.
function raiseParentCompletion<S extends ExitEntryState>(state: S, s: number, parent: number): S {
  const parentId = stateAt(state.machine, parent).id;
  if (parentId === null || parentId === "") return state;
  const folded = donedata(state, s);
  const raised = raisePlatform(folded.state, `done.state.${parentId}`, stateOrigin(s), folded.data);
  return maybeRaiseGrandparentCompletion(raised, s, parent);
}

// The parallel's event, raised with no data when the parent's own parent is a
// parallel every region of which is now in a final state, and skipped when
// that parallel has no id.
function maybeRaiseGrandparentCompletion<S extends ExitEntryState>(
  state: S,
  s: number,
  parent: number,
): S {
  const { machine } = state;
  const grandparent = stateAt(machine, parent).parent;
  if (grandparent === null || !isParallel(machine, grandparent)) return state;
  const complete = childStates(machine, grandparent).every((region) =>
    isInFinalState(state, region),
  );
  if (!complete) return state;
  const grandparentId = stateAt(machine, grandparent).id;
  if (grandparentId === null || grandparentId === "") return state;
  return raisePlatform(state, `done.state.${grandparentId}`, stateOrigin(s), Undefined);
}

/**
 * `isInFinalState`: a compound state is in a final state when an active child
 * is a final; a parallel when every region is, recursively. Anything else,
 * a final itself included, is not.
 */
export function isInFinalState(state: ExitEntryState, s: number): boolean {
  const { machine, configuration } = state;
  if (isCompound(machine, s)) {
    return childStates(machine, s).some(
      (child) => configuration.has(child) && isFinal(machine, child),
    );
  }
  if (isParallel(machine, s)) {
    return childStates(machine, s).every((child) => isInFinalState(state, child));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Donedata
// ---------------------------------------------------------------------------

/** What folding a final state's `<donedata>` answered: the state, with any failure queued, and the data. */
export interface Donedata<S extends ExitEntryState> {
  readonly state: S;
  readonly data: Value;
}

/**
 * The data a final state's `done.*` event carries: its `<donedata>` folded to
 * a value. No `<donedata>`, or one with neither `<content>` nor `<param>`, is
 * no data. A `<content>` body is text read as the payload of a `<send>`'s
 * `<content>` is. A `<content expr>` is evaluated; a failure raises
 * `error.execution` and is no data. `<param>`s are evaluated in document
 * order against one context, each failure raising its own `error.execution`
 * and being left out; the rest are a map, the last of a repeated name
 * winning, and none left is no data.
 */
export function donedata<S extends ExitEntryState>(state: S, s: number): Donedata<S> {
  const compiled = stateAt(state.machine, s).donedata;
  if (compiled === null) return { state, data: Undefined };
  const context = contextOf(state);
  if (compiled.expr === null) {
    let current = state;
    const pairs: [string, Value][] = [];
    compiled.params.forEach((param, paramIndex) => {
      const outcome = evaluateParam(context, param.expr);
      if (outcome.ok) {
        pairs.push([param.name, outcome.value]);
      } else {
        const origin: Origin = { kind: "donedata_param", stateIndex: s, paramIndex };
        current = raiseError(current, origin, outcome.reason);
      }
    });
    return { state: current, data: paramsData(pairs) };
  }
  if (compiled.expr.kind === "static") {
    const { value } = compiled.expr;
    return { state, data: typeof value === "string" ? textData(value) : value };
  }
  const outcome = evaluate(context, compiled.expr);
  if (outcome.ok) return { state, data: outcome.value };
  return { state: raiseError(state, stateOrigin(s), outcome.reason), data: Undefined };
}

// A `<param>`'s value. Only a `namelist` entry can hold an expression that
// did not compile, so a `<donedata>` param never does; the arm answers the
// compiler's message, as any node carrying such an expression does.
function evaluateParam(context: EvaluationContext, expr: Expr | Invalid): EvaluateOutcome {
  if (expr.kind !== "invalid") return evaluate(context, expr);
  return {
    ok: false,
    reason: { kind: "compile_error", source: expr.source, message: expr.message },
  };
}

// ---------------------------------------------------------------------------
// Running blocks and raising events
// ---------------------------------------------------------------------------

// Each block in turn, its owner named by its position among the state's
// blocks of that kind.
function runBlocks<S extends ExitEntryState>(
  state: S,
  blocks: readonly { readonly content: readonly ContentNode[] }[],
  ownerAt: (ordinal: number) => Owner,
): Moved<S> {
  let current = state;
  const effects: ExitEntryEffect[] = [];
  blocks.forEach((block, ordinal) => {
    const ran = runBlock(current, block.content, ownerAt(ordinal));
    current = ran.state;
    effects.push(...ran.effects);
  });
  return { state: current, effects };
}

// One block through the block runner, against a context built from the state
// as it stands now; what the block wrote, sent and raised is kept.
function runBlock<S extends ExitEntryState>(
  state: S,
  content: readonly ContentNode[],
  owner: Owner,
): Moved<S> {
  const counters = { macrostep: state.macrostep, microstep: state.microstep, round: state.round };
  const outcome = executeBlock(contextOf(state), content, { owner, counters }, state.sends);
  return {
    state: {
      ...state,
      datamodel: outcome.context.data,
      sends: outcome.sends,
      internalQueue: [...state.internalQueue, ...outcome.raised],
    },
    effects: outcome.effects,
  };
}

function stateOrigin(s: number): Origin {
  return { kind: "state", stateIndex: s };
}

// A platform event on the internal queue, its cause stamped from the counters.
function raisePlatform<S extends ExitEntryState>(
  state: S,
  name: string,
  origin: Origin,
  data: Value,
): S {
  const event: Event = {
    name,
    type: "platform",
    data,
    cause: { origin, macrostep: state.macrostep, microstep: state.microstep, round: state.round },
  };
  return { ...state, internalQueue: [...state.internalQueue, event] };
}

function raiseError<S extends ExitEntryState>(
  state: S,
  origin: Origin,
  reason: ExecutionReason,
): S {
  const event = executionError(origin, state, reason);
  return { ...state, internalQueue: [...state.internalQueue, event] };
}

// The context one evaluation site runs against: the datamodel, and `In()`
// reading the configuration through the chart's own ids.
function contextOf(state: ExitEntryState): EvaluationContext {
  const states: ActiveStates = {
    indexOf: (stateId) => state.machine.idToIndex.get(stateId),
    configuration: state.configuration,
  };
  return evaluationContext(state.datamodel, states);
}
