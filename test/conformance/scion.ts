// The scion case runner: drives one corpus case through the in-memory driver
// and compares what the reference compares.
//
// For each case it compiles the source, starts the chart, and compares the
// active leaf set with the case's initial configuration; then for each step it
// settles the virtual clock, sends the step's event, waits on the virtual clock
// for the expectation, and compares again. It compares the ACTIVE LEAF SET -
// the active states that have no child, by id - and not the full
// configuration, as the reference's harness does (`assert_configuration/3` and
// `active_leaf_states/1` in `lib/statifier/testing/case.ex` at v2.9.0). An
// active leaf with no id fails the case, as the reference's
// `assert_every_leaf_named/2` does: no expectation can name it, so a set
// comparison alone would let it pass unobserved. A stopped chart is compared
// at the configuration it held when it stopped, which the reference reads off
// its done effect and the driver keeps in its state.
//
// The virtual clock, in the two knobs the conformance apparatus record fixes
// (decision 8 of `docs/adr/0003-the-conformance-apparatus.md`), each from the
// reference's harness:
//
// - The settle window. Before each event, while a timer is pending and the
//   earliest falls due within 100 virtual ms of the window's start, the clock
//   jumps to that timer's due time and fires it (with every other timer due
//   then, in the order they were scheduled, and each run to completion before
//   the next, which is how the driver's `advance` fires). A timer due later
//   than the window stays pending, and the clock ends the window at its end;
//   when no timer is left, the clock stays where the last one fired, as the
//   reference stops waiting the moment nothing is pending.
// - The configuration deadline. After the start and after each event, while
//   the active leaf set differs from the expectation, the chart has not
//   stopped and a timer is pending whose due time is within 4000 virtual ms
//   of the event, the clock jumps to the earliest due time and fires what is
//   due; the comparison is made once none of that holds.
//
// The clock only ever jumps to a due time, because nothing but a firing timer
// changes the configuration between two events; the reference's 5 ms poll and
// its two-poll debounce answer races between processes on a real clock that a
// virtual clock does not have. When no timer is pending neither knob does
// anything, so this one drive reproduces both of the reference's paths: the
// synchronous one, which has no timing, and the session one, which has these
// two knobs. Only the event's name is sent, as the reference's harness sends
// only the name.
//
// Every case runs: no feature the scion suite requires is one this package
// does not run, so no case is failed before it starts.
//
// Like the runner, this reaches nothing outside the language.

import type { CorpusCase } from "../../scripts/lib/corpus-rules.d.mts";
import { type Chart, compile } from "../../src/compiler.js";
import { advance, type DriveResult, type State, start, step } from "../../src/driver.js";
import { isAtomic } from "../../src/machine.js";
import type { CaseOutcome } from "./runner.js";

/** How long, in virtual ms, the clock may run before an event to drain short timers. */
export const SETTLE_WINDOW_MS = 100;

/** How long, in virtual ms after an event, the runner waits for the expectation. */
export const CONFIGURATION_DEADLINE_MS = 4000;

/** What a comparison found: the leaves, or the sentence saying why they cannot be compared. */
type Leaves =
  | { readonly ok: true; readonly ids: string[] }
  | { readonly ok: false; readonly reason: string };

function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function list(ids: readonly string[]): string {
  return `[${[...ids].sort(byCodeUnit).join(", ")}]`;
}

/**
 * The active leaf set, by id: the active states with no child. A stopped chart
 * answers the configuration it held when it stopped. A leaf the document gave
 * no id is counted, never named.
 */
export function activeLeaves(chart: Chart, state: State): Leaves {
  const machine = chart.machine;
  const names = state.done === null ? state.configuration : state.done.configuration;
  const ids: string[] = [];
  let unnamed = 0;
  for (const name of names) {
    const index = machine.idToIndex.get(name) ?? Number(name.slice(1));
    if (!isAtomic(machine, index)) continue;
    if (machine.states[index]?.id === null) unnamed += 1;
    else ids.push(name);
  }
  if (unnamed > 0) {
    return {
      ok: false,
      reason: `${unnamed} active leaf state(s) have no id; the expectation ${list(ids)} cannot name them`,
    };
  }
  return { ok: true, ids: ids.sort(byCodeUnit) };
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const expected = new Set(right);
  const actual = new Set(left);
  return expected.size === actual.size && [...expected].every((id) => actual.has(id));
}

