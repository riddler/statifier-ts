// The in-memory driver: start, step, advance, configuration and isDone over
// a compiled chart; the external queue; the virtual clock and its pending
// timers; routing a send; a registered send type handed to the host's
// processor; and the state as a plain JSON value.
//
// The charts are the library loan (a copy at the desk, on loan, overdue,
// returned) and parcel delivery (a parcel scanned from depot to doorstep).

import { Duration, float, PDate, Undefined, type Value } from "@riddler/predicator";
import { describe, expect, it } from "vitest";
import { type Chart, compile } from "../src/compiler.js";
import type { InterpreterEffect } from "../src/core/interpreter.js";
import type { Cancel, Send, SendDelayed } from "../src/core/send.js";
import type { Event } from "../src/datamodel.js";
import {
  advance,
  configuration,
  type DriveOptions,
  type DriveResult,
  isDone,
  type SendProcessor,
  type StartOptions,
  type State,
  start,
  step,
} from "../src/driver.js";
import * as entry from "../src/index.js";

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

function begin(chart: Chart, options: Partial<StartOptions> = {}): Moved {
  return ok(start(chart, { sessionId: "desk-1", ...options }));
}

function send(chart: Chart, state: State, name: string, options?: DriveOptions): Moved {
  return ok(step(chart, state, { name }, options));
}

function wait(chart: Chart, state: State, ms: number, options?: DriveOptions): Moved {
  return ok(advance(chart, state, ms, options));
}

function kinds(effects: readonly InterpreterEffect[]): string[] {
  return effects.map((effect) => effect.kind);
}

function logged(effects: readonly InterpreterEffect[]): Value[] {
  return effects.flatMap((effect) => (effect.kind === "log" ? [effect.value] : []));
}

function viaJson(state: State): State {
  return JSON.parse(JSON.stringify(state)) as State;
}

// A copy goes out on a 2 s loan; when the loan runs out it is overdue;
// returning it from either state stops the chart with the renewal count.
const LOAN_SOURCE = `<scxml ${SCXML} initial="desk" name="loan">
  <datamodel><data id="renewals" expr="0"/></datamodel>
  <state id="desk"><transition event="checkout" target="on_loan"/></state>
  <state id="on_loan" initial="active">
    <onentry><send id="due" event="loan.due" delay="2s"/></onentry>
    <onexit><cancel sendid="due"/></onexit>
    <state id="active">
      <transition event="loan.due" target="overdue"/>
      <transition event="renew" target="on_loan"><assign location="renewals" expr="renewals + 1"/></transition>
    </state>
    <state id="overdue"/>
    <transition event="return" target="returned"/>
  </state>
  <final id="returned"><donedata><param name="renewals" expr="renewals"/></donedata></final>
</scxml>`;
const LOAN = chartOf(LOAN_SOURCE);

