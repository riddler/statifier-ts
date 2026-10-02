// The Basic HTTP processor, driven through the driver as a host drives it.
//
// The chart is the library's hold notice: a copy comes in for a patron's
// hold and the branch posts the notice to the patron's desk through the
// Basic HTTP processor; a notice that misses moves the chart to
// `notice_failed`. The transport is a table, not a network: it records each
// request and answers what the test says.

import { float, Undefined } from "@riddler/predicator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSuites } from "../scripts/lib/corpus.mjs";
import {
  BASIC_HTTP_EVENT_PROCESSOR,
  basicHttp,
  type ReportedSendFailure,
} from "../src/basichttp/index.js";
import { requestFor, sendKey } from "../src/basichttp/processor.js";
import { type Chart, compile } from "../src/compiler.js";
import type { InterpreterEffect } from "../src/core/interpreter.js";
import type { Cancel, Send, SendDelayed } from "../src/core/send.js";
import {
  advance,
  type DriveResult,
  type ProcessorContext,
  reportSendFailed,
  type SendProcessors,
  type State,
  start,
  step,
} from "../src/driver.js";
import type { HttpAnswer, HttpRequest, HttpTransport } from "../src/http-transport.js";

const SCXML = 'xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="predicator"';

function chartOf(source: string): Chart {
  const result = compile(source);
  if (!result.ok) throw new Error(`fixture does not compile: ${JSON.stringify(result.errors)}`);
  return result.chart;
}

type Moved = { readonly state: State; readonly effects: readonly InterpreterEffect[] };

function ok(result: DriveResult): Moved {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result;
}

function logged(effects: readonly InterpreterEffect[]): Record<string, unknown> {
  return Object.fromEntries(
    effects.flatMap((effect) =>
      effect.kind === "log" ? [[effect.label ?? "", effect.value]] : [],
    ),
  );
}

// Lets every request the processor started settle, and every report run.
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

interface Desk {
  readonly transport: HttpTransport;
  readonly requests: HttpRequest[];
  readonly reports: ReportedSendFailure[];
  answer: HttpAnswer | (() => Promise<HttpAnswer>);
}

function desk(): Desk {
  const requests: HttpRequest[] = [];
  const reports: ReportedSendFailure[] = [];
  const made: Desk = {
    requests,
    reports,
    answer: { kind: "status", status: 204 },
    transport: {
      post: (request) => {
        requests.push(request);
        const { answer } = made;
        return typeof answer === "function" ? answer() : Promise.resolve(answer);
      },
    },
  };
  return made;
}

function sendTypesFor(d: Desk): SendProcessors {
  const http = basicHttp({
    baseUrl: "https://library.example/scxml",
    transport: d.transport,
    report: (failure) => d.reports.push(failure),
  });
  if (!http.ok) throw new Error(`refused: ${http.reason}`);
  return http.sendTypes;
}

const HOLD = chartOf(`<scxml ${SCXML} initial="awaiting_copy" name="hold">
  <datamodel>
    <data id="copy" expr="'book-17'"/>
    <data id="desk" expr="'https://library.example/desk-1'"/>
  </datamodel>
  <state id="awaiting_copy">
    <onentry>
      <log label="short" expr="_ioprocessors['basichttp'].location"/>
      <log label="uri" expr="_ioprocessors['${BASIC_HTTP_EVENT_PROCESSOR}'].location"/>
    </onentry>
    <transition event="copy.available" target="notifying"/>
  </state>
  <state id="notifying">
    <onentry>
      <send id="notice" event="hold.ready" type="basichttp" targetexpr="desk">
        <param name="patron" expr="'ada'"/>
        <param name="copy" expr="copy"/>
        <param name="renewals" expr="2"/>
      </send>
    </onentry>
    <transition event="error.communication" cond="_event.sendid == 'notice'" target="notice_failed"/>
    <transition event="patron.collected" target="collected"/>
  </state>
  <state id="notice_failed"/>
  <final id="collected"/>
</scxml>`);

