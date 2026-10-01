// Position export and import: a running chart's state in the string-id
// vocabulary the reference migrates a position in, out and back in.
//
// The reference is `Statifier.Position.export/1` and `import/2` in
// statifier-ex at v2.9.0. `export/1` translates a position's state indexes
// to the ids the document wrote, drops the root, and refuses a position
// whose internal queue holds an event (`internal_queue_not_empty`) or that
// holds a state, other than the root, with no written id
// (`unnameable_states`, every such index, sorted). `import/2` checks every
// required key is present (`check_required_keys/1`) and then each one's
// shape (`check_shapes/1`), both as `malformed_export`; then resolves every
// id against the chart and refuses with every unknown id at once, sorted
// (`unknown_state_ids`); and rebuilds the position with the root re-added,
// the internal queue empty and the per-drive fields left for the driver to
// stamp. It performs no identity check: the exported `identity` is
// provenance, read by nobody. A key that is not required is not looked at.
// The binary envelope beside them, and the identity check that belongs to
// it, are not ported.
//
// A driver state already holds the reference's export vocabulary as its
// first block of fields, spelled in camel case, so the export is that block
// and the chart identity, with the driver's own fields dropped: the session
// id, the virtual clock, the pending timers, the queues, the delayed sends
// processors hold, the budget halt and the stopped chart's donedata. The
// import is the reverse: the position's block, the given chart's identity,
// and the driver's fields as a fresh session leaves them - the clock at
// zero, no timer, empty queues, nothing held, no halt - with the session id
// read from `_sessionid`, the system variable the chart itself reads it
// from. The state is then written once through the driver's own codec, so
// an imported state is in exactly the form a drive answers.

import { decodeTagged } from "@riddler/predicator/tagged";
import type { Chart, ChartIdentity } from "./compiler.js";
import type { RoundBudget } from "./core/interpreter.js";
import { type ActiveInvocation, rewrite, type State } from "./driver.js";
import { POSITION_KEYS, positionShapeFailure } from "./driver-shape.js";

/**
 * A position in the string-id vocabulary: the reference's required export
 * keys in camel case, and the identity of the chart it was exported from.
 * Every list of states is sorted, and the root is never named.
 */
export interface ExportedPosition {
  /** Provenance only: `importPosition` never reads it. */
  readonly identity: ChartIdentity;
  /** The active states' ids, root excluded, sorted. */
  readonly configuration: readonly string[];
  /** Every state ever entered, root excluded, sorted. */
  readonly enteredStates: readonly string[];
  /** States whose invocations have not started, sorted. */
  readonly statesToInvoke: readonly string[];
  /** Each history state's id to its recorded states' ids, sorted. */
  readonly historyValues: Readonly<Record<string, readonly string[]>>;
  readonly activeInvocations: readonly ActiveInvocation[];
  readonly invokeCounter: number;
  readonly sendCounter: number;
  readonly timerCounter: number;
  /** Every datamodel root, the system variables included, as tagged-value text. */
  readonly datamodel: Readonly<Record<string, string>>;
  readonly running: boolean;
  readonly status: "running" | "done";
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
  readonly trace: boolean;
  readonly maxMacrostepRounds: RoundBudget;
}

/**
 * Why a position could not be exported. `internal_queue_not_empty`: the
 * state is mid-macrostep, with an internal event selected against this
 * chart's transitions still waiting. `unnameable_states`: the state holds a
 * state, other than the root, the document gave no id; `indexes` names every
 * one, sorted.
 */
export type ExportRefused =
  | { readonly ok: false; readonly reason: "internal_queue_not_empty" }
  | {
      readonly ok: false;
      readonly reason: "unnameable_states";
      readonly indexes: readonly number[];
    };

/** What `exportPosition` answers. */
export type ExportResult =
  | { readonly ok: true; readonly position: ExportedPosition }
  | ExportRefused;

/**
 * What made an export malformed: a value that is not an object at all;
 * required keys missing, every one named, sorted; the first required field
 * of the wrong type, by its path; a datamodel value whose text does not
 * decode; or a datamodel whose `_sessionid` is not a string, so the state
 * has no session to run as.
 */
export type MalformedExport =
  | { readonly kind: "not_an_object" }
  | { readonly kind: "missing_keys"; readonly keys: readonly string[] }
  | { readonly kind: "bad_shape"; readonly field: string }
  | { readonly kind: "undecodable_value"; readonly field: string }
  | { readonly kind: "no_session_id"; readonly field: string };

/**
 * Why a position could not be imported, with exactly the reference's two
 * reasons. `malformed_export`: the value is not an exported position;
 * `detail` says what failed. `unknown_state_ids`: the position names states
 * the chart does not hold; `ids` names every one, sorted.
 */
export type ImportRefused =
  | {
      readonly ok: false;
      readonly reason: "unknown_state_ids";
      readonly ids: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: "malformed_export";
      readonly detail: MalformedExport;
    };

/** What `importPosition` answers. */
export type ImportResult = { readonly ok: true; readonly state: State } | ImportRefused;

const SESSION_ID = "_sessionid";

