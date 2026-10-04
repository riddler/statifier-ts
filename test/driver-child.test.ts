// The in-process SCXML child: an `<invoke>` whose content the driver compiles
// and runs as a child session on the parent's virtual clock. Starting it, the
// parent and invocation send targets, its completion and done event, its
// cancel when the invoking state exits, the discard of what a cancelled child
// sent, autoforward, the invoke types the driver does not run, the content
// that cannot start a child, the datamodel seeding, the shared clock, and the
// child's state inside the driver's JSON state.
//
// The charts are parcel delivery: a depot that invokes a courier, which takes
// a parcel from the van to the doorstep. A courier's chart is written the way
// the corpus writes an in-line child, with no namespace declared.

import { describe, expect, it } from "vitest";
import { type Chart, compile } from "../src/compiler.js";
import {
  advance,
  configuration,
  type DriveEffect,
  type DriveResult,
  type State,
  start,
  step,
} from "../src/driver.js";
import { exportPosition, importPosition } from "../src/position.js";

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

function begin(chart: Chart): Moved {
  return ok(start(chart, { sessionId: "depot-1" }));
}

function send(chart: Chart, state: State, name: string): Moved {
  return ok(step(chart, state, { name }));
}

function wait(chart: Chart, state: State, ms: number): Moved {
  return ok(advance(chart, state, ms));
}

function logged(effects: readonly DriveEffect[]): unknown[] {
  return effects.flatMap((effect) => (effect.kind === "log" ? [effect.value] : []));
}

function viaJson(state: State): State {
  return JSON.parse(JSON.stringify(state)) as State;
}

// A depot whose courier waits in the van for the depot's go, then reports the
// parcel delivered and stops with the number of scans it made.
const DEPOT = chartOf(`<scxml ${SCXML} initial="depot">
  <state id="depot">
    <invoke id="courier" type="scxml">
      <content>
        <scxml version="1.0" initial="van">
          <state id="van">
            <transition event="parcel.go" target="doorstep">
              <send target="#_parent" event="parcel.delivered"/>
            </transition>
          </state>
          <final id="doorstep"><donedata><param name="scans" expr="3"/></donedata></final>
        </scxml>
      </content>
    </invoke>
    <transition event="dispatch"><send target="#_courier" event="parcel.go"/></transition>
    <transition event="parcel.delivered" target="delivered"><log expr="_event.invokeid"/></transition>
  </state>
  <state id="delivered">
    <transition event="done.invoke.courier" target="closed">
      <log expr="_event.data.scans"/>
      <log expr="_event.invokeid"/>
      <log expr="_event.origin"/>
    </transition>
  </state>
  <final id="closed"/>
</scxml>`);