function matches(chart: Chart, state: State, expected: readonly string[]): boolean {
  const leaves = activeLeaves(chart, state);
  return leaves.ok && sameSet(leaves.ids, expected);
}

function earliestDue(state: State): number | undefined {
  let earliest: number | undefined;
  for (const timer of state.timers) {
    if (earliest === undefined || timer.dueMs < earliest) earliest = timer.dueMs;
  }
  return earliest;
}

/** A refused drive, as a thrown bug: every call here is handed a state the driver made. */
function moved(result: DriveResult, call: string): State {
  if (result.ok) return result.state;
  throw new Error(`the driver refused ${call}: ${result.reason}`);
}

/**
 * The settle window: fires every timer due within `SETTLE_WINDOW_MS` of the
 * clock's time, earliest first, and ends the window at its end when a timer
 * is still pending.
 */
export function settle(chart: Chart, state: State): State {
  const windowEnd = state.nowMs + SETTLE_WINDOW_MS;
  let current = state;
  for (;;) {
    const due = earliestDue(current);
    if (due === undefined) return current;
    if (due > windowEnd)
      return moved(advance(chart, current, windowEnd - current.nowMs), "advance");
    current = moved(advance(chart, current, due - current.nowMs), "advance");
  }
}

/**
 * The configuration deadline: fires due timers, earliest first, until the
 * active leaf set is the expectation, the chart has stopped, no timer is
 * pending, or the next one falls due later than `CONFIGURATION_DEADLINE_MS`
 * after `since`.
 */
export function awaitConfiguration(
  chart: Chart,
  state: State,
  expected: readonly string[],
  since: number,
): State {
  const deadline = since + CONFIGURATION_DEADLINE_MS;
  let current = state;
  for (;;) {
    if (matches(chart, current, expected) || current.done !== null) return current;
    const due = earliestDue(current);
    if (due === undefined || due > deadline) return current;
    current = moved(advance(chart, current, due - current.nowMs), "advance");
  }
}

/** The comparison after the start or a step: null when it agrees, else the reason. */
function compare(
  chart: Chart,
  state: State,
  expected: readonly string[],
  where: string,
): string | null {
  const leaves = activeLeaves(chart, state);
  if (!leaves.ok) return `${where}: ${leaves.reason}`;
  if (sameSet(leaves.ids, expected)) return null;
  return `${where}: expected active leaf states ${list(expected)}, got ${list(leaves.ids)}`;
}

function compileFailure(testCase: CorpusCase): { chart: Chart } | { reason: string } {
  const compiled = compile(testCase.source);
  if (compiled.ok) return { chart: compiled.chart };
  const errors = compiled.errors.map((error) => `${error.reason}: ${error.message}`);
  return { reason: `the source does not compile: ${errors.join("; ")}` };
}

/** Runs one scion case: a pass, or a fail whose reason names the step and both leaf sets. */
export function runScionCase(testCase: CorpusCase): CaseOutcome {
  const compiled = compileFailure(testCase);
  if ("reason" in compiled) return { result: "fail", reason: compiled.reason };
  const { chart } = compiled;

  const started = start(chart, { sessionId: testCase.id });
  if (!started.ok) return { result: "fail", reason: `start was refused: ${started.reason}` };
  let state = awaitConfiguration(chart, started.state, testCase.initial_configuration, 0);
  const initial = compare(
    chart,
    state,
    testCase.initial_configuration,
    "the initial configuration",
  );
  if (initial !== null) return { result: "fail", reason: initial };

  for (const [index, { event, configuration }] of testCase.steps.entries()) {
    const where = `step ${index + 1} (event ${JSON.stringify(event.name)})`;
    const settled = settle(chart, state);
    const stepped = step(chart, settled, { name: event.name });
    if (!stepped.ok) {
      return {
        result: "fail",
        reason: `${where}: the driver refused the event: ${stepped.reason}`,
      };
    }
    state = awaitConfiguration(chart, stepped.state, configuration, settled.nowMs);
    const found = compare(chart, state, configuration, where);
    if (found !== null) return { result: "fail", reason: found };
  }
  return { result: "pass" };
}
