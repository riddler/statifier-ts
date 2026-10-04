// The statifier case runner: drives one case of the statifier suite through
// the in-memory driver and compares what the reference compares.
//
// The reference's runner routes a statifier case by whether it carries a
// `host` object (`run_case/1` in `lib/mix/statifier/corpus/runner.ex` at
// v2.9.0). A case with none runs through `test_scxml/4`, as a scion case does,
// so it is driven here by the scion runner's one drive
// (`test/conformance/scion.ts`). A case with one runs through the reference's
// host-case harness (`Mix.Statifier.Corpus.HostCase` in
// `lib/mix/statifier/corpus/host_case.ex`), which this file follows:
//
// - The host registers each of the case's `send_types` with one processor of
//   its own, which records every send it is handed and delivers none. A
//   delayed send handed to it is its timer, and it never fires one. Here that
//   processor is a `SendProcessor` passed to every driver call through the
//   public `sendTypes` option.
// - The drive is the scion runner's: the active leaf set compared after the
//   start and after each step, under the same two virtual-clock knobs. A
//   step's event carries the step's `data`, when it gives one, as the
//   reference's harness injects it.
// - Each handed send is written in the case's item shape (the harness's
//   `item/2`): `type`, `target`, `event` with its `name` and, when the send
//   carries a payload, its `data`; `delay_ms` for a delayed send; `send_id`
//   only when the author named the send. Once every step agrees, the items
//   handed over the whole run, in order, must be exactly the case's
//   `expect_sends`.
// - A cancel that reaches the processor marks `"outcome": "cancelled"` on each
//   delayed send handed before it under the cancel's send id whose expected
//   item asks for it (the harness's `cancel_named/2`), so a marked item no
//   cancel reached disagrees.
// - A handed send whose expected item, at the same position, carries
//   `"outcome": "fail"` is reported failed, and its item marked so, as the
//   harness's `perform_outcome/4` reports it through
//   `Statifier.Session.failed_send/3` as soon as it reads the processor's
//   message: here through the driver's `reportSendFailed` once the call that
//   handed it returns, before the configuration is read, so the step that led
//   to the send is the one whose configuration shows what the sender made of
//   the `error.communication` it got. A report the driver refuses because the
//   chart has stopped is dropped, as the reference's session ignores one; any
//   other refusal fails the case.
//
// A case whose host carries a diff pair - `to_source` and `expect_diff`, with
// an optional `mapping` and `expect_compatible_at` - is driven here like any
// other host case, as the reference's runner drives it: its moduledoc says
// that runner "compares none of them", and the reference compares the four
// keys only in its own test suite (`test/corpus/diff_cases_test.exs` at
// v2.10.0), through its chart diff and its position predicate, which this
// package does not port. So a diff case agrees here on its configurations and
// its sends, the comparisons the reference's runner makes for it.
//
// A case whose host carries `declared_events` and `expect_accepts` has its
// chart's accepts check compared before it is driven, as the reference's
// harness compares it (`accepts/2` in `host_case.ex` at v2.10.0): the check's
// two lists, `unreachable` and `undeclared`, must be exactly the expected
// ones, order included, and either key without the other is a disagreement.
// The check is this package's `checkAccepts`, the port of the reference's
// `Statifier.Chart.check_accepts/2`.
//
// A case whose host carries `event_io_processors` - at v2.10.0 a w3c case,
// which the w3c runner routes here - has each processor it names registered
// as the reference's `with_event_io_processors/2` registers it, after the
// accepts check and before the start: the package's own Basic HTTP processor,
// under its URI and its short form, delivering through an in-memory loopback
// front (`test/conformance/loopback.ts`) rather than the reference's HTTP
// server. Its deliveries settle on the job queue, so this drive is async: the
// configuration is read one timer at a time, and before each timer fires,
// every delivery handed so far is let settle, each event the front took is
// stepped into the session and each miss the processor reported is reported
// through `reportSendFailed`, as the reference's front and processor reach
// its session while its harness polls. An event delivered through the front
// is so taken at the virtual time its send was made, ahead of any timer the
// clock has yet to reach; a request over the loopback takes no virtual time.
// So a chart that sends to itself through the processor on every delivery
// would never let an exchange end: the exchange is bounded at
// `MAX_EXCHANGE_ROUNDS` rounds, and a case past the bound fails with
// `EXCHANGE_NOT_SETTLED` rather than holding the run. The reference's
// harness ends such a chart at its real deadline instead.
// No feature check is made for a host case, as the reference's harness makes
// none.
//
// Like the runner, this reaches nothing outside the language.

