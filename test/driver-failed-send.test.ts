// A send the host could not deliver: `reportSendFailed`, a later report of a
// handed send, and a processor's `deliver` answering a failure within the
// call that handed it. Each raises `error.communication` onto the internal
// queue with the send's content as its origin and the send's id as its
// `sendid`, and the chart runs to a stable configuration within that call.
//
// The chart is the library's hold notice: a copy comes in for a patron's hold
// and the branch notices the patron; a notice that fails sends the desk to
// call the patron instead.

import { describe, expect, it } from "vitest";
import { type Chart, compile } from "../src/compiler.js";
import type { InterpreterEffect } from "../src/core/interpreter.js";
import type { Send, SendDelayed } from "../src/core/send.js";
import {
  type DeliveryFailure,
  type DriveOptions,
  type DriveResult,
  reportSendFailed,
  type SendProcessor,
  type State,
  start,
  step,
} from "../src/driver.js";

const SCXML = 'xmlns="http://www.w3.org/2005/07/scxml" version="1.0"';

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

function logged(effects: readonly InterpreterEffect[]): [string, unknown][] {
  return effects.flatMap((effect) =>
    effect.kind === "log" ? [[effect.label ?? "", effect.value] as [string, unknown]] : [],
  );
}

function viaJson(state: State): State {
  return JSON.parse(JSON.stringify(state)) as State;
}

// The notice is sent on entering `notifying`, under the author's id
// `notice`; the reminder is sent with no id, so the driver generates one.
// A failure naming the notice moves to `notice_failed`, which tells the desk
// to call, an event the chart sends itself and takes in the same call.
const HOLD = chartOf(`<scxml ${SCXML} initial="awaiting_copy" name="hold">
  <state id="awaiting_copy"><transition event="copy.available" target="notifying"/></state>
  <state id="notifying">
    <onentry>
      <send id="notice" type="library:notice" target="patron:ada" event="hold.ready"/>
      <send type="library:notice" target="patron:ada" event="hold.reminder"/>
    </onentry>
    <transition event="error.communication" cond="_event.sendid == 'notice'" target="notice_failed">
      <log label="type" expr="_event.type"/>
      <log label="sendid" expr="_event.sendid"/>
    </transition>
    <transition event="error.communication" target="notifying">
      <log label="other" expr="_event.sendid"/>
    </transition>
    <transition event="patron.collected" target="collected"/>
  </state>
  <state id="notice_failed">
    <onentry><send event="desk.call"/></onentry>
    <transition event="desk.call" target="calling"/>
  </state>
  <state id="calling"><transition event="patron.collected" target="collected"/></state>
  <final id="collected"/>
</scxml>`);

interface Desk {
  readonly handed: (Send | SendDelayed)[];
  readonly options: DriveOptions;
}

// A notice processor that records every send, answering what `answer` says.
function desk(answer: (send: Send | SendDelayed) => unknown = () => undefined): Desk {
  const handed: (Send | SendDelayed)[] = [];
  const processor: SendProcessor = {
    deliver: (send) => {
      handed.push(send);
      return answer(send);
    },
  };
  return { handed, options: { sendTypes: { "library:notice": processor } } };
}

// The hold, started and stepped into `notifying`, its two notices handed.
function notifying(host: Desk): Moved {
  const started = ok(start(HOLD, { sessionId: "hold-ada", ...host.options }));
  return ok(step(HOLD, started.state, { name: "copy.available" }, host.options));
}

function sent(host: Desk, event: string): Send | SendDelayed {
  const found = host.handed.find((send) => send.event === event);
  if (found === undefined) throw new Error(`no ${event} was handed`);
  return found;
}