describe("start, step and configuration", () => {
  // Sabotage: answering the configuration in document order rather than
  // sorted by id (on_loan before active) turns this red.
  it("starts a chart, steps it, and reads the configuration as sorted string ids", () => {
    const started = begin(LOAN);
    expect(configuration(started.state)).toEqual(["desk"]);
    expect(started.state.running).toBe(true);
    const out = send(LOAN, started.state, "checkout");
    expect(configuration(out.state)).toEqual(["active", "on_loan"]);
    expect(kinds(out.effects)).toEqual(["send_delayed"]);
    expect(isDone(out.state)).toEqual({ ok: true, done: false });
  });

  // Sabotage: writing the state's lists in document order (the sort removed
  // from the naming) turns this red.
  it("writes the reference's position fields and the driver's own", () => {
    const { state } = send(LOAN, begin(LOAN).state, "checkout");
    expect(Object.keys(state)).toEqual([
      "identity",
      "configuration",
      "enteredStates",
      "statesToInvoke",
      "historyValues",
      "activeInvocations",
      "invokeCounter",
      "sendCounter",
      "timerCounter",
      "datamodel",
      "running",
      "status",
      "macrostep",
      "microstep",
      "round",
      "trace",
      "maxMacrostepRounds",
      "sessionId",
      "nowMs",
      "timers",
      "timerSequence",
      "externalQueue",
      "internalQueue",
      "heldSends",
      "halted",
      "done",
      "invokedAs",
      "invocations",
      "mailbox",
    ]);
    expect(state.identity).toEqual(LOAN.identity);
    expect(state.enteredStates).toEqual(["active", "desk", "on_loan"]);
    expect(state.timerCounter).toBe(1);
    expect(state.macrostep).toBe(2);
    expect(state.datamodel.renewals).toBe("0");
    expect(state.datamodel._sessionid).toBe('"desk-1"');
  });

  // Sabotage: taking every queued external event in one macrostep (handing
  // the core only the last) turns this red.
  it("takes queued external events one per macrostep, in order", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="desk">
      <state id="desk">
        <onentry><send event="copy.scanned"/><send event="copy.shelved"/></onentry>
        <transition event="copy.scanned" target="scanned"/>
      </state>
      <state id="scanned"><transition event="copy.shelved" target="shelf"/></state>
      <state id="shelf"/>
    </scxml>`);
    const { state } = begin(chart);
    expect(configuration(state)).toEqual(["shelf"]);
    expect(state.macrostep).toBe(3);
    expect(state.externalQueue).toEqual([]);
  });

  // Sabotage: answering ok with the state unchanged for a stopped chart
  // turns this red.
  it("refuses an event once the chart has stopped, and reports the donedata", () => {
    const loaned = send(LOAN, begin(LOAN).state, "checkout");
    const renewed = send(LOAN, loaned.state, "renew");
    const done = send(LOAN, renewed.state, "return");
    expect(kinds(done.effects)).toContain("done");
    expect(isDone(done.state)).toEqual({
      ok: true,
      done: true,
      donedata: { renewals: 1 },
      configuration: ["returned"],
    });
    expect(configuration(done.state)).toEqual([]);
    expect(done.state.timers).toEqual([]);
    expect(step(LOAN, done.state, { name: "checkout" })).toEqual({
      ok: false,
      reason: "not_running",
    });
  });

  // Sabotage: carrying the host's data as undefined turns this red.
  it("carries an event's data into _event", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="desk">
      <state id="desk"><transition event="checkout"><log expr="_event.data.patron"/></transition></state>
    </scxml>`);
    const out = ok(step(chart, begin(chart).state, { name: "checkout", data: { patron: "p-1" } }));
    expect(logged(out.effects)).toEqual(["p-1"]);
  });
});