describe("the Basic HTTP processor's registration", () => {
  // Sabotage: answering an empty entry from `ioprocessorsEntry` turns this red.
  it("writes the session's location under both of its type strings", () => {
    const d = desk();
    const started = ok(start(HOLD, { sessionId: "branch-7", sendTypes: sendTypesFor(d) }));

    expect(logged(started.effects)).toEqual({
      short: "https://library.example/scxml/branch-7",
      uri: "https://library.example/scxml/branch-7",
    });
  });

  it("names the processor under its URI and its short form", () => {
    const d = desk();
    expect(Object.keys(sendTypesFor(d))).toEqual([BASIC_HTTP_EVENT_PROCESSOR, "basichttp"]);
  });

  it("refuses options it cannot run with, as values", () => {
    const report = () => {};
    expect(basicHttp({ baseUrl: "", report })).toEqual({ ok: false, reason: "missing_base_url" });
    expect(basicHttp({ baseUrl: "https://x", report: undefined as never })).toEqual({
      ok: false,
      reason: "missing_report",
    });
    expect(basicHttp({ baseUrl: "https://x", report, transport: {} as never })).toEqual({
      ok: false,
      reason: "invalid_transport",
    });
    expect(basicHttp(undefined as never)).toEqual({ ok: false, reason: "missing_base_url" });
  });
});

describe("a send the processor is handed", () => {
  // Sabotage: dropping the sort of a map's names in `requestFor`, or the
  // event name ahead of them, turns this red.
  it("becomes one form POST to its target, carrying its dedup key", async () => {
    const d = desk();
    const sendTypes = sendTypesFor(d);
    const started = ok(start(HOLD, { sessionId: "branch-7", sendTypes }));
    ok(step(HOLD, started.state, { name: "copy.available" }, { sendTypes }));
    await settle();

    expect(d.requests).toEqual([
      {
        method: "POST",
        url: "https://library.example/desk-1",
        headers: [
          ["content-type", "application/x-www-form-urlencoded"],
          ["scxml-send-key", "branch-7/notice/2/1/0/2/onentry.2.0/1"],
        ],
        body: "_scxmleventname=hold.ready&copy=book-17&patron=ada&renewals=2",
      },
    ]);
    expect(d.reports).toEqual([]);
  });

  // Sabotage: adding anything that varies between two handings (a clock, a
  // counter of the processor's own) to `sendKey` turns this red.
  it("carries the same key each time the same send is handed", async () => {
    const d = desk();
    const sendTypes = sendTypesFor(d);
    const started = ok(start(HOLD, { sessionId: "branch-7", sendTypes }));
    ok(step(HOLD, started.state, { name: "copy.available" }, { sendTypes }));
    ok(step(HOLD, started.state, { name: "copy.available" }, { sendTypes }));
    await settle();

    expect(d.requests).toHaveLength(2);
    expect(d.requests[0]).toEqual(d.requests[1]);
  });

  // Sabotage: making the request within `deliver` rather than after it turns
  // the first expectation red.
  it("is posted after the call that handed it has returned", async () => {
    const d = desk();
    const sendTypes = sendTypesFor(d);
    const started = ok(start(HOLD, { sessionId: "branch-7", sendTypes }));
    ok(step(HOLD, started.state, { name: "copy.available" }, { sendTypes }));

    expect(d.requests).toEqual([]);
    await settle();
    expect(d.requests).toHaveLength(1);
  });
});

