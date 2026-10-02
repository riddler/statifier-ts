// A send the host could not deliver: `reportSendFailed`, a later report of a
// handed send, and a processor's `deliver` answering a failure within the
// call that handed it. Each raises `error.communication` onto the internal
// queue with the send's content as its origin and the send's id as its
// `sendid`, and the chart runs to a stable configuration within that call.
//
// The chart is the library's hold notice: a copy comes in for a patron's hold
// and the branch notices the patron; a notice that fails sends the desk to
// call the patron instead.

import { afterEach, describe, expect, it, vi } from "vitest";
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

  // Sabotage: answering a call an earlier run made as taken, rather than
  // with the failure it answered, turns this red: the chart rests in
  // notifying.
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
    expect(host.handed.map((send) => send.event)).toEqual(["hold.ready", "hold.reminder"]);
    expect(logged(moved.effects)).toEqual([
      ["type", "platform"],
      ["sendid", "notice"],
    ]);
    expect(moved.state.configuration).toEqual(["calling"]);
    expect(reminder.sendId).not.toBe("notice");
  });

  // Sabotage: answering once the first run's calls are made, without making
  // the run again after the failure, turns this red.
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

describe("a failure deliver answers, raised within the run that handed the send", () => {
  const failure: DeliveryFailure = { kind: "failure", reason: "patron:ada has no address" };

  // The branch tells the desk to stand by, an event the chart sends itself,
  // and then sends the notice, in one block. A notice that fails moves the
  // chart to `notice_failed` before the desk's event is taken; taken first,
  // that event would move it to `standing_by`.
  const RETURNS = chartOf(`<scxml ${SCXML} initial="awaiting_copy" name="returns">
  <state id="awaiting_copy"><transition event="copy.available" target="notifying"/></state>
  <state id="notifying">
    <onentry>
      <send event="desk.stand_by"/>
      <send id="notice" type="library:notice" target="patron:ada" event="hold.ready"/>
    </onentry>
    <transition event="error.communication" target="notice_failed">
      <log label="sendid" expr="_event.sendid"/>
    </transition>
    <transition event="desk.stand_by" target="standing_by"/>
  </state>
  <state id="notice_failed">
    <onentry><send type="library:notice" target="desk:front" event="hold.call_patron"/></onentry>
  </state>
  <state id="standing_by">
    <onentry><send type="library:notice" target="patron:ada" event="hold.stand_by"/></onentry>
  </state>
</scxml>`);

  // Sabotage: raising the failure only once the run has taken its external
  // queue (the held call's answer read after the run, as before) turns this
  // red: the chart takes the desk's event first and rests in `standing_by`.
  it("joins the internal queue before the run takes its external queue", () => {
    const host = desk((send) => (send.event === "hold.ready" ? failure : undefined));
    const started = ok(start(RETURNS, { sessionId: "returns-ada", ...host.options }));
    const moved = ok(step(RETURNS, started.state, { name: "copy.available" }, host.options));
    expect(moved.state.configuration).toEqual(["notice_failed"]);
    expect(logged(moved.effects)).toEqual([["sendid", "notice"]]);
    // The desk's event was taken after the failure, by a state with no
    // transition for it.
    expect(moved.state.externalQueue).toEqual([]);
  });

  // Sabotage: calling the processor again for the sends the call already
  // handed when it raises a failure turns this red: the notice is handed
  // twice. So does making the calls a run held past the failure: the
  // stand-by notice, which only the run without the failure sends, is handed.
  it("calls each processor once for each send the call hands", () => {
    const host = desk((send) => (send.event === "hold.ready" ? failure : undefined));
    const started = ok(start(RETURNS, { sessionId: "returns-ada", ...host.options }));
    ok(step(RETURNS, started.state, { name: "copy.available" }, host.options));
    expect(host.handed.map((send) => send.event)).toEqual(["hold.ready", "hold.call_patron"]);
  });

  // Sabotage: asking the entry hook each time the call's run is made again
  // turns this red: a start whose run a failure changes asks it twice.
  it("asks the entry hook once per type when a start's run fails a send", () => {
    const asked: string[] = [];
    const processor: SendProcessor = {
      deliver: (send) => (send.event === "hold.ready" ? failure : undefined),
      ioprocessorsEntry: (type) => {
        asked.push(type);
        return {};
      },
    };
    const AT_ONCE = chartOf(`<scxml ${SCXML} initial="notifying" name="at_once">
  <state id="notifying">
    <onentry><send id="notice" type="library:notice" target="patron:ada" event="hold.ready"/></onentry>
    <transition event="error.communication" target="notice_failed"/>
  </state>
  <state id="notice_failed"/>
</scxml>`);
    const started = ok(
      start(AT_ONCE, { sessionId: "hold-ada", sendTypes: { "library:notice": processor } }),
    );
    expect(started.state.configuration).toEqual(["notice_failed"]);
    expect(asked).toEqual(["library:notice"]);
  });

  // Sabotage: making the held calls before the state is written turns this
  // red: the refused start hands the failing notice.
  it("hands nothing when the call is refused, a send that would fail included", () => {
    const host = desk(() => failure);
    const SENDS_AT_ONCE = chartOf(`<scxml ${SCXML} initial="notifying" name="sends_at_once">
  <state id="notifying">
    <onentry><send id="notice" type="library:notice" target="patron:ada" event="hold.ready"/></onentry>
    <transition event="error.communication" target="notice_failed"/>
  </state>
  <state id="notice_failed"/>
</scxml>`);
    // The same start without the value the state cannot write hands the
    // notice, so the refusal below is what hands nothing.
    ok(start(SENDS_AT_ONCE, { sessionId: "hold-ada", ...host.options }));
    expect(host.handed.map((send) => send.event)).toEqual(["hold.ready"]);
    host.handed.length = 0;
    expect(
      start(SENDS_AT_ONCE, {
        sessionId: "hold-ada",
        ...host.options,
        datamodel: { shelf: { $type: "date" } },
      }),
    ).toEqual({ ok: false, reason: "unencodable_value" });
    expect(host.handed).toEqual([]);
  });
});