import { fromHost, toHost, typeName, type Value } from "@riddler/predicator";
import type { CorpusCase, CorpusStep } from "../../scripts/lib/corpus-rules.d.mts";
import { checkAccepts } from "../../src/accepts.js";
import type { Chart } from "../../src/compiler.js";
import type { Cancel, Send, SendDelayed } from "../../src/core/send.js";
import type { Event } from "../../src/datamodel.js";
import {
  advance,
  type DriveOptions,
  type DriveResult,
  type HostEvent,
  reportSendFailed,
  type SendProcessor,
  type SendProcessors,
  type State,
  start,
  step,
} from "../../src/driver.js";
import {
  EVENT_IO_PROCESSORS,
  type EventIoProcessors,
  PROCESSOR_NOT_REGISTERED,
  processorsNotRegistered,
  type Wire,
  wireEventIoProcessors,
} from "./loopback.js";
import type { CaseOutcome } from "./runner.js";
import {
  CONFIGURATION_DEADLINE_MS,
  compareLeafSets,
  compileCase,
  earliestDue,
  runScionCase,
  SETTLE_WINDOW_MS,
} from "./scion.js";

/**
 * The accepts check's comparison, before the case is driven: null when the
 * host carries neither key or `checkAccepts` answers exactly the expected
 * lists, else the reason.
 */
export function compareAccepts(
  chart: Chart,
  host: Readonly<Record<string, unknown>>,
): string | null {
  const declared = Object.hasOwn(host, "declared_events");
  const expected = Object.hasOwn(host, "expect_accepts");
  if (!declared && !expected) return null;
  if (!expected) return "declared_events is present without expect_accepts";
  if (!declared) return "expect_accepts is present without declared_events";
  const check = checkAccepts(chart, host.declared_events as readonly string[] | null);
  const actual = { unreachable: check.unreachable, undeclared: check.undeclared };
  if (canonical(actual) === canonical(host.expect_accepts)) return null;
  return `expected the accepts check ${canonical(host.expect_accepts)}, got ${canonical(actual)}`;
}

/** One send in the case's item shape. */
export interface SendItem {
  readonly type: unknown;
  readonly target: unknown;
  readonly event: { readonly name: string; readonly data?: unknown };
  readonly delay_ms?: number;
  readonly send_id?: string;
  readonly outcome?: "fail" | "cancelled";
}

// A payload the harness leaves out: undefined, null, or an empty map.
function noPayload(value: Value): boolean {
  if (typeName(value) === "undefined" || value === null) return true;
  return typeName(value) === "map" && Object.keys(value as object).length === 0;
}

/** A handed send in the case's item shape, as the reference's `item/2` writes it. */
export function itemOf(send: Send | SendDelayed, event: Event): SendItem {
  return {
    type: toHost(send.type),
    target: toHost(send.target),
    event: noPayload(event.data)
      ? { name: event.name }
      : { name: event.name, data: toHost(event.data) },
    ...(send.kind === "send_delayed" ? { delay_ms: send.delayMs } : {}),
    ...(event.sendid === undefined ? {} : { send_id: event.sendid }),
  };
}

interface Handed {
  readonly sendId: string;
  readonly expected: SendItem | undefined;
  item: SendItem;
}

