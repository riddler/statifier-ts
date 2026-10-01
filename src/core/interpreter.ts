// The interpreter loop: starting a chart, taking one external event, and the
// macrostep that runs each to a stable configuration.
//
// Ported function for function from the reference's interpreter module
// (`Statifier.Interpreter` in statifier-ex at v2.9.0), itself a literal port
// of the SCXML recommendation's Appendix D. Each exported function names the
// pseudocode function it ports, or says which loop it hoists.
//
// The pseudocode's globals and loop variables are the fields of one value,
// the machine state: every function takes it and answers the state it leaves
// with the effects it produced, in the order they were produced, so a
// position between two calls is data rather than a stack frame. The outer
// `while running` loop is the caller's: the core takes one external event per
// call, and whoever drives it keeps the external events still waiting.
//
// Three counters stamp every effect and every raised event. `macrostep`
// advances once when the chart starts and once per external event, and
// resets the other two. `microstep` advances once per exit-execute-enter
// step, and once for the initial entry. `round` advances once per pass of the
// inner loop, a pass that moves nothing included.
//
// Where this departs from the pseudocode, as the reference does:
//
// - The inner loop is bounded. Appendix D lets a macrostep run forever and
//   presumes something outside can stop it; a pure core has nothing outside,
//   so the loop spends a round budget, 10000 rounds unless the host sets
//   another or none, and a macrostep that spends it stops where the last
//   round left it and answers a `budget_exhausted` effect. The chart keeps
//   running; nothing is exited.
// - `returnDoneEvent` is an effect: `done`, answered last when the chart
//   stops, carrying the top-level final's donedata.
// - `exitInterpreter` empties the internal queue last: nothing can take an
//   event from it once the chart has stopped, so a stopped chart is quiescent.
//
// What is not here yet. Nothing starts an invocation, so the invoke pass only
// forgets the states it would have walked, and an external event meets no
// invocation to finalize or forward to. The trace effects and the datamodel
// effects the reference emits land with their vocabularies.

import { Undefined, type Value } from "@riddler/predicator";
import {
  type ActiveStates,
  type Datamodel,
  type EvaluationContext,
  type Event,
  type ExecutionReason,
  evaluationContext,
  executionError,
  initialDatamodel,
  putEvent,
  runProgram,
} from "../datamodel.js";
import {
  type CompiledTransition,
  documentOrder,
  exitOrder,
  isFinal,
  type Machine,
  stateAt,
  transitionAt,
} from "../machine.js";
import { executeBlock } from "./content.js";
import { initializeDatamodel } from "./datamodel.js";
import {
  cancelInvocationsForState,
  donedata,
  type ExitEntryEffect,
  type ExitEntryState,
  enterStates,
  exitStates,
  runOnexitBlocks,
} from "./exit-entry.js";
import { selectEventlessTransitions, selectTransitions } from "./selection.js";
import { INITIAL_SEND_STATE } from "./send.js";

// ---------------------------------------------------------------------------
// The machine state and the effects
// ---------------------------------------------------------------------------

/** The rounds one macrostep may spend: a positive count, or `infinity` for none. */
export type RoundBudget = number | "infinity";

/** The round budget when the host sets none. */
export const MAX_MACROSTEP_ROUNDS = 10_000;

/**
 * The interpreter's position: every field exit and entry reads and writes,
 * plus whether the chart has finished and the round budget each macrostep may
 * spend. `running` goes false when a top-level final is entered; `status`
 * becomes `done` only once `exitInterpreter` has finished.
 */
export interface MachineState extends ExitEntryState {
  readonly status: "running" | "done";
  readonly maxMacrostepRounds: RoundBudget;
}

/**
 * A macrostep that spent its round budget without reaching a stable
 * configuration. The position is where the last round left it, the chart
 * still running.
 */
