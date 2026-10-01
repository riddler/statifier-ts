// The interpreter loop: starting a chart, one external event, the macrostep
// and its round budget, the counters, a top-level final and its donedata,
// exitInterpreter, the invoke pass, and the datamodel's binding when the
// chart starts and on a state's first entry.
//
// The charts written here are the library loan (a copy at the desk, on loan,
// returned, its holds) and patron registration. Where a case ports one of the
// reference's own tests, the test file and the test name at statifier-ex
// v2.9.0 are quoted above it, with the answer the reference asserts.

import { Undefined } from "@riddler/predicator";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compiler.js";
import type { Trace } from "../../src/core/effects.js";
import {
  type BudgetExhausted,
  type Done,
  exitInterpreter,
  handleEvent,
  type InterpreterEffect,
  initialize,
  MAX_MACROSTEP_ROUNDS,
  type MachineState,
  macrostep,
  mainEventLoop,
  microstep,
  runRound,
  type Stepped,
} from "../../src/core/interpreter.js";
import type { Event } from "../../src/datamodel.js";
import { isAtomic, type Machine } from "../../src/machine.js";

const SCXML = 'xmlns="http://www.w3.org/2005/07/scxml" version="1.0"';

function machineOf(source: string): Machine {
  const result = compile(source);
  if (!result.ok) throw new Error(`fixture does not compile: ${JSON.stringify(result.errors)}`);
  return result.chart.machine;
}

function start(source: string, rounds?: number | "infinity"): Stepped {
  const machine = machineOf(source);
  if (rounds === undefined) return initialize(machine, { sessionId: "desk" });
  return initialize(machine, { sessionId: "desk", maxMacrostepRounds: rounds });
}

function external(name: string): Event {
  return { name, type: "external", data: Undefined };
}

function send(stepped: Stepped, name: string): Stepped {
  const outcome = handleEvent(stepped.state, external(name));
  if (!outcome.ok) throw new Error(`refused: ${outcome.reason}`);
  return outcome;
}

function leaves(state: MachineState): string[] {
  const { machine, configuration } = state;
  return [...configuration]
    .filter((index) => isAtomic(machine, index))
    .map((index) => machine.states[index]?.id ?? `#${index}`)
    .sort();
}

function idx(machine: Machine, id: string): number {
  const index = machine.idToIndex.get(id);
  if (index === undefined) throw new Error(`no state ${id}`);
  return index;
}

function budgetExhausted(effects: readonly InterpreterEffect[]): BudgetExhausted[] {
  return effects.filter((e): e is BudgetExhausted => e.kind === "budget_exhausted");
}

function doneOf(effects: readonly InterpreterEffect[]): Done[] {
  return effects.filter((e): e is Done => e.kind === "done");
}

function logs(effects: readonly InterpreterEffect[]): unknown[] {
  return effects.flatMap((e) => (e.kind === "log" ? [e.value] : []));
}

// ---------------------------------------------------------------------------
// Starting a chart and taking an event
// ---------------------------------------------------------------------------

const LOAN = `<scxml ${SCXML} initial="desk">
  <datamodel><data id="loans" expr="0"/></datamodel>
  <state id="desk">
    <transition event="copy.checked_out" target="loaned">
      <assign location="loans" expr="loans + 1"/>
    </transition>
  </state>
  <state id="loaned">
    <onentry><raise event="loan.opened"/></onentry>
    <transition event="loan.opened" target="on_shelf_hold"/>
  </state>
  <state id="on_shelf_hold">
    <transition event="copy.returned" target="desk"/>
  </state>
</scxml>`;

