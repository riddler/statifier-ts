// Transition selection: the event-name matcher, the two selection walks,
// conflict removal, and the domain half (effective targets, the transition
// domain, the least common compound ancestor, the exit set).
//
// The charts are the library loan (a copy at the desk, on loan, renewed, its
// holds and fines, a branch's stacks) and parcel delivery (a route from depot
// to doorstep). Where a case ports one of the reference's own tests, the test
// file and the test name at statifier-ex v2.9.0 are quoted above it, with
// the answer the reference asserts; the chart is the same shape in this
// file's domains.
//
// No test here depends on an integral float keeping its float brand through
// the binding's evaluate: the only number a condition reads is the literal 1.

import { describe, expect, it } from "vitest";
import { compile } from "../../src/compiler.js";
import {
  computeExitSet,
  conditionMatch,
  findLCCA,
  getEffectiveTargetStates,
  getTransitionDomain,
  nameMatch,
  removeConflictingTransitions,
  type SelectionState,
  selectEventlessTransitions,
  selectTransitions,
  tokenize,
} from "../../src/core/selection.js";
import type { CompiledTransition, Machine } from "../../src/machine.js";

const SCXML = 'xmlns="http://www.w3.org/2005/07/scxml" version="1.0"';

function machineOf(source: string): Machine {
  const result = compile(source);
  if (!result.ok) throw new Error(`fixture does not compile: ${JSON.stringify(result.errors)}`);
  return result.chart.machine;
}

function idx(machine: Machine, id: string): number {
  const index = machine.idToIndex.get(id);
  if (index === undefined) throw new Error(`no state ${id}`);
  return index;
}

function stateWith(
  machine: Machine,
  ids: readonly string[],
  extra: Partial<SelectionState> = {},
): SelectionState {
  return {
    machine,
    configuration: new Set(ids.map((id) => idx(machine, id))),
    historyValues: new Map(),
    datamodel: new Map(),
    internalQueue: [],
    macrostep: 0,
    microstep: 0,
    round: 0,
    ...extra,
  };
}

/** The transition written with this single event descriptor, from `source` when several share it. */
function transitionNamed(machine: Machine, event: string, source?: string): CompiledTransition {
  const found = machine.transitions.find(
    (t) =>
      t.events.length === 1 &&
      t.events[0]?.join(".") === event &&
      (source === undefined || t.source === idx(machine, source)),
  );
  if (found === undefined) throw new Error(`no transition ${event}`);
  return found;
}

function eventlessOf(machine: Machine, source: string): CompiledTransition {
  const found = machine.transitions.find(
    (t) => t.events.length === 0 && t.source === idx(machine, source),
  );
  if (found === undefined) throw new Error(`no eventless transition on ${source}`);
  return found;
}

function event(name: string) {
  return { name };
}

// ---------------------------------------------------------------------------
// The event-name matcher
// ---------------------------------------------------------------------------

/** An `event` attribute as the compiler splits it: descriptors on whitespace, tokens on dots. */
function descriptors(attribute: string): string[][] {
  return attribute.split(/\s+/).map((descriptor) => descriptor.split("."));
}