describe("the virtual clock", () => {
  // Sabotage: skipping a timer due exactly at the new time (its `>` test
  // made `>=`) turns this red.
  it("fires a delayed self-send exactly at its due time and not before", () => {
    const loaned = send(LOAN, begin(LOAN).state, "checkout");
    expect(loaned.state.timers).toHaveLength(1);
    expect(loaned.state.timers[0]?.dueMs).toBe(2000);
    const early = wait(LOAN, loaned.state, 1999);
    expect(configuration(early.state)).toEqual(["active", "on_loan"]);
    expect(early.effects).toEqual([]);
    expect(early.state.nowMs).toBe(1999);
    const due = wait(LOAN, early.state, 1);
    expect(configuration(due.state)).toEqual(["on_loan", "overdue"]);
    expect(due.state.timers).toEqual([]);
    expect(due.state.nowMs).toBe(2000);
  });

  // Sabotage: leaving a cancelled timer pending (the filter in cancelSend
  // removed) turns this red.
  it("removes a pending timer when its send is cancelled", () => {
    const loaned = send(LOAN, begin(LOAN).state, "checkout");
    const renewed = send(LOAN, loaned.state, "renew");
    // The exit cancels the first loan's timer; the re-entry schedules a new one.
    expect(kinds(renewed.effects)).toEqual(["cancel", "datamodel_change", "send_delayed"]);
    expect(renewed.state.timers.map((t) => t.sequence)).toEqual([1]);
    const returned = send(LOAN, loaned.state, "return");
    expect(returned.state.timers).toEqual([]);
  });

  // Sabotage: firing timers due together in reverse scheduling order turns
  // this red.
  it("fires due timers earliest first, and in scheduling order at one due time", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <onentry>
          <send event="parcel.late" delay="300ms"/>
          <send event="parcel.first" delay="100ms"/>
          <send event="parcel.second" delay="100ms"/>
        </onentry>
        <transition event="parcel.*"><log expr="_event.name"/></transition>
      </state>
    </scxml>`);
    const out = wait(chart, begin(chart).state, 1000);
    expect(logged(out.effects)).toEqual(["parcel.first", "parcel.second", "parcel.late"]);
    expect(out.state.nowMs).toBe(1000);
  });

  // Sabotage: scheduling a timer due at its delay from zero rather than from
  // the clock's time when it was sent turns this red.
  it("schedules a delayed send from the clock's time when it was sent", () => {
    const later = wait(LOAN, begin(LOAN).state, 500);
    const loaned = send(LOAN, later.state, "checkout");
    expect(loaned.state.timers[0]?.dueMs).toBe(2500);
  });

  // Sabotage: accepting a negative time turns this red.
  it("refuses a negative or non-finite time", () => {
    const { state } = begin(LOAN);
    expect(advance(LOAN, state, -1)).toEqual({ ok: false, reason: "invalid_duration" });
    expect(advance(LOAN, state, Number.POSITIVE_INFINITY)).toEqual({
      ok: false,
      reason: "invalid_duration",
    });
  });
});

describe("routing a send", () => {
  // Sabotage: routing #_internal onto the external queue turns this red:
  // the internal event would be taken after the queued external one.
  it("delivers a send to #_internal onto the internal queue, after the batch that sent it", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="desk">
      <state id="desk">
        <onentry>
          <send event="loan.ext"/>
          <send event="loan.int" target="#_internal"/>
        </onentry>
        <transition event="loan.int" target="internal_first"/>
        <transition event="loan.ext" target="external_first"/>
      </state>
      <state id="internal_first"/>
      <state id="external_first"/>
    </scxml>`);
    const { state } = begin(chart);
    expect(configuration(state)).toEqual(["internal_first"]);
  });

  // Sabotage: delivering this session's own #_scxml_ address as a
  // communication error turns this red.
  it("delivers a send to this session's own address onto its external queue", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <onentry><send event="parcel.scanned" targetexpr="'#_scxml_' + _sessionid"/></onentry>
        <transition event="parcel.scanned" target="scanned"><log expr="_event.origin"/></transition>
      </state>
      <state id="scanned"/>
    </scxml>`);
    const out = begin(chart, { sessionId: "van-7" });
    expect(configuration(out.state)).toEqual(["scanned"]);
    expect(logged(out.effects)).toEqual(["#_scxml_van-7"]);
  });

  // Sabotage: dropping an unreachable send silently turns this red.
  it("fails a send to a parent or another session with error.communication", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <onentry><send id="up" event="parcel.out" target="#_parent"/></onentry>
        <transition event="error.communication" target="failed"><log expr="_event.sendid"/></transition>
      </state>
      <state id="failed"><onentry><send event="parcel.lost" target="#_scxml_other"/></onentry>
        <transition event="error.communication" target="lost"/>
      </state>
      <state id="lost"/>
    </scxml>`);
    const out = begin(chart);
    expect(configuration(out.state)).toEqual(["lost"]);
    expect(logged(out.effects)).toEqual(["up"]);
  });

  // Sabotage: leaving an immediate send to another session to the driver's
  // routing after the macrostep (no routes stamped on the core) turns this
  // red: the raise that follows the send is taken first.
  it("takes a send's unreachable-session error before a raise that follows it", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
    <state id="depot">
      <onentry>
        <send event="parcel.handover" target="#_scxml_van-9"/>
        <raise event="parcel.loaded"/>
      </onentry>
      <transition event="error.communication" target="unreachable"><log expr="_event.sendid"/></transition>
      <transition event="*" target="loaded"/>
    </state>
    <state id="unreachable"/>
    <state id="loaded"/>
  </scxml>`);
    const out = begin(chart, { sessionId: "van-7" });
    expect(configuration(out.state)).toEqual(["unreachable"]);
    expect(logged(out.effects)).toEqual(["send_1"]);
    expect(kinds(out.effects)).not.toContain("send");
  });

  // Sabotage: stamping no routes on a decoded state turns this red.
  it("judges an unreachable session the same way after the state is read back", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
    <state id="depot">
      <transition event="dispatch" target="dispatching"/>
    </state>
    <state id="dispatching">
      <onentry>
        <send event="parcel.handover" target="#_scxml_van-9"/>
        <raise event="parcel.loaded"/>
      </onentry>
      <transition event="error.communication" target="unreachable"/>
      <transition event="*" target="loaded"/>
    </state>
    <state id="unreachable"/>
    <state id="loaded"/>
  </scxml>`);
    const started = begin(chart, { sessionId: "van-7" });
    const out = send(chart, viaJson(started.state), "dispatch");
    expect(configuration(out.state)).toEqual(["unreachable"]);
  });

  // Sabotage: dropping a send to a target this driver cannot reach, instead
  // of raising error.communication, turns this red.
  it("routes a delayed send when its timer fires", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <onentry><send event="parcel.late" target="#_parent" delay="1s"/></onentry>
        <transition event="error.communication" target="failed"/>
      </state>
      <state id="failed"/>
    </scxml>`);
    const started = begin(chart);
    expect(configuration(started.state)).toEqual(["depot"]);
    expect(configuration(wait(chart, started.state, 1000).state)).toEqual(["failed"]);
  });
});

describe("registered send types", () => {
  const PARCEL = chartOf(`<scxml ${SCXML} initial="depot">
    <state id="depot">
      <onentry>
        <send type="courier" event="parcel.handed" target="van-7"><param name="parcel" expr="'p-9'"/></send>
        <send id="chase" type="courier" event="parcel.chase" target="van-7" delay="1s"/>
      </onentry>
      <transition event="cancel.chase"><cancel sendid="chase"/></transition>
      <transition event="resend"><send type="courier" event="parcel.again" target="van-7"/></transition>
      <transition event="parcel.*" target="wrong"/>
    </state>
    <state id="wrong"/>
  </scxml>`);

  function courier(): {
    processor: SendProcessor;
    handed: [Send | SendDelayed, Event][];
    cancels: Cancel[];
  } {
    const handed: [Send | SendDelayed, Event][] = [];
    const cancels: Cancel[] = [];
    return {
      handed,
      cancels,
      processor: {
        deliver: (s, e) => {
          handed.push([s, e]);
        },
        cancel: (c) => {
          cancels.push(c);
        },
      },
    };
  }

  // Sabotage: scheduling a registered type's delayed send as a timer (the
  // registered check skipped for send_delayed) turns this red.
  it("hands a send of a registered type to its processor and reports it, never firing it", () => {
    const host = courier();
    const sendTypes = { courier: host.processor };
    const out = begin(PARCEL, { sendTypes });
    expect(host.handed.map(([s]) => [s.kind, s.event, s.target])).toEqual([
      ["send", "parcel.handed", "van-7"],
      ["send_delayed", "parcel.chase", "van-7"],
    ]);
    expect(host.handed[0]?.[1]).toMatchObject({
      name: "parcel.handed",
      data: { parcel: "p-9" },
      origin: "#_scxml_desk-1",
    });
    expect(out.state.timers).toEqual([]);
    const reported = out.effects.flatMap((e) =>
      e.kind === "send" || e.kind === "send_delayed" ? [[e.kind, e.sendId, e.type]] : [],
    );
    expect(reported).toEqual([
      ["send", "send_1", "courier"],
      ["send_delayed", "chase", "courier"],
    ]);
    expect(Object.keys(out.state)).not.toContain("handedSends");
    expect(out.state.heldSends).toEqual({ chase: ["courier"] });
    const later = wait(PARCEL, out.state, 5000, { sendTypes });
    expect(configuration(later.state)).toEqual(["depot"]);
    expect(later.effects).toEqual([]);
  });

  // Sabotage: telling the processor of a cancel for a send it does not hold
  // (the held check removed) turns this red on the second cancel.
  it("tells the processor holding a delayed send of its cancel, once", () => {
    const host = courier();
    const sendTypes = { courier: host.processor };
    const first = send(PARCEL, begin(PARCEL, { sendTypes }).state, "cancel.chase", { sendTypes });
    expect(host.cancels.map((c) => c.sendId)).toEqual(["chase"]);
    expect(first.state.heldSends).toEqual({});
    send(PARCEL, first.state, "cancel.chase", { sendTypes });
    expect(host.cancels).toHaveLength(1);
  });

  // Sabotage: decoding the registered set as the one the chart started with
  // rather than the processors passed with the call turns this red.
  it("judges a send's type against the processors passed with each call", () => {
    const host = courier();
    const sendTypes = { courier: host.processor };
    const { state } = begin(PARCEL, { sendTypes });
    expect(host.handed).toHaveLength(2);
    // Without the processor the send is refused and raises error.execution,
    // which the wildcard transition does not take.
    const without = send(PARCEL, state, "resend");
    expect(configuration(without.state)).toEqual(["depot"]);
    expect(kinds(without.effects)).toEqual([]);
    expect(host.handed).toHaveLength(2);
    const withIt = send(PARCEL, state, "resend", { sendTypes });
    expect(kinds(withIt.effects)).toEqual(["send"]);
    expect(host.handed.map(([s]) => s.event)).toEqual([
      "parcel.handed",
      "parcel.chase",
      "parcel.again",
    ]);
    expect(kinds(begin(PARCEL).effects)).toEqual(["datamodel_init"]);
  });

  // A chart that reads _ioprocessors for the courier type on start and again
  // on every `check`, logging whether the entry is there.
  const LISTED = chartOf(`<scxml ${SCXML} initial="depot">
    <state id="depot">
      <onentry><log label="courier" expr="_ioprocessors['courier'] !== undefined"/></onentry>
      <transition event="check"><log label="courier" expr="_ioprocessors['courier'] !== undefined"/></transition>
    </state>
  </scxml>`);

  // Sabotage: starting the chart's datamodel without the registered set
  // (the interpreter's sendTypes not handed to initialDatamodel) turns the
  // first expectation red.
  it("lists each registered type in _ioprocessors, fixed when the chart starts", () => {
    const sendTypes = { courier: courier().processor };
    const started = begin(LISTED, { sendTypes });
    expect(logged(started.effects)).toEqual([true]);
    expect(logged(send(LISTED, started.state, "check").effects)).toEqual([true]);
    const bare = begin(LISTED);
    expect(logged(bare.effects)).toEqual([false]);
    expect(logged(send(LISTED, bare.state, "check", { sendTypes }).effects)).toEqual([false]);
  });
});

describe("the state as a JSON value", () => {
  // Sabotage: decoding the virtual clock as zero rather than the state's
  // time turns this red.
  it("parses back from JSON to a state that steps identically", () => {
    const loaned = send(LOAN, begin(LOAN).state, "checkout");
    const waited = wait(LOAN, loaned.state, 700);
    const parsed = viaJson(waited.state);
    expect(parsed).toEqual(waited.state);
    for (const next of [
      (s: State) => step(LOAN, s, { name: "renew" }),
      (s: State) => advance(LOAN, s, 1300),
      (s: State) => step(LOAN, s, { name: "return" }),
    ]) {
      expect(next(parsed)).toEqual(next(waited.state));
    }
    const fired = ok(advance(LOAN, parsed, 1300));
    expect(configuration(fired.state)).toEqual(["on_loan", "overdue"]);
  });

  // A copy on loan invokes a patron notice each time the loan opens, so the
  // invoke counter is part of what the next step reads.
  // Sabotage: writing invokeCounter as 0 in encodeState turns this red.
  it("keeps the invoke counter, so the next invocation's id follows the last", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="on_loan">
      <state id="on_loan">
        <invoke type="scxml"/>
        <transition event="renew" target="on_loan"/>
      </state>
    </scxml>`);
    const started = begin(chart);
    expect(started.state.invokeCounter).toBe(1);
    const renewed = send(chart, viaJson(started.state), "renew");
    expect(renewed.effects).toMatchObject([
      { kind: "cancel_invoke", invokeId: "on_loan.inv_1" },
      { kind: "invoke", invokeId: "on_loan.inv_2" },
    ]);
  });

  // Sabotage: writing values with JSON.stringify (an integral float read
  // back as an integer, undefined lost) turns this red.
  it("keeps values plain JSON loses, through the tagged-value text", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="desk">
      <datamodel><data id="period" expr="21d"/><data id="due_on" expr="#2026-10-21#"/></datamodel>
      <state id="desk"><transition event="check"><log expr="note"/><log expr="period"/><log expr="rate"/><log expr="due_on"/></transition></state>
    </scxml>`);
    const host: Record<string, Value> = { rate: float(2), note: Undefined };
    const started = begin(chart, { datamodel: host });
    const parsed = viaJson(started.state);
    const direct = send(chart, started.state, "check");
    expect(send(chart, parsed, "check")).toEqual(direct);
    const [note, period, rate, dueOn] = logged(direct.effects);
    expect(note).toBe(Undefined);
    expect(period).toBeInstanceOf(Duration);
    // The evaluator answers an integral float as a float, as the state keeps
    // it, which is what the next step reads.
    expect(rate).toEqual(float(2));
    expect(parsed.datamodel.rate).toBe("2.0");
    expect(parsed.datamodel.note).toBe(started.state.datamodel.note);
    expect(dueOn).toBeInstanceOf(PDate);
  });

  // Sabotage: comparing only the content hash, not the name, turns this red.
  it("refuses a state made by another chart", () => {
    const compiled = compile(LOAN_SOURCE, { chartName: "loan-desk" });
    if (!compiled.ok) throw new Error("fixture does not compile");
    const renamed = compiled.chart;
    const { state } = begin(LOAN);
    expect(step(renamed, state, { name: "checkout" })).toEqual({
      ok: false,
      reason: "chart_mismatch",
    });
  });

  // Sabotage: accepting an id the chart does not hold (indexOf answering 0)
  // turns this red.
  it("refuses a state naming a state the chart does not have, or text that does not decode", () => {
    const { state } = begin(LOAN);
    expect(step(LOAN, { ...state, configuration: ["stacks"] }, { name: "x" })).toEqual({
      ok: false,
      reason: "malformed_state",
      detail: { kind: "unknown_state", name: "stacks" },
    });
    expect(step(LOAN, { ...state, configuration: ["#0"] }, { name: "x" })).toEqual({
      ok: false,
      reason: "malformed_state",
      detail: { kind: "unknown_state", name: "#0" },
    });
    expect(
      step(LOAN, { ...state, datamodel: { ...state.datamodel, renewals: "{" } }, { name: "x" }),
    ).toEqual({
      ok: false,
      reason: "malformed_state",
      detail: { kind: "undecodable_value", field: "datamodel.renewals" },
    });
  });

  // Sabotage: naming the field without its index in the queue turns this red.
  it("names the queued event whose data does not decode", () => {
    const { state } = begin(LOAN);
    const queued = { name: "checkout", type: "external" as const, data: "null" };
    const broken = { ...state, halted: "budget_exhausted" as const };
    const accepted = step(LOAN, { ...broken, externalQueue: [queued] }, { name: "x" });
    expect(accepted.ok).toBe(true);
    expect(
      step(LOAN, { ...broken, externalQueue: [queued, { ...queued, data: "[" }] }, { name: "x" }),
    ).toEqual({
      ok: false,
      reason: "malformed_state",
      detail: { kind: "undecodable_value", field: "externalQueue[1].data" },
    });
  });

  // Sabotage: writing a value the tagged-value text refuses as an empty
  // string without refusing turns this red.
  it("refuses a value the tagged-value text cannot carry", () => {
    expect(start(LOAN, { sessionId: "desk-1", datamodel: { shelf: { $type: "date" } } })).toEqual({
      ok: false,
      reason: "unencodable_value",
    });
  });

  // Sabotage: naming a state with no id by its document id (null) rather
  // than "#" and its index turns this red.
  it("names a state the document gave no id by its index", () => {
    const chart = chartOf(`<scxml ${SCXML}>
      <state><transition event="scan" target="doorstep"/></state>
      <final id="doorstep"/>
    </scxml>`);
    const { state } = begin(chart);
    expect(configuration(state)).toEqual(["#1"]);
    expect(configuration(send(chart, viaJson(state), "scan").state)).toEqual([]);
  });

  // Sabotage: decoding a pending timer of an immediate send without
  // refusing turns this red.
  it("refuses a pending timer that is not a delayed send", () => {
    const { state } = send(LOAN, begin(LOAN).state, "checkout");
    const [timer] = state.timers;
    if (timer === undefined) throw new Error("no timer");
    const broken = { ...state, timers: [{ ...timer, send: { ...timer.send, kind: "send" } }] };
    expect(advance(LOAN, broken as State, 0)).toEqual({
      ok: false,
      reason: "malformed_state",
      detail: { kind: "not_a_delayed_send", field: "timers[0].send" },
    });
  });
});

describe("isDone", () => {
  // Sabotage: answering a stand-in undefined for donedata that does not
  // decode turns this red.
  it("answers a decode failure, not a stand-in value, for donedata that does not decode", () => {
    const loaned = send(LOAN, begin(LOAN).state, "checkout");
    const done = send(LOAN, loaned.state, "return").state;
    if (done.done === null) throw new Error("not done");
    expect(isDone({ ...done, done: { ...done.done, donedata: "{" } })).toEqual({
      ok: false,
      reason: "malformed_state",
      detail: { kind: "undecodable_value", field: "done.donedata" },
    });
  });
});

describe("the state's shape", () => {
  function badShape(field: string) {
    return { ok: false, reason: "malformed_state", detail: { kind: "bad_shape", field } };
  }

  function without(state: State, field: string): State {
    const copy: Record<string, unknown> = { ...state };
    delete copy[field];
    return copy as unknown as State;
  }

  function reshaped(state: State, changes: Record<string, unknown>): State {
    return { ...state, ...changes } as unknown as State;
  }

  // Sabotage: answering the shape refusal with the field `state` whatever
  // failed, or skipping the check in isDone, turns this red.
  it("refuses a state that is not a driver state at all, on step, advance and isDone", () => {
    const empty = {} as unknown as State;
    expect(step(LOAN, empty, { name: "checkout" })).toEqual(badShape("identity"));
    expect(advance(LOAN, empty, 10)).toEqual(badShape("identity"));
    expect(isDone(empty)).toEqual(badShape("identity"));
    expect(step(LOAN, null as unknown as State, { name: "checkout" })).toEqual(badShape("state"));
  });

  // Sabotage: answering the shape refusal with the field `state` whatever
  // failed turns this red.
  it("names a missing field", () => {
    const { state } = begin(LOAN);
    for (const field of ["timers", "datamodel", "identity", "configuration"]) {
      expect(step(LOAN, without(state, field), { name: "checkout" })).toEqual(badShape(field));
      expect(advance(LOAN, without(state, field), 10)).toEqual(badShape(field));
    }
  });

  // Sabotage: naming a datamodel entry without its key turns this red.
  it("names a datamodel value that is not tagged-value text", () => {
    const { state } = begin(LOAN);
    const broken = reshaped(state, { datamodel: { ...state.datamodel, n: 5 } });
    expect(step(LOAN, broken, { name: "checkout" })).toEqual(badShape("datamodel.n"));
  });

  // Sabotage: accepting any number-like clock (the type check on nowMs
  // removed) turns this red: the clock becomes "100300".
  it("refuses a clock that is not a non-negative number", () => {
    const { state } = begin(LOAN);
    expect(advance(LOAN, reshaped(state, { nowMs: "100" }), 300)).toEqual(badShape("nowMs"));
    expect(advance(LOAN, reshaped(state, { nowMs: -1 }), 300)).toEqual(badShape("nowMs"));
  });

  // Sabotage: accepting any string as the status turns this red.
  it("refuses a status or running flag outside its values", () => {
    const { state } = begin(LOAN);
    expect(step(LOAN, reshaped(state, { status: "paused" }), { name: "x" })).toEqual(
      badShape("status"),
    );
    expect(step(LOAN, reshaped(state, { running: "yes" }), { name: "x" })).toEqual(
      badShape("running"),
    );
  });

  // Sabotage: checking a timer's fields without its send record turns this
  // red.
  it("names the first bad field inside a pending timer and a queued event", () => {
    const { state } = send(LOAN, begin(LOAN).state, "checkout");
    const [timer] = state.timers;
    if (timer === undefined) throw new Error("no timer");
    const badTimer = { ...timer, send: { ...timer.send, owner: { kind: "elsewhere" } } };
    expect(advance(LOAN, reshaped(state, { timers: [badTimer] }), 0)).toEqual(
      badShape("timers[0].send.owner.kind"),
    );
    const queued = { name: "checkout", type: "external", data: "null", cause: { origin: {} } };
    expect(step(LOAN, reshaped(state, { externalQueue: [queued] }), { name: "x" })).toEqual(
      badShape("externalQueue[0].cause.origin.kind"),
    );
  });

  // An event an invocation's start or its finalize raised names that
  // invocation as its origin, and a state holding one is read back.
  // Sabotage: removing `invoke` from the origin kinds driver-shape accepts
  // turns this red.
  it("accepts a queued event whose origin is an invocation or its finalize", () => {
    const { state } = begin(LOAN);
    for (const kind of ["invoke", "finalize"]) {
      const origin = { kind, stateIndex: 1, invokeIndex: 0 };
      const cause = { origin, macrostep: 1, microstep: 1, round: 1 };
      const queued = { name: "error.execution", type: "platform", data: "null", cause };
      expect(step(LOAN, reshaped(state, { externalQueue: [queued] }), { name: "x" }).ok).toBe(true);
    }
  });

  // Sabotage: refusing a state that has every field right (the round budget
  // check made to refuse "infinity") turns this red.
  it("accepts every state the driver itself writes", () => {
    const started = begin(LOAN, { maxMacrostepRounds: "infinity" });
    const loaned = send(LOAN, viaJson(started.state), "checkout");
    expect(isDone(viaJson(loaned.state))).toEqual({ ok: true, done: false });
    expect(advance(LOAN, viaJson(loaned.state), 2000).ok).toBe(true);
  });
});

describe("a macrostep that spends its budget", () => {
  // Sabotage: draining external events after the halt turns this red.
  it("halts the driver: external events wait and pending timers still fire", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="desk">
      <state id="desk">
        <onentry><send event="loan.due" delay="1s"/></onentry>
        <transition event="spin" target="spin_a"/>
        <transition event="loan.due"><log expr="'due'"/></transition>
      </state>
      <state id="spin_a"><transition target="spin_b"/></state>
      <state id="spin_b"><transition target="spin_a"/></state>
    </scxml>`);
    const started = begin(chart, { maxMacrostepRounds: 5 });
    const spun = send(chart, started.state, "spin");
    expect(kinds(spun.effects)).toContain("budget_exhausted");
    expect(spun.state.halted).toBe("budget_exhausted");
    const waiting = send(chart, spun.state, "checkout");
    expect(waiting.effects).toEqual([]);
    expect(waiting.state.externalQueue.map((e) => e.name)).toEqual(["checkout"]);
    const fired = wait(chart, waiting.state, 1000);
    expect(fired.state.timers).toEqual([]);
    expect(fired.state.externalQueue.map((e) => e.name)).toEqual(["checkout", "loan.due"]);
    expect(viaJson(fired.state)).toEqual(fired.state);
  });
});