describe("initialize", () => {
  // statifier-ex v2.9.0, test/statifier/interpreter/interpreter_acceptance_test.exs:
  // the initialization macrostep is macrostep 1 and the initial entry its microstep 1.
  // Sabotage: dropping the microstep advance before the initial entry turns this red.
  it("enters the initial states as microstep 1 of macrostep 1 and runs to a stable configuration", () => {
    const { state, effects } = start(LOAN);
    expect(leaves(state)).toEqual(["desk"]);
    expect([state.macrostep, state.microstep, state.round]).toEqual([1, 1, 1]);
    expect(state.running).toBe(true);
    expect(state.status).toBe("running");
    expect(state.datamodel.get("loans")).toBe(0);
    expect(state.datamodel.get("_sessionid")).toBe("desk");
    expect(state.statesToInvoke.size).toBe(0);
    expect(effects.map((e) => e.kind)).toEqual(["datamodel_init", "datamodel_change"]);
  });

  // Sabotage: letting the host's value lose to the root <data> turns this red.
  it("binds no root <data> whose id the host supplied", () => {
    const machine = machineOf(LOAN);
    const { state } = initialize(machine, {
      sessionId: "desk",
      datamodel: new Map([["loans", 7]]),
    });
    expect(state.datamodel.get("loans")).toBe(7);
  });

  // Sabotage: dropping the registered send types at start turns this red.
  it("hands the registered send types to the send state", () => {
    const machine = machineOf(LOAN);
    const sendTypes = new Set(["x-parcel"]);
    const { state } = initialize(machine, { sessionId: "desk", sendTypes });
    expect(state.sends.sendTypes).toBe(sendTypes);
  });
});

describe("handleEvent", () => {
  // Sabotage: not resetting the microstep counter at a new macrostep turns this red.
  it("begins a macrostep, takes the event, and runs the internal events it raised", () => {
    const next = send(start(LOAN), "copy.checked_out");
    expect(leaves(next.state)).toEqual(["on_shelf_hold"]);
    expect(next.state.datamodel.get("loans")).toBe(1);
    // Two microsteps: the external event's, then loan.opened's.
    expect([next.state.macrostep, next.state.microstep]).toEqual([2, 2]);
    expect(next.state.internalQueue).toEqual([]);
    const event = next.state.datamodel.get("_event") as { name: string };
    expect(event.name).toBe("loan.opened");
  });

  // Sabotage: advancing the microstep counter on a selection that took nothing turns this red.
  it("advances no microstep for an event nothing takes", () => {
    const next = send(start(LOAN), "copy.returned");
    expect(leaves(next.state)).toEqual(["desk"]);
    expect([next.state.macrostep, next.state.microstep, next.state.round]).toEqual([2, 0, 1]);
  });

  // Sabotage: dropping the running guard turns this red.
  it("refuses an event once the chart has stopped", () => {
    const stopped = start(`<scxml ${SCXML}><final id="closed"/></scxml>`);
    expect(handleEvent(stopped.state, external("copy.returned"))).toEqual({
      ok: false,
      reason: "not_running",
    });
  });
});