describe("a run made again after a failure, reading the clock or a random draw", () => {
  const failure: DeliveryFailure = { kind: "failure", reason: "patron:ada has no address" };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The branch draws which desk takes the hold, and the notice to the
  // front desk fails. A run made again must draw what the first run drew.
  const DRAWN = chartOf(`<scxml ${SCXML} initial="drawing" name="drawn">
  <datamodel><data id="draw"/></datamodel>
  <state id="drawing">
    <onentry>
      <assign location="draw" expr="Math.random()"/>
      <if cond="draw &lt; 0.5">
        <send id="front" type="library:notice" target="desk:front" event="hold.front"/>
      <else/>
        <send id="back" type="library:notice" target="desk:back" event="hold.back"/>
      </if>
    </onentry>
    <transition event="error.communication" target="notice_failed">
      <log label="sendid" expr="_event.sendid"/>
    </transition>
  </state>
  <state id="notice_failed"/>
</scxml>`);

  // Sabotage: evaluating without the call's pinned random source (each run
  // drawing afresh) turns this red: the run made again draws the back desk,
  // raises a failure for a send never handed, and reports a send never made.
  it("draws the same random value in every run of one call", () => {
    const draws = [0.1, 0.9, 0.9, 0.9];
    vi.spyOn(Math, "random").mockImplementation(() => draws.shift() ?? 0.9);
    const host = desk((send) => (send.event === "hold.front" ? failure : undefined));
    const started = ok(start(DRAWN, { sessionId: "hold-ada", ...host.options }));
    expect(host.handed.map((send) => send.event)).toEqual(["hold.front"]);
    expect(logged(started.effects)).toEqual([["sendid", "front"]]);
    const reported = started.effects.flatMap((effect) =>
      effect.kind === "send" ? [effect.event] : [],
    );
    expect(reported).toEqual(["hold.front"]);
    expect(started.state.configuration).toEqual(["notice_failed"]);
  });

  // The branch stamps the notice with the time it is sent, and the notice
  // fails. The send the call reports carries the stamp the processor was
  // handed.
  const STAMPED = chartOf(`<scxml ${SCXML} initial="notifying" name="stamped">
  <state id="notifying">
    <onentry>
      <send id="notice" type="library:notice" target="patron:ada" event="hold.ready">
        <param name="at" expr="Date.now()"/>
      </send>
    </onentry>
    <transition event="error.communication" target="notice_failed"/>
  </state>
  <state id="notice_failed"/>
</scxml>`);

  // Sabotage: evaluating without the call's pinned clock turns this red: the
  // send the call reports carries a later stamp than the one handed.
  it("reads the same clock in every run of one call", () => {
    let millis = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => {
      millis += 60_000;
      return millis;
    });
    const host = desk(() => failure);
    const started = ok(start(STAMPED, { sessionId: "hold-ada", ...host.options }));
    const handed = host.handed.map((send) => send.data);
    const reported = started.effects.flatMap((effect) =>
      effect.kind === "send" ? [effect.data] : [],
    );
    expect(handed).toHaveLength(1);
    expect(reported).toEqual(handed);
    expect(started.state.configuration).toEqual(["notice_failed"]);
  });
});
