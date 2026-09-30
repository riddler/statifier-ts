// Transition selection: which transitions an event enables, which fire, and
// which states each one leaves.
//
// Ported function for function from the reference's selection module and its
// event-name matcher (`Statifier.Interpreter.Selection` and
// `Statifier.Interpreter.NameMatch` in statifier-ex at v2.9.0), themselves a
// literal port of the SCXML recommendation's Appendix D. Each exported
// function names the pseudocode function it ports.
//
// The pseudocode reads two globals, the configuration and the recorded
// history. Here they are fields of the state passed first, which carries
// what selection reads and nothing more; a fuller session state satisfies it
// as it stands. Every function is a pure query: plain values in, plain
// values out. The two selection walks answer the state back as well, because
// a condition that fails mid-walk raises `error.execution`, and the state is
// where that event is queued: it comes back unchanged when no condition
// failed.
//
// The domain half - `findLCCA`, `getEffectiveTargetStates`,
// `getTransitionDomain` and `computeExitSet` - answers which states a
// transition leaves; the exit-and-entry half of the interpreter imports it
// from here. The selection half - `conditionMatch`, `selectTransitions`,
// `selectEventlessTransitions` and `removeConflictingTransitions` - answers
// which transitions fire.

import {
  type ActiveStates,
  type CondOutcome,
  type Counters,
  type Datamodel,
  type EvaluationContext,
  type Event,
  evaluateCond,
  evaluationContext,
  raiseCondErrors,
} from "../datamodel.js";
import {
  type CompiledTransition,
  documentOrder,
  isAtomic,
  isCompound,
  isDescendant,
  isHistory,
  lcca,
  type Machine,
  properAncestors,
  stateAt,
  transitionAt,
} from "../machine.js";

/**
 * What selection reads of a session: the chart, the configuration, the
 * recorded history by history state, the datamodel a condition runs against,
 * the internal queue a failed condition's event joins, and the counters that
 * event's cause is stamped from.
 */
export interface SelectionState extends Counters {
  readonly machine: Machine;
  readonly configuration: ReadonlySet<number>;
  readonly historyValues: ReadonlyMap<number, ReadonlySet<number>>;
  readonly datamodel: Datamodel;
  readonly internalQueue: readonly Event[];
}

/** What a selection walk answered: the state, with any failed condition's event queued, and the transitions that fire. */
export interface Selection<S extends SelectionState> {
  readonly state: S;
  readonly transitions: readonly CompiledTransition[];
}

// ---------------------------------------------------------------------------
// The event-name matcher
// ---------------------------------------------------------------------------

/**
 * Whether any of a transition's event descriptors matches the event whose
 * name is `eventTokens` (`nameMatch`). A descriptor matches when its tokens
 * are a prefix of the event's on token boundaries: `error` matches
 * `error.execution` and not `errors.execution`. A trailing `*` token, or the
 * empty token a trailing dot leaves, is dropped first, so `*` matches every
 * event and `foo.*` matches `foo` and `foo.bar`. A `*` anywhere else is
 * matched as written.
 */
export function nameMatch(
  descriptors: readonly (readonly string[])[],
  eventTokens: readonly string[],
): boolean {
  return descriptors.some((descriptor) => descriptorMatch(descriptor, eventTokens));
}

function descriptorMatch(descriptor: readonly string[], eventTokens: readonly string[]): boolean {
  const normalized = normalize(descriptor);
  if (eventTokens.length < normalized.length) return false;
  return normalized.every((token, i) => eventTokens[i] === token);
}

function normalize(descriptor: readonly string[]): readonly string[] {
  const last = descriptor[descriptor.length - 1];
  return last === "*" || last === "" ? descriptor.slice(0, -1) : descriptor;
}

/** Splits an event name into the dot-separated tokens `nameMatch` compares. */
export function tokenize(name: string): string[] {
  return name.split(".");
}

// ---------------------------------------------------------------------------
// Which states a transition leaves
// ---------------------------------------------------------------------------

/** `findLCCA`: the least common compound ancestor of the states in `indexes`. */
export function findLCCA(machine: Machine, indexes: readonly number[]): number | null {
  return lcca(machine, indexes);
}

/**
 * `getEffectiveTargetStates`: the transition's targets, each history target
 * resolved to the states it stands for - its recorded value when one is
 * recorded, else its default transition's own effective targets. The list is
 * not deduplicated; no consumer's answer changes on a repeat.
 */
export function getEffectiveTargetStates(
  state: SelectionState,
  transition: CompiledTransition,
): number[] {
  return transition.targets.flatMap((target) => effectiveTargetStates(state, target));
}

