// The position round-trip property: a self-consistency claim over the scion
// suite.
//
// For each scion case it drives the chart as the scion runner does (the
// settle window before each event, the configuration deadline after it) and
// takes a POINT after the start and after every step. At each point it
// exports the state's position, writes it to JSON text and reads it back,
// compiles the case's source again into a fresh chart, imports the position
// into it, and then drives the remaining steps on the imported state the same
// way. The imported state must agree with the unbroken drive at the point and
// after every later step; see `disagreement` for what "agree" compares.
//
// A point the export cannot carry is counted with its reason rather than
// compared. Two reasons are the export's own refusals
// (`internal_queue_not_empty`, `unnameable_states`). The others are driver
// state, which is not a position field: a pending timer (`pending_timers`),
// an external event not yet taken (`external_queue_not_empty`), a delayed
// send a processor holds (`held_sends`), and a spent round budget (`halted`).
// An import would start each of those empty, so the continuation would be a
// different drive, not a lost position.
//
// The claim is the package agreeing with itself: nothing is lost on the way
// out and back. It says nothing about whether the export matches the
// reference's; that needs corpus cases that assert the exported position,
// which the reference does not emit yet.
//
// Like the runner, this reaches nothing outside the language.

import type { CorpusCase } from "../../scripts/lib/corpus-rules.d.mts";
import { type Chart, compile } from "../../src/compiler.js";
import { isDone, type State, start, step } from "../../src/driver.js";
import { POSITION_KEYS } from "../../src/driver-shape.js";
import { type ExportResult, exportPosition, importPosition } from "../../src/position.js";
import { awaitConfiguration, settle } from "./scion.js";

/** Why a point's state cannot travel in a position. */
export type NotCarriedReason =
  | "internal_queue_not_empty"
  | "unnameable_states"
  | "pending_timers"
  | "external_queue_not_empty"
  | "held_sends"
  | "halted";

/** Exports a state's position; the property takes it as a parameter so a planted drop can be tested. */
export type ExportPosition = (state: State) => ExportResult;

/**
 * One point of one case: the start (`point` 0) or after step `point`. It was
 * carried and every later state agreed, it was not carried and why, or it
 * was carried and something disagreed, with where and how.
 */
export type PointResult =
  | { readonly caseId: string; readonly point: number; readonly outcome: "agree" }
  | {
      readonly caseId: string;
      readonly point: number;
      readonly outcome: "not_carried";
      readonly reason: NotCarriedReason;
    }
  | {
      readonly caseId: string;
      readonly point: number;
      readonly outcome: "disagree";
      readonly reason: string;
    };

/** The property's counts over a set of cases, and every disagreement. */
export interface PositionReport {
  readonly cases: number;
  readonly steps: number;
  readonly points: number;
  readonly agreeing: number;
  readonly notCarried: Readonly<Partial<Record<NotCarriedReason, number>>>;
  readonly disagreements: readonly PointResult[];
}

function chartOf(testCase: CorpusCase): Chart {
  const compiled = compile(testCase.source);
  if (!compiled.ok) throw new Error(`${testCase.id}: the source does not compile`);
  return compiled.chart;
}

function where(point: number): string {
  return point === 0 ? "the start" : `step ${point}`;
}

/**
 * The scion runner's drive, recording the state after the start and after
 * every step. Each case the registry claims passes this drive, so a refusal
 * here is a broken case, thrown.
 */
function unbroken(chart: Chart, testCase: CorpusCase): State[] {
  const started = start(chart, { sessionId: testCase.id });
  if (!started.ok) throw new Error(`${testCase.id}: start was refused: ${started.reason}`);
  let state = awaitConfiguration(chart, started.state, testCase.initial_configuration, 0);
  const states = [state];
  for (const [index, { event, configuration }] of testCase.steps.entries()) {
    const settled = settle(chart, state);
    const stepped = step(chart, settled, { name: event.name });
    if (!stepped.ok) {
      throw new Error(`${testCase.id}: ${where(index + 1)} was refused: ${stepped.reason}`);
    }
    state = awaitConfiguration(chart, stepped.state, configuration, settled.nowMs);
    states.push(state);
  }
  return states;
}

/**
 * Null when the imported drive's state agrees with the unbroken drive's,
 * else the first thing that differs. Compared: every field a position
 * holds (the configuration first, then the rest in the position's own key
 * order: the entered states, the history, the counters, every datamodel
 * root's text, running and status among them), whether `isDone` answers
 * stopped, and, for a chart that stopped AFTER the import, the
 * configuration it stopped in. A chart that was already stopped at the
 * point is not compared at that last one: its configuration at the stop
 * travels in the done effect, never in the position, so the imported state
 * answers the position's own configuration there instead; the configuration
 * the state holds, running, status and `isDone` are what say the two have
 * both stopped.
 */