/** The host a case registers: one processor for every send type, and what it was handed. */
export interface Host {
  readonly options: DriveOptions;
  readonly handed: readonly SendItem[];
  /**
   * The handed sends whose expected item asks for a failure and that are not
   * yet reported, in the order they were handed; taking them empties the list.
   */
  takeFailed(): (Send | SendDelayed)[];
}

/**
 * A host for these send types, comparing what it is handed with `expected`,
 * with the Event I/O Processors `delivering` holds registered beside its own
 * processor, as the reference merges the two registrations; they deliver
 * rather than record.
 */
export function hostFor(
  sendTypes: readonly string[],
  expected: readonly SendItem[],
  delivering: SendProcessors = {},
): Host {
  const handed: Handed[] = [];
  let failed: (Send | SendDelayed)[] = [];
  const processor: SendProcessor = {
    deliver(send, event) {
      const item = expected[handed.length];
      const fails = item?.outcome === "fail";
      if (fails) failed.push(send);
      const written = itemOf(send, event);
      handed.push({
        sendId: send.sendId,
        expected: item,
        item: fails ? { ...written, outcome: "fail" } : written,
      });
      return undefined;
    },
    cancel(cancel: Cancel) {
      for (const entry of handed) {
        if (
          entry.sendId === cancel.sendId &&
          entry.expected?.outcome === "cancelled" &&
          entry.item.delay_ms !== undefined
        ) {
          entry.item = { ...entry.item, outcome: "cancelled" };
        }
      }
    },
  };
  const processors: SendProcessors = {
    ...Object.fromEntries(sendTypes.map((type) => [type, processor])),
    ...delivering,
  };
  return {
    options: { sendTypes: processors },
    get handed() {
      return handed.map((entry) => entry.item);
    },
    takeFailed() {
      const taken = failed;
      failed = [];
      return taken;
    },
  };
}

type Observed = State | { readonly reason: string };

/**
 * The most rounds one exchange with the wire takes: a round is one settle of
 * every delivery handed so far and the arrivals it brings back, each handed
 * to the driver. A request over the loopback takes no virtual time, so a
 * chart that sends to itself through the processor on every delivery brings
 * something back on every round, and the clock never reaches a timer that
 * would end it. A run of the vendored cases that name a processor took at
 * most two rounds in any one exchange.
 */
export const MAX_EXCHANGE_ROUNDS = 100;

/** The reason a case fails with when one exchange passes `MAX_EXCHANGE_ROUNDS`. */
export const EXCHANGE_NOT_SETTLED = `the exchange with the loopback front did not settle within ${MAX_EXCHANGE_ROUNDS} rounds`;

// Reports each send the host marked failed and has not reported, in the
// order it was handed. A report refused because the chart has stopped is
// dropped, as the reference's session ignores a report to a finished sender.
function reportFailed(chart: Chart, state: State, host: Host): Observed {
  let current = state;
  for (const send of host.takeFailed()) {
    const reported = reportSendFailed(chart, current, { send }, host.options);
    if (reported.ok) current = reported.state;
    else if (reported.reason !== "not_running") {
      return { reason: `the driver refused the failed-send report: ${reported.reason}` };
    }
  }
  return current;
}