function effectiveTargetStates(state: SelectionState, target: number): number[] {
  if (!isHistory(state.machine, target)) return [target];
  const recorded = state.historyValues.get(target);
  if (recorded !== undefined) return [...recorded];
  const defaultIndex = stateAt(state.machine, target).historyDefault;
  if (defaultIndex === null) return [];
  return getEffectiveTargetStates(state, transitionAt(state.machine, defaultIndex));
}

/**
 * `getTransitionDomain`: the state whose active descendants the transition
 * exits, or null when its effective targets are empty. An internal
 * transition whose source is compound and whose every effective target is a
 * proper descendant of that source has the source as its domain; every other
 * transition has the least common compound ancestor of its source and its
 * effective targets.
 */
export function getTransitionDomain(
  state: SelectionState,
  transition: CompiledTransition,
): number | null {
  const effectiveTargets = getEffectiveTargetStates(state, transition);
  if (effectiveTargets.length === 0) return null;
  const { machine } = state;
  const { source } = transition;
  if (
    transition.type === "internal" &&
    isCompound(machine, source) &&
    effectiveTargets.every((target) => isDescendant(machine, target, source))
  ) {
    return source;
  }
  return findLCCA(machine, [source, ...effectiveTargets]);
}

/**
 * `computeExitSet`: every state in the configuration that is a proper
 * descendant of some transition's domain, across all the transitions. A
 * transition with no written target contributes nothing; one whose written
 * targets resolve to no domain contributes nothing either. The set is
 * unordered: exit order is the caller's.
 */
export function computeExitSet(
  state: SelectionState,
  transitions: readonly CompiledTransition[],
): Set<number> {
  const statesToExit = new Set<number>();
  for (const transition of transitions) {
    if (transition.targets.length === 0) continue;
    const domain = getTransitionDomain(state, transition);
    if (domain === null) continue;
    for (const active of state.configuration) {
      if (isDescendant(state.machine, active, domain)) statesToExit.add(active);
    }
  }
  return statesToExit;
}

// ---------------------------------------------------------------------------
// Which transitions fire
// ---------------------------------------------------------------------------

/**
 * `conditionMatch`: evaluates the transition's condition against the state's
 * datamodel and configuration. No condition passes. A condition that fails,
 * or answers something other than a boolean, answers the failure; the
 * transition is then not enabled, and the selection walks raise
 * `error.execution` for it.
 */
export function conditionMatch(state: SelectionState, transition: CompiledTransition): CondOutcome {
  return evaluateCond(contextOf(state), transition.cond ?? undefined);
}

/**
 * `selectTransitions`: the transitions `event` enables, at most one per
 * atomic state in the configuration, taken in document order. For each, the
 * state itself and then each proper ancestor outward is searched, and the
 * first transition in document order whose descriptors match the event and
 * whose condition holds is taken, so a child's transition preempts its
 * ancestor's. The enabled list keeps the first occurrence of each transition,
 * then passes through `removeConflictingTransitions`.
 */
export function selectTransitions<S extends SelectionState>(
  state: S,
  event: Pick<Event, "name">,
): Selection<S> {
  return selectRound(state, tokenize(event.name));
}

/**
 * `selectEventlessTransitions`: `selectTransitions`' walk for the
 * transitions that name no event. A transition that names one is never
 * taken here, and an eventless one is never taken by `selectTransitions`.
 */
export function selectEventlessTransitions<S extends SelectionState>(state: S): Selection<S> {
  return selectRound(state, null);
}

/**
 * `removeConflictingTransitions`: the enabled transitions, filtered to a set
 * with no two exiting a common state. Taken in the order given, each
 * transition is checked against those kept so far. On a conflict, a
 * transition whose source is a descendant of the kept one's source preempts
 * it and keeps checking; otherwise the later transition is the one dropped,
 * and the check stops. A surviving transition is appended after every kept
 * one it preempted is removed.
 */
export function removeConflictingTransitions(
  state: SelectionState,
  enabledTransitions: readonly CompiledTransition[],
): CompiledTransition[] {
  let filtered: CompiledTransition[] = [];
  for (const t1 of enabledTransitions) {
    let t1Preempted = false;
    const transitionsToRemove = new Set<CompiledTransition>();
    for (const t2 of filtered) {
      if (!conflicts(state, t1, t2)) continue;
      if (isDescendant(state.machine, t1.source, t2.source)) {
        transitionsToRemove.add(t2);
      } else {
        t1Preempted = true;
        break;
      }
    }
    if (!t1Preempted) {
      filtered = filtered.filter((t) => !transitionsToRemove.has(t));
      filtered.push(t1);
    }
  }
  return filtered;
}