describe("starting a child", () => {
  // Sabotage: compiling the content without the relaxed namespace rule turns
  // this red: the courier's chart declares no namespace, so no child starts.
  it("compiles the content and starts it as a child session under its own id", () => {
    const { state } = begin(DEPOT);
    expect(configuration(state)).toEqual(["depot"]);
    expect(state.invocations).toHaveLength(1);
    const [courier] = state.invocations;
    expect(courier?.invokeId).toBe("courier");
    expect(courier?.state?.sessionId).toBe("depot-1.courier");
    expect(courier?.state?.invokedAs).toBe("courier");
    expect(courier?.state?.configuration).toEqual(["van"]);
    expect(courier?.state?.datamodel._sessionid).toBe('"depot-1.courier"');
  });

  // Sabotage: seeding every param rather than only those a root <data> names
  // turns this red.
  it("seeds the child's datamodel with the params its root data names, and no other", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <invoke id="courier" type="scxml">
          <param name="parcel" expr="'P-7'"/>
          <param name="weight" expr="2"/>
          <content>
            <scxml version="1.0" initial="van">
              <datamodel><data id="parcel" expr="'none'"/></datamodel>
              <state id="van"/>
            </scxml>
          </content>
        </invoke>
      </state>
    </scxml>`);
    const child = begin(chart).state.invocations[0]?.state;
    expect(child?.datamodel.parcel).toBe('"P-7"');
    expect(child?.datamodel).not.toHaveProperty("weight");
  });
});

describe("the parent and invocation targets", () => {
  // Sabotage: routing #_<invokeid> to error.communication, as the driver did
  // before it ran a child, turns this red.
  it("delivers #_<invokeid> to the child and #_parent to the parent, stamped with the invoke id", () => {
    const out = send(DEPOT, begin(DEPOT).state, "dispatch");
    expect(configuration(out.state)).toEqual([]);
    expect(logged(out.effects)).toEqual(["courier", 3, "courier", "#_scxml_depot-1"]);
  });

  // Sabotage: leaving the event's invokeid unset on a send to #_parent turns
  // this red.
  it("stamps a send to #_parent with the invoke id and the child's own origin", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <invoke id="courier" type="scxml">
          <content>
            <scxml version="1.0" initial="van">
              <state id="van"><onentry><send target="#_parent" event="parcel.loaded"/></onentry></state>
            </scxml>
          </content>
        </invoke>
        <transition event="parcel.loaded" target="loaded">
          <log expr="_event.invokeid"/>
          <log expr="_event.origin"/>
        </transition>
      </state>
      <state id="loaded"/>
    </scxml>`);
    const out = begin(chart);
    expect(configuration(out.state)).toEqual(["loaded"]);
    expect(logged(out.effects)).toEqual(["courier", "#_scxml_depot-1.courier"]);
  });

  // Sabotage: declaring no invocation in the routes stamped on the core turns
  // this red: the core refuses the send to #_courier where it runs, and the
  // depot takes the error.
  it("declares a live invocation to the core, so a send to it is not refused", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <invoke id="courier" type="scxml">
          <content><scxml version="1.0" initial="van"><state id="van"/></scxml></content>
        </invoke>
        <transition event="dispatch"><send target="#_courier" event="parcel.go"/></transition>
        <transition event="error.communication" target="unreachable"/>
      </state>
      <state id="unreachable"/>
    </scxml>`);
    expect(configuration(send(chart, begin(chart).state, "dispatch").state)).toEqual(["depot"]);
  });

  // Sabotage: declaring the routes before every event taken, not only at an
  // input from outside, turns this red: the depot's own `go` would see the
  // courier and its send would reach it.
  it("takes an event the chart queued for itself under the routes declared when it started", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <onentry><send event="go"/></onentry>
        <invoke id="courier" type="scxml">
          <content>
            <scxml version="1.0" initial="van">
              <state id="van">
                <transition event="parcel.ping"><send target="#_parent" event="parcel.pong"/></transition>
              </state>
            </scxml>
          </content>
        </invoke>
        <transition event="go"><send target="#_courier" event="parcel.ping"/></transition>
        <transition event="parcel.pong" target="answered"/>
        <transition event="error.communication" target="refused"/>
      </state>
      <state id="answered"/>
      <state id="refused"/>
    </scxml>`);
    expect(configuration(begin(chart).state)).toEqual(["refused"]);
  });

  // Sabotage: declaring the routes before every event taken turns this red:
  // the core refuses the send to the cancelled courier where it runs, and the
  // raise after it never happens.
  it("routes a self-queued send to an invocation cancelled since the routes were declared", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <invoke id="courier" type="scxml">
          <content><scxml version="1.0" initial="van"><state id="van"/></scxml></content>
        </invoke>
        <transition event="recall" target="held"/>
      </state>
      <state id="held">
        <onentry><send event="retry"/></onentry>
        <transition event="retry">
          <send target="#_courier" event="parcel.go"/>
          <raise event="retried"/>
        </transition>
        <transition event="retried" target="retried"/>
        <transition event="error.communication" target="refused"/>
      </state>
      <state id="retried"><transition event="error.communication" target="reported"/></state>
      <state id="refused"/>
      <state id="reported"/>
    </scxml>`);
    expect(configuration(send(chart, begin(chart).state, "recall").state)).toEqual(["reported"]);
  });

  // Sabotage: delivering to the child an invocation names after its state
  // has exited (the retired id still routed) turns this red.
  it("answers error.communication for a send to an invocation its own transition just cancelled", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <invoke id="courier" type="scxml">
          <content><scxml version="1.0" initial="van"><state id="van"/></scxml></content>
        </invoke>
        <transition event="dispatch" target="dispatched"><send target="#_courier" event="parcel.go"/></transition>
      </state>
      <state id="dispatched"><transition event="error.communication" target="unreachable"/></state>
      <state id="unreachable"/>
    </scxml>`);
    expect(configuration(send(chart, begin(chart).state, "dispatch").state)).toEqual([
      "unreachable",
    ]);
  });
});

