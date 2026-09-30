// Exit and entry: exit and entry order, history recorded and restored, the
// entry set, default entry and default history content, the completion
// events and their donedata, the running flag, invocation cancels, and a
// parallel never the least common compound ancestor; then the reference
// corpus's scion history cases driven through the test driver stub.
//
// The charts written here are the library loan (a copy at the desk, on loan,
// its holds, a branch's stacks, a loan being closed) and parcel delivery.
// Where a case ports one of the reference's own tests, the test file and the
// test name at statifier-ex v2.9.0 are quoted above it, with the answer the
// reference asserts. The scion cases at the foot are the reference corpus's
// own, quoted verbatim from conformance/corpus/scion.json at v2.9.0; their
// sources are the reference's and are not examples.
//
// No test here depends on an integral float keeping its float brand through
// the binding's evaluate: every number compared is an integer.

import { Undefined } from "@riddler/predicator";
import { describe, expect, it } from "vitest";
import {
  addAncestorStatesToEnter,
  addDescendantStatesToEnter,
  cancelInvocationsForState,
  computeEntrySet,
  donedata,
  type ExitEntryEffect,
  type ExitEntryState,
  emptyEntrySet,
  enterStates,
  exitStates,
  invocationKey,
  isInFinalState,
  runOnexitBlocks,
} from "../../src/core/exit-entry.js";
import { INITIAL_SEND_STATE } from "../../src/core/send.js";
import type { Event } from "../../src/datamodel.js";
import type { CompiledTransition, Machine } from "../../src/machine.js";
import { activeLeafIds, machineOf, type Stub, send, start } from "../support/driver-stub.js";

const SCXML = 'xmlns="http://www.w3.org/2005/07/scxml" version="1.0"';

function idx(machine: Machine, id: string): number {
  const index = machine.idToIndex.get(id);
  if (index === undefined) throw new Error(`no state ${id}`);
  return index;
}

function stateWith(
  machine: Machine,
  ids: readonly string[],
  extra: Partial<ExitEntryState> = {},
): ExitEntryState {
  return {
    machine,
    configuration: new Set([0, ...ids.map((id) => idx(machine, id))]),
    historyValues: new Map(),
    datamodel: new Map(),
    internalQueue: [],
    macrostep: 0,
    microstep: 0,
    round: 0,
    sends: INITIAL_SEND_STATE,
    statesToInvoke: new Set(),
    activeInvocations: new Map(),
    running: true,
    ...extra,
  };
}

/** The transition written with this single event descriptor. */
function transitionNamed(machine: Machine, event: string): CompiledTransition {
  const found = machine.transitions.find(
    (t) => t.events.length === 1 && t.events[0]?.join(".") === event,
  );
  if (found === undefined) throw new Error(`no transition ${event}`);
  return found;
}

function ids(machine: Machine, indexes: Iterable<number>): string[] {
  return [...indexes].map((index) => machine.states[index]?.id ?? `#${index}`).sort();
}

function labels(effects: readonly ExitEntryEffect[]): (string | null)[] {
  return effects.flatMap((effect) => (effect.kind === "log" ? [effect.label] : []));
}

function names(queue: readonly Event[]): string[] {
  return queue.map((event) => event.name);
}

// ---------------------------------------------------------------------------
// Exit
// ---------------------------------------------------------------------------

const DESK = `<scxml ${SCXML} initial="copy">
  <state id="copy" initial="shelved">
    <onexit><log label="copy.exit"/></onexit>
    <history id="last_shelf" type="shallow">
      <transition target="shelved"/>
    </history>
    <history id="last_loan" type="deep">
      <transition target="on_loan">
        <log label="last_loan.default"/>
      </transition>
    </history>
    <state id="shelved">
      <onexit><log label="shelved.exit"/></onexit>
      <transition event="copy.borrowed" target="on_loan"/>
    </state>
    <state id="on_loan">
      <onentry><log label="on_loan.entry"/></onentry>
      <onexit><log label="on_loan.exit.first"/></onexit>
      <onexit><log label="on_loan.exit.second"/></onexit>
      <initial>
        <transition target="borrowed"><log label="on_loan.initial"/></transition>
      </initial>
      <state id="borrowed">
        <onentry><log label="borrowed.entry"/></onentry>
        <onexit><log label="borrowed.exit"/></onexit>
        <transition event="loan.renewed" target="renewed"/>
      </state>
      <state id="renewed">
        <onentry><log label="renewed.entry"/></onentry>
      </state>
    </state>
    <transition event="copy.withdrawn" target="desk"/>
    <transition event="copy.recalled" target="last_loan"/>
    <transition event="copy.reshelved" target="last_shelf"/>
  </state>
  <state id="desk">
    <transition event="copy.returned" target="last_loan"/>
    <transition event="copy.found" target="last_shelf"/>
    <transition event="copy.renewed" target="renewed"/>
  </state>
</scxml>`;