export interface BudgetExhausted {
  readonly kind: "budget_exhausted";
  /** The configuration, in document order. */
  readonly configuration: readonly number[];
  readonly budget: RoundBudget;
  /** The internal events still queued, oldest first. */
  readonly pendingInternalEvents: readonly Event[];
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
}

/**
 * The chart has stopped. `donedata` is the top-level final's donedata, or
 * undefined when it has none or it failed; `donedataError` is the data of the
 * `error.execution` that failure raised, which nothing can take from the
 * queue once the chart has stopped, or null.
 */
export interface Done {
  readonly kind: "done";
  readonly donedata: Value;
  readonly donedataError: Value | null;
  /** The configuration as it stood when the chart stopped, in document order. */
  readonly configuration: readonly number[];
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
}

/** An effect the interpreter produced. */
export type InterpreterEffect = ExitEntryEffect | BudgetExhausted | Done;

/** What a loop function answers: the state it leaves and its effects, in order. */
export interface Stepped {
  readonly state: MachineState;
  readonly effects: readonly InterpreterEffect[];
}

/** What starting a chart takes. */
export interface InitializeOptions {
  /** The session's id, minted by the host: `_sessionid` reads it. */
  readonly sessionId: string;
  /** Values the host supplies, over which the system variables are set; a root `<data>` of the same id is not bound. */
  readonly datamodel?: Datamodel;
  /** The round budget; `MAX_MACROSTEP_ROUNDS` when absent. */
  readonly maxMacrostepRounds?: RoundBudget;
  /** The send types the host registered a processor for, or null for none. */
  readonly sendTypes?: ReadonlySet<string> | null;
}

/** What `handleEvent` answers: the step, or a refusal when the chart has stopped. */
export type HandleOutcome =
  | ({ readonly ok: true } & Stepped)
  | { readonly ok: false; readonly reason: "not_running" };

// ---------------------------------------------------------------------------
// The entry seams
// ---------------------------------------------------------------------------

/**
 * `interpret`: a fresh position over the chart, its datamodel initialized,
 * its `<script>` children of `<scxml>` run in document order, the initial
 * states entered, and the initialization macrostep run to a stable
 * configuration - or to the chart stopping, when entry reaches a top-level
 * final. This is macrostep 1, and the initial entry is its microstep 1.
 */
export function initialize(machine: Machine, options: InitializeOptions): Stepped {
  let state = beginMicrostep(beginMacrostep(newMachineState(machine, options)));
  state = initializeDatamodel(state);
  state = runGlobalScripts(state);
  const entered = enterStates(state, [initialTransition(machine)]);
  const looped = mainEventLoop(entered.state);
  return { state: looped.state, effects: [...entered.effects, ...looped.effects] };
}

/**
 * `mainEventLoop`'s external-event body: a new macrostep, `_event` set, the
 * transitions the event enables selected and taken, then the macrostep run
 * to a stable configuration. A stopped chart refuses the event.
 */
export function handleEvent(state: MachineState, event: Event): HandleOutcome {
  if (!state.running) return { ok: false, reason: "not_running" };
  const begun = beginMacrostep(state);
  const withEvent = { ...begun, datamodel: putEvent(begun.datamodel, event) };
  const selected = selectTransitions(withEvent, event);
  const ran = runSelected(selected.state, selected.transitions);
  const looped = mainEventLoop(ran.state);
  return { ok: true, state: looped.state, effects: [...ran.effects, ...looped.effects] };
}

// A fresh position: nothing entered, the counters at zero, the host's values
// under the system variables.
function newMachineState(machine: Machine, options: InitializeOptions): MachineState {
  return {
    machine,
    configuration: new Set(),
    historyValues: new Map(),
    datamodel: initialDatamodel(
      options.datamodel ?? new Map(),
      options.sessionId,
      machine.name ?? undefined,
    ),
    internalQueue: [],
    macrostep: 0,
    microstep: 0,
    round: 0,
    sends: { ...INITIAL_SEND_STATE, sendTypes: options.sendTypes ?? null },
    statesToInvoke: new Set(),
    enteredStates: new Set(),
    activeInvocations: new Map(),
    running: true,
    status: "running",
    maxMacrostepRounds: options.maxMacrostepRounds ?? MAX_MACROSTEP_ROUNDS,
  };
}