describe("microstep and runRound", () => {
  // Sabotage: running the transition content after the entry turns this red.
  it("exits, runs the transition's content, then enters", () => {
    const machine = machineOf(`<scxml ${SCXML} initial="desk">
      <datamodel><data id="trail" expr="''"/></datamodel>
      <state id="desk">
        <onexit><assign location="trail" expr="trail + 'x'"/></onexit>
        <transition event="copy.checked_out" target="loaned">
          <assign location="trail" expr="trail + 'c'"/>
        </transition>
      </state>
      <state id="loaned"><onentry><assign location="trail" expr="trail + 'e'"/></onentry></state>
    </scxml>`);
    const { state } = initialize(machine, { sessionId: "desk" });
    const t = machine.transitions.find((tr) => tr.source === idx(machine, "desk"));
    if (t === undefined) throw new Error("no transition");
    const stepped = microstep(state, [t]);
    expect(stepped.state.datamodel.get("trail")).toBe("xce");
    expect(leaves(stepped.state)).toEqual(["loaned"]);
  });

  // Sabotage: skipping the round advance on a stopped chart turns this red.
  it("counts a round and ends the macrostep once the chart is not running", () => {
    const { state } = start(LOAN);
    const round = runRound({ ...state, running: false });
    expect(round.quiescent).toBe(true);
    expect(round.state.round).toBe(state.round + 1);
  });

  // Sabotage: consulting the internal queue before the eventless transitions turns this red.
  it("takes an eventless transition before an internal event", () => {
    const machine = machineOf(`<scxml ${SCXML} initial="desk">
      <state id="desk"><transition target="loaned"/><transition event="loan.opened" target="lost"/></state>
      <state id="loaned"/>
      <state id="lost"/>
    </scxml>`);
    const { state } = initialize(machine, { sessionId: "desk" });
    const staged: MachineState = {
      ...state,
      configuration: new Set([0, idx(machine, "desk")]),
      internalQueue: [{ name: "loan.opened", type: "internal", data: Undefined }],
    };
    const round = runRound(staged);
    expect(round.quiescent).toBe(false);
    expect(leaves(round.state)).toEqual(["loaned"]);
    expect(round.state.internalQueue).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The round budget
// ---------------------------------------------------------------------------

// The reference's livelock fixture, recast at the desk: a condition that
// fails every round raises error.execution, which the next round takes and
// which enables nothing, so no round is ever the last.
const LIVELOCK = `<scxml ${SCXML} initial="desk">
  <state id="desk"><transition cond="patronCleared" target="loaned"/></state>
  <state id="loaned"/>
</scxml>`;

describe("the round budget", () => {
  // The engine's number, statifier-ex v2.9.0 lib/statifier/machine_state.ex,
  // the struct's default: `max_macrostep_rounds: 10_000`.
  // Sabotage: changing MAX_MACROSTEP_ROUNDS to 9_999 turns this red.
  it("is the engine's 10000 when the host sets none, and a livelock spends it and stops", () => {
    expect(MAX_MACROSTEP_ROUNDS).toBe(10_000);
    const { state, effects } = start(LIVELOCK);
    const [exhausted, ...more] = budgetExhausted(effects);
    expect(more).toEqual([]);
    expect(exhausted?.budget).toBe(10_000);
    expect(exhausted?.round).toBe(10_000);
    expect(state.round).toBe(10_000);
    expect(effects[effects.length - 1]).toBe(exhausted);
  });

  // statifier-ex v2.9.0, test/statifier/interpreter/interpreter_acceptance_test.exs,
  // "it terminates with the effect instead of hanging": one BudgetExhausted
  // with budget 20, still running, status running, still in the first state.
  // Sabotage: removing the zero-rounds-left stop in the fold hangs this test (the fold never returns).
  it("terminates with the effect instead of hanging", () => {
    const { state, effects } = start(LIVELOCK, 20);
    const machine = state.machine;
    expect(budgetExhausted(effects).map((e) => e.budget)).toEqual([20]);
    expect(state.running).toBe(true);
    expect(state.status).toBe("running");
    expect([...state.configuration].sort()).toEqual([0, idx(machine, "desk")]);
    expect(doneOf(effects)).toEqual([]);
  });

  // Same file, "the bound counts rounds, not microsteps": microstep 1.
  // Sabotage: charging the budget only for rounds that take a transition hangs this test (the fold never returns).
  it("counts rounds, not microsteps", () => {
    const [exhausted] = budgetExhausted(start(LIVELOCK, 20).effects);
    expect(exhausted?.microstep).toBe(1);
    expect(exhausted?.round).toBe(20);
    expect(exhausted?.macrostep).toBe(1);
  });

  // Same file, "the pending internal events field reads the machine_state's own queue".
  // Sabotage: answering an empty list for the pending events turns this red.
  it("carries the queue as it stands", () => {
    const { state, effects } = start(
      `<scxml ${SCXML} initial="desk">
        <state id="desk">
          <onentry><raise event="hold.placed"/></onentry>
          <transition event="hold.placed" target="desk"/>
        </state>
      </scxml>`,
      5,
    );
    const [exhausted] = budgetExhausted(effects);
    expect(exhausted?.pendingInternalEvents).toEqual(state.internalQueue);
    expect(exhausted?.pendingInternalEvents.map((e) => e.name)).toEqual(["hold.placed"]);
    expect(exhausted?.configuration).toEqual([0, idx(state.machine, "desk")]);
  });

  // Same file, "a later call gets a fresh budget and exhausts again" and
  // "the round resets on the next macrostep and reaches 20 again".
  // Sabotage: carrying the round counter across macrosteps turns this red.
  it("starts each macrostep with a fresh budget and a fresh round count", () => {
    const next = send(start(LIVELOCK, 20), "copy.returned");
    expect(budgetExhausted(next.effects).map((e) => [e.budget, e.round, e.macrostep])).toEqual([
      [20, 20, 2],
    ]);
  });

  // Sabotage: treating the infinite budget as already spent turns this red.
  it("spends nothing under an infinite budget", () => {
    const { state, effects } = start(LOAN, "infinity");
    expect(leaves(state)).toEqual(["desk"]);
    expect(budgetExhausted(effects)).toEqual([]);
  });

  // Sabotage: answering nothing from the public fold on a spent budget turns this red.
  it("answers the effect from macrostep alone", () => {
    const { state } = start(LIVELOCK, 3);
    const folded = macrostep({ ...state, round: 0 });
    expect(budgetExhausted(folded.effects).map((e) => e.round)).toEqual([3]);
  });

  // Sabotage: skipping exitInterpreter when the last round stopped the chart turns this red.
  it("still exits a chart the last round stopped", () => {
    const { effects, state } = start(
      `<scxml ${SCXML} initial="desk">
        <state id="desk"><transition target="closed"/></state>
        <final id="closed"/>
      </scxml>`,
      1,
    );
    expect(effects.map((e) => e.kind)).toEqual(["datamodel_init", "budget_exhausted", "done"]);
    expect(state.status).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// The top-level final, donedata and exitInterpreter
// ---------------------------------------------------------------------------

describe("a top-level final", () => {
  // Sabotage: leaving the collected donedata off the done effect turns this red.
  it("stops the chart and yields done with its donedata", () => {
    const { state, effects } = start(`<scxml ${SCXML} initial="desk">
      <datamodel><data id="due" expr="14"/></datamodel>
      <state id="desk">
        <transition event="loan.closed" target="closed"/>
      </state>
      <final id="closed">
        <donedata><param name="days" expr="due"/><param name="branch" expr="'main'"/></donedata>
      </final>
    </scxml>`);
    const next = send({ state, effects }, "loan.closed");
    const [done, ...more] = doneOf(next.effects);
    expect(more).toEqual([]);
    expect(done?.donedata).toEqual({ days: 14, branch: "main" });
    expect(done?.donedataError).toBeNull();
    expect(done?.configuration).toEqual([0, idx(state.machine, "closed")]);
    expect([done?.macrostep, done?.microstep]).toEqual([2, 1]);
    expect(next.effects[next.effects.length - 1]).toBe(done);
    expect(next.state.running).toBe(false);
    expect(next.state.status).toBe("done");
    expect(next.state.configuration.size).toBe(0);
  });

  // statifier-ex v2.9.0 lib/statifier/interpreter.ex, exit_interpreter/1,
  // item 5: a failed donedata is no data, its error.execution is raised and
  // discarded with the queue, and its data rides on the done effect.
  // Sabotage: keeping the internal queue at exit turns this red.
  it("yields done without data when its donedata fails, and raises error.execution", () => {
    const { state, effects } = start(`<scxml ${SCXML} initial="closed">
      <final id="closed"><donedata><content expr="missingFine"/></donedata></final>
    </scxml>`);
    const [done] = doneOf(effects);
    expect(done?.donedata).toBe(Undefined);
    expect(done?.donedataError).toMatchObject({ kind: "evaluator_error", source: "missingFine" });
    expect(state.internalQueue).toEqual([]);
  });

  // Sabotage: dropping the error.execution a nested final's failed donedata raises turns this red.
  it("raises error.execution for a nested final's failed donedata, which the chart takes", () => {
    const { state } = start(`<scxml ${SCXML} initial="loan">
      <state id="loan" initial="closed">
        <final id="closed"><donedata><content expr="missingFine"/></donedata></final>
        <transition event="error.execution" target="flagged"/>
      </state>
      <state id="flagged"/>
    </scxml>`);
    expect(leaves(state)).toEqual(["flagged"]);
  });

  // Sabotage: exiting in document order rather than exit order turns this red.
  it("runs every active state's onexit in exit order and records no history", () => {
    const machine = machineOf(`<scxml ${SCXML} initial="loan">
      <state id="loan" initial="desk">
        <history id="loan_history" type="deep"><transition target="desk"/></history>
        <onexit><log label="exit" expr="'loan'"/></onexit>
        <state id="desk"><onexit><log label="exit" expr="'desk'"/></onexit></state>
      </state>
    </scxml>`);
    const { state } = initialize(machine, { sessionId: "desk" });
    const exited = exitInterpreter({ ...state, running: false });
    expect(logs(exited.effects)).toEqual(["desk", "loan"]);
    expect(exited.state.historyValues.size).toBe(0);
    const [done] = doneOf(exited.effects);
    expect(done?.donedata).toBe(Undefined);
    expect(done?.donedataError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mainEventLoop and the invoke pass
// ---------------------------------------------------------------------------

describe("mainEventLoop", () => {
  // Sabotage: leaving the states to invoke in place after the pass turns this red.
  it("clears the states to invoke once the macrostep is stable", () => {
    const { state } = start(LOAN);
    const staged = { ...state, statesToInvoke: new Set([idx(state.machine, "desk")]) };
    expect(mainEventLoop(staged).state.statesToInvoke.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The datamodel when the chart starts and on first entry
// ---------------------------------------------------------------------------

const REGISTRATION = (
  binding: "early" | "late",
) => `<scxml ${SCXML} binding="${binding}" initial="applying">
  <datamodel><data id="applications" expr="1"/></datamodel>
  <state id="applying">
    <transition event="form.submitted" target="verifying"/>
  </state>
  <state id="verifying">
    <datamodel><data id="checks" expr="applications + 1"/></datamodel>
    <onentry><log label="checks" expr="checks"/><assign location="checks" expr="checks + 10"/></onentry>
    <transition event="patron.resubmits" target="applying"/>
  </state>
</scxml>`;

describe("late binding", () => {
  // statifier-ex v2.9.0 lib/statifier/interpreter/datamodel.ex, enter_state/2:
  // a state's own <data> binds on its first entry under late binding, before
  // its onentry, and never again.
  // Sabotage: binding state data on every entry, not only the first, turns this red.
  it("binds a state's own data on its first entry before onentry, and never rebinds it", () => {
    let chart = start(REGISTRATION("late"));
    expect(chart.state.datamodel.get("applications")).toBe(1);
    expect(chart.state.datamodel.get("checks")).toBe(Undefined);
    chart = send(chart, "form.submitted");
    expect(logs(chart.effects)).toEqual([2]);
    expect(chart.state.datamodel.get("checks")).toBe(12);
    chart = send(chart, "patron.resubmits");
    chart = send(chart, "form.submitted");
    expect(logs(chart.effects)).toEqual([12]);
    expect(chart.state.datamodel.get("checks")).toBe(22);
  });

  // Sabotage: binding every <data> when the chart starts under late binding turns this red.
  it("binds only the root's own data when the chart starts", () => {
    const { state } = start(REGISTRATION("late"));
    expect(state.enteredStates.has(idx(state.machine, "applying"))).toBe(true);
    expect(state.enteredStates.has(idx(state.machine, "verifying"))).toBe(false);
    expect(state.datamodel.has("checks")).toBe(true);
    expect(state.datamodel.get("checks")).toBe(Undefined);
    // Nothing tried to bind the state's own data, so nothing failed.
    expect(state.datamodel.get("_event")).toBe(Undefined);
  });

  // Sabotage: rebinding the root's data on the root's entry turns this red.
  it("never rebinds the root's data over a host value", () => {
    const machine = machineOf(REGISTRATION("late"));
    const { state } = initialize(machine, {
      sessionId: "desk",
      datamodel: new Map([["applications", 40]]),
    });
    expect(state.datamodel.get("applications")).toBe(40);
  });
});

describe("early binding", () => {
  // Sabotage: deferring state data under early binding turns this red.
  it("binds every data when the chart starts, each against the seeded datamodel", () => {
    let chart = start(REGISTRATION("early"));
    // One context, built before any binds: `applications` reads undefined
    // there, so `checks` fails to bind, raising error.execution from its <data>.
    expect(chart.state.datamodel.get("checks")).toBe(Undefined);
    expect(chart.state.datamodel.get("_event")).toMatchObject({
      name: "error.execution",
      data: { source: "applications + 1" },
    });
    chart = send(chart, "form.submitted");
    // No second binding on the state's entry.
    expect(logs(chart.effects)).toEqual([Undefined]);
  });
});

describe("a <data> that fails to bind", () => {
  // Sabotage: skipping the raise for a failed binding turns this red.
  it("raises error.execution from the data and leaves the id undefined", () => {
    const { state } = start(`<scxml ${SCXML} initial="desk">
      <datamodel><data id="fine" expr="unknownRate * 2"/><data id="branch" src="branches.json"/></datamodel>
      <state id="desk"><transition event="error.execution" target="flagged"/></state>
      <state id="flagged"><transition event="error.execution" target="flagged_twice"/></state>
      <state id="flagged_twice"/>
    </scxml>`);
    expect(leaves(state)).toEqual(["flagged_twice"]);
    expect(state.datamodel.get("fine")).toBe(Undefined);
    expect(state.datamodel.get("branch")).toBe(Undefined);
    const event = state.datamodel.get("_event") as { data: { kind: string; src: string } };
    expect(event.data).toEqual({ kind: "src", src: "branches.json" });
  });
});

describe("the <script> children of <scxml>", () => {
  // The compiler holds a script whose body did not compile as one, so
  // starting the chart raises error.execution for it, as the reference raises.
  // Sabotage: skipping the global scripts turns this red.
  it("raise error.execution when they did not compile", () => {
    const { state } = start(`<scxml ${SCXML} initial="desk">
      <script>fines =</script>
      <state id="desk"><transition event="error.execution" target="flagged"/></state>
      <state id="flagged"/>
    </scxml>`);
    expect(leaves(state)).toEqual(["flagged"]);
    const event = state.datamodel.get("_event") as { data: { kind: string } };
    expect(event.data.kind).toBe("compile_error");
  });

  // Sabotage: compiling every script body to an Invalid again turns this red:
  // no fine is written and the chart takes error.execution to `flagged`.
  it("run in document order, each against the datamodel the one before it left", () => {
    const { state } = start(`<scxml ${SCXML} initial="desk">
      <script>fines = 2</script>
      <script>fines = fines + 1</script>
      <state id="desk"><transition event="error.execution" target="flagged"/></state>
      <state id="flagged"/>
    </scxml>`);
    expect(leaves(state)).toEqual(["desk"]);
    expect(state.datamodel.get("fines")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// The datamodel effects and the trace effects
// ---------------------------------------------------------------------------

/** Each effect's kind, a trace named by which trace it is. */
function tags(effects: readonly InterpreterEffect[]): string[] {
  return effects.map((e) => (e.kind === "trace" ? `trace:${e.trace}` : e.kind));
}

function traceOf<K extends Trace["trace"]>(
  effects: readonly InterpreterEffect[],
  trace: K,
): Extract<Trace, { trace: K }>[] {
  return effects.filter(
    (e): e is Extract<Trace, { trace: K }> => e.kind === "trace" && e.trace === trace,
  );
}

function startTraced(source: string, rounds?: number): Stepped {
  const machine = machineOf(source);
  return initialize(machine, {
    sessionId: "desk",
    trace: true,
    ...(rounds === undefined ? {} : { maxMacrostepRounds: rounds }),
  });
}

describe("the datamodel effects when a chart starts", () => {
  // statifier-ex v2.9.0, lib/statifier/interpreter/datamodel.ex,
  // `initialize/1`: the datamodel_init baseline first, taken after every id
  // exists and before any binds, then one datamodel_change per binding.
  // Sabotage: taking the datamodel_init after the binding in
  // initializeDatamodel turns this red (loans reads 0, not undefined).
  it("answers the baseline first, then each binding in ascending order", () => {
    const { effects } = start(`<scxml ${SCXML} initial="desk" name="branch">
      <datamodel><data id="loans" expr="0"/><data id="holds" expr="[]"/></datamodel>
      <state id="desk"/>
    </scxml>`);
    const [init, ...changes] = effects;
    expect(init).toMatchObject({ kind: "datamodel_init", macrostep: 1, microstep: 1, round: 0 });
    if (init?.kind !== "datamodel_init") throw new Error("expected datamodel_init");
    expect(init.datamodel.loans).toBe(Undefined);
    expect(init.datamodel.holds).toBe(Undefined);
    expect(init.datamodel._sessionid).toBe("desk");
    expect(init.datamodel._name).toBe("branch");
    expect(changes).toEqual([
      {
        kind: "datamodel_change",
        locationPath: ["loans"],
        locationSource: "loans",
        newValue: 0,
        priorValue: Undefined,
        dIndex: 0,
        cIndex: null,
        owner: null,
        macrostep: 1,
        microstep: 1,
        round: 0,
      },
      {
        kind: "datamodel_change",
        locationPath: ["holds"],
        locationSource: "holds",
        newValue: [],
        priorValue: Undefined,
        dIndex: 1,
        cIndex: null,
        owner: null,
        macrostep: 1,
        microstep: 1,
        round: 0,
      },
    ]);
  });

  // statifier-ex v2.9.0, datamodel.ex, `bind/6`: no change "for a value
  // nothing here wrote".
  // Sabotage: answering a change for a root <data> the host's value stands
  // in for turns this red.
  it("answers no change for a root <data> the host supplied, and the baseline carries the host's value", () => {
    const machine = machineOf(LOAN);
    const { effects } = initialize(machine, {
      sessionId: "desk",
      datamodel: new Map([["loans", 7]]),
    });
    expect(tags(effects)).toEqual(["datamodel_init"]);
    expect(effects[0]).toMatchObject({ datamodel: { loans: 7 } });
  });

  // Sabotage: answering a change from either failure branch of bindValue -
  // an expression that did not compile, or one whose evaluation fails -
  // turns this red.
  it("answers no change for a binding that fails", () => {
    const { effects } = start(`<scxml ${SCXML} initial="desk">
      <datamodel><data id="fines" expr="nope +"/><data id="holds" expr="branch_holds"/></datamodel>
      <state id="desk"/>
    </scxml>`);
    expect(tags(effects)).toEqual(["datamodel_init"]);
  });

  // statifier-ex v2.9.0, lib/statifier/interpreter/exit_entry.ex, `arrive`:
  // a first entry's binding effects come before the state's onentry.
  // Sabotage: putting the binding's effects after the onentry's in arrive
  // turns this red.
  it("answers a late-bound state's binding on its first entry, before its onentry, and never again", () => {
    const source = `<scxml ${SCXML} initial="desk" binding="late">
      <state id="desk"><transition event="copy.checked_out" target="loaned"/></state>
      <state id="loaned">
        <datamodel><data id="due" expr="14"/></datamodel>
        <onentry><log label="due" expr="due"/></onentry>
        <transition event="copy.returned" target="desk"/>
      </state>
    </scxml>`;
    const first = send(start(source), "copy.checked_out");
    expect(tags(first.effects)).toEqual(["datamodel_change", "log"]);
    expect(first.effects[0]).toMatchObject({ locationPath: ["due"], newValue: 14, dIndex: 0 });
    const again = send(send(first, "copy.returned"), "copy.checked_out");
    expect(tags(again.effects)).toEqual(["log"]);
  });
});

describe("the trace effects", () => {
  const TRACED_LOAN = `<scxml ${SCXML} initial="desk">
    <datamodel><data id="loans" expr="0"/></datamodel>
    <state id="desk">
      <onexit><log label="leaving"/></onexit>
      <transition event="copy.checked_out" target="loaned">
        <assign location="loans" expr="loans + 1"/>
      </transition>
    </state>
    <state id="loaned">
      <onentry><raise event="loan.opened"/></onentry>
      <transition event="loan.opened" target="on_hold"/>
    </state>
    <state id="on_hold"><transition event="copy.returned" target="returned"/></state>
    <final id="returned"/>
  </scxml>`;

  // statifier-ex v2.9.0, lib/statifier/interpreter.ex, `initialize/2` and
  // `main_event_loop/3`: the datamodel effects, the entry set, then the
  // fold's terminal empty selection, the invoke pass and the stable
  // macrostep.
  // Sabotage: answering macrostep_stable ahead of the invoke pass in
  // mainEventLoop turns this red.
  it("answers the reference's order when a chart starts", () => {
    expect(tags(startTraced(TRACED_LOAN).effects)).toEqual([
      "datamodel_init",
      "datamodel_change",
      "trace:entry_set",
      "trace:transitions_selected",
      "trace:invoke_pass",
      "trace:macrostep_stable",
    ]);
  });

  // statifier-ex v2.9.0, interpreter.ex, `handle_event/2`, `internal_round/1`
  // and `run_selected/3`.
  // Sabotage: dropping the empty eventless selection's trace in internalRound
  // turns this red.
  it("answers the reference's order for an external event and the internal event it raises", () => {
    const next = send(startTraced(TRACED_LOAN), "copy.checked_out");
    expect(tags(next.effects)).toEqual([
      "trace:event_dequeued",
      "trace:finalize_autoforward",
      "trace:transitions_selected",
      "trace:exit_set",
      "log",
      "trace:content_executed",
      "datamodel_change",
      "trace:content_executed",
      "trace:entry_set",
      "trace:content_executed",
      "trace:transitions_selected",
      "trace:event_dequeued",
      "trace:transitions_selected",
      "trace:exit_set",
      "trace:content_executed",
      "trace:entry_set",
      "trace:transitions_selected",
      "trace:invoke_pass",
      "trace:macrostep_stable",
    ]);
    expect(traceOf(next.effects, "event_dequeued").map((t) => [t.event.name, t.from])).toEqual([
      ["copy.checked_out", "external"],
      ["loan.opened", "internal"],
    ]);
  });

  // statifier-ex v2.9.0, interpreter.ex moduledoc: a selection's trace
  // carries the microstep it ran in, one behind the exit set that follows.
  // Sabotage: stamping the selection's trace after beginMicrostep in
  // runSelected turns this red.
  it("stamps a selection one microstep behind the exit set it starts", () => {
    const next = send(startTraced(TRACED_LOAN), "copy.checked_out");
    const [selected] = traceOf(next.effects, "transitions_selected");
    const [exitSet] = traceOf(next.effects, "exit_set");
    expect([selected?.macrostep, selected?.microstep, selected?.round]).toEqual([2, 0, 0]);
    expect([exitSet?.macrostep, exitSet?.microstep, exitSet?.round]).toEqual([2, 1, 0]);
    expect(selected?.event?.name).toBe("copy.checked_out");
    expect(selected?.tIndexes).toHaveLength(1);
  });

  // statifier-ex v2.9.0, lib/statifier/effect/trace/exit_set.ex and
  // entry_set.ex: the states in exit or entry order, and the configuration
  // once every one has moved.
  // Sabotage: carrying the configuration from before the exits in exitStates
  // turns this red.
  it("names the states moved and the configuration they leave", () => {
    const begun = startTraced(TRACED_LOAN);
    const { machine } = begun.state;
    const next = send(begun, "copy.checked_out");
    const [exitSet] = traceOf(next.effects, "exit_set");
    const [entrySet] = traceOf(next.effects, "entry_set");
    expect(exitSet?.indexes).toEqual([idx(machine, "desk")]);
    expect(exitSet?.configuration).toEqual([0]);
    expect(entrySet?.indexes).toEqual([idx(machine, "loaned")]);
    expect(entrySet?.configuration).toEqual([0, idx(machine, "loaned")]);
  });

  // statifier-ex v2.9.0, interpreter.ex, `exit_interpreter/1`: the exit set
  // first, then the exits, then the done trace and the done effect.
  // Sabotage: dropping the done trace in exitInterpreter turns this red.
  it("answers an exit set first and a done trace before done when the chart stops", () => {
    const stopped = send(send(startTraced(TRACED_LOAN), "copy.checked_out"), "copy.returned");
    const tail = tags(stopped.effects).slice(-5);
    expect(tail).toEqual([
      "trace:content_executed",
      "trace:entry_set",
      "trace:exit_set",
      "trace:done",
      "done",
    ]);
    const [, last] = traceOf(stopped.effects, "exit_set");
    const { machine } = stopped.state;
    expect(last?.indexes).toEqual([idx(machine, "returned"), 0]);
    expect(last?.configuration).toEqual([]);
    const [doneTrace] = traceOf(stopped.effects, "done");
    expect(doneTrace?.configuration).toEqual([0, idx(machine, "returned")]);
  });

  // statifier-ex v2.9.0, interpreter.ex, `terminal_effects/2`: a macrostep
  // that stops the chart answers no macrostep_stable.
  // Sabotage: dropping the running test from terminalEffects turns this red.
  it("answers no macrostep_stable when the macrostep stops the chart", () => {
    const stopped = send(send(startTraced(TRACED_LOAN), "copy.checked_out"), "copy.returned");
    expect(traceOf(stopped.effects, "macrostep_stable")).toEqual([]);
  });

  // statifier-ex v2.9.0, interpreter.ex, `run_global_script/3`: each
  // top-level script answers a content_executed naming no node.
  // Sabotage: dropping the trace in runGlobalScripts turns this red.
  it("answers a content_executed for each <script> child of <scxml>", () => {
    const { effects } = startTraced(`<scxml ${SCXML} initial="desk">
      <script>fines = 2</script>
      <script>fines =</script>
      <state id="desk"/>
    </scxml>`);
    expect(traceOf(effects, "content_executed").map((t) => [t.owner, t.cIndexes])).toEqual([
      [{ kind: "global_script", index: 0 }, []],
      [{ kind: "global_script", index: 1 }, []],
    ]);
  });

  // Sabotage: defaulting the trace flag to true in newMachineState turns
  // this red.
  it("answers none when the position does not trace", () => {
    const next = send(start(TRACED_LOAN), "copy.checked_out");
    expect(next.state.trace).toBe(false);
    expect(next.effects.filter((e) => e.kind === "trace")).toEqual([]);
  });
});