// What the wire brought back since it was last read, handed to the driver in
// the order it arrived, each delivery first allowed to settle: an event the
// front took is stepped into the session, as the reference's front enqueues
// it there, and a miss the processor reported is reported through
// `reportSendFailed`, as the reference's processor reports it to its session.
// Either refused because the chart has stopped is dropped, as the reference's
// stopped session takes neither; any other refusal fails the case. Repeats
// until a settle brings nothing back, for at most `MAX_EXCHANGE_ROUNDS`
// rounds that bring something back; a further round that brings something
// back fails the case with `EXCHANGE_NOT_SETTLED`. With no wire, nothing is
// exchanged.
async function exchange(
  chart: Chart,
  state: State,
  options: DriveOptions,
  wire: Wire | null,
): Promise<Observed> {
  if (wire === null) return state;
  let current = state;
  for (let round = 1; ; round++) {
    await wire.settle();
    const arrivals = wire.take();
    if (arrivals.length === 0) return current;
    if (round > MAX_EXCHANGE_ROUNDS) return { reason: EXCHANGE_NOT_SETTLED };
    for (const arrival of arrivals) {
      const answered =
        arrival.kind === "event"
          ? step(chart, current, arrival.delivered.event, options)
          : reportSendFailed(
              chart,
              current,
              { send: arrival.failure.send, reason: arrival.failure.reason },
              options,
            );
      if (answered.ok) current = answered.state;
      else if (answered.reason !== "not_running") {
        const what = arrival.kind === "event" ? "a delivered event" : "a reported miss";
        return { reason: `the driver refused ${what}: ${answered.reason}` };
      }
    }
  }
}

// The settle window before a step (scion's `settle`), with what the wire
// brings back exchanged after each timer fires: the reference's front and its
// processor reach the session while its harness waits out the window. The
// host's failed sends are not reported here, as the reference's harness
// reads its processor's messages only while it waits for a configuration.
async function settleHost(
  chart: Chart,
  state: State,
  options: DriveOptions,
  wire: Wire | null,
): Promise<Observed> {
  const windowEnd = state.nowMs + SETTLE_WINDOW_MS;
  let current: Observed = state;
  for (;;) {
    if ("reason" in current) return current;
    const due = earliestDue(current);
    if (due === undefined) return current;
    if (due > windowEnd) {
      return moved(advance(chart, current, windowEnd - current.nowMs, options), "advance");
    }
    const fired = moved(advance(chart, current, due - current.nowMs, options), "advance");
    current = await exchange(chart, fired, options, wire);
  }
}

// The state a driver call leads to once it is read (scion's
// `awaitConfiguration`, one timer at a time): before each comparison, every
// failed send the host marked is reported, as the reference's harness
// reports one before it reads the configuration again, and what the wire
// brings back is exchanged, as the reference's front and processor reach the
// session at once rather than after a timer it holds. So an event delivered
// through the front is taken at the virtual time its send was made, ahead of
// any timer the clock has yet to reach.
async function observe(
  chart: Chart,
  state: State,
  expected: readonly string[],
  since: number,
  host: Host,
  wire: Wire | null,
): Promise<Observed> {
  const deadline = since + CONFIGURATION_DEADLINE_MS;
  let current: Observed = state;
  for (;;) {
    for (;;) {
      const reported = reportFailed(chart, current, host);
      if ("reason" in reported) return reported;
      const exchanged = await exchange(chart, reported, host.options, wire);
      if ("reason" in exchanged) return exchanged;
      const unchanged = exchanged === current;
      current = exchanged;
      if (unchanged) break;
    }
    if (compareLeafSets(chart, current, expected, "") === null || current.done !== null) {
      return current;
    }
    const due = earliestDue(current, true);
    if (due === undefined || due > deadline) return current;
    current = moved(advance(chart, current, due - current.nowMs, host.options), "advance");
  }
}

/** A refused drive, as a thrown bug: every call here is handed a state the driver made. */
function moved(result: DriveResult, call: string): State {
  if (result.ok) return result.state;
  throw new Error(`the driver refused ${call}: ${result.reason}`);
}

// Canonical text for a comparison: object keys sorted, list order kept.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    const record = value as Record<string, unknown>;
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The comparison of the handed sends with the expected ones: null when they agree, else the reason. */
export function compareSends(
  expected: readonly SendItem[],
  handed: readonly SendItem[],
): string | null {
  if (canonical(expected) === canonical(handed)) return null;
  return `expected the sends handed to the host ${canonical(expected)}, got ${canonical(handed)}`;
}