describe("a missed delivery", () => {
  async function handed(d: Desk): Promise<{ sendTypes: SendProcessors; state: State }> {
    const sendTypes = sendTypesFor(d);
    const started = ok(start(HOLD, { sessionId: "branch-7", sendTypes }));
    const notified = ok(step(HOLD, started.state, { name: "copy.available" }, { sendTypes }));
    await settle();
    return { sendTypes, state: notified.state };
  }

  // Sabotage: reading every status as a delivery in `basicHttp`'s `post`
  // turns this red.
  it("reaches the chart as error.communication through the host's report", async () => {
    const d = desk();
    d.answer = { kind: "status", status: 503 };
    const { sendTypes, state } = await handed(d);

    expect(d.reports).toEqual([
      {
        sessionId: "branch-7",
        send: {
          sendId: "notice",
          cIndex: 2,
          owner: { kind: "onentry", stateIndex: 2, ordinal: 0 },
        },
        reason: "http_status 503",
      },
    ]);
    expect(state.configuration).toEqual(["notifying"]);

    const [report] = d.reports as [ReportedSendFailure];
    const failed = ok(reportSendFailed(HOLD, state, report, { sendTypes }));
    expect(failed.state.configuration).toEqual(["notice_failed"]);
  });

  it("is reported with the transport's own words when no response came back", async () => {
    const d = desk();
    d.answer = { kind: "failure", reason: "connection refused" };
    await handed(d);

    expect(d.reports.map((r) => r.reason)).toEqual(["connection refused"]);
  });

  // Sabotage: removing the catch around the transport call in `post` turns
  // this red with an unhandled rejection and no report.
  it("is reported when the transport rejects or throws", async () => {
    const rejecting = desk();
    rejecting.answer = () => Promise.reject(new Error("socket closed"));
    await handed(rejecting);
    const throwing = desk();
    throwing.answer = () => {
      throw new Error("no client");
    };
    await handed(throwing);

    expect(rejecting.reports.map((r) => r.reason)).toEqual([
      "transport_threw: Error: socket closed",
    ]);
    expect(throwing.reports.map((r) => r.reason)).toEqual(["transport_threw: Error: no client"]);
  });

  it("is not reported for any status in 2xx", async () => {
    for (const status of [200, 202, 299]) {
      const d = desk();
      d.answer = { kind: "status", status };
      await handed(d);
      expect(d.reports).toEqual([]);
    }
    const d = desk();
    d.answer = { kind: "status", status: 300 };
    await handed(d);
    expect(d.reports.map((r) => r.reason)).toEqual(["http_status 300"]);
  });
});

describe("a send with no target", () => {
  const NO_TARGET = chartOf(`<scxml ${SCXML} initial="notifying">
    <state id="notifying">
      <onentry><send id="notice" event="hold.ready" type="basichttp"/></onentry>
      <transition event="error.communication" target="notice_failed">
        <log label="sendid" expr="_event.sendid"/>
      </transition>
    </state>
    <state id="notice_failed"/>
  </scxml>`);

  // Sabotage: posting a send with no target instead of failing it turns
  // this red.
  it("fails within the call that handed it, and makes no request", async () => {
    const d = desk();
    const started = ok(start(NO_TARGET, { sessionId: "branch-7", sendTypes: sendTypesFor(d) }));
    await settle();

    expect(started.state.configuration).toEqual(["notice_failed"]);
    expect(logged(started.effects)).toEqual({ sendid: "notice" });
    expect(d.requests).toEqual([]);
    expect(d.reports).toEqual([]);
  });
});

describe("a send whose target is not text", () => {
  const NUMBER_TARGET = chartOf(`<scxml ${SCXML} initial="notifying">
    <state id="notifying">
      <onentry><send id="notice" event="hold.ready" type="basichttp" targetexpr="7"/></onentry>
    </state>
  </scxml>`);

  it("is reported, and makes no request", async () => {
    const d = desk();
    ok(start(NUMBER_TARGET, { sessionId: "branch-7", sendTypes: sendTypesFor(d) }));
    await settle();

    expect(d.requests).toEqual([]);
    expect(d.reports.map((r) => r.reason)).toEqual(["invalid_target"]);
  });
});