// The root's `<initial>` transition, or the one the reference synthesizes from
// the root's default targets when the document wrote none. A synthesized
// transition is no document element, so it has no index of its own.
function initialTransition(machine: Machine): CompiledTransition {
  const root = stateAt(machine, 0);
  if (root.initialTransition !== null) return transitionAt(machine, root.initialTransition);
  return {
    tIndex: -1,
    source: 0,
    targets: root.initial,
    events: [],
    cond: null,
    type: "external",
    content: [],
    location: machine.location,
    condLocation: null,
    attributeLocations: {},
  };
}

// `executeGlobalScriptElement`: each `<script>` child of `<scxml>` in document
// order, each against the datamodel the one before it left. A script that
// did not compile, or whose run fails, raises `error.execution`; what a
// failing run wrote before it stopped is kept.
function runGlobalScripts(state: MachineState): MachineState {
  let current = state;
  state.machine.globalScripts.forEach((script, index) => {
    const origin = { kind: "global_script", index } as const;
    if ("kind" in script) {
      const reason: ExecutionReason = {
        kind: "compile_error",
        source: script.source,
        message: script.message,
      };
      current = enqueue(current, executionError(origin, current, reason));
      return;
    }
    const outcome = runProgram(contextOf(current), script);
    current = { ...current, datamodel: outcome.data };
    if (!outcome.ok) current = enqueue(current, executionError(origin, current, outcome.reason));
  });
  return current;
}

// ---------------------------------------------------------------------------
// The step and the loop
// ---------------------------------------------------------------------------

/**
 * `microstep`: exits the states the transitions leave, runs each
 * transition's own content in the order given, then enters the states they
 * reach.
 */
export function microstep(
  state: MachineState,
  transitions: readonly CompiledTransition[],
): Stepped {
  const exited = exitStates(state, transitions);
  const executed = executeTransitionContent(exited.state, transitions);
  const entered = enterStates(executed.state, transitions);
  return {
    state: entered.state,
    effects: [...exited.effects, ...executed.effects, ...entered.effects],
  };
}

/**
 * `executeTransitionContent`: each transition's content through the block
 * runner, in the order the transitions were selected.
 */
export function executeTransitionContent(
  state: MachineState,
  transitions: readonly CompiledTransition[],
): Stepped {
  let current = state;
  const effects: InterpreterEffect[] = [];
  for (const t of transitions) {
    const counters = {
      macrostep: current.macrostep,
      microstep: current.microstep,
      round: current.round,
    };
    const owner = { kind: "transition", tIndex: t.tIndex } as const;
    const outcome = executeBlock(contextOf(current), t.content, { owner, counters }, current.sends);
    current = {
      ...current,
      datamodel: outcome.context.data,
      sends: outcome.sends,
      internalQueue: [...current.internalQueue, ...outcome.raised],
    };
    effects.push(...outcome.effects);
  }
  return { state: current, effects };
}

/** What one round answered: whether the macrostep is now stable, the state, and the effects. */
export interface Round extends Stepped {
  readonly quiescent: boolean;
}

/**
 * One pass of `mainEventLoop`'s inner `while running and not macrostepDone`
 * loop, hoisted so a position between two rounds is a value: the round
 * counter advances, then the eventless transitions are selected and taken
 * when any are enabled; otherwise one internal event is taken from the queue
 * and the transitions it enables taken. A round that finds no eventless
 * transition and an empty queue ends the macrostep, as does a chart no longer
 * running.
 */