export function disagreement(
  original: State,
  imported: State,
  stoppedAtPoint: boolean,
): string | null {
  const before = original as unknown as Readonly<Record<string, unknown>>;
  const after = imported as unknown as Readonly<Record<string, unknown>>;
  for (const key of ["configuration", ...POSITION_KEYS.filter((key) => key !== "configuration")]) {
    if (key === "datamodel") {
      const roots = new Set([
        ...Object.keys(original.datamodel),
        ...Object.keys(imported.datamodel),
      ]);
      for (const root of [...roots].sort()) {
        const was = original.datamodel[root];
        const is = imported.datamodel[root];
        if (was !== is) return `datamodel.${root} is ${is}, the unbroken drive's ${was}`;
      }
      continue;
    }
    const was = JSON.stringify(before[key]);
    const is = JSON.stringify(after[key]);
    if (was !== is) return `${key} is ${is}, the unbroken drive's ${was}`;
  }
  const originalDone = isDone(original);
  const importedDone = isDone(imported);
  if (!originalDone.ok || !importedDone.ok) return "isDone refused a state a drive answered";
  if (originalDone.done !== importedDone.done) {
    return `isDone answers ${importedDone.done}, the unbroken drive's ${originalDone.done}`;
  }
  if (
    originalDone.done &&
    importedDone.done &&
    !stoppedAtPoint &&
    JSON.stringify(originalDone.configuration) !== JSON.stringify(importedDone.configuration)
  ) {
    return `the chart stopped in ${JSON.stringify(importedDone.configuration)}, the unbroken drive's in ${JSON.stringify(originalDone.configuration)}`;
  }
  return null;
}

/** Why the point's state cannot travel in a position, or null when it can. */
function driverState(state: State): NotCarriedReason | null {
  if (state.timers.length > 0) return "pending_timers";
  if (state.externalQueue.length > 0) return "external_queue_not_empty";
  if (Object.keys(state.heldSends).length > 0) return "held_sends";
  if (state.halted !== null) return "halted";
  return null;
}

function roundTrip(
  testCase: CorpusCase,
  states: readonly State[],
  point: number,
  exportState: ExportPosition,
): PointResult {
  const caseId = testCase.id;
  const original = states[point] as State;
  const exported = exportState(original);
  if (!exported.ok) return { caseId, point, outcome: "not_carried", reason: exported.reason };
  const held = driverState(original);
  if (held !== null) return { caseId, point, outcome: "not_carried", reason: held };

  const fail = (reason: string): PointResult => ({ caseId, point, outcome: "disagree", reason });
  const chart = chartOf(testCase);
  const imported = importPosition(chart, JSON.parse(JSON.stringify(exported.position)));
  if (!imported.ok) return fail(`the import was refused: ${imported.reason}`);

  const stoppedAtPoint = original.done !== null;
  let state = imported.state;
  const atPoint = disagreement(original, state, stoppedAtPoint);
  if (atPoint !== null) return fail(`at the import: ${atPoint}`);
  for (let later = point + 1; later < states.length; later += 1) {
    const { event, configuration } = testCase.steps[later - 1] as CorpusCase["steps"][number];
    const settled = settle(chart, state);
    const stepped = step(chart, settled, { name: event.name });
    if (!stepped.ok)
      return fail(`${where(later)}: the imported chart refused the event: ${stepped.reason}`);
    state = awaitConfiguration(chart, stepped.state, configuration, settled.nowMs);
    const found = disagreement(states[later] as State, state, stoppedAtPoint);
    if (found !== null) return fail(`${where(later)}: ${found}`);
  }
  return { caseId, point, outcome: "agree" };
}

/** The property at every point of one scion case: the start, then after each step. */
export function positionRoundTrip(
  testCase: CorpusCase,
  exportState: ExportPosition = exportPosition,
): PointResult[] {
  const states = unbroken(chartOf(testCase), testCase);
  return states.map((_, point) => roundTrip(testCase, states, point, exportState));
}

/** The property over every case given, counted. */
export function runPositionProperty(
  cases: readonly CorpusCase[],
  exportState: ExportPosition = exportPosition,
): PositionReport {
  const results = cases.flatMap((testCase) => positionRoundTrip(testCase, exportState));
  const notCarried: Partial<Record<NotCarriedReason, number>> = {};
  for (const result of results) {
    if (result.outcome === "not_carried") {
      notCarried[result.reason] = (notCarried[result.reason] ?? 0) + 1;
    }
  }
  return {
    cases: cases.length,
    steps: cases.reduce((sum, testCase) => sum + testCase.steps.length, 0),
    points: results.length,
    agreeing: results.filter((result) => result.outcome === "agree").length,
    notCarried,
    disagreements: results.filter((result) => result.outcome === "disagree"),
  };
}

/** The report's summary lines, as the gate stage and `pnpm conformance` print them. */
export function positionLines(report: PositionReport): string[] {
  const reasons = Object.entries(report.notCarried)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([reason, count]) => `${reason} ${count}`);
  const notCarried = report.points - report.agreeing - report.disagreements.length;
  return [
    `position: ${report.points} points over ${report.cases} scion cases (${report.cases} starts and ${report.steps} steps)`,
    `position: ${report.agreeing} round trips agree, ${report.disagreements.length} disagree`,
    `position: ${notCarried} points not carried${reasons.length > 0 ? `: ${reasons.join(", ")}` : ""}`,
    ...report.disagreements.map((result) =>
      result.outcome === "disagree"
        ? `  - ${result.caseId} at ${where(result.point)}: ${result.reason}`
        : "",
    ),
  ];
}