describe("a delayed send", () => {
  const DELAYED = chartOf(`<scxml ${SCXML} initial="notifying">
    <state id="notifying">
      <onentry>
        <send id="reminder" event="hold.reminder" type="basichttp"
              target="https://library.example/desk-1" delay="2s"/>
      </onentry>
      <transition event="patron.collected" target="collected">
        <cancel sendid="reminder"/>
      </transition>
    </state>
    <state id="collected"/>
  </scxml>`);

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // Sabotage: posting a delayed send at once rather than holding it turns
  // the first expectation red.
  it("is held on the timer and posted once its delay passes", async () => {
    vi.useFakeTimers();
    const d = desk();
    ok(start(DELAYED, { sessionId: "branch-7", sendTypes: sendTypesFor(d) }));
    await vi.advanceTimersByTimeAsync(1999);
    expect(d.requests).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(d.requests.map((r) => r.body)).toEqual(["_scxmleventname=hold.reminder"]);
  });

  // Sabotage: making `cancel` a no-op turns this red.
  it("is dropped by a cancel of its send id, in its own session only", async () => {
    vi.useFakeTimers();
    const d = desk();
    const sendTypes = sendTypesFor(d);
    const first = ok(start(DELAYED, { sessionId: "branch-7", sendTypes }));
    ok(start(DELAYED, { sessionId: "branch-8", sendTypes }));
    ok(step(DELAYED, first.state, { name: "patron.collected" }, { sendTypes }));
    await vi.advanceTimersByTimeAsync(2000);

    expect(d.requests.map((r) => r.headers[1]?.[1].split("/")[0])).toEqual(["branch-8"]);
  });

  it("is reported when there is no timer to hold it", async () => {
    vi.stubGlobal("setTimeout", undefined);
    const d = desk();
    ok(start(DELAYED, { sessionId: "branch-7", sendTypes: sendTypesFor(d) }));
    await settle();

    expect(d.requests).toEqual([]);
    expect(d.reports.map((r) => r.reason)).toEqual(["timer_unavailable"]);
  });

  it("leaves a cancel of a send it does not hold, or of no text id, alone", () => {
    const d = desk();
    const processor = sendTypesFor(d).basichttp;
    const cancel = { kind: "cancel", sendId: "never", ordinal: 1 } as unknown as Cancel;
    expect(() => processor?.cancel?.(cancel, { sessionId: "branch-7" })).not.toThrow();
    expect(() =>
      processor?.cancel?.({ ...cancel, sendId: 3 }, { sessionId: "branch-7" }),
    ).not.toThrow();
  });
});

describe("the request a send becomes", () => {
  const base: Send = {
    kind: "send",
    event: "hold.ready",
    target: "https://library.example/desk-1",
    type: "basichttp",
    data: "the copy is in",
    sendId: "send_3",
    idFromAuthor: false,
    cIndex: 1,
    owner: { kind: "transition", tIndex: 4 },
    macrostep: 3,
    microstep: 2,
    round: 0,
    ordinal: null,
  };

  // Sabotage: form-encoding a text body in `requestFor` turns this red.
  it("sends content as text/plain, with the event name in the query string", () => {
    expect(requestFor("branch 7/a", base)).toEqual({
      method: "POST",
      url: "https://library.example/desk-1?_scxmleventname=hold.ready",
      headers: [
        ["content-type", "text/plain"],
        ["scxml-send-key", "branch%207%2Fa/send_3/3/2/0/1/transition.4/"],
      ],
      body: "the copy is in",
    });
  });

  it("joins the event name to a target that already has a query string", () => {
    const request = requestFor("b", { ...base, target: "https://library.example/d?branch=7" });
    expect(request?.url).toBe("https://library.example/d?branch=7&_scxmleventname=hold.ready");
  });

  it("sends content with no event name to the target as written", () => {
    const request = requestFor("b", { ...base, event: null, data: float(2) });
    expect(request?.url).toBe("https://library.example/desk-1");
    expect(request?.body).toBe("2.0");
  });

  it("sends no data as the event name alone, and no name as an empty form", () => {
    expect(requestFor("b", { ...base, data: Undefined })?.body).toBe("_scxmleventname=hold.ready");
    expect(requestFor("b", { ...base, data: Undefined, event: null })?.body).toBe("");
  });

  it("spells each owner kind as the reference does", () => {
    const delayed: SendDelayed = { ...base, kind: "send_delayed", delayMs: 10, ordinal: 4 };
    const keys = [
      { kind: "onentry", stateIndex: 1, ordinal: 2 },
      { kind: "onexit", stateIndex: 3, ordinal: 0 },
      { kind: "finalize", stateIndex: 5, invokeIndex: 1 },
      { kind: "transition", tIndex: 9 },
    ].map((owner) => sendKey("b", { ...delayed, owner } as SendDelayed).split("/")[6]);
    expect(keys).toEqual(["onentry.1.2", "onexit.3.0", "finalize.5.1", "transition.9"]);
    expect(sendKey("b", delayed).split("/")[7]).toBe("4");
  });
});