describe("nameMatch", () => {
  const table: [descriptor: string, event: string, matches: boolean][] = [
    ["error", "error", true],
    ["error", "error.execution", true],
    ["error", "errors.execution", false],
    ["error.*", "error", true],
    ["error.*", "error.execution", true],
    ["error.*", "error.communication.timeout", true],
    ["error.*", "errors", false],
    ["foo.bar", "foo", false],
    ["foo", "foo.bar", true],
    ["foo.", "foo", true],
    ["foo.", "foo.bar", true],
    ["*", "foo", true],
    ["*", "copy.reserved.held", true],
    ["copy.reserved.held", "copy.reserved.held", true],
    ["copy.reserved", "copy.reserved.held", true],
    ["copy.reserved.held", "copy.reserved", false],
    ["copy.reserved.held", "copy.reserved.lost", false],
    ["copy.*.held", "copy.reserved.held", false],
    ["copy.*.held", "copy.*.held", true],
    ["loan.renewed *", "patron.notified", true],
    ["loan.renewed copy", "copy.borrowed", true],
    ["loan.renewed copy", "patron", false],
  ];

  // Sabotage: comparing the dot-joined strings with startsWith instead of
  // token by token turns this red (error would match errors.execution).
  // Sabotage: dropping the trailing-token normalization turns this red
  // (error.* would not match error, * would not match anything).
  // Sabotage: using every instead of some over the descriptors turns this red.
  it.each(table)("%s against %s is %s", (descriptor, name, matches) => {
    expect(nameMatch(descriptors(descriptor), tokenize(name))).toBe(matches);
  });

  // Sabotage: splitting on "" instead of "." turns this red.
  it("tokenizes a dotted name and a one-token name", () => {
    expect(tokenize("error.execution")).toEqual(["error", "execution"]);
    expect(tokenize("error")).toEqual(["error"]);
  });

  // Sabotage: replacing nameMatch's call in the event walk with a constant
  // true turns this red (copy.returned would take the error.* transition).
  it("selects through the matcher with compiled descriptors", () => {
    const machine = machineOf(`<scxml ${SCXML}>
      <state id="desk">
        <transition event="error.*" target="closed"/>
        <transition event="copy.borrowed copy.reserved.held" target="onLoan"/>
      </state>
      <state id="onLoan"/>
      <state id="closed"/>
    </scxml>`);
    const state = stateWith(machine, ["desk"]);
    const targetOf = (name: string) =>
      selectTransitions(state, event(name)).transitions.map((t) => t.targets);
    expect(targetOf("error.execution")).toEqual([[idx(machine, "closed")]]);
    expect(targetOf("copy.reserved.held")).toEqual([[idx(machine, "onLoan")]]);
    expect(targetOf("copy.returned")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The selection walks
// ---------------------------------------------------------------------------

const DESK = `<scxml ${SCXML} initial="shelf">
  <state id="shelf">
    <transition event="copy.borrowed" target="returned"/>
  </state>
  <state id="branch">
    <transition event="copy.recalled" target="returned"/>
    <state id="desk">
      <transition event="copy.recalled" target="returned"/>
    </state>
  </state>
  <state id="counter">
    <transition event="copy.scanned" target="returned"/>
    <transition event="copy.scanned" target="onHold"/>
  </state>
  <state id="checkout">
    <transition event="loan.refused" cond="false" target="returned"/>
    <transition event="loan.approved" cond="true" target="returned"/>
    <transition event="loan.opened" target="returned"/>
  </state>
  <state id="renewal">
    <transition target="returned"/>
    <transition event="loan.renewed" target="returned"/>
  </state>
  <state id="patron">
    <transition event="patron.notified"/>
    <parallel id="accounts">
      <state id="loans"><state id="loansOpen"/></state>
      <state id="holds"><state id="holdsOpen"/></state>
    </parallel>
  </state>
  <parallel id="stacks">
    <state id="fiction">
      <state id="fictionShelved">
        <transition event="stacks.sweep" target="fictionReturned" type="internal"/>
      </state>
      <state id="fictionReturned"/>
    </state>
    <state id="reference">
      <state id="referenceShelved">
        <transition event="stacks.sweep" target="referenceReturned" type="internal"/>
      </state>
      <state id="referenceReturned"/>
    </state>
  </parallel>
  <state id="bindery">
    <transition event="stacks.sweep" target="binderyQueue" type="internal"/>
    <state id="binderyQueue"/>
  </state>
  <state id="catalogue">
    <transition event="catalogue.updated"/>
  </state>
  <state id="loan">
    <transition event="loan.reset" target="onLoan" type="internal"/>
    <state id="term">
      <transition event="term.extend" target="renewed" type="internal"/>
      <state id="onLoan">
        <transition event="loan.renew" target="renewed" type="external"/>
      </state>
      <state id="renewed">
        <transition event="loan.lapse" target="onLoan" type="external"/>
      </state>
    </state>
    <state id="fines">
      <transition event="fines.clear" target="finesNone" type="internal"/>
      <state id="finesNone"/>
      <state id="finesDue"/>
    </state>
  </state>
  <state id="returned"/>
  <state id="onHold"/>
</scxml>`;

const HOLDS = `<scxml ${SCXML} initial="request">
  <state id="request">
    <transition event="hold.placed" cond="patronBlocked" target="done"/>
  </state>
  <state id="count">
    <transition event="hold.placed" cond="1" target="done"/>
  </state>
  <state id="queue">
    <transition event="hold.ready" target="done"/>
    <transition event="hold.ready" cond="patronBlocked" target="done"/>
  </state>
  <parallel id="notices">
    <state id="email">
      <transition event="notice.sent" cond="patronBlocked" target="done"/>
    </state>
    <state id="post">
      <transition event="notice.sent" cond="1" target="done"/>
    </state>
  </parallel>
  <state id="waiting">
    <transition cond="patronBlocked" target="done"/>
  </state>
  <state id="done"/>
</scxml>`;

describe("selectTransitions", () => {
  const machine = machineOf(DESK);

  // Sabotage: making transitionEnabled answer false always turns this red.
  it("selects an event-matched transition on the atomic state itself", () => {
    const { transitions } = selectTransitions(
      stateWith(machine, ["shelf"]),
      event("copy.borrowed"),
    );
    expect(transitions).toEqual([transitionNamed(machine, "copy.borrowed")]);
  });

  // Sabotage: ignoring nameMatch's answer in transitionEnabled turns this red.
  it("selects nothing for an event no descriptor matches", () => {
    const { transitions } = selectTransitions(stateWith(machine, ["shelf"]), event("copy.lost"));
    expect(transitions).toEqual([]);
  });

  // Reference: test/statifier/interpreter/selection_test.exs, "child preempts
  // ancestor" - the one selected transition's source is the descendant.
  // Sabotage: starting the ancestor walk at the atomic state's parent turns this red.
  it("takes the child's transition over its ancestor's", () => {
    const { transitions } = selectTransitions(
      stateWith(machine, ["branch", "desk"]),
      event("copy.recalled"),
    );
    expect(transitions.map((t) => t.source)).toEqual([idx(machine, "desk")]);
  });

  // Reference: selection_test.exs, "sibling document-order priority: the
  // first transition in document order wins" - the first-written target.
  // Sabotage: searching a state's transitions in reverse turns this red.
  it("takes the first matching transition in document order on one state", () => {
    const { transitions } = selectTransitions(
      stateWith(machine, ["counter"]),
      event("copy.scanned"),
    );
    expect(transitions.map((t) => t.targets)).toEqual([[idx(machine, "returned")]]);
  });

  // Sabotage: making a condition that answers false enable its transition turns this red.
  it("does not select a transition whose condition is false", () => {
    const { transitions } = selectTransitions(
      stateWith(machine, ["checkout"]),
      event("loan.refused"),
    );
    expect(transitions).toEqual([]);
  });

  // Sabotage: making a condition that answers true disable its transition turns this red.
  it("selects a transition whose condition is true", () => {
    const { transitions } = selectTransitions(
      stateWith(machine, ["checkout"]),
      event("loan.approved"),
    );
    expect(transitions).toEqual([transitionNamed(machine, "loan.approved")]);
  });

  // Sabotage: passing the transition's null condition through as a condition
  // to evaluate turns this red.
  it("selects a transition with no condition", () => {
    const { transitions } = selectTransitions(
      stateWith(machine, ["checkout"]),
      event("loan.opened"),
    );
    expect(transitions).toEqual([transitionNamed(machine, "loan.opened")]);
  });

  // Sabotage: dropping the event walk's eventless guard and widening its name
  // match to accept no descriptors turns this red (the first-written, eventless
  // one would win).
  it("ignores an eventless transition", () => {
    const { transitions } = selectTransitions(
      stateWith(machine, ["renewal"]),
      event("loan.renewed"),
    );
    expect(transitions).toEqual([transitionNamed(machine, "loan.renewed")]);
  });

  // Sabotage: answering a copy of the state when no condition failed turns this red.
  it("answers the same state when no condition failed", () => {
    const state = stateWith(machine, ["shelf"]);
    expect(selectTransitions(state, event("copy.borrowed")).state).toBe(state);
  });

  // Reference: selection_test.exs, "a transition shared by two atomic
  // states' ancestor walk appears once".
  // Sabotage: dropping the first-occurrence filter turns this red (the
  // targetless transition would appear once per region).
  it("keeps one occurrence of a transition two atomic states reach", () => {
    const { transitions } = selectTransitions(
      stateWith(machine, ["patron", "accounts", "loans", "loansOpen", "holds", "holdsOpen"]),
      event("patron.notified"),
    );
    expect(transitions).toEqual([transitionNamed(machine, "patron.notified")]);
  });

  // Reference: selection_test.exs, "parallel regions keep non-conflicting
  // transitions" - all three sources survive. Here the order is asserted
  // too: the atomic states are walked in document order, whatever order the
  // configuration holds them in.
  // Sabotage: walking the atomic states in the configuration's own order
  // (dropping the document-order sort) turns this red.
  it("keeps non-conflicting transitions from parallel regions, in document order", () => {
    const state = stateWith(machine, [
      "binderyQueue",
      "bindery",
      "referenceShelved",
      "reference",
      "fictionShelved",
      "fiction",
      "stacks",
    ]);
    const { transitions } = selectTransitions(state, event("stacks.sweep"));
    expect(transitions.map((t) => t.source)).toEqual([
      idx(machine, "fictionShelved"),
      idx(machine, "referenceShelved"),
      idx(machine, "bindery"),
    ]);
  });
});

describe("a failed condition during selection", () => {
  const machine = machineOf(HOLDS);

  // Sabotage: not recording a failed condition turns this red.
  it("raises error.execution naming the transition and is not selected", () => {
    const transition = transitionNamed(machine, "hold.placed", "request");
    const { state, transitions } = selectTransitions(
      stateWith(machine, ["request"]),
      event("hold.placed"),
    );
    expect(transitions).toEqual([]);
    expect(state.internalQueue).toHaveLength(1);
    const [raised] = state.internalQueue;
    expect(raised?.name).toBe("error.execution");
    expect(raised?.type).toBe("platform");
    expect(raised?.cause?.origin).toEqual({ kind: "transition", tIndex: transition.tIndex });
    expect(raised?.reason).toMatchObject({ kind: "evaluator_error", source: "patronBlocked" });
    expect(transition.condLocation).not.toBeNull();
  });

  // Sabotage: letting a failed condition enable its transition turns this red.
  it("raises error.execution for a condition that is not a boolean", () => {
    const { state, transitions } = selectTransitions(
      stateWith(machine, ["count"]),
      event("hold.placed"),
    );
    expect(transitions).toEqual([]);
    expect(state.internalQueue.map((e) => e.reason)).toEqual([
      { kind: "non_boolean_cond", value: 1 },
    ]);
  });

  // Sabotage: stamping the cause with zero counters turns this red.
  it("stamps the cause with the state's counters", () => {
    const { state } = selectTransitions(
      stateWith(machine, ["request"], { macrostep: 3, microstep: 2, round: 1 }),
      event("hold.placed"),
    );
    expect(state.internalQueue[0]?.cause).toMatchObject({ macrostep: 3, microstep: 2, round: 1 });
  });

  // Sabotage: resetting the recorded failures for each atomic state turns this red.
  it("raises every failure in the round, in document order, after what was queued", () => {
    const queued = { name: "notice.queued", type: "internal" as const, data: null };
    const email = transitionNamed(machine, "notice.sent", "email");
    const post = transitionNamed(machine, "notice.sent", "post");
    const { state } = selectTransitions(
      stateWith(machine, ["post", "email", "notices"], { internalQueue: [queued] }),
      event("notice.sent"),
    );
    expect(state.internalQueue.map((e) => e.cause?.origin ?? e.name)).toEqual([
      "notice.queued",
      { kind: "transition", tIndex: email.tIndex },
      { kind: "transition", tIndex: post.tIndex },
    ]);
  });

  // Sabotage: evaluating every transition on a state instead of stopping at
  // the first enabled one turns this red.
  it("raises nothing for a condition the walk never reaches", () => {
    const { state, transitions } = selectTransitions(
      stateWith(machine, ["queue"]),
      event("hold.ready"),
    );
    expect(transitions.map((t) => t.cond)).toEqual([null]);
    expect(state.internalQueue).toEqual([]);
  });

  // Sabotage: not recording a failed condition turns this red.
  it("raises error.execution for an eventless transition's condition", () => {
    const transition = eventlessOf(machine, "waiting");
    const { state, transitions } = selectEventlessTransitions(stateWith(machine, ["waiting"]));
    expect(transitions).toEqual([]);
    expect(state.internalQueue.map((e) => e.cause?.origin)).toEqual([
      { kind: "transition", tIndex: transition.tIndex },
    ]);
  });
});

describe("selectEventlessTransitions", () => {
  const machine = machineOf(DESK);

  // Sabotage: letting the eventless walk take an event-bearing transition,
  // or refusing the eventless one, turns this red.
  it("selects a transition with no event and ignores one with an event", () => {
    const { transitions } = selectEventlessTransitions(stateWith(machine, ["renewal"]));
    expect(transitions).toEqual([eventlessOf(machine, "renewal")]);
  });

  // Sabotage: answering a copy of the state when no condition failed turns this red.
  it("answers the same state when no condition failed", () => {
    const state = stateWith(machine, ["renewal"]);
    expect(selectEventlessTransitions(state).state).toBe(state);
  });

  // Sabotage: letting the eventless walk match event-bearing transitions turns this red.
  it("selects nothing where every transition names an event", () => {
    expect(selectEventlessTransitions(stateWith(machine, ["shelf"])).transitions).toEqual([]);
  });
});

describe("removeConflictingTransitions", () => {
  const machine = machineOf(DESK);
  const wholeLoan = ["loan", "term", "onLoan", "renewed", "fines", "finesNone", "finesDue"];

  // Reference: test/statifier/interpreter/selection_test.exs, "descendant
  // preempts ancestor on conflict, regardless of list order" - the answer
  // is `[t_l]` for both `[t_p, t_l]` and `[t_l, t_p]`. Here `loan.reset` is
  // the reference's p-evt (an internal transition on the outer state) and
  // `term.extend` its l-evt (an internal transition on the child region).
  // Sabotage: swapping the descendant test's arguments turns this red.
  it("lets a descendant-sourced transition preempt an ancestor-sourced one, in either order", () => {
    const state = stateWith(machine, wholeLoan);
    const reset = transitionNamed(machine, "loan.reset");
    const extend = transitionNamed(machine, "term.extend");
    expect(removeConflictingTransitions(state, [reset, extend])).toEqual([extend]);
    expect(removeConflictingTransitions(state, [extend, reset])).toEqual([extend]);
  });

  // Reference: selection_test.exs, "document-order priority on conflict
  // between unrelated sources" - `[t_l1, t_l2]` answers `[t_l1]` and
  // `[t_l2, t_l1]` answers `[t_l2]`: the earlier one wins.
  // Sabotage: letting the later transition win every conflict turns this red.
  it("keeps the earlier of two conflicting transitions from unrelated sources", () => {
    const state = stateWith(machine, ["term", "onLoan", "renewed"]);
    const renew = transitionNamed(machine, "loan.renew");
    const lapse = transitionNamed(machine, "loan.lapse");
    expect(removeConflictingTransitions(state, [renew, lapse])).toEqual([renew]);
    expect(removeConflictingTransitions(state, [lapse, renew])).toEqual([lapse]);
  });

  // Reference: selection_test.exs, "a targetless transition conflicts with
  // nothing" - both survive, in the order given.
  // Sabotage: treating an empty exit set as conflicting with everything turns this red.
  it("lets a targetless transition conflict with nothing", () => {
    const state = stateWith(machine, ["term", "onLoan", "renewed"]);
    const updated = transitionNamed(machine, "catalogue.updated");
    const renew = transitionNamed(machine, "loan.renew");
    expect(removeConflictingTransitions(state, [updated, renew])).toEqual([updated, renew]);
  });

  // Reference: selection_test.exs, "a transition preempted by an earlier one
  // does not itself remove a third" - `[t_l, t_p, t_r]` answers `[t_l, t_r]`.
  // Sabotage: clearing the kept list when a transition is preempted turns this red.
  it("removes nothing on behalf of a transition that was itself preempted", () => {
    const state = stateWith(machine, wholeLoan);
    const extend = transitionNamed(machine, "term.extend");
    const reset = transitionNamed(machine, "loan.reset");
    const clear = transitionNamed(machine, "fines.clear");
    expect(removeConflictingTransitions(state, [extend, reset, clear])).toEqual([extend, clear]);
  });
});

// ---------------------------------------------------------------------------
// Which states a transition leaves
// ---------------------------------------------------------------------------

const ROUTE = `<scxml ${SCXML} initial="route">
  <state id="route" initial="depot">
    <transition event="route.restart" target="route"/>
    <transition event="route.rewind" target="depot" type="internal"/>
    <transition event="route.rescan" target="depot"/>
    <transition event="route.hold"/>
    <transition event="route.resume" target="lastLeg"/>
    <transition event="route.divert" target="warehouse" type="internal"/>
    <history id="lastLeg"><transition target="depot"/></history>
    <state id="depot">
      <transition event="parcel.loaded" target="van" type="internal"/>
    </state>
    <state id="van">
      <transition event="parcel.unloaded" target="warehouse" type="internal"/>
    </state>
  </state>
  <parallel id="doorstep">
    <transition event="doorstep.reset" target="unsigned" type="internal"/>
    <state id="signature">
      <state id="unsigned">
        <transition event="parcel.signed" target="signed"/>
        <transition event="parcel.handed" target="photoTaken"/>
      </state>
      <state id="signed"/>
    </state>
    <state id="photo">
      <state id="noPhoto">
        <transition event="parcel.photographed" target="photoTaken"/>
      </state>
      <state id="photoTaken"/>
    </state>
  </parallel>
  <state id="warehouse">
    <transition event="parcel.split" target="signed photoTaken"/>
  </state>
</scxml>`;

describe("findLCCA", () => {
  const machine = machineOf(ROUTE);

  // Sabotage: accepting a parallel as the common ancestor turns this red
  // (the two regions' states would answer the parallel).
  it("skips a parallel: two regions' states answer the ancestor above it", () => {
    expect(findLCCA(machine, [idx(machine, "unsigned"), idx(machine, "photoTaken")])).toBe(0);
  });

  // Sabotage: testing the candidate as its own descendant (a non-strict
  // range) turns this red (a state and its ancestor would answer the ancestor).
  it("answers the nearest compound ancestor, never a state in the list", () => {
    expect(findLCCA(machine, [idx(machine, "depot"), idx(machine, "van")])).toBe(
      idx(machine, "route"),
    );
    expect(findLCCA(machine, [idx(machine, "depot"), idx(machine, "route")])).toBe(0);
  });

  // Sabotage: answering the root for an empty list turns this red.
  it("answers null where no ancestor qualifies", () => {
    expect(findLCCA(machine, [0])).toBeNull();
    expect(findLCCA(machine, [])).toBeNull();
  });
});

describe("getEffectiveTargetStates", () => {
  const machine = machineOf(ROUTE);
  const resume = transitionNamed(machine, "route.resume");

  // Sabotage: resolving every target as a history target turns this red.
  it("passes a target that is not a history state through, in order", () => {
    const state = stateWith(machine, []);
    expect(getEffectiveTargetStates(state, transitionNamed(machine, "parcel.split"))).toEqual([
      idx(machine, "signed"),
      idx(machine, "photoTaken"),
    ]);
  });

  // Sabotage: ignoring the recorded value turns this red (the default would answer).
  it("resolves a history target to its recorded value", () => {
    const history = idx(machine, "lastLeg");
    const state = stateWith(machine, [], {
      historyValues: new Map([[history, new Set([idx(machine, "van")])]]),
    });
    expect(getEffectiveTargetStates(state, resume)).toEqual([idx(machine, "van")]);
  });

  // Sabotage: answering the history state itself when nothing is recorded turns this red.
  it("resolves an unrecorded history target through its default transition", () => {
    expect(getEffectiveTargetStates(stateWith(machine, []), resume)).toEqual([
      idx(machine, "depot"),
    ]);
  });
});

describe("getTransitionDomain", () => {
  const machine = machineOf(ROUTE);
  const state = stateWith(machine, []);
  const domainOf = (name: string) => getTransitionDomain(state, transitionNamed(machine, name));

  // Sabotage: dropping the empty-targets guard turns this red (the source's
  // own common ancestor would answer).
  it("answers null for a transition with no target", () => {
    expect(domainOf("route.hold")).toBeNull();
  });

  // Sabotage: dropping the internal-transition rule turns this red.
  it("answers the source for an internal transition into its own descendants", () => {
    expect(domainOf("route.rewind")).toBe(idx(machine, "route"));
  });

  // Sabotage: applying the internal rule to an external transition turns this red.
  it("answers the common ancestor for the same targets taken externally", () => {
    expect(domainOf("route.rescan")).toBe(0);
  });

  // Sabotage: reducing the internal rule to the type test alone turns this red.
  it("answers the common ancestor for an internal transition on an atomic state", () => {
    expect(domainOf("parcel.loaded")).toBe(idx(machine, "route"));
  });

  // Sabotage: dropping the compound-source test turns this red (the parallel
  // would answer itself).
  it("answers the common ancestor for an internal transition on a parallel", () => {
    expect(domainOf("doorstep.reset")).toBe(0);
  });

  // Sabotage: dropping the every-target-a-descendant test turns this red.
  it("answers the common ancestor for an internal transition leaving its source", () => {
    expect(domainOf("route.divert")).toBe(0);
  });

  // Sabotage: accepting a parallel as the common ancestor turns this red.
  it("answers the ancestor above a parallel for a transition across its regions", () => {
    expect(domainOf("parcel.handed")).toBe(0);
  });
});

describe("computeExitSet", () => {
  const machine = machineOf(ROUTE);
  const exitOf = (ids: string[], names: string[]) =>
    [
      ...computeExitSet(
        stateWith(machine, ids),
        names.map((name) => transitionNamed(machine, name)),
      ),
    ].sort((a, b) => a - b);
  const indexes = (ids: string[]) => ids.map((id) => idx(machine, id)).sort((a, b) => a - b);

  // Sabotage: taking a targetless transition's domain as its source turns this red.
  it("contributes nothing for a transition with no target", () => {
    expect(exitOf(["route", "van"], ["route.hold"])).toEqual([]);
  });

  // Sabotage: a non-strict descendant test (the domain in its own exit set) turns this red.
  it("exits a compound state and its active descendants on a self-transition", () => {
    expect(exitOf(["route", "van"], ["route.restart"])).toEqual(indexes(["route", "van"]));
  });

  // Sabotage: dropping the internal-transition rule turns this red (route would exit).
  it("exits only the source's descendants on an internal transition", () => {
    expect(exitOf(["route", "van"], ["route.rewind"])).toEqual(indexes(["van"]));
  });

  // Sabotage: exiting every descendant of the domain, active or not, turns this red.
  it("never exits a state outside the configuration", () => {
    expect(exitOf(["route", "depot"], ["route.rewind"])).toEqual(indexes(["depot"]));
  });

  // Sabotage: exiting the domain's whole subtree turns this red (the regions would meet).
  it("gives two regions' own transitions disjoint exit sets, and unions them", () => {
    const active = ["doorstep", "signature", "unsigned", "photo", "noPhoto"];
    expect(exitOf(active, ["parcel.signed"])).toEqual(indexes(["unsigned"]));
    expect(exitOf(active, ["parcel.photographed"])).toEqual(indexes(["noPhoto"]));
    expect(exitOf(active, ["parcel.signed", "parcel.photographed"])).toEqual(
      indexes(["unsigned", "noPhoto"]),
    );
  });
});

describe("conditionMatch", () => {
  const machine = machineOf(`<scxml ${SCXML}>
    <state id="van">
      <transition event="parcel.check" cond="In('van')" target="depot"/>
      <transition event="parcel.misroute" cond="In('depot')" target="depot"/>
      <transition event="parcel.unknown" cond="In('moon')" target="depot"/>
      <transition event="parcel.left" target="depot"/>
      <transition event="parcel.weighed" cond="weight" target="depot"/>
    </state>
    <state id="depot"/>
  </scxml>`);
  const state = stateWith(machine, ["van"]);
  const matchOf = (name: string) => conditionMatch(state, transitionNamed(machine, name));

  // Sabotage: building In() over an empty configuration turns this red.
  it("answers In() against the state's configuration", () => {
    expect(matchOf("parcel.check")).toEqual({ ok: true, value: true });
    expect(matchOf("parcel.misroute")).toEqual({ ok: true, value: false });
    expect(matchOf("parcel.unknown")).toEqual({ ok: true, value: false });
  });

  // Sabotage: answering false for an absent condition turns this red.
  it("passes a transition with no condition", () => {
    expect(matchOf("parcel.left")).toEqual({ ok: true, value: true });
  });

  // Sabotage: evaluating against an empty datamodel instead of the state's turns this red.
  it("evaluates against the state's datamodel, and answers an unbound name's failure", () => {
    const transition = transitionNamed(machine, "parcel.weighed");
    const bound = stateWith(machine, ["van"], { datamodel: new Map([["weight", true]]) });
    expect(conditionMatch(bound, transition)).toEqual({ ok: true, value: true });
    expect(conditionMatch(state, transition)).toMatchObject({
      ok: false,
      reason: { kind: "evaluator_error", source: "weight" },
    });
  });
});