describe("reportSendFailed", () => {
  // Sabotage: raising the event as an internal event rather than a platform
  // one turns this red on the logged `_event.type`.
  it("raises error.communication carrying the send's id and runs the chart to stability within the call", () => {
    const host = desk();
    const before = notifying(host);
    expect(before.state.configuration).toEqual(["notifying"]);
    const reported = ok(
      reportSendFailed(
        HOLD,
        viaJson(before.state),
        { send: sent(host, "hold.ready"), reason: "no route to patron:ada" },
        host.options,
      ),
    );
    expect(logged(reported.effects)).toEqual([
      ["type", "platform"],
      ["sendid", "notice"],
    ]);
    // The desk call the chart sent itself is taken in the same call.
    expect(reported.state.configuration).toEqual(["calling"]);
    expect(reported.state.internalQueue).toEqual([]);
    expect(reported.state.externalQueue).toEqual([]);
  });

  // Sabotage: carrying the send id only when the author named it (as a
  // routing failure does) turns this red: the generated id is dropped and
  // the chart reads no sendid.
  it("carries the send's id whether or not the author named it", () => {
    const host = desk();
    const before = notifying(host);
    const reminder = sent(host, "hold.reminder");
    expect(reminder.idFromAuthor).toBe(false);
    const reported = ok(reportSendFailed(HOLD, before.state, { send: reminder }, host.options));
    expect(logged(reported.effects)).toEqual([["other", reminder.sendId]]);
    expect(reported.state.configuration).toEqual(["notifying"]);
  });

  // Sabotage: raising the event with any other content index than the
  // send's (one past it) turns this red.
  it("names the send's content as the event's origin", () => {
    const host = desk();
    const before = notifying(host);
    const notice = sent(host, "hold.ready");
    const traced = { ...before.state, trace: true };
    const reported = ok(reportSendFailed(HOLD, traced, { send: notice }, host.options));
    const dequeued = reported.effects.find(
      (effect) => effect.kind === "trace" && effect.trace === "event_dequeued",
    );
    expect(dequeued).toMatchObject({
      trace: "event_dequeued",
      from: "internal",
      event: {
        name: "error.communication",
        type: "platform",
        sendid: "notice",
        cause: { origin: { kind: "content", cIndex: notice.cIndex, owner: notice.owner } },
      },
    });
  });

  // Sabotage: carrying the send id only when the send says the author named
  // it turns this red: the three fields carry no such flag.
  it("takes only the fields the event is built from, so a host may keep just those", () => {
    const host = desk();
    const before = notifying(host);
    const { sendId, cIndex, owner } = sent(host, "hold.ready");
    const kept = JSON.parse(JSON.stringify({ sendId, cIndex, owner }));
    const reported = ok(reportSendFailed(HOLD, before.state, { send: kept }, host.options));
    expect(reported.state.configuration).toEqual(["calling"]);
  });

  // Sabotage: dropping the running check turns the stopped chart's report
  // into an ok answer and this red.
  it("refuses a report once the chart has stopped, and every malformed send, as values", () => {
    const host = desk();
    const before = notifying(host);
    const notice = sent(host, "hold.ready");
    const collected = ok(step(HOLD, before.state, { name: "patron.collected" }, host.options));
    expect(collected.state.done).not.toBeNull();
    expect(reportSendFailed(HOLD, collected.state, { send: notice }, host.options)).toEqual({
      ok: false,
      reason: "not_running",
    });
    const malformed: unknown[] = [
      undefined,
      null,
      {},
      { ...notice, sendId: 7 },
      { ...notice, cIndex: -1 },
      { ...notice, cIndex: 1.5 },
      { ...notice, owner: null },
      { ...notice, owner: { kind: "elsewhere" } },
    ];
    for (const send of malformed) {
      const failure = { send } as Parameters<typeof reportSendFailed>[2];
      expect(reportSendFailed(HOLD, before.state, failure), JSON.stringify(send)).toEqual({
        ok: false,
        reason: "not_a_send",
      });
    }
    expect(reportSendFailed(HOLD, undefined as unknown as State, { send: notice })).toMatchObject({
      ok: false,
      reason: "malformed_state",
    });
    const other = chartOf(`<scxml ${SCXML} name="desk"><state id="open"/></scxml>`);
    expect(reportSendFailed(other, before.state, { send: notice })).toEqual({
      ok: false,
      reason: "chart_mismatch",
    });
  });
});

describe("a processor's deliver answering a failure", () => {
  const failure: DeliveryFailure = { kind: "failure", reason: "patron:ada has no address" };

  // Sabotage: ignoring what deliver answers (the held call answering null)
  // turns this red: the chart stays in notifying.
  it("fails the send within the call that handed it", () => {
    const host = desk((send) => (send.event === "hold.ready" ? failure : undefined));
    const moved = notifying(host);
    expect(host.handed.map((send) => send.event)).toEqual(["hold.ready", "hold.reminder"]);
    expect(logged(moved.effects)).toEqual([
      ["type", "platform"],
      ["sendid", "notice"],
    ]);
    expect(moved.state.configuration).toEqual(["calling"]);
  });

  // Sabotage: raising the failures in reverse order turns this red.
  it("raises each failed send in the order it was handed", () => {
    // The first two sends handed, the notice and the reminder, both fail.
    let failures = 2;
    const host = desk(() => {
      if (failures === 0) return undefined;
      failures -= 1;
      return failure;
    });
    const moved = notifying(host);
    const reminder = sent(host, "hold.reminder");
    // The notice fails first and moves the chart on; the reminder's failure
    // then finds no transition from `calling` and is taken by nothing.
    expect(host.handed).toHaveLength(2);
    expect(logged(moved.effects)).toEqual([
      ["type", "platform"],
      ["sendid", "notice"],
    ]);
    expect(moved.state.configuration).toEqual(["calling"]);
    expect(reminder.sendId).not.toBe("notice");
  });

  // Sabotage: dropping the processor calls a failure's run makes (the
  // answer loop running only the first pass of calls) turns this red.
  it("hands the sends the failure's run makes, within the same call", () => {
    let failures = 1;
    const host = desk((send) => {
      if (send.event !== "hold.reminder" || failures === 0) return undefined;
      failures -= 1;
      return failure;
    });
    const moved = notifying(host);
    expect(host.handed.map((send) => send.event)).toEqual([
      "hold.ready",
      "hold.reminder",
      "hold.ready",
      "hold.reminder",
    ]);
    expect(moved.state.configuration).toEqual(["notifying"]);
  });

  // Sabotage: reading any object as a failure turns this red.
  it("reads any other answer as a send the processor took", () => {
    for (const answered of [undefined, null, 1, "failure", { kind: "status" }, []]) {
      const host = desk(() => answered);
      expect(notifying(host).state.configuration, JSON.stringify(answered)).toEqual(["notifying"]);
    }
  });

  // A processor that throws is the host's exception, and propagates
  // unchanged: the driver does not read it as a failure. Sabotage: catching
  // the throw and failing the send turns this red.
  it("lets a processor's own exception propagate unchanged", () => {
    const thrown = new Error("the notice service is down");
    const host = desk(() => {
      throw thrown;
    });
    const started = ok(start(HOLD, { sessionId: "hold-ada", ...host.options }));
    expect(() => step(HOLD, started.state, { name: "copy.available" }, host.options)).toThrow(
      thrown,
    );
  });
});