describe("the entry point", () => {
  // Sabotage: removing `advance` from the entry point's exports turns this
  // red.
  it("exports the six calls", () => {
    expect(typeof entry.compile).toBe("function");
    expect(typeof entry.start).toBe("function");
    expect(typeof entry.step).toBe("function");
    expect(typeof entry.advance).toBe("function");
    expect(typeof entry.configuration).toBe("function");
    expect(typeof entry.isDone).toBe("function");
  });
});

describe("the trace flag", () => {
  // The reference's position carries `trace` and a drive reads it from the
  // position (statifier-ex v2.9.0, lib/statifier/position.ex, `import/2`).
  // Sabotage: decoding the state's trace as false in decodeState turns this
  // red (no trace effect, and the flag comes back false).
  it("is read from the state and written back, and a set flag answers the trace effects", () => {
    const started = begin(LOAN);
    expect(started.state.trace).toBe(false);
    const traced = send(LOAN, viaJson({ ...started.state, trace: true }), "checkout");
    expect(traced.state.trace).toBe(true);
    expect(traced.effects.filter((effect) => effect.kind === "trace").length).toBeGreaterThan(0);
    const plain = send(LOAN, started.state, "checkout");
    expect(plain.effects.filter((effect) => effect.kind === "trace")).toEqual([]);
  });
});