describe("the driver's processor context and entry hook", () => {
  const SIMPLE = chartOf(`<scxml ${SCXML} initial="notifying">
    <state id="notifying">
      <onentry>
        <log label="entry" expr="_ioprocessors['library:notice']"/>
        <send id="notice" event="hold.ready" type="library:notice" target="patron:ada" delay="1s"/>
      </onentry>
      <transition event="patron.collected" target="collected"><cancel sendid="notice"/></transition>
    </state>
    <state id="collected"/>
  </scxml>`);

  // Sabotage: passing no context to `deliver` or `cancel` in `handOff` or
  // `cancelSend` turns this red.
  it("hands deliver, cancel and the entry hook the session's id", () => {
    const seen: [string, ProcessorContext][] = [];
    const sendTypes: SendProcessors = {
      "library:notice": {
        deliver: (_send, _event, context) => {
          seen.push(["deliver", context]);
        },
        cancel: (_cancel, context) => {
          seen.push(["cancel", context]);
        },
        ioprocessorsEntry: (type, context) => {
          seen.push([`entry ${type}`, context]);
          return { desk: `desk-for-${context.sessionId}` };
        },
      },
    };
    const started = ok(start(SIMPLE, { sessionId: "branch-7", sendTypes }));
    ok(step(SIMPLE, started.state, { name: "patron.collected" }, { sendTypes }));

    expect(logged(started.effects)).toEqual({ entry: { desk: "desk-for-branch-7" } });
    expect(seen).toEqual([
      ["entry library:notice", { sessionId: "branch-7" }],
      ["deliver", { sessionId: "branch-7" }],
      ["cancel", { sessionId: "branch-7" }],
    ]);
  });

  it("keeps an empty entry for a processor without the hook, and on a resumed state", () => {
    const sendTypes: SendProcessors = { "library:notice": { deliver: () => {} } };
    const started = ok(start(SIMPLE, { sessionId: "branch-7", sendTypes }));
    expect(logged(started.effects)).toEqual({ entry: {} });
    const moved = ok(advance(SIMPLE, started.state, 0, { sendTypes }));
    expect(moved.state.configuration).toEqual(["notifying"]);
  });
});

describe("a send with no target, beside a send to the session itself", () => {
  // The branch tells its own desk to stand by and posts the notice with no
  // target, in one block. The notice's failure joins the internal queue
  // within the run that handed it, so it is taken before the desk's event,
  // as the reference raises it from the processor's plan.
  const STAND_BY = chartOf(`<scxml ${SCXML} initial="notifying">
    <state id="notifying">
      <onentry>
        <send event="desk.stand_by"/>
        <send id="notice" event="hold.ready" type="basichttp"/>
      </onentry>
      <transition event="error.communication" target="notice_failed"/>
      <transition event="*" target="standing_by"/>
    </state>
    <state id="notice_failed"/>
    <state id="standing_by"/>
  </scxml>`);

  // Sabotage: raising a failure deliver answered only once the run has
  // taken its external queue turns this red: the chart rests in
  // `standing_by`.
  it("is taken before the event the same block sent the session", async () => {
    const d = desk();
    const started = ok(start(STAND_BY, { sessionId: "branch-7", sendTypes: sendTypesFor(d) }));
    await settle();

    expect(started.state.configuration).toEqual(["notice_failed"]);
    expect(d.requests).toEqual([]);
    expect(d.reports).toEqual([]);
  });

  // The vendored corpus's own w3c/test577, driven through the processor with
  // a transport that records requests and makes none: the case passes for
  // the reason the reference's harness passes it, the processor's
  // no-target failure taken ahead of `event1`, and with no request made.
  // Sabotage: as above; the chart rests in `fail`.
  it("passes w3c/test577 through the processor, making no request", async () => {
    const testCase = loadSuites()
      .find((suite) => suite.suite === "w3c")
      ?.cases.find((found) => found.id === "w3c/test577");
    if (testCase === undefined) throw new Error("no w3c/test577 in the vendored corpus");
    expect(testCase.host?.event_io_processors).toEqual([BASIC_HTTP_EVENT_PROCESSOR]);
    const d = desk();
    const started = ok(
      start(chartOf(testCase.source), { sessionId: "w3c-577", sendTypes: sendTypesFor(d) }),
    );
    await settle();

    expect(started.state.done?.configuration).toEqual(testCase.initial_configuration);
    expect(started.state.done?.configuration).toEqual(["pass"]);
    expect(logged(started.effects)).toEqual({ Outcome: "pass" });
    expect(d.requests).toEqual([]);
    expect(d.reports).toEqual([]);
  });
});
