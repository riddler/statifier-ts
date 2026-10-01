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
//
// Three things the reference's harness does this runner cannot, and each
// fails its case with the reason before or while it is driven, never patched
// around:
//
// - An expected send marked `"outcome": "fail"`: the reference's harness
//   reports that send failed through `Statifier.Session.failed_send/3`, so the
//   sender takes `error.communication`. The driver's `SendProcessor.deliver`
//   answers nothing and the driver offers no call that reports a failed send,
//   so the host here has no way to say it.
// - `declared_events` and `expect_accepts`: the reference checks the chart's
//   accepted-events declaration before it runs the case
//   (`Statifier.Chart.check_accepts/2`), which this package does not port.
// - `to_source`, `expect_diff`, `mapping` and `expect_compatible_at`: the
//   reference compares them in its own test suite, through its chart diff and
//   its position predicate, which this package does not port.
//
// Like the runner, this reaches nothing outside the language.

import { fromHost, toHost, typeName, type Value } from "@riddler/predicator";
import type { CorpusCase, CorpusStep } from "../../scripts/lib/corpus-rules.d.mts";
import type { Cancel, Send, SendDelayed } from "../../src/core/send.js";
import type { Event } from "../../src/datamodel.js";
import {
  type DriveOptions,
  type HostEvent,
  type SendProcessor,
  type SendProcessors,
  start,
  step,
} from "../../src/driver.js";
import type { CaseOutcome } from "./runner.js";
import { awaitConfiguration, compareLeafSets, compileCase, runScionCase, settle } from "./scion.js";

/** The reason a case marking a send `"outcome": "fail"` fails with. */
export const FAILED_SEND_NOT_REPORTABLE =
  'the case expects the host to report a send failed ("outcome": "fail"), and the driver offers a host no way to: SendProcessor.deliver answers nothing';

/** The host keys of the reference's accepts check, which this package does not port. */
export const ACCEPTS_KEYS: readonly string[] = Object.freeze(["declared_events", "expect_accepts"]);

/** The host keys of the reference's chart diff and position predicate, which this package does not port. */
export const DIFF_KEYS: readonly string[] = Object.freeze([
  "to_source",
  "mapping",
  "expect_diff",
  "expect_compatible_at",
]);

/**
 * Why a host case cannot be run here, before it is driven: the accepts check
 * or the diff pair it carries, naming the keys; null when it carries neither.
 */
export function notPorted(host: Readonly<Record<string, unknown>>): string | null {
  const accepts = ACCEPTS_KEYS.filter((key) => Object.hasOwn(host, key));
  if (accepts.length > 0) {
    return `the case's host checks the chart's declared events (${accepts.join(", ")}), and this package does not port the reference's accepts check`;
  }
  const diff = DIFF_KEYS.filter((key) => Object.hasOwn(host, key));
  if (diff.length > 0) {
    return `the case's host diffs the chart to a second chart (${diff.join(", ")}), and this package does not port the reference's chart diff or its position predicate`;
  }
  return null;
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
  /** Set when the case asks for something the host cannot do here. */
  readonly problem: string | null;
}

/** A host for these send types, comparing what it is handed with `expected`. */
export function hostFor(sendTypes: readonly string[], expected: readonly SendItem[]): Host {
  const handed: Handed[] = [];
  let problem: string | null = null;
  const processor: SendProcessor = {
    deliver(send, event) {
      const item = expected[handed.length];
      if (item?.outcome === "fail" && problem === null) problem = FAILED_SEND_NOT_REPORTABLE;
      handed.push({ sendId: send.sendId, expected: item, item: itemOf(send, event) });
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
  const processors: SendProcessors = Object.fromEntries(sendTypes.map((type) => [type, processor]));
  return {
    options: { sendTypes: processors },
    get handed() {
      return handed.map((entry) => entry.item);
    },
    get problem() {
      return problem;
    },
  };
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

/** Runs one host case: a pass, or a fail naming what disagreed. */
export function runHostCase(testCase: CorpusCase): CaseOutcome {
  const spec = testCase.host ?? {};
  const unported = notPorted(spec);
  if (unported !== null) return { result: "fail", reason: unported };
  const compiled = compileCase(testCase);
  if ("reason" in compiled) return { result: "fail", reason: compiled.reason };
  const { chart } = compiled;

  const expected = (Array.isArray(spec.expect_sends) ? spec.expect_sends : []) as SendItem[];
  const host = hostFor(strings(spec.send_types), expected);
  const { options } = host;

  const started = start(chart, { sessionId: testCase.id, ...options });
  if (!started.ok) return { result: "fail", reason: `start was refused: ${started.reason}` };
  let state = awaitConfiguration(chart, started.state, testCase.initial_configuration, 0, options);
  if (host.problem !== null) return { result: "fail", reason: host.problem };
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
    const settled = settle(chart, state, options);
    const stepped = step(chart, settled, hostEvent, options);
    if (!stepped.ok) {
      return {
        result: "fail",
        reason: `${where}: the driver refused the event: ${stepped.reason}`,
      };
    }
    state = awaitConfiguration(chart, stepped.state, configuration, settled.nowMs, options);
    if (host.problem !== null) return { result: "fail", reason: host.problem };
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
export function runStatifierCase(testCase: CorpusCase): CaseOutcome {
  return testCase.host === undefined ? runScionCase(testCase) : runHostCase(testCase);
}