describe("a child's completion", () => {
  // Sabotage: dropping the done event a stopped child returns turns this red.
  it("returns done.invoke.<id> with the child's donedata and retires the invocation", () => {
    const delivered = send(DEPOT, begin(DEPOT).state, "dispatch");
    expect(delivered.state.invocations).toEqual([]);
    expect(delivered.state.done?.configuration).toEqual(["closed"]);
  });

  // Sabotage: cancelling a child that already said it completed (the
  // completed check removed) turns this red: its done event is discarded.
  it("keeps a completed child's done event when the parent leaves on what the child sent first", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <invoke id="courier" type="scxml">
          <content>
            <scxml version="1.0" initial="doorstep">
              <final id="doorstep"><onexit><send target="#_parent" event="parcel.signed"/></onexit></final>
            </scxml>
          </content>
        </invoke>
        <transition event="parcel.signed" target="signed"/>
      </state>
      <state id="signed"><transition event="done.invoke" target="closed"/></state>
      <state id="closed"/>
    </scxml>`);
    const { state } = begin(chart);
    expect(configuration(state)).toEqual(["closed"]);
    expect(state.invocations).toEqual([]);
  });
});

describe("cancelling a child", () => {
  // Courier timers: a delayed report to the depot, and an exit report.
  const RECALL = chartOf(`<scxml ${SCXML} initial="depot">
    <state id="depot">
      <invoke id="courier" type="scxml">
        <content>
          <scxml version="1.0" initial="van">
            <state id="van">
              <onentry><send target="#_parent" event="parcel.lost" delay="1s"/></onentry>
              <onexit><send target="#_parent" event="courier.recalled"/></onexit>
            </state>
          </scxml>
        </content>
      </invoke>
      <transition event="recall" target="held"/>
    </state>
    <state id="held">
      <transition event="parcel.lost" target="lost"/>
      <transition event="courier.recalled" target="recalled"/>
    </state>
    <state id="lost"/>
    <state id="recalled"/>
  </scxml>`);

  // Sabotage: ignoring a cancel_invoke (the child kept running) turns this
  // red: the courier's delayed report reaches the depot.
  it("stops the child when the invoking state exits, and its timers with it", () => {
    const recalled = send(RECALL, begin(RECALL).state, "recall");
    expect(configuration(recalled.state)).toEqual(["held"]);
    expect(recalled.state.invocations).toEqual([]);
    expect(configuration(wait(RECALL, recalled.state, 2000).state)).toEqual(["held"]);
  });

  // Sabotage: taking a mailbox entry whatever its invocation (the liveness
  // check removed) turns this red: the depot hears the courier's exit report.
  it("discards what the cancelled child sends from its exit", () => {
    const recalled = send(RECALL, begin(RECALL).state, "recall");
    expect(configuration(recalled.state)).toEqual(["held"]);
    expect(recalled.state.mailbox).toEqual([]);
  });

  // Sabotage: dropping a cancelled child without running its exit turns this
  // red: its <onexit> report never reaches the depot's mailbox.
  it("runs the cancelled child's <onexit> handlers, whose report waits untaken in a halted parent", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <invoke id="courier" type="scxml">
          <content>
            <scxml version="1.0" initial="van">
              <state id="van"><onexit><send target="#_parent" event="courier.recalled"/></onexit></state>
            </scxml>
          </content>
        </invoke>
        <transition event="recall" target="held"/>
      </state>
      <state id="held">
        <onentry><raise event="tick"/></onentry>
        <transition event="tick"><raise event="tick"/></transition>
      </state>
    </scxml>`);
    const started = ok(start(chart, { sessionId: "depot-1", maxMacrostepRounds: 3 }));
    const recalled = send(chart, started.state, "recall");
    expect(recalled.state.halted).toBe("budget_exhausted");
    expect(recalled.state.invocations).toEqual([]);
    expect(recalled.state.mailbox.map((mail) => [mail.kind, mail.event?.name])).toEqual([
      ["event", "courier.recalled"],
    ]);
  });

  // Sabotage: taking a mailbox entry whatever its invocation turns this red:
  // the depot hears the load the courier reported before it was recalled.
  it("discards what a child sent before it was cancelled, if the parent had not taken it", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <onentry><send event="recall"/></onentry>
        <invoke id="courier" type="scxml">
          <content>
            <scxml version="1.0" initial="van">
              <state id="van"><onentry><send target="#_parent" event="parcel.loaded"/></onentry></state>
            </scxml>
          </content>
        </invoke>
        <transition event="recall" target="held"/>
      </state>
      <state id="held"><transition event="parcel.loaded" target="loaded"/></state>
      <state id="loaded"/>
    </scxml>`);
    const { state } = begin(chart);
    expect(configuration(state)).toEqual(["held"]);
  });
});

describe("autoforward", () => {
  // Sabotage: answering an autoforward effect with nothing turns this red.
  it("delivers each external event the parent takes to an autoforwarding child", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <invoke id="courier" type="scxml" autoforward="true">
          <content>
            <scxml version="1.0" initial="van">
              <state id="van">
                <transition event="parcel.scan">
                  <send target="#_parent" event="scan.seen"><param name="name" expr="_event.name"/></send>
                </transition>
              </state>
            </scxml>
          </content>
        </invoke>
        <transition event="scan.seen" target="seen"><log expr="_event.data.name"/></transition>
      </state>
      <state id="seen"/>
    </scxml>`);
    const out = send(chart, begin(chart).state, "parcel.scan");
    expect(configuration(out.state)).toEqual(["seen"]);
    expect(logged(out.effects)).toEqual(["parcel.scan"]);
  });
});