// A step's event, carrying the step's data as its payload when it gives one.
function eventOf(event: CorpusStep["event"]): HostEvent | { reason: string } {
  if (!Object.hasOwn(event, "data")) return { name: event.name };
  const data = fromHost(event.data);
  if (!data.ok) return { reason: `the step's data is not a value: ${data.reason}` };
  return { name: event.name, data: data.value };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/**
 * Runs one host case, in the reference's order (`run/2` in `host_case.ex` at
 * v2.10.0): the source compiled, the accepts check compared, the Event I/O
 * Processors the host names registered with a loopback front, then the drive;
 * a pass, or a fail naming what disagreed. No feature check is made: the
 * reference's host-case harness makes none. `registered` is the closed set
 * of processors a case may name, the runner's unless a caller names another.
 */
export async function runHostCase(
  testCase: CorpusCase,
  registered: EventIoProcessors = EVENT_IO_PROCESSORS,
): Promise<CaseOutcome> {
  const spec = testCase.host ?? {};
  const compiled = compileCase(testCase);
  if ("reason" in compiled) return { result: "fail", reason: compiled.reason };
  const { chart } = compiled;
  const accepts = compareAccepts(chart, spec);
  if (accepts !== null) return { result: "fail", reason: accepts };

  const unregistered = processorsNotRegistered(testCase, registered);
  if (unregistered.length > 0) {
    return { result: "fail", reason: `${PROCESSOR_NOT_REGISTERED}: ${unregistered.join(", ")}` };
  }
  const uris = strings(spec.event_io_processors);
  const wired =
    uris.length === 0
      ? null
      : wireEventIoProcessors(uris, (sessionId) => sessionId === testCase.id, registered);
  if (wired !== null && !wired.ok) return { result: "fail", reason: wired.reason };
  const wire = wired === null ? null : wired.wire;

  const expected = (Array.isArray(spec.expect_sends) ? spec.expect_sends : []) as SendItem[];
  const host = hostFor(strings(spec.send_types), expected, wire?.sendTypes ?? {});
  const { options } = host;

  const started = start(chart, { sessionId: testCase.id, ...options });
  if (!started.ok) return { result: "fail", reason: `start was refused: ${started.reason}` };
  const observed = await observe(
    chart,
    started.state,
    testCase.initial_configuration,
    0,
    host,
    wire,
  );
  if ("reason" in observed) return { result: "fail", reason: observed.reason };
  let state = observed;
  const initial = compareLeafSets(
    chart,
    state,
    testCase.initial_configuration,
    "the initial configuration",
  );
  if (initial !== null) return { result: "fail", reason: initial };

  for (const [index, { event, configuration }] of testCase.steps.entries()) {
    const where = `step ${index + 1} (event ${JSON.stringify(event.name)})`;
    const hostEvent = eventOf(event);
    if ("reason" in hostEvent) return { result: "fail", reason: `${where}: ${hostEvent.reason}` };
    const settled = await settleHost(chart, state, options, wire);
    if ("reason" in settled) return { result: "fail", reason: `${where}: ${settled.reason}` };
    const stepped = step(chart, settled, hostEvent, options);
    if (!stepped.ok) {
      return {
        result: "fail",
        reason: `${where}: the driver refused the event: ${stepped.reason}`,
      };
    }
    const after = await observe(chart, stepped.state, configuration, settled.nowMs, host, wire);
    if ("reason" in after) return { result: "fail", reason: `${where}: ${after.reason}` };
    state = after;
    const found = compareLeafSets(chart, state, configuration, where);
    if (found !== null) return { result: "fail", reason: found };
  }

  const sends = compareSends(expected, host.handed);
  return sends === null ? { result: "pass" } : { result: "fail", reason: sends };
}

/**
 * Runs one statifier case: through the host-case drive when it carries a
 * `host` object, as the reference's runner routes it, and otherwise through
 * the scion runner's drive.
 */
export function runStatifierCase(testCase: CorpusCase): CaseOutcome | Promise<CaseOutcome> {
  return testCase.host === undefined ? runScionCase(testCase) : runHostCase(testCase);
}