export function runRound(state: MachineState): Round {
  const begun = beginRound(state);
  if (!begun.running) return { quiescent: true, state: begun, effects: [] };
  const eventless = selectEventlessTransitions(begun);
  if (eventless.transitions.length > 0) {
    return { quiescent: false, ...runSelected(eventless.state, eventless.transitions) };
  }
  return internalRound(eventless.state);
}

// The internal event half of a round: the oldest queued event becomes
// `_event` and the transitions it enables are taken; an empty queue ends the
// macrostep.
function internalRound(state: MachineState): Round {
  const [event, ...rest] = state.internalQueue;
  if (event === undefined) return { quiescent: true, state, effects: [] };
  const withEvent = { ...state, internalQueue: rest, datamodel: putEvent(state.datamodel, event) };
  const selected = selectTransitions(withEvent, event);
  return { quiescent: false, ...runSelected(selected.state, selected.transitions) };
}

// `if not enabledTransitions.isEmpty(): microstep(enabledTransitions)`, the
// tail every selection shares; the microstep counter advances only when
// something is taken.
function runSelected(state: MachineState, transitions: readonly CompiledTransition[]): Stepped {
  if (transitions.length === 0) return { state, effects: [] };
  return microstep(beginMicrostep(state), transitions);
}

/** How a macrostep's rounds ended: stable (or stopped), or out of budget. */
type Outcome = "quiescent" | "exhausted";

interface Folded extends Stepped {
  readonly outcome: Outcome;
  readonly roundsLeft: RoundBudget;
}

/**
 * `mainEventLoop`'s inner `while running and not macrostepDone` loop, run
 * round by round until the macrostep is stable, the chart stops, or the round
 * budget is spent. A spent budget answers `budget_exhausted` last, with the
 * position as the last round left it.
 */
export function macrostep(state: MachineState): Stepped {
  const folded = fold(state, state.maxMacrostepRounds);
  return {
    state: folded.state,
    effects: [...folded.effects, ...terminalEffects(folded.state, folded.outcome)],
  };
}

// The rounds, each charged against the budget; reaching a stable
// configuration costs nothing beyond the rounds already charged, so what is
// left carries over to an invoke re-entry.
function fold(state: MachineState, budget: RoundBudget): Folded {
  let current = state;
  let roundsLeft = budget;
  const effects: InterpreterEffect[] = [];
  for (;;) {
    if (roundsLeft === 0) return { outcome: "exhausted", state: current, effects, roundsLeft };
    const round = runRound(current);
    current = round.state;
    effects.push(...round.effects);
    if (round.quiescent) return { outcome: "quiescent", state: current, effects, roundsLeft };
    roundsLeft = roundsLeft === "infinity" ? roundsLeft : roundsLeft - 1;
  }
}

// A stable macrostep answers nothing more; a spent budget answers
// `budget_exhausted`.
function terminalEffects(state: MachineState, outcome: Outcome): InterpreterEffect[] {
  if (outcome === "quiescent") return [];
  return [
    {
      kind: "budget_exhausted",
      configuration: documentOrder(state.configuration),
      budget: state.maxMacrostepRounds,
      pendingInternalEvents: [...state.internalQueue],
      macrostep: state.macrostep,
      microstep: state.microstep,
      round: state.round,
    },
  ];
}

/**
 * `mainEventLoop`'s outer body after the caller's own selection: the
 * macrostep run, then, while the chart runs, the invoke pass, and `continue`
 * when the pass left the internal queue non-empty - under the same round
 * budget, so a re-entry never starts a fresh one. When the chart stopped,
 * `exitInterpreter` runs instead.
 */