function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// Every state name a position's fields hold, in no particular order.
function namedStates(position: {
  readonly configuration: readonly string[];
  readonly enteredStates: readonly string[];
  readonly statesToInvoke: readonly string[];
  readonly historyValues: Readonly<Record<string, readonly string[]>>;
  readonly activeInvocations: readonly ActiveInvocation[];
}): Set<string> {
  const named = new Set([
    ...position.configuration,
    ...position.enteredStates,
    ...position.statesToInvoke,
  ]);
  for (const [history, recorded] of Object.entries(position.historyValues)) {
    named.add(history);
    for (const name of recorded) named.add(name);
  }
  for (const invocation of position.activeInvocations) named.add(invocation.state);
  return named;
}

// The index of a state the driver names `#` and its index because the
// document gave it no id; null for a written id, which can never start
// with `#`.
function unnamedIndex(name: string): number | null {
  return /^#[0-9]+$/.test(name) ? Number(name.slice(1)) : null;
}

/**
 * The position a driver state holds, in the string-id vocabulary, or the
 * reason it cannot be exported. Pending timers, the queues and the rest of
 * the driver's own fields are not part of a position and are not written.
 */
export function exportPosition(state: State): ExportResult {
  if (state.internalQueue.length > 0) return { ok: false, reason: "internal_queue_not_empty" };
  const unnameable = [...namedStates(state)]
    .map(unnamedIndex)
    .filter((index): index is number => index !== null && index !== 0)
    .sort((a, b) => a - b);
  if (unnameable.length > 0) return { ok: false, reason: "unnameable_states", indexes: unnameable };
  return {
    ok: true,
    position: {
      identity: { ...state.identity },
      configuration: [...state.configuration],
      enteredStates: [...state.enteredStates],
      statesToInvoke: [...state.statesToInvoke],
      historyValues: Object.fromEntries(
        Object.entries(state.historyValues).map(([history, recorded]) => [history, [...recorded]]),
      ),
      activeInvocations: state.activeInvocations.map((invocation) => ({ ...invocation })),
      invokeCounter: state.invokeCounter,
      sendCounter: state.sendCounter,
      timerCounter: state.timerCounter,
      datamodel: { ...state.datamodel },
      running: state.running,
      status: state.status,
      macrostep: state.macrostep,
      microstep: state.microstep,
      round: state.round,
      trace: state.trace,
      maxMacrostepRounds: state.maxMacrostepRounds,
    },
  };
}

function malformed(detail: MalformedExport): ImportRefused {
  return { ok: false, reason: "malformed_export", detail };
}

/**
 * A driver state over `chart` rebuilt from an exported position, or the
 * reason it cannot be. The position's identity is not read: a position may
 * be loaded onto any chart that holds every state it names. The driver's own
 * fields start as a fresh session's do, and the session id is the one the
 * position's `_sessionid` holds.
 */
export function importPosition(chart: Chart, exported: unknown): ImportResult {
  if (typeof exported !== "object" || exported === null || Array.isArray(exported)) {
    return malformed({ kind: "not_an_object" });
  }
  const missing = POSITION_KEYS.filter((key) => !Object.hasOwn(exported, key)).sort(byCodeUnit);
  if (missing.length > 0) return malformed({ kind: "missing_keys", keys: missing });
  const badShape = positionShapeFailure(exported);
  if (badShape !== null) return malformed({ kind: "bad_shape", field: badShape });
  const position = exported as ExportedPosition;
  let sessionId: string | null = null;
  for (const [root, text] of Object.entries(position.datamodel)) {
    const decoded = decodeTagged(text);
    if (!decoded.ok) return malformed({ kind: "undecodable_value", field: `datamodel.${root}` });
    if (root === SESSION_ID && typeof decoded.value === "string") sessionId = decoded.value;
  }
  if (sessionId === null) {
    return malformed({ kind: "no_session_id", field: `datamodel.${SESSION_ID}` });
  }
  const unknown = [...namedStates(position)]
    .filter((name) => !chart.machine.idToIndex.has(name))
    .sort(byCodeUnit);
  if (unknown.length > 0) return { ok: false, reason: "unknown_state_ids", ids: unknown };
  const rebuilt = rewrite(chart, {
    identity: chart.identity,
    configuration: position.configuration,
    enteredStates: position.enteredStates,
    statesToInvoke: position.statesToInvoke,
    historyValues: position.historyValues,
    activeInvocations: position.activeInvocations,
    invokeCounter: position.invokeCounter,
    sendCounter: position.sendCounter,
    timerCounter: position.timerCounter,
    datamodel: position.datamodel,
    running: position.running,
    status: position.status,
    macrostep: position.macrostep,
    microstep: position.microstep,
    round: position.round,
    trace: position.trace,
    maxMacrostepRounds: position.maxMacrostepRounds,
    sessionId,
    nowMs: 0,
    timers: [],
    timerSequence: 0,
    externalQueue: [],
    internalQueue: [],
    heldSends: {},
    halted: null,
    done: null,
  });
  // Every check the rewrite makes has been made above, so a refusal here is
  // a bug in this module, not an outcome a caller handles.
  if (!rebuilt.ok)
    throw new Error(`importPosition: a checked position was refused (${rebuilt.reason})`);
  return { ok: true, state: rebuilt.state };
}