// Two transitions conflict when their exit sets share a state.
function conflicts(state: SelectionState, t1: CompiledTransition, t2: CompiledTransition): boolean {
  const exit2 = computeExitSet(state, [t2]);
  for (const s of computeExitSet(state, [t1])) {
    if (exit2.has(s)) return true;
  }
  return false;
}

// The walk both selection functions share, and their common tail: raise the
// failed conditions in walk order, keep each transition's first occurrence,
// and remove conflicts. `eventTokens` is null for the eventless walk.
function selectRound<S extends SelectionState>(
  state: S,
  eventTokens: readonly string[] | null,
): Selection<S> {
  const context = contextOf(state);
  const outcomes: CondRecord[] = [];
  const enabled: CompiledTransition[] = [];
  for (const atomic of atomicStatesInDocumentOrder(state)) {
    const transition = selectedForAtomicState(
      state.machine,
      context,
      atomic,
      eventTokens,
      outcomes,
    );
    if (transition !== null) enabled.push(transition);
  }
  const raised = withCondErrors(state, outcomes);
  return {
    state: raised,
    transitions: removeConflictingTransitions(raised, uniqueByIndex(enabled)),
  };
}

/** One evaluated condition, with the transition it belongs to. */
interface CondRecord {
  readonly tIndex: number;
  readonly outcome: CondOutcome;
}

// The outer loop: every active atomic state, in document order.
function atomicStatesInDocumentOrder(state: SelectionState): number[] {
  const atomic = [...state.configuration].filter((index) => isAtomic(state.machine, index));
  return documentOrder(atomic);
}

// The labelled `break loop` of one atomic state's search: the state, then
// each proper ancestor outward, stopping at the first state with an enabled
// transition.
function selectedForAtomicState(
  machine: Machine,
  context: EvaluationContext,
  atomic: number,
  eventTokens: readonly string[] | null,
  outcomes: CondRecord[],
): CompiledTransition | null {
  for (const s of [atomic, ...properAncestors(machine, atomic)]) {
    const transition = firstMatchingTransition(machine, context, s, eventTokens, outcomes);
    if (transition !== null) return transition;
  }
  return null;
}

// The per-state inner loop: the state's own transitions in document order,
// stopping at the first enabled one, so a later sibling's condition is never
// evaluated once an earlier one is taken.
function firstMatchingTransition(
  machine: Machine,
  context: EvaluationContext,
  s: number,
  eventTokens: readonly string[] | null,
  outcomes: CondRecord[],
): CompiledTransition | null {
  for (const tIndex of stateAt(machine, s).transitions) {
    const transition = transitionAt(machine, tIndex);
    if (transitionEnabled(context, transition, eventTokens, outcomes)) return transition;
  }
  return null;
}

// The eventless predicate (no event attribute) when `eventTokens` is null,
// the event-matched one (an event attribute that matches) otherwise; both
// end in the transition's condition. Only a failed condition is recorded:
// it is the one outcome the round acts on.
function transitionEnabled(
  context: EvaluationContext,
  transition: CompiledTransition,
  eventTokens: readonly string[] | null,
  outcomes: CondRecord[],
): boolean {
  const eventless = transition.events.length === 0;
  if (eventTokens === null ? !eventless : eventless) return false;
  if (eventTokens !== null && !nameMatch(transition.events, eventTokens)) return false;
  const outcome = evaluateCond(context, transition.cond ?? undefined);
  if (!outcome.ok) outcomes.push({ tIndex: transition.tIndex, outcome });
  return outcome.ok && outcome.value;
}

// The failed conditions' `error.execution` events joined to the internal
// queue, in walk order. The state is answered as it came when none failed.
function withCondErrors<S extends SelectionState>(state: S, outcomes: readonly CondRecord[]): S {
  if (outcomes.length === 0) return state;
  return { ...state, internalQueue: raiseCondErrors(state.internalQueue, outcomes, state) };
}

// The enabled list keeping each transition's first occurrence.
function uniqueByIndex(transitions: readonly CompiledTransition[]): CompiledTransition[] {
  const seen = new Set<number>();
  return transitions.filter((t) => {
    if (seen.has(t.tIndex)) return false;
    seen.add(t.tIndex);
    return true;
  });
}

// The context one evaluation site runs against: the datamodel, and `In()`
// reading the configuration through the chart's own ids.
function contextOf(state: SelectionState): EvaluationContext {
  const states: ActiveStates = {
    indexOf: (stateId) => state.machine.idToIndex.get(stateId),
    configuration: state.configuration,
  };
  return evaluationContext(state.datamodel, states);
}