export function mainEventLoop(state: MachineState): Stepped {
  let current = state;
  let budget = state.maxMacrostepRounds;
  const effects: InterpreterEffect[] = [];
  for (;;) {
    const folded = fold(current, budget);
    current = folded.state;
    budget = folded.roundsLeft;
    effects.push(...folded.effects);
    if (!current.running) {
      effects.push(...terminalEffects(current, folded.outcome));
      const exited = exitInterpreter(current);
      return { state: exited.state, effects: [...effects, ...exited.effects] };
    }
    current = runInvokePass(current);
    if (current.internalQueue.length === 0) {
      return { state: current, effects: [...effects, ...terminalEffects(current, folded.outcome)] };
    }
    if (budget === 0) {
      return { state: current, effects: [...effects, ...terminalEffects(current, "exhausted")] };
    }
  }
}

// `for state in statesToInvoke.sort(entryOrder): ... invoke(inv)` then
// `statesToInvoke.clear()`. Nothing starts an invocation yet, so the pass
// only clears.
function runInvokePass(state: MachineState): MachineState {
  if (state.statesToInvoke.size === 0) return state;
  return { ...state, statesToInvoke: new Set() };
}

/**
 * `exitInterpreter`: every active state leaves in exit order, running its
 * `<onexit>` blocks and cancelling its live invocations, with no history
 * recorded; the top-level final among them, if any, yields the donedata.
 * `done` is answered last, the status becomes `done`, and the internal queue
 * is emptied, taking any event the exits raised with it.
 */
export function exitInterpreter(state: MachineState): Stepped {
  const configurationAtExit = documentOrder(state.configuration);
  let current = state;
  let data: Value = Undefined;
  let dataError: Value | null = null;
  const effects: InterpreterEffect[] = [];
  for (const s of exitOrder(state.configuration)) {
    const onexit = runOnexitBlocks(current, s);
    const cancels = cancelInvocationsForState(onexit.state, s);
    effects.push(...onexit.effects, ...cancels.effects);
    const configuration = new Set(cancels.state.configuration);
    configuration.delete(s);
    current = { ...cancels.state, configuration };
    if (isFinal(current.machine, s) && stateAt(current.machine, s).parent === 0) {
      const collected = collectDonedata(current, s);
      current = collected.state;
      data = collected.data;
      dataError = collected.error;
    }
  }
  effects.push({
    kind: "done",
    donedata: data,
    donedataError: dataError,
    configuration: configurationAtExit,
    macrostep: current.macrostep,
    microstep: current.microstep,
    round: current.round,
  });
  return { state: { ...current, status: "done", internalQueue: [] }, effects };
}

// The top-level final's donedata, and the data of the first `error.execution`
// folding it raised: the queue is read either side of the fold, so an event
// already queued is never taken for the donedata's own.
function collectDonedata(
  state: MachineState,
  s: number,
): { state: MachineState; data: Value; error: Value | null } {
  const before = state.internalQueue.length;
  const folded = donedata(state, s);
  const raised = folded.state.internalQueue
    .slice(before)
    .find((event) => event.name === "error.execution");
  return { state: folded.state, data: folded.data, error: raised?.data ?? null };
}

// ---------------------------------------------------------------------------
// The counters and the queue
// ---------------------------------------------------------------------------

// A new macrostep: the microstep and round counters start over.
function beginMacrostep(state: MachineState): MachineState {
  return { ...state, macrostep: state.macrostep + 1, microstep: 0, round: 0 };
}

function beginMicrostep(state: MachineState): MachineState {
  return { ...state, microstep: state.microstep + 1 };
}

function beginRound(state: MachineState): MachineState {
  return { ...state, round: state.round + 1 };
}

function enqueue(state: MachineState, event: Event): MachineState {
  return { ...state, internalQueue: [...state.internalQueue, event] };
}

// The context one evaluation site runs against: the datamodel, and `In()`
// reading the configuration through the chart's own ids.
function contextOf(state: MachineState): EvaluationContext {
  const states: ActiveStates = {
    indexOf: (stateId) => state.machine.idToIndex.get(stateId),
    configuration: state.configuration,
  };
  return evaluationContext(state.datamodel, states);
}