describe("an invocation the driver does not run", () => {
  // Sabotage: running every invoke type as SCXML (the type check removed)
  // turns this red: the courier starts and no error.execution is raised.
  it("raises error.execution for a type other than SCXML, and records nothing", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <invoke id="courier" type="http://example.org/courier">
          <content><scxml version="1.0" initial="van"><state id="van"/></scxml></content>
        </invoke>
        <transition event="error.execution" target="refused"/>
        <transition event="error.communication" target="unreachable"/>
      </state>
      <state id="refused"/>
      <state id="unreachable"/>
    </scxml>`);
    const { state } = begin(chart);
    expect(configuration(state)).toEqual(["refused"]);
    expect(state.invocations).toEqual([]);
  });

  // Sabotage: recording nothing for an invocation whose content cannot start
  // a child turns this red: the later send to it is refused as unreachable.
  it("raises error.communication when the content cannot start a child, and keeps the id live", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot" initial="starting">
        <invoke id="courier" type="scxml" src="courier.scxml"/>
        <state id="starting"><transition event="error.communication" target="waiting"/></state>
        <state id="waiting">
          <onentry><send target="#_courier" event="parcel.go"/></onentry>
          <transition event="error.communication" target="unreachable"/>
        </state>
        <state id="unreachable"/>
      </state>
    </scxml>`);
    const { state } = begin(chart);
    expect(configuration(state)).toEqual(["depot", "waiting"]);
    expect(state.invocations).toEqual([
      { invokeId: "courier", autoforward: false, completed: false, source: null, state: null },
    ]);
  });

  // Sabotage: raising error.execution, not error.communication, for content
  // that does not compile turns this red.
  it("raises error.communication for content in another namespace", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <invoke id="courier" type="scxml">
          <content><scxml xmlns="http://example.org/parcels" version="1.0"><state id="van"/></scxml></content>
        </invoke>
        <transition event="error.communication" target="unreachable"/>
      </state>
      <state id="unreachable"/>
    </scxml>`);
    expect(configuration(begin(chart).state)).toEqual(["unreachable"]);
  });
});

describe("the shared clock", () => {
  // Sabotage: firing only the host session's own timers turns this red: the
  // courier's report never comes.
  it("fires a child's timers on the parent's clock, in due order across the tree", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <onentry><send event="deadline" delay="2s"/></onentry>
        <invoke id="courier" type="scxml">
          <content>
            <scxml version="1.0" initial="van">
              <state id="van">
                <onentry><send event="arrive" delay="1s"/></onentry>
                <transition event="arrive"><send target="#_parent" event="parcel.at.hub"/></transition>
              </state>
            </scxml>
          </content>
        </invoke>
        <transition event="parcel.at.hub" target="hub"/>
        <transition event="deadline" target="late"/>
      </state>
      <state id="hub"><transition event="deadline" target="on_time"/></state>
      <state id="late"/>
      <state id="on_time"/>
    </scxml>`);
    const started = begin(chart);
    expect(started.state.invocations[0]?.state?.timers).toHaveLength(1);
    const early = wait(chart, started.state, 999);
    expect(configuration(early.state)).toEqual(["depot"]);
    expect(early.state.invocations[0]?.state?.nowMs).toBe(999);
    expect(configuration(wait(chart, early.state, 1).state)).toEqual(["hub"]);
    expect(configuration(wait(chart, started.state, 2500).state)).toEqual(["on_time"]);
  });
});

