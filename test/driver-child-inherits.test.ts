// What an in-process child inherits from the call that runs it: the host's
// registered send types (`inheritSendTypes`) and the host's view of its
// effects (`inheritObservers`), each off unless the call opts in, as the
// reference's `inherit_send_types` and `inherit_observers` session options
// are. Off, a child registers no send type and its effects are not reported;
// on, a child's send of a registered type reaches the host's processor with
// the child's session id, and every effect a child's run answers is reported
// among the call's effects inside a `child` effect naming that id.
//
// The charts are parcel delivery: a depot that invokes a courier, whose scans
// go to the host's scanner processor, and a courier that invokes a sorter.

import { describe, expect, it } from "vitest";
import { type Chart, compile } from "../src/compiler.js";
import type { Send, SendDelayed } from "../src/core/send.js";
import {
  type DeliveryFailure,
  type DriveEffect,
  type DriveOptions,
  type DriveResult,
  type ProcessorContext,
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

type Moved = { readonly state: State; readonly effects: readonly DriveEffect[] };

function ok(result: DriveResult): Moved {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result;
}

function viaJson(state: State): State {
  return JSON.parse(JSON.stringify(state)) as State;
}

// The host session's own log values, in order.
function logged(effects: readonly DriveEffect[]): unknown[] {
  return effects.flatMap((effect) => (effect.kind === "log" ? [effect.value] : []));
}

// Each child effect as its session id and kind, in order.
function childKinds(effects: readonly DriveEffect[]): [string, string][] {
  return effects.flatMap((effect): [string, string][] =>
    effect.kind === "child" ? [[effect.sessionId, effect.effect.kind]] : [],
  );
}

// Each child log as its session id and value, in order.
function childLogs(effects: readonly DriveEffect[]): [string, unknown][] {
  return effects.flatMap((effect): [string, unknown][] =>
    effect.kind === "child" && effect.effect.kind === "log"
      ? [[effect.sessionId, effect.effect.value]]
      : [],
  );
}

// The host's scanner: records each send it is handed with the session it was
// handed for, and answers a failure for the events `failing` names.
function scanner(failing: readonly string[] = []): {
  readonly handed: [string, string][];
  readonly processor: SendProcessor;
} {
  const handed: [string, string][] = [];
  const failure: DeliveryFailure = { kind: "failure", reason: "the hub is closed" };
  const processor: SendProcessor = {
    deliver: (_send: Send | SendDelayed, event, context: ProcessorContext) => {
      handed.push([event.name, context.sessionId]);
      return failing.includes(event.name) ? failure : undefined;
    },
    ioprocessorsEntry: (_type, context) => ({ hub: `hub-for-${context.sessionId}` }),
  };
  return { handed, processor };
}

// A depot whose courier scans the parcel as it loads the van and again as it
// reaches the doorstep, both through the host's `parcel:scan` type. A scan the
// courier cannot send, or one the scanner reports failed, it tells the depot.
const DEPOT = chartOf(`<scxml ${SCXML} initial="depot">
  <state id="depot">
    <invoke id="courier" type="scxml">
      <content>
        <scxml version="1.0" initial="van">
          <datamodel><data id="scans" expr="0"/></datamodel>
          <state id="van">
            <onentry>
              <log label="courier" expr="'loaded'"/>
              <send type="parcel:scan" event="parcel.loaded" target="hub:north"/>
            </onentry>
            <transition event="parcel.go" target="doorstep">
              <assign location="scans" expr="scans + 1"/>
              <send type="parcel:scan" event="parcel.delivered" target="hub:north"/>
            </transition>
            <transition event="error.execution" target="stuck">
              <send target="#_parent" event="courier.refused"/>
            </transition>
            <transition event="error.communication" target="stuck">
              <send target="#_parent" event="courier.lost"/>
            </transition>
          </state>
          <state id="doorstep">
            <transition event="error.communication" target="stuck">
              <send target="#_parent" event="courier.lost"/>
            </transition>
          </state>
          <state id="stuck"/>
        </scxml>
      </content>
    </invoke>
    <transition event="dispatch"><send target="#_courier" event="parcel.go"/></transition>
    <transition event="courier.refused"><log expr="'refused'"/></transition>
    <transition event="courier.lost"><log expr="'lost'"/></transition>
  </state>
</scxml>`);

describe("a child with no inheritance asked for", () => {
  // Sabotage: starting every child with the call's processors whether or not
  // the call opts in turns this red: the scanner is handed the courier's scan.
  it("registers no send type in the child, so its scan raises error.execution there", () => {
    const host = scanner();
    const started = ok(
      start(DEPOT, { sessionId: "depot-1", sendTypes: { "parcel:scan": host.processor } }),
    );
    expect(host.handed).toEqual([]);
    expect(logged(started.effects)).toEqual(["refused"]);
  });

  // Sabotage: reporting a child's effects whether or not the call opts in
  // turns this red.
  it("reports none of the child's effects", () => {
    const started = ok(start(DEPOT, { sessionId: "depot-1" }));
    expect(childKinds(started.effects)).toEqual([]);
  });
});

describe("inheritSendTypes", () => {
  const opts = (processor: SendProcessor): DriveOptions => ({
    sendTypes: { "parcel:scan": processor },
    inheritSendTypes: true,
  });

  // Sabotage: starting the child with no processors although the call opts
  // in turns this red: the scan raises error.execution and nothing is handed.
  it("hands a child's send of a registered type to the host's processor, with the child's id", () => {
    const host = scanner();
    const started = ok(start(DEPOT, { sessionId: "depot-1", ...opts(host.processor) }));
    expect(host.handed).toEqual([["parcel.loaded", "depot-1.courier"]]);
    expect(logged(started.effects)).toEqual([]);
  });

  // Sabotage: building the child's `_ioprocessors` from no processors turns
  // this red: the entry is absent.
  it("writes the registered type's entry into the child's _ioprocessors", () => {
    const host = scanner();
    const { state } = ok(start(DEPOT, { sessionId: "depot-1", ...opts(host.processor) }));
    const courier = state.invocations[0]?.state;
    expect(courier?.datamodel._ioprocessors).toContain("parcel:scan");
    expect(courier?.datamodel._ioprocessors).toContain("hub-for-depot-1.courier");
  });

  // Sabotage: decoding a child with no processors although the call opts in
  // turns this red: the doorstep scan raises error.execution in the child.
  it("reaches the processor from a child decoded from the state a later call is handed", () => {
    const host = scanner();
    const started = ok(start(DEPOT, { sessionId: "depot-1", ...opts(host.processor) }));
    const moved = ok(
      step(DEPOT, viaJson(started.state), { name: "dispatch" }, opts(host.processor)),
    );
    expect(host.handed).toEqual([
      ["parcel.loaded", "depot-1.courier"],
      ["parcel.delivered", "depot-1.courier"],
    ]);
    expect(logged(moved.effects)).toEqual([]);
    expect(moved.state.invocations[0]?.state?.configuration).toEqual(["doorstep"]);
  });

  // Sabotage: calling the child's processor during the run rather than once
  // the call's state is written turns this red: the refused step hands the
  // doorstep scan, and the retry hands it again.
  it("hands a child's send only once the call's state is written", () => {
    const host = scanner();
    const { state } = ok(start(DEPOT, { sessionId: "depot-1", ...opts(host.processor) }));
    const unencodable = { name: "dispatch", data: { $type: "date" } };
    expect(step(DEPOT, state, unencodable, opts(host.processor))).toEqual({
      ok: false,
      reason: "unencodable_value",
    });
    expect(host.handed).toEqual([["parcel.loaded", "depot-1.courier"]]);
    ok(step(DEPOT, state, { name: "dispatch" }, opts(host.processor)));
    expect(host.handed).toEqual([
      ["parcel.loaded", "depot-1.courier"],
      ["parcel.delivered", "depot-1.courier"],
    ]);
  });

  // Sabotage: ignoring the failure a processor answers for a child's send
  // turns this red: the courier never hears of it and the depot logs nothing.
  it("raises a failure the processor answers for a child's send within the run, once", () => {
    const host = scanner(["parcel.loaded"]);
    const started = ok(start(DEPOT, { sessionId: "depot-1", ...opts(host.processor) }));
    expect(host.handed).toEqual([["parcel.loaded", "depot-1.courier"]]);
    expect(logged(started.effects)).toEqual(["lost"]);
    expect(started.state.invocations[0]?.state?.configuration).toEqual(["stuck"]);
  });

  // Sabotage: passing the processors to the host's children only, and not on
  // to theirs, turns this red: the sorter's scan is not handed.
  it("passes the processors down the whole tree", () => {
    const host = scanner();
    ok(start(SORTING_DEPOT, { sessionId: "depot-1", ...opts(host.processor) }));
    expect(host.handed).toEqual([
      ["parcel.loaded", "depot-1.courier"],
      ["parcel.sorted", "depot-1.courier.sorter"],
    ]);
  });
});

describe("inheritObservers", () => {
  // Sabotage: starting the child with a list nothing reads although the call
  // opts in (dropping the child's effects) turns this red.
  it("reports every effect of the child's run among the call's effects, tagged with its id", () => {
    const started = ok(start(DEPOT, { sessionId: "depot-1", inheritObservers: true }));
    expect(childKinds(started.effects)).toEqual([
      ["depot-1.courier", "datamodel_init"],
      ["depot-1.courier", "datamodel_change"],
      ["depot-1.courier", "log"],
      // The scan of a type the child does not register answers no send; the
      // courier then tells its parent.
      ["depot-1.courier", "send"],
    ]);
    expect(childLogs(started.effects)).toEqual([["depot-1.courier", "loaded"]]);
    // The host session's own effects stay unwrapped, the child's after the
    // invoke that started it.
    const invokeAt = started.effects.findIndex((effect) => effect.kind === "invoke");
    const firstChildAt = started.effects.findIndex((effect) => effect.kind === "child");
    expect(invokeAt).toBeGreaterThanOrEqual(0);
    expect(firstChildAt).toBeGreaterThan(invokeAt);
    expect(logged(started.effects)).toEqual(["refused"]);
  });

  // Sabotage: reporting a child's effect unwrapped turns this red: the
  // child's log reads as the host session's own.
  it("reports a child's datamodel write and send from a later call, under the child's id", () => {
    // With the send types inherited the courier's scan is handed, so it waits
    // in the van for the depot's go.
    const host = scanner();
    const options: DriveOptions = {
      sendTypes: { "parcel:scan": host.processor },
      inheritSendTypes: true,
      inheritObservers: true,
    };
    const loaded = ok(start(DEPOT, { sessionId: "depot-1", ...options }));
    const moved = ok(step(DEPOT, viaJson(loaded.state), { name: "dispatch" }, options));
    const writes = moved.effects.flatMap((effect) =>
      effect.kind === "child" && effect.effect.kind === "datamodel_change"
        ? [[effect.sessionId, effect.effect.locationPath, effect.effect.newValue]]
        : [],
    );
    expect(writes).toEqual([["depot-1.courier", ["scans"], 1]]);
    const sends = moved.effects.flatMap((effect) =>
      effect.kind === "child" && effect.effect.kind === "send"
        ? [[effect.sessionId, effect.effect.event]]
        : [],
    );
    expect(sends).toEqual([["depot-1.courier", "parcel.delivered"]]);
    expect(logged(moved.effects)).toEqual([]);
  });

  // Sabotage: reporting a grandchild's effect inside its parent's child
  // effect, or under its parent's id, turns this red.
  it("reports a grandchild's effects under its own id, not nested", () => {
    const started = ok(start(SORTING_DEPOT, { sessionId: "depot-1", inheritObservers: true }));
    expect(childLogs(started.effects)).toEqual([
      ["depot-1.courier", "loaded"],
      ["depot-1.courier.sorter", "sorting"],
    ]);
    for (const effect of started.effects) {
      if (effect.kind === "child") expect(effect.effect.kind).not.toBe("child");
    }
  });

  // Sabotage: starting a child with its trace flag clear whatever its
  // parent's turns this red: the courier answers no trace.
  it("starts a child with its parent's trace flag", () => {
    const { state } = ok(start(DISPATCHING, { sessionId: "depot-1" }));
    const traced = ok(
      step(
        DISPATCHING,
        { ...state, trace: true },
        { name: "dispatch" },
        { inheritObservers: true },
      ),
    );
    expect(childKinds(traced.effects)).toContainEqual(["depot-1.courier", "trace"]);
    expect(traced.state.invocations[0]?.state?.trace).toBe(true);
    const untraced = ok(step(DISPATCHING, state, { name: "dispatch" }, { inheritObservers: true }));
    expect(childKinds(untraced.effects)).not.toContainEqual(["depot-1.courier", "trace"]);
    expect(untraced.state.invocations[0]?.state?.trace).toBe(false);
  });

  // Sabotage: handing the child the call's processors when only observers
  // are asked for turns this red.
  it("is independent of inheritSendTypes", () => {
    const host = scanner();
    const started = ok(
      start(DEPOT, {
        sessionId: "depot-1",
        sendTypes: { "parcel:scan": host.processor },
        inheritObservers: true,
      }),
    );
    expect(host.handed).toEqual([]);
    expect(logged(started.effects)).toEqual(["refused"]);
  });
});

// A depot whose courier invokes a sorter; both scan through the host's type.
const SORTING_DEPOT = chartOf(`<scxml ${SCXML} initial="depot">
  <state id="depot">
    <invoke id="courier" type="scxml">
      <content>
        <scxml version="1.0" initial="van">
          <state id="van">
            <onentry>
              <log expr="'loaded'"/>
              <send type="parcel:scan" event="parcel.loaded" target="hub:north"/>
            </onentry>
            <invoke id="sorter" type="scxml">
              <content>
                <scxml version="1.0" initial="sorting">
                  <state id="sorting">
                    <onentry>
                      <log expr="'sorting'"/>
                      <send type="parcel:scan" event="parcel.sorted" target="hub:north"/>
                    </onentry>
                  </state>
                </scxml>
              </content>
            </invoke>
          </state>
        </scxml>
      </content>
    </invoke>
  </state>
</scxml>`);

// A depot that invokes its courier only once dispatched, so a call can set
// the trace flag before the courier starts.
const DISPATCHING = chartOf(`<scxml ${SCXML} initial="yard">
  <state id="yard">
    <transition event="dispatch" target="depot"/>
  </state>
  <state id="depot">
    <invoke id="courier" type="scxml">
      <content>
        <scxml version="1.0" initial="van"><state id="van"/></scxml>
      </content>
    </invoke>
  </state>
</scxml>`);