describe("exitStates", () => {
  // Reference: exit_entry_exit_test.exs, "exit order is strictly descending
  // index" - every onexit block runs innermost first.
  // Sabotage: exiting in document order instead of exit order turns this red.
  it("exits innermost first, each state's onexit blocks in document order", () => {
    const machine = machineOf(DESK);
    const state = stateWith(machine, ["copy", "on_loan", "borrowed"]);
    const { effects } = exitStates(state, [transitionNamed(machine, "copy.withdrawn")]);
    expect(labels(effects)).toEqual([
      "borrowed.exit",
      "on_loan.exit.first",
      "on_loan.exit.second",
      "copy.exit",
    ]);
  });

  // Reference: exit_entry_exit_test.exs, "the configuration after
  // exit_states/2 is the original minus exactly the exit set".
  // Sabotage: skipping the configuration delete in the per-state exit turns this red.
  it("leaves exactly the exit set, and drops it from the states to invoke", () => {
    const machine = machineOf(DESK);
    const state = stateWith(machine, ["copy", "on_loan", "borrowed"], {
      statesToInvoke: new Set([idx(machine, "borrowed"), idx(machine, "desk")]),
    });
    const exited = exitStates(state, [transitionNamed(machine, "loan.renewed")]).state;
    expect(ids(machine, exited.configuration)).toEqual(["#0", "copy", "on_loan"]);
    expect(ids(machine, exited.statesToInvoke)).toEqual(["desk"]);
  });

  // Reference: exit_entry_exit_test.exs, "shallow and deep on the same
  // exiting state record different values in one pass".
  // Sabotage: recording the deep value for a shallow history turns this red.
  it("records a shallow history's active children and a deep history's active atomic descendants", () => {
    const machine = machineOf(DESK);
    const state = stateWith(machine, ["copy", "on_loan", "borrowed"]);
    const exited = exitStates(state, [transitionNamed(machine, "copy.withdrawn")]).state;
    expect(ids(machine, exited.historyValues.get(idx(machine, "last_shelf")) ?? [])).toEqual([
      "on_loan",
    ]);
    expect(ids(machine, exited.historyValues.get(idx(machine, "last_loan")) ?? [])).toEqual([
      "borrowed",
    ]);
  });

  // Reference: exit_entry_exit_test.exs, "recording overwrites a previously
  // recorded value on revisit".
  // Sabotage: keeping an existing recorded value instead of overwriting it turns this red.
  it("overwrites a value recorded on an earlier exit", () => {
    const machine = machineOf(DESK);
    const earlier = new Map([[idx(machine, "last_shelf"), new Set([idx(machine, "on_loan")])]]);
    const state = stateWith(machine, ["copy", "shelved"], { historyValues: earlier });
    const exited = exitStates(state, [transitionNamed(machine, "copy.withdrawn")]).state;
    expect(ids(machine, exited.historyValues.get(idx(machine, "last_shelf")) ?? [])).toEqual([
      "shelved",
    ]);
  });

  // Reference: exit_entry_exit_test.exs, "a history child of a state that
  // is not exiting records nothing".
  // Sabotage: recording every history child in the chart turns this red.
  it("records nothing for a history whose state does not exit", () => {
    const machine = machineOf(DESK);
    const state = stateWith(machine, ["copy", "on_loan", "borrowed"]);
    const exited = exitStates(state, [transitionNamed(machine, "loan.renewed")]).state;
    expect(exited.historyValues.size).toBe(0);
  });

  // Sabotage: adding each transition's source to the exit set turns this red.
  it("exits nothing for a transition with no target", () => {
    const machine = machineOf(DESK);
    const state = stateWith(machine, ["copy", "shelved"]);
    const targetless = { ...transitionNamed(machine, "copy.borrowed"), targets: [] };
    const exited = exitStates(state, [targetless]);
    expect(exited.effects).toEqual([]);
    expect(ids(machine, exited.state.configuration)).toEqual(["#0", "copy", "shelved"]);
  });

  // Reference: exit_entry_exit_test.exs, "the onexit seam is live" - an
  // onexit block's own effect comes back, owned by that block.
  // Sabotage: numbering the onexit owner's ordinal from one turns this red.
  it("runs a state's onexit blocks alone, owned by their position", () => {
    const machine = machineOf(DESK);
    const ran = runOnexitBlocks(stateWith(machine, ["copy", "on_loan"]), idx(machine, "on_loan"));
    expect(ran.effects.map((e) => (e.kind === "log" ? e.owner : null))).toEqual([
      { kind: "onexit", stateIndex: idx(machine, "on_loan"), ordinal: 0 },
      { kind: "onexit", stateIndex: idx(machine, "on_loan"), ordinal: 1 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Invocation cancels
// ---------------------------------------------------------------------------

const HOLD_SHELF = `<scxml ${SCXML} initial="hold">
  <state id="hold">
    <onexit><log label="hold.exit"/></onexit>
    <invoke type="http://www.w3.org/TR/scxml/" src="patron-notice.scxml"/>
    <invoke type="http://www.w3.org/TR/scxml/" src="branch-transfer.scxml"/>
    <transition event="hold.expired" target="released"/>
  </state>
  <state id="released"/>
</scxml>`;

describe("cancelInvocationsForState", () => {
  // Nothing starts an invocation yet, so a live one is seeded by hand here.
  // Reference: exit_entry_exit_test.exs has no invocation case; the order is
  // the reference's depart/2: onexit blocks, then cancels, in document order.
  // Sabotage: running the cancels before the onexit blocks turns this red.
  it("cancels a live invocation after the state's onexit blocks and forgets it", () => {
    const machine = machineOf(HOLD_SHELF);
    const hold = idx(machine, "hold");
    const state = stateWith(machine, ["hold"], {
      activeInvocations: new Map([[invocationKey(hold, 1), "hold.transfer"]]),
      macrostep: 2,
      microstep: 1,
    });
    const exited = exitStates(state, [transitionNamed(machine, "hold.expired")]);
    expect(exited.effects.map((e) => e.kind)).toEqual(["log", "cancel_invoke"]);
    expect(exited.effects[1]).toEqual({
      kind: "cancel_invoke",
      invokeId: "hold.transfer",
      stateIndex: hold,
      macrostep: 2,
      microstep: 1,
      round: 0,
    });
    expect(exited.state.activeInvocations.size).toBe(0);
  });

  // Sabotage: emitting a cancel for every compiled invoke turns this red.
  it("cancels nothing for an invocation that never started", () => {
    const machine = machineOf(HOLD_SHELF);
    const state = stateWith(machine, ["hold"]);
    const ran = cancelInvocationsForState(state, idx(machine, "hold"));
    expect(ran.effects).toEqual([]);
    expect(ran.state).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// The entry set
// ---------------------------------------------------------------------------

const BRANCH = `<scxml ${SCXML} initial="lobby">
  <state id="lobby">
    <transition event="patron.entered" target="stacks"/>
    <transition event="patron.to_fiction" target="fiction_aisle"/>
    <transition event="patron.to_last_room" target="last_room"/>
  </state>
  <parallel id="stacks">
    <history id="last_room" type="deep">
      <transition target="fiction_aisle reference_desk"/>
    </history>
    <state id="fiction" initial="fiction_aisle">
      <state id="fiction_aisle"/>
      <state id="fiction_returns"/>
    </state>
    <state id="reference" initial="reference_desk">
      <state id="reference_desk"/>
      <state id="reference_archive"/>
    </state>
  </parallel>
</scxml>`;

describe("computeEntrySet", () => {
  // Reference: exit_entry_entry_set_test.exs, "a parallel target enters every
  // region and each region's initial descendants".
  // Sabotage: skipping the uncovered-regions walk for a parallel target turns this red.
  it("enters every region of a parallel target, each by its initial state", () => {
    const machine = machineOf(BRANCH);
    const entrySet = computeEntrySet(stateWith(machine, ["lobby"]), [
      transitionNamed(machine, "patron.entered"),
    ]);
    expect(ids(machine, entrySet.statesToEnter)).toEqual([
      "fiction",
      "fiction_aisle",
      "reference",
      "reference_desk",
      "stacks",
    ]);
    expect(ids(machine, entrySet.statesForDefaultEntry)).toEqual(["fiction", "reference"]);
  });

  // Reference: exit_entry_entry_set_test.exs, "a transition into one region
  // of a parallel, from outside the parallel ... enters the named target, its
  // ancestors up to the domain, and the uncovered sibling region" and "flags
  // only the uncovered sibling region".
  // Sabotage: treating every region as uncovered turns this red.
  it("enters one region's target, its ancestors and only the uncovered sibling region", () => {
    const machine = machineOf(BRANCH);
    const entrySet = computeEntrySet(stateWith(machine, ["lobby"]), [
      transitionNamed(machine, "patron.to_fiction"),
    ]);
    expect(ids(machine, entrySet.statesToEnter)).toEqual([
      "fiction",
      "fiction_aisle",
      "reference",
      "reference_desk",
      "stacks",
    ]);
    expect(ids(machine, entrySet.statesForDefaultEntry)).toEqual(["reference"]);
  });

  // Reference: exit_entry_entry_set_test.exs, "an unrecorded history follows
  // its default transition's targets and registers default_history_content".
  // Sabotage: keying the default history content by the history instead of its parent turns this red.
  it("follows an unrecorded history's default and registers its content on the parent", () => {
    const machine = machineOf(BRANCH);
    const entrySet = computeEntrySet(stateWith(machine, ["lobby"]), [
      transitionNamed(machine, "patron.to_last_room"),
    ]);
    expect(ids(machine, entrySet.statesToEnter)).toEqual([
      "fiction",
      "fiction_aisle",
      "reference",
      "reference_desk",
      "stacks",
    ]);
    expect([...entrySet.defaultHistoryContent.keys()]).toEqual([idx(machine, "stacks")]);
  });

  // Reference: exit_entry_entry_set_test.exs, "a recorded deep history
  // restores its recorded atomic set with coherent parallel restoration".
  // Sabotage: ignoring the recorded value and following the default turns this red.
  it("restores a recorded deep history across both regions and registers no default content", () => {
    const machine = machineOf(BRANCH);
    const recorded = new Set([idx(machine, "fiction_returns"), idx(machine, "reference_archive")]);
    const state = stateWith(machine, ["lobby"], {
      historyValues: new Map([[idx(machine, "last_room"), recorded]]),
    });
    const entrySet = computeEntrySet(state, [transitionNamed(machine, "patron.to_last_room")]);
    expect(ids(machine, entrySet.statesToEnter)).toEqual([
      "fiction",
      "fiction_returns",
      "reference",
      "reference_archive",
      "stacks",
    ]);
    expect(entrySet.defaultHistoryContent.size).toBe(0);
  });

  // Reference: exit_entry_entry_set_test.exs, "a targetless transition
  // contributes nothing to any of the three members".
  // Sabotage: entering the source's ancestors for a targetless transition turns this red.
  it("enters nothing for a transition with no target", () => {
    const machine = machineOf(BRANCH);
    const targetless = { ...transitionNamed(machine, "patron.entered"), targets: [] };
    const entrySet = computeEntrySet(stateWith(machine, ["lobby"]), [targetless]);
    expect(entrySet.statesToEnter.size).toBe(0);
  });

  // Sabotage: stopping the ancestor walk one state early turns this red.
  it("walks every ancestor up to, and not including, the bound; a null bound reaches the root", () => {
    const machine = machineOf(BRANCH);
    const state = stateWith(machine, []);
    const bounded = emptyEntrySet();
    addAncestorStatesToEnter(state, idx(machine, "fiction_aisle"), idx(machine, "stacks"), bounded);
    expect(ids(machine, bounded.statesToEnter)).toEqual(["fiction"]);
    // Called alone, with the target itself not yet in the set, the parallel
    // finds its own region uncovered too and enters it by default.
    const unbounded = emptyEntrySet();
    addAncestorStatesToEnter(state, idx(machine, "fiction_aisle"), null, unbounded);
    expect(ids(machine, unbounded.statesToEnter)).toEqual([
      "#0",
      "fiction",
      "fiction_aisle",
      "reference",
      "reference_desk",
      "stacks",
    ]);
  });

  // Sabotage: adding a history state itself to the states to enter turns this red.
  it("never enters a history state itself", () => {
    const machine = machineOf(BRANCH);
    const entrySet = emptyEntrySet();
    addDescendantStatesToEnter(stateWith(machine, []), idx(machine, "last_room"), entrySet);
    expect(entrySet.statesToEnter.has(idx(machine, "last_room"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

describe("enterStates", () => {
  // Reference: exit_entry_enter_test.exs, "entry order is strictly ascending
  // index"; the initial transition's content runs after the state's onentry.
  // Sabotage: entering in exit order instead of document order turns this red.
  it("enters in document order, a default entry's initial content after its onentry", () => {
    const machine = machineOf(DESK);
    const state = stateWith(machine, ["copy", "shelved"]);
    const exited = exitStates(state, [transitionNamed(machine, "copy.borrowed")]).state;
    const entered = enterStates(exited, [transitionNamed(machine, "copy.borrowed")]);
    expect(labels(entered.effects)).toEqual(["on_loan.entry", "on_loan.initial", "borrowed.entry"]);
    expect(ids(machine, entered.state.configuration)).toEqual([
      "#0",
      "borrowed",
      "copy",
      "on_loan",
    ]);
    expect(ids(machine, entered.state.statesToInvoke)).toEqual(["borrowed", "on_loan"]);
  });

  // Reference: exit_entry_enter_test.exs, "a state entered only through its
  // history child is not flagged for default entry" - here, a compound
  // entered as the ancestor of an explicit target runs no initial content.
  // Sabotage: flagging every compound the ancestor walk adds turns this red.
  it("runs no initial content for a compound entered as an explicit target's ancestor", () => {
    const machine = machineOf(DESK);
    const entered = enterStates(stateWith(machine, ["desk"]), [
      transitionNamed(machine, "copy.renewed"),
    ]);
    expect(labels(entered.effects)).toEqual(["on_loan.entry", "renewed.entry"]);
  });

  // Reference: exit_entry_enter_test.exs, "combo carries onentry content, is
  // flagged for default entry, and registers default history content" and
  // "a recorded history registers no default history content".
  // Sabotage: registering the default content for a recorded history too turns this red.
  it("runs a history's default content only while the history is unrecorded", () => {
    const machine = machineOf(DESK);
    const returned = transitionNamed(machine, "copy.returned");
    const first = enterStates(stateWith(machine, ["desk"]), [returned]);
    expect(labels(first.effects)).toEqual([
      "last_loan.default",
      "on_loan.entry",
      "on_loan.initial",
      "borrowed.entry",
    ]);
    const recorded = new Map([[idx(machine, "last_loan"), new Set([idx(machine, "renewed")])]]);
    const second = enterStates(stateWith(machine, ["desk"], { historyValues: recorded }), [
      returned,
    ]);
    expect(labels(second.effects)).toEqual(["on_loan.entry", "renewed.entry"]);
  });

  // Reference: exit_entry_enter_test.exs, "the onentry seam is live: entering
  // a with an onentry <raise> queues its event".
  // Sabotage: dropping the block's raised events turns this red.
  it("queues what an onentry block raises, and keeps what it assigns", () => {
    const machine = machineOf(`<scxml ${SCXML} initial="depot">
      <datamodel><data id="scans" expr="0"/></datamodel>
      <state id="depot"><transition event="parcel.loaded" target="van"/></state>
      <state id="van">
        <onentry>
          <assign location="scans" expr="scans + 1"/>
          <raise event="parcel.in_transit"/>
        </onentry>
      </state>
    </scxml>`);
    const state = stateWith(machine, ["depot"], { datamodel: new Map([["scans", 0]]) });
    const entered = enterStates(state, [transitionNamed(machine, "parcel.loaded")]).state;
    expect(names(entered.internalQueue)).toEqual(["parcel.in_transit"]);
    expect(entered.datamodel.get("scans")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Completion events and donedata
// ---------------------------------------------------------------------------

const CLOSING = `<scxml ${SCXML} initial="closing">
  <parallel id="closing">
    <state id="returns" initial="checking_in">
      <state id="checking_in"><transition event="copy.checked_in" target="returned"/></state>
      <final id="returned"/>
    </state>
    <state id="fines" initial="owing">
      <state id="owing"><transition event="fine.paid" target="settled"/></state>
      <final id="settled"/>
    </state>
  </parallel>
</scxml>`;

describe("completion events", () => {
  // Reference: exit_entry_enter_test.exs, "completing the second region of a
  // parallel raises done.state.{grandparent} after the parent's": the region's
  // event, then the parallel's, both with undefined data.
  // Sabotage: raising the parallel's event before the region's turns this red.
  it("raises done.state for a completed parallel after its last region's own", () => {
    const machine = machineOf(CLOSING);
    const state = stateWith(machine, ["closing", "returns", "returned", "fines", "owing"], {
      macrostep: 4,
      microstep: 2,
    });
    const paid = transitionNamed(machine, "fine.paid");
    const entered = enterStates(exitStates(state, [paid]).state, [paid]).state;
    expect(names(entered.internalQueue)).toEqual(["done.state.fines", "done.state.closing"]);
    for (const event of entered.internalQueue) {
      expect(event.type).toBe("platform");
      expect(event.data).toBe(Undefined);
      expect(event.cause).toEqual({
        origin: { kind: "state", stateIndex: idx(machine, "settled") },
        macrostep: 4,
        microstep: 2,
        round: 0,
      });
    }
  });

  // Reference: exit_entry_enter_test.exs, "completing only the first region
  // of a parallel raises only the parent's done.state".
  // Sabotage: completing a parallel when any region is final instead of every one turns this red.
  it("raises only the region's done.state while another region is still open", () => {
    const machine = machineOf(CLOSING);
    const state = stateWith(machine, ["closing", "returns", "checking_in", "fines", "owing"]);
    const checkedIn = transitionNamed(machine, "copy.checked_in");
    const entered = enterStates(exitStates(state, [checkedIn]).state, [checkedIn]).state;
    expect(names(entered.internalQueue)).toEqual(["done.state.returns"]);
  });

  // Reference: exit_entry_enter_test.exs, "a parallel grandparent with no id
  // raises nothing for itself and does not crash".
  // Sabotage: raising the parallel's event without its id check turns this red.
  it("raises nothing for a completed parallel with no id", () => {
    const machine = machineOf(
      CLOSING.replace('<parallel id="closing">', "<parallel>").replace(' initial="closing"', ""),
    );
    const state = stateWith(machine, ["returns", "returned", "fines", "owing"]);
    const withParallel = new Set([...state.configuration, idx(machine, "returns") - 1]);
    const paid = transitionNamed(machine, "fine.paid");
    const exited = exitStates({ ...state, configuration: withParallel }, [paid]).state;
    expect(names(enterStates(exited, [paid]).state.internalQueue)).toEqual(["done.state.fines"]);
  });

  // Reference: exit_entry_enter_test.exs, "a compound parent with no id raises
  // nothing and does not crash" - the validator refuses such a chart, so the
  // parent's id is removed from the compiled Machine here.
  // Sabotage: raising the parent's event without its id check turns this red.
  it("raises nothing for a final whose parent has no id", () => {
    const compiled = machineOf(CLOSING);
    const fines = idx(compiled, "fines");
    const machine: Machine = {
      ...compiled,
      states: compiled.states.map((s) => (s.index === fines ? { ...s, id: null } : s)),
    };
    const state = stateWith(machine, ["closing", "returns", "checking_in", "fines", "owing"]);
    const paid = transitionNamed(machine, "fine.paid");
    const entered = enterStates(exitStates(state, [paid]).state, [paid]).state;
    expect(entered.internalQueue).toEqual([]);
  });

  // Reference: exit_entry_enter_test.exs, "entering a top-level final sets
  // running: false and raises nothing".
  // Sabotage: leaving the running flag set on a top-level final turns this red.
  it("stops the chart on a top-level final and raises nothing", () => {
    const machine = machineOf(`<scxml ${SCXML} initial="in_transit">
      <state id="in_transit"><transition event="parcel.delivered" target="delivered"/></state>
      <final id="delivered"/>
    </scxml>`);
    const entered = enterStates(stateWith(machine, ["in_transit"]), [
      transitionNamed(machine, "parcel.delivered"),
    ]).state;
    expect(entered.running).toBe(false);
    expect(entered.internalQueue).toEqual([]);
  });

  // Reference: exit_entry_enter_test.exs, "in_final_state?/2": a compound is
  // in a final state with an active final child; a parallel only when every
  // region is; an atomic final is not.
  // Sabotage: answering true for a final itself turns this red.
  it("answers isInFinalState for a compound, a parallel and a final", () => {
    const machine = machineOf(CLOSING);
    const done = stateWith(machine, ["closing", "returns", "returned", "fines", "settled"]);
    const open = stateWith(machine, ["closing", "returns", "returned", "fines", "owing"]);
    expect(isInFinalState(done, idx(machine, "returns"))).toBe(true);
    expect(isInFinalState(done, idx(machine, "closing"))).toBe(true);
    expect(isInFinalState(open, idx(machine, "closing"))).toBe(false);
    expect(isInFinalState(open, idx(machine, "fines"))).toBe(false);
    expect(isInFinalState(done, idx(machine, "settled"))).toBe(false);
  });
});

const PICKUP = `<scxml ${SCXML} initial="desk">
  <datamodel><data id="branch" expr="'Eastside'"/></datamodel>
  <state id="desk">
    <transition event="hold.static" target="static_ready"/>
    <transition event="hold.expr" target="expr_ready"/>
    <transition event="hold.expr_fails" target="failing_ready"/>
    <transition event="hold.params" target="params_ready"/>
    <transition event="hold.bare" target="bare_ready"/>
  </state>
  <state id="static_hold"><final id="static_ready"><donedata><content>42</content></donedata></final></state>
  <state id="expr_hold"><final id="expr_ready"><donedata><content expr="1 + 1"/></donedata></final></state>
  <state id="failing_hold"><final id="failing_ready"><donedata><content expr="shelf + 1"/></donedata></final></state>
  <state id="params_hold">
    <final id="params_ready">
      <donedata>
        <param name="branch" location="branch"/>
        <param name="copies" expr="missing_copies"/>
        <param name="days" expr="7"/>
        <param name="days" expr="14"/>
      </donedata>
    </final>
  </state>
  <state id="bare_hold"><final id="bare_ready"><donedata/></final></state>
</scxml>`;

function doneEvent(event: string): { queue: readonly Event[]; machine: Machine } {
  const machine = machineOf(PICKUP);
  const state = stateWith(machine, ["desk"], { datamodel: new Map([["branch", "Eastside"]]) });
  const t = transitionNamed(machine, event);
  return { queue: enterStates(exitStates(state, [t]).state, [t]).state.internalQueue, machine };
}

describe("donedata", () => {
  // Reference: exit_entry_enter_test.exs, "a final with static donedata
  // carries it as the raised event's data" - the text 42 is the integer 42.
  // Sabotage: carrying the <content> text as written instead of reading it turns this red.
  it("reads a <content> body as data", () => {
    const { queue } = doneEvent("hold.static");
    expect(queue.map((e) => [e.name, e.data])).toEqual([["done.state.static_hold", 42]]);
  });

  // Reference: exit_entry_enter_test.exs, "a compiled <content expr> donedata
  // carries the evaluated value".
  // Sabotage: answering no data for a <content expr> turns this red.
  it("evaluates a <content expr>", () => {
    const { queue } = doneEvent("hold.expr");
    expect(queue.map((e) => [e.name, e.data])).toEqual([["done.state.expr_hold", 2]]);
  });

  // Reference: exit_entry_enter_test.exs, "a failing compiled <content expr>
  // donedata yields :undefined data and one error.execution first".
  // Sabotage: dropping the donedata's error.execution turns this red.
  it("raises error.execution ahead of the done event, which carries no data, when <content expr> fails", () => {
    const { queue, machine } = doneEvent("hold.expr_fails");
    expect(names(queue)).toEqual(["error.execution", "done.state.failing_hold"]);
    expect(queue[0]?.cause?.origin).toEqual({
      kind: "state",
      stateIndex: idx(machine, "failing_ready"),
    });
    expect(queue[1]?.data).toBe(Undefined);
  });

  // Reference: exit_entry_enter_test.exs, "donedata <param>": "multiple params
  // merge in document order", "a duplicate name takes the last value", "a
  // <param location> over a bound datamodel path reads its value", "a failing
  // param is omitted and produces exactly one error.execution" and "a failing
  // param's error.execution origin names the param, not the state".
  // Sabotage: stopping the fold at the first failing param turns this red.
  it("folds <param>s in document order, leaving out and raising for a failing one", () => {
    const { queue, machine } = doneEvent("hold.params");
    expect(names(queue)).toEqual(["error.execution", "done.state.params_hold"]);
    expect(queue[0]?.cause?.origin).toEqual({
      kind: "donedata_param",
      stateIndex: idx(machine, "params_ready"),
      paramIndex: 1,
    });
    expect(queue[1]?.data).toEqual({ branch: "Eastside", days: 14 });
  });

  // Reference: exit_entry_enter_test.exs, "a donedata whose only param fails
  // produces event.data == :undefined, not %{}" - here, a <donedata> with no
  // child at all is no data either.
  // Sabotage: answering an empty map for a <donedata> with nothing in it turns this red.
  it("carries no data for a <donedata> with neither <content> nor <param>", () => {
    const { queue } = doneEvent("hold.bare");
    expect(queue.map((e) => [e.name, e.data])).toEqual([["done.state.bare_hold", Undefined]]);
  });

  // Sabotage: dropping the compiler's message from the raised reason turns this red.
  it("raises a param whose expression never compiled, as any node carrying one does", () => {
    const machine = machineOf(PICKUP);
    const ready = idx(machine, "params_ready");
    const broken: Machine = {
      ...machine,
      states: machine.states.map((s) =>
        s.index === ready && s.donedata !== null
          ? {
              ...s,
              donedata: {
                ...s.donedata,
                params: s.donedata.params.map((p, i) =>
                  i === 0 ? { ...p, expr: { kind: "invalid", source: "(", message: "no" } } : p,
                ),
              },
            }
          : s,
      ),
    };
    const folded = donedata(stateWith(broken, ["params_hold"]), ready);
    expect(folded.state.internalQueue[0]?.reason).toEqual({
      kind: "compile_error",
      source: "(",
      message: "no",
    });
  });
});

// ---------------------------------------------------------------------------
// A parallel is never the least common compound ancestor
// ---------------------------------------------------------------------------

// Reference: docs/adr/0022-parallel-is-never-the-lcca.md at v2.9.0, the
// engine's answer, quoted: "a transition between (or within) regions of a
// parallel exits and re-enters the whole parallel". Its Context counts the
// same thing: under the literal port a region's self-transition runs the
// parallel's <onexit> and <onentry> once more than a reading that admits the
// parallel as the ancestor would.
const STACKS = `<scxml ${SCXML} initial="stacks">
  <datamodel>
    <data id="entries" expr="0"/>
    <data id="exits" expr="0"/>
  </datamodel>
  <parallel id="stacks">
    <onentry><assign location="entries" expr="entries + 1"/></onentry>
    <onexit><assign location="exits" expr="exits + 1"/></onexit>
    <state id="fiction"><transition event="copy.reshelved" target="fiction"/></state>
    <state id="reference"/>
  </parallel>
</scxml>`;

describe("a parallel is never the least common compound ancestor", () => {
  // Sabotage: admitting a parallel as the common ancestor in lcca turns this red.
  it("exits and re-enters the whole parallel for a transition within one region", () => {
    const machine = machineOf(STACKS);
    const state = stateWith(machine, ["stacks", "fiction", "reference"]);
    const exited = exitStates(state, [transitionNamed(machine, "copy.reshelved")]).state;
    expect(ids(machine, exited.configuration)).toEqual(["#0"]);

    let stub: Stub = start(STACKS);
    expect([stub.state.datamodel.get("entries"), stub.state.datamodel.get("exits")]).toEqual([
      1, 0,
    ]);
    stub = send(stub, "copy.reshelved");
    expect([stub.state.datamodel.get("entries"), stub.state.datamodel.get("exits")]).toEqual([
      2, 1,
    ]);
    expect(activeLeafIds(stub)).toEqual(["fiction", "reference"]);
  });
});

// ---------------------------------------------------------------------------
// The scion history cases, through the driver stub
// ---------------------------------------------------------------------------

/** One corpus case: its source, the leaf set after start, and each step's leaf set. */
interface CorpusCase {
  readonly id: string;
  readonly source: string;
  readonly initialConfiguration: readonly string[];
  readonly steps: readonly { readonly event: string; readonly configuration: readonly string[] }[];
}

// The corpus cases, quoted from conformance/corpus/scion.json at statifier-ex
// v2.9.0: the id, the source, the configuration after start and each step's
// event and configuration, as the corpus writes them.
const HISTORY_CASES: readonly CorpusCase[] = [
  {
    id: "scion/history/history0",
    source: `<?xml version="1.0" encoding="UTF-8"?>
<!--
   Copyright 2011-2012 Jacob Beard, INFICON, and other SCION contributors

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
-->
<scxml 
    datamodel="ecmascript"
    xmlns="http://www.w3.org/2005/07/scxml"
    version="1.0"
    initial="a">

    <state id="a">
        <transition target="h" event="t1"/>
    </state>

    <state id="b" initial="b1">

        <history id="h">
            <transition target="b2"/>
        </history>

        <state id="b1"/>

        <state id="b2">
            <transition event="t2" target="b3"/>
        </state>

        <state id="b3">
            <transition event="t3" target="a"/>
        </state>
    </state>

</scxml>




`,
    initialConfiguration: ["a"],
    steps: [
      { event: "t1", configuration: ["b2"] },
      { event: "t2", configuration: ["b3"] },
      { event: "t3", configuration: ["a"] },
      { event: "t1", configuration: ["b3"] },
    ],
  },
  {
    id: "scion/history/history1",
    source: `<?xml version="1.0" encoding="UTF-8"?>
<!--
   Copyright 2011-2012 Jacob Beard, INFICON, and other SCION contributors

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
-->
<scxml 
    datamodel="ecmascript"
    xmlns="http://www.w3.org/2005/07/scxml"
    version="1.0"
    initial="a">

    <state id="a">
        <transition target="h" event="t1"/>
    </state>

    <state id="b" initial="b1">

        <history id="h" type="deep">
            <transition target="b1.2"/>
        </history>

        <state id="b1" initial="b1.1">
            <state id="b1.1"/>

            <state id="b1.2">
                <transition event="t2" target="b1.3"/>
            </state>

            <state id="b1.3">
                <transition event="t3" target="a"/>
            </state>
        </state>


    </state>

</scxml>





`,
    initialConfiguration: ["a"],
    steps: [
      { event: "t1", configuration: ["b1.2"] },
      { event: "t2", configuration: ["b1.3"] },
      { event: "t3", configuration: ["a"] },
      { event: "t1", configuration: ["b1.3"] },
    ],
  },
  {
    id: "scion/history/history2",
    source: `<?xml version="1.0" encoding="UTF-8"?>
<!--
   Copyright 2011-2012 Jacob Beard, INFICON, and other SCION contributors

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
-->
<scxml 
    datamodel="ecmascript"
    xmlns="http://www.w3.org/2005/07/scxml"
    version="1.0"
    initial="a">

    <state id="a">
        <transition target="h" event="t1"/>
    </state>

    <state id="b" initial="b1">

        <history id="h" type="shallow">
            <transition target="b1.2"/>
        </history>

        <state id="b1" initial="b1.1">
            <state id="b1.1"/>

            <state id="b1.2">
                <transition event="t2" target="b1.3"/>
            </state>

            <state id="b1.3">
                <transition event="t3" target="a"/>
            </state>
        </state>


    </state>

</scxml>






`,
    initialConfiguration: ["a"],
    steps: [
      { event: "t1", configuration: ["b1.2"] },
      { event: "t2", configuration: ["b1.3"] },
      { event: "t3", configuration: ["a"] },
      { event: "t1", configuration: ["b1.1"] },
    ],
  },
  {
    id: "scion/history/history3",
    source: `<?xml version="1.0" encoding="UTF-8"?>
<!--
   Copyright 2011-2012 Jacob Beard, INFICON, and other SCION contributors

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
-->
<scxml 
    datamodel="ecmascript"
    xmlns="http://www.w3.org/2005/07/scxml"
    version="1.0"
    initial="a">


    <state id="a">
        <transition target="p" event="t1"/>
        <transition target="h" event="t4"/>
    </state>

    <parallel id="p">
        <history id="h" type="deep">
            <transition target="b"/>
        </history>

        <state id="b" initial="b1">
            <state id="b1">
                <transition target="b2" event="t2"/>
            </state>

            <state id="b2"/>
        </state>

        <state id="c" initial="c1">
            <state id="c1">
                <transition target="c2" event="t2"/>
            </state>

            <state id="c2"/>
        </state>
    
        <transition target="a" event="t3"/>
    </parallel>
</scxml>







`,
    initialConfiguration: ["a"],
    steps: [
      { event: "t1", configuration: ["b1", "c1"] },
      { event: "t2", configuration: ["b2", "c2"] },
      { event: "t3", configuration: ["a"] },
      { event: "t4", configuration: ["b2", "c2"] },
    ],
  },
  {
    id: "scion/history/history4",
    source: `<?xml version="1.0" encoding="UTF-8"?>
<!--
   Copyright 2011-2012 Jacob Beard, INFICON, and other SCION contributors

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
-->
<!--
     illustrates both deep and shallow history, working in both AND and OR states
-->
<scxml 
    datamodel="ecmascript"
    xmlns="http://www.w3.org/2005/07/scxml"
    version="1.0"
    initial="a">


    <state id="a">
        <transition target="p" event="t1"/>
        <transition target="p" event="t6"/>
        <transition target="hp" event="t9"/>
    </state>

    <parallel id="p">
        <history id="hp" type="deep">
            <transition target="b"/>
        </history>

        <state id="b" initial="hb">

            <history id="hb" type="deep">
                <transition target="b1"/>
            </history>

            <state id="b1" initial="b1.1">
                <state id="b1.1">
                    <transition target="b1.2" event="t2"/>
                </state>

                <state id="b1.2">
                    <transition target="b2" event="t3"/>
                </state>
            </state>

            <state id="b2" initial="b2.1">
                <state id="b2.1">
                    <transition target="b2.2" event="t4"/>
                </state>

                <state id="b2.2">
                    <transition target="a" event="t5"/>
                    <transition target="a" event="t8"/>
                </state>
            </state>
        </state>

        <state id="c" initial="hc">

            <history id="hc" type="shallow">
                <transition target="c1"/>
            </history>

            <state id="c1" initial="c1.1">
                <state id="c1.1">
                    <transition target="c1.2" event="t2"/>
                </state>

                <state id="c1.2">
                    <transition target="c2" event="t3"/>
                </state>
            </state>

            <state id="c2" initial="c2.1">
                <state id="c2.1">
                    <transition target="c2.2" event="t4"/>
                    <transition target="c2.2" event="t7"/>
                </state>

                <state id="c2.2">
                </state>
            </state>
        </state>
    </parallel>
</scxml>








`,
    initialConfiguration: ["a"],
    steps: [
      { event: "t1", configuration: ["b1.1", "c1.1"] },
      { event: "t2", configuration: ["b1.2", "c1.2"] },
      { event: "t3", configuration: ["b2.1", "c2.1"] },
      { event: "t4", configuration: ["b2.2", "c2.2"] },
      { event: "t5", configuration: ["a"] },
      { event: "t6", configuration: ["b2.2", "c2.1"] },
      { event: "t7", configuration: ["b2.2", "c2.2"] },
      { event: "t8", configuration: ["a"] },
      { event: "t9", configuration: ["b2.2", "c2.2"] },
    ],
  },
  {
    id: "scion/history/history4b",
    source: `<?xml version="1.0" encoding="UTF-8"?>
<!--
   Copyright 2011-2012 Jacob Beard, INFICON, and other SCION contributors

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
-->
<!--
     illustrates both deep and shallow history, working in both AND and OR states
-->
<scxml 
    datamodel="ecmascript"
    xmlns="http://www.w3.org/2005/07/scxml"
    version="1.0"
    initial="a">


    <state id="a">
        <transition target="p" event="t1"/>
        <transition target="hb hc" event="t6"/>
        <transition target="hp" event="t9"/>
    </state>

    <parallel id="p">
        <history id="hp" type="deep">
            <transition target="b"/>
        </history>

        <state id="b" initial="hb">

            <history id="hb" type="deep">
                <transition target="b1"/>
            </history>

            <state id="b1" initial="b1.1">
                <state id="b1.1">
                    <transition target="b1.2" event="t2"/>
                </state>

                <state id="b1.2">
                    <transition target="b2" event="t3"/>
                </state>
            </state>

            <state id="b2" initial="b2.1">
                <state id="b2.1">
                    <transition target="b2.2" event="t4"/>
                </state>

                <state id="b2.2">
                    <transition target="a" event="t5"/>
                    <transition target="a" event="t8"/>
                </state>
            </state>
        </state>

        <state id="c" initial="hc">

            <history id="hc" type="shallow">
                <transition target="c1"/>
            </history>

            <state id="c1" initial="c1.1">
                <state id="c1.1">
                    <transition target="c1.2" event="t2"/>
                </state>

                <state id="c1.2">
                    <transition target="c2" event="t3"/>
                </state>
            </state>

            <state id="c2" initial="c2.1">
                <state id="c2.1">
                    <transition target="c2.2" event="t4"/>
                    <transition target="c2.2" event="t7"/>
                </state>

                <state id="c2.2">
                </state>
            </state>
        </state>
    </parallel>
</scxml>








`,
    initialConfiguration: ["a"],
    steps: [
      { event: "t1", configuration: ["b1.1", "c1.1"] },
      { event: "t2", configuration: ["b1.2", "c1.2"] },
      { event: "t3", configuration: ["b2.1", "c2.1"] },
      { event: "t4", configuration: ["b2.2", "c2.2"] },
      { event: "t5", configuration: ["a"] },
      { event: "t6", configuration: ["b2.2", "c2.1"] },
      { event: "t7", configuration: ["b2.2", "c2.2"] },
      { event: "t8", configuration: ["a"] },
      { event: "t9", configuration: ["b2.2", "c2.2"] },
    ],
  },
  {
    id: "scion/history/history5",
    source: `<?xml version="1.0" encoding="UTF-8"?>
<!--
   Copyright 2011-2012 Jacob Beard, INFICON, and other SCION contributors

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
-->
<!-- 
illustrates deep history with many parallel states
--> 
<scxml
    datamodel="ecmascript"
    xmlns="http://www.w3.org/2005/07/scxml"
    version="1.0"
    initial="a">

    <parallel id="a">
        <history id="ha" type="deep">
            <transition target="b"/>
        </history>

        <parallel id="b">
            <parallel id="c">
                <parallel id="d">
                    <parallel id="e">

                        <state id="i" initial="i1">
                            <state id="i1">
                                <transition target="i2" event="t1"/>
                            </state>

                            <state id="i2">
                                <transition target="l" event="t2"/>
                            </state>
                        </state>

                        <state id="j"/>
                    </parallel>

                    <state id="h"/>
                </parallel>

                <state id="g"/>
            </parallel>

            <state id="f" initial="f1">
                <state id="f1">
                    <transition target="f2" event="t1"/>
                </state>

                <state id="f2">
                </state>
            </state>
        </parallel>

        <state id="k"/>
    </parallel>

    <state id="l">
        <transition target="ha" event="t3"/>
    </state>

</scxml>



`,
    initialConfiguration: ["i1", "j", "h", "g", "f1", "k"],
    steps: [
      { event: "t1", configuration: ["i2", "j", "h", "g", "f2", "k"] },
      { event: "t2", configuration: ["l"] },
      { event: "t3", configuration: ["i2", "j", "h", "g", "f2", "k"] },
    ],
  },
  {
    id: "scion/history/history6",
    source: `<?xml version="1.0" encoding="UTF-8"?>
<!--
   Copyright 2011-2012 Jacob Beard, INFICON, and other SCION contributors

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
-->
<scxml 
    datamodel="ecmascript"
    xmlns="http://www.w3.org/2005/07/scxml"
    version="1.0"
    initial="a">

    <datamodel>
        <data id="x" expr="2"/>
    </datamodel>

    <state id="a">
        <transition target="h" event="t1"/>
    </state>

    <state id="b" initial="b1">
        <onentry>
            <assign location="x" expr="x * 3"/>
            <log expr="'b, x:' + x"/>
        </onentry>

        <history id="h">
            <transition target="b2"/>
        </history>

        <state id="b1"/>

        <state id="b2">
            <onentry>
                <assign location="x" expr="x * 5"/>
                <log expr="'b2, x:' + x"/>
            </onentry>
            <transition event="t2" target="b3"/>
        </state>

        <state id="b3">
            <onentry>
                <assign location="x" expr="x * 7"/>
                <log expr="'b3, x:' + x"/>
            </onentry>
            <transition event="t3" target="a"/>
        </state>

        <!-- 4410 should be the value of x after the following sequence of enter actions:
             a, b, b2, b3, a, b, b3 -->
        <transition event="t4" target="success" cond="x === 4410"/>
        <!-- we make a special 'really-fail' state because of a particular bug in SCION I am trying to illustrate -->
        <transition event="t4" target="really-fail" cond="x === 1470"/>
        <!-- for everything else, we just fail -->
        <transition event="t4" target="fail"/>
    </state>

    <state id="success"/>

    <state id="fail"/>

    <state id="really-fail"/>

</scxml>
`,
    initialConfiguration: ["a"],
    steps: [
      { event: "t1", configuration: ["b2"] },
      { event: "t2", configuration: ["b3"] },
      { event: "t3", configuration: ["a"] },
      { event: "t1", configuration: ["b3"] },
      { event: "t4", configuration: ["success"] },
    ],
  },
];

describe("the scion history cases", () => {
  // Every case in the reference corpus whose id is under scion/history/.
  it("lists the eight cases", () => {
    expect(HISTORY_CASES.map((c) => c.id)).toEqual([
      "scion/history/history0",
      "scion/history/history1",
      "scion/history/history2",
      "scion/history/history3",
      "scion/history/history4",
      "scion/history/history4b",
      "scion/history/history5",
      "scion/history/history6",
    ]);
  });

  // Sabotage: recording a deep history as a shallow one turns history1, history3, history4, history4b and history5 red.
  for (const corpusCase of HISTORY_CASES) {
    it(`passes ${corpusCase.id}`, () => {
      let stub = start(corpusCase.source);
      expect(activeLeafIds(stub)).toEqual([...corpusCase.initialConfiguration].sort());
      corpusCase.steps.forEach((step, i) => {
        stub = send(stub, step.event);
        expect(activeLeafIds(stub), `after step ${i + 1}, ${step.event}`).toEqual(
          [...step.configuration].sort(),
        );
      });
    });
  }
});