describe("a child inside the JSON state", () => {
  // Sabotage: encoding an invocation without its child's state turns this
  // red: the decoded depot has no courier to dispatch.
  it("goes through JSON with its child and steps as the original does", () => {
    const started = begin(DEPOT);
    const direct = send(DEPOT, started.state, "dispatch");
    const stored = send(DEPOT, viaJson(started.state), "dispatch");
    expect(logged(stored.effects)).toEqual(["courier", 3, "courier", "#_scxml_depot-1"]);
    expect(stored.state).toEqual(direct.state);
    expect(logged(stored.effects)).toEqual(logged(direct.effects));
  });

  // Sabotage: writing the mailbox as empty turns this red: the depot that
  // spent its round budget would lose what its courier sent.
  it("keeps what a child sent a halted parent, through JSON, in the order it was sent", () => {
    const chart = chartOf(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <onentry><raise event="tick"/></onentry>
        <transition event="tick"><raise event="tick"/></transition>
        <invoke id="courier" type="scxml">
          <content>
            <scxml version="1.0" initial="doorstep">
              <final id="doorstep"><onexit><send target="#_parent" event="parcel.signed"/></onexit></final>
            </scxml>
          </content>
        </invoke>
      </state>
    </scxml>`);
    const { state } = ok(start(chart, { sessionId: "depot-1", maxMacrostepRounds: 3 }));
    expect(state.halted).toBe("budget_exhausted");
    expect(state.mailbox.map((mail) => [mail.kind, mail.invokeId, mail.event?.name])).toEqual([
      ["completed", "courier", undefined],
      ["event", "courier", "parcel.signed"],
      ["done", "courier", "done.invoke.courier"],
    ]);
    expect(state.mailbox[1]?.event?.invokeid).toBe("courier");
    expect(ok(advance(chart, viaJson(state), 0)).state).toEqual(state);
  });

  // Sabotage: decoding a child's fields without their path into the whole
  // state turns this red.
  it("names a failing field of a child by its path into the whole state", () => {
    const { state } = begin(DEPOT);
    const [courier] = state.invocations;
    if (courier?.state === undefined || courier.state === null) throw new Error("no courier");
    const broken = {
      ...state,
      invocations: [
        {
          ...courier,
          state: { ...courier.state, datamodel: { ...courier.state.datamodel, x: "{" } },
        },
      ],
    };
    expect(step(DEPOT, broken, { name: "dispatch" })).toEqual({
      ok: false,
      reason: "malformed_state",
      detail: { kind: "undecodable_value", field: "invocations[0].state.datamodel.x" },
    });
    const shapeless = {
      ...state,
      invocations: [{ ...courier, state: { ...courier.state, nowMs: -1 } }],
    };
    expect(step(DEPOT, shapeless, { name: "dispatch" })).toEqual({
      ok: false,
      reason: "malformed_state",
      detail: { kind: "bad_shape", field: "invocations[0].state.nowMs" },
    });
  });

  // Sabotage: accepting a child whose recorded source is not the chart its
  // state was made by turns this red.
  it("refuses a child whose source is not the chart its state was made by", () => {
    const { state } = begin(DEPOT);
    const [courier] = state.invocations;
    if (courier === undefined) throw new Error("no courier");
    const edited = { ...state, invocations: [{ ...courier, source: `${courier.source} ` }] };
    expect(step(DEPOT, edited, { name: "dispatch" })).toEqual({
      ok: false,
      reason: "malformed_state",
      detail: { kind: "bad_shape", field: "invocations[0].source" },
    });
  });

  // Sabotage: decoding a child without comparing its invokedAs to its
  // record's invokeId turns this red: both edited states decode.
  it("refuses a child whose invokedAs is not its invocation's id", () => {
    const { state } = begin(DEPOT);
    const [courier] = state.invocations;
    if (courier?.state === undefined || courier.state === null) throw new Error("no courier");
    for (const invokedAs of ["van", null]) {
      const edited = {
        ...state,
        invocations: [{ ...courier, state: { ...courier.state, invokedAs } }],
      };
      expect(step(DEPOT, edited, { name: "dispatch" })).toEqual({
        ok: false,
        reason: "malformed_state",
        detail: { kind: "bad_shape", field: "invocations[0].state.invokedAs" },
      });
    }
  });

  // Sabotage: decoding the host's session without checking that its
  // invokedAs is null turns this red: the edited state decodes.
  it("refuses a host's state that says it runs as an invocation", () => {
    const { state } = begin(DEPOT);
    const edited = { ...state, invokedAs: "courier" };
    expect(step(DEPOT, edited, { name: "dispatch" })).toEqual({
      ok: false,
      reason: "malformed_state",
      detail: { kind: "bad_shape", field: "invokedAs" },
    });
  });

  // Sabotage: setting each decoded invocation by its id without checking
  // that the id is new turns this red: the second record overwrites the
  // first and the state decodes.
  it("refuses two invocation records with one id", () => {
    const { state } = begin(DEPOT);
    const [courier] = state.invocations;
    if (courier === undefined) throw new Error("no courier");
    const edited = { ...state, invocations: [courier, courier] };
    expect(step(DEPOT, edited, { name: "dispatch" })).toEqual({
      ok: false,
      reason: "malformed_state",
      detail: { kind: "bad_shape", field: "invocations[1].invokeId" },
    });
  });

  // A library loan that invokes a renewal, whose chart invokes a hold check:
  // the three levels a refusal below the first child is named through.
  const RENEWAL = chartOf(`<scxml ${SCXML} initial="loan">
    <state id="loan">
      <invoke id="renewal" type="scxml">
        <content>
          <scxml version="1.0" initial="review">
            <state id="review">
              <invoke id="hold-check" type="scxml">
                <content>
                  <scxml version="1.0" initial="checking"><state id="checking"/></scxml>
                </content>
              </invoke>
            </state>
          </scxml>
        </content>
      </invoke>
      <transition event="return" target="returned"/>
    </state>
    <final id="returned"/>
  </scxml>`);

  // Sabotage: naming a record's path without the prefix of the state that
  // holds it (`invocations[${i}]` for `${at}invocations[${i}]` in
  // decodeState) turns this red: the field names the grandchild as a direct
  // child.
  it("refuses a grandchild whose invokedAs is not its invocation's id", () => {
    const { state } = ok(start(RENEWAL, { sessionId: "desk-1" }));
    const [renewal] = state.invocations;
    if (renewal?.state === undefined || renewal.state === null) throw new Error("no renewal");
    const [holdCheck] = renewal.state.invocations;
    if (holdCheck?.state === undefined || holdCheck.state === null) {
      throw new Error("no hold check");
    }
    for (const invokedAs of ["checking", null]) {
      const edited = {
        ...state,
        invocations: [
          {
            ...renewal,
            state: {
              ...renewal.state,
              invocations: [{ ...holdCheck, state: { ...holdCheck.state, invokedAs } }],
            },
          },
        ],
      };
      expect(step(RENEWAL, edited, { name: "return" })).toEqual({
        ok: false,
        reason: "malformed_state",
        detail: {
          kind: "bad_shape",
          field: "invocations[0].state.invocations[0].state.invokedAs",
        },
      });
    }
  });

  // Sabotage: naming a duplicate record's field without its state's prefix
  // (`invocations[${i}].invokeId` in decodeState) turns this red.
  it("refuses two grandchild invocation records with one id", () => {
    const { state } = ok(start(RENEWAL, { sessionId: "desk-1" }));
    const [renewal] = state.invocations;
    if (renewal?.state === undefined || renewal.state === null) throw new Error("no renewal");
    const [holdCheck] = renewal.state.invocations;
    if (holdCheck === undefined) throw new Error("no hold check");
    const edited = {
      ...state,
      invocations: [
        { ...renewal, state: { ...renewal.state, invocations: [holdCheck, holdCheck] } },
      ],
    };
    expect(step(RENEWAL, edited, { name: "return" })).toEqual({
      ok: false,
      reason: "malformed_state",
      detail: { kind: "bad_shape", field: "invocations[0].state.invocations[1].invokeId" },
    });
  });

  // Sabotage: writing the invocations into the exported position turns this
  // red.
  it("leaves the child out of a position, so an import starts with none", () => {
    const { state } = begin(DEPOT);
    const exported = exportPosition(state);
    if (!exported.ok) throw new Error(exported.reason);
    expect(exported.position).not.toHaveProperty("invocations");
    expect(exported.position.activeInvocations).toEqual([
      { state: "depot", invokeIndex: 0, invokeId: "courier" },
    ]);
    const imported = importPosition(DEPOT, JSON.parse(JSON.stringify(exported.position)));
    if (!imported.ok) throw new Error(imported.reason);
    expect(imported.state.invocations).toEqual([]);
    expect(imported.state.mailbox).toEqual([]);
  });
});
