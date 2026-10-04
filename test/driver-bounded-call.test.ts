// One driver call is bounded by the session's round budget,
// `maxMacrostepRounds`: a chart that sends again on every failure its
// processor answers, and a chart that sends itself an event on every event
// it takes, each return from the call with the spent-budget halt rather than
// running without end.
//
// The charts are the library's: a hold notice the branch sends again each
// time the notice fails, and a returns cart a clerk re-shelves one copy at a
// time, sending the cart again after each copy.

import { describe, expect, it } from "vitest";
import { type Chart, compile } from "../src/compiler.js";
import type { BudgetExhausted } from "../src/core/interpreter.js";
import {
  type DriveEffect,
  type DriveResult,
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

function exhausted(effects: readonly DriveEffect[]): BudgetExhausted[] {
  return effects.flatMap((effect) => (effect.kind === "budget_exhausted" ? [effect] : []));
}

// Each failed notice re-enters `notifying`, which sends the notice again.
const NOTICE = chartOf(`<scxml ${SCXML} initial="awaiting_copy" name="notice">
  <state id="awaiting_copy"><transition event="copy.available" target="notifying"/></state>
  <state id="notifying">
    <onentry><send id="notice" type="library:notice" target="patron:ada" event="hold.ready"/></onentry>
    <transition event="error.communication" target="notifying"/>
    <transition event="patron.collected" target="collected"/>
  </state>
  <final id="collected"/>
</scxml>`);

// A notice processor that fails the first `failures` notices it is handed
// and takes every one after them, counting what it was handed. The cap keeps
// a call the bound does not stop finite, so a missing bound fails the
// assertions rather than hanging the suite.
function notices(failures: number): {
  readonly handed: () => number;
  readonly processor: SendProcessor;
} {
  let handed = 0;
  return {
    handed: () => handed,
    processor: {
      deliver: () => {
        handed += 1;
        return handed <= failures
          ? { kind: "failure", reason: "no route to patron:ada" }
          : undefined;
      },
    },
  };
}

const CAP = 50;

describe("a call over a chart that sends again on every failed delivery", () => {
  // Sabotage: raising every failure the call meets, whatever the count (the
  // budget check in `handOff` removed), turns this red: the processor is
  // handed the notice until the cap, and the call answers no halt.
  it("returns with the budget_exhausted halt once the failures it raised spend the budget", () => {
    const desk = notices(CAP);
    const options = { sendTypes: { "library:notice": desk.processor } };
    const started = ok(start(NOTICE, { sessionId: "hold-ada", maxMacrostepRounds: 5, ...options }));
    const stepped = ok(step(NOTICE, started.state, { name: "copy.available" }, options));
    // Five failures raised and run, the sixth queued and not run.
    expect(desk.handed()).toBe(6);
    expect(stepped.state.halted).toBe("budget_exhausted");
    expect(stepped.state.configuration).toEqual(["notifying"]);
    expect(stepped.state.internalQueue.map((event) => [event.name, event.sendid])).toEqual([
      ["error.communication", "notice"],
    ]);
    const [halt, ...more] = exhausted(stepped.effects);
    expect(more).toEqual([]);
    expect(halt?.budget).toBe(5);
    expect(halt?.pendingInternalEvents.map((event) => event.name)).toEqual(["error.communication"]);
    expect(stepped.effects[stepped.effects.length - 1]?.kind).toBe("budget_exhausted");
    expect(viaJson(stepped.state)).toEqual(stepped.state);
  });

  // Sabotage: counting the failures against one less than the budget turns
  // this red: the fifth failure is queued and the call halts.
  it("leaves a call whose failures stay within the budget as it was", () => {
    const desk = notices(5);
    const options = { sendTypes: { "library:notice": desk.processor } };
    const started = ok(start(NOTICE, { sessionId: "hold-ada", maxMacrostepRounds: 5, ...options }));
    const stepped = ok(step(NOTICE, started.state, { name: "copy.available" }, options));
    expect(desk.handed()).toBe(6);
    expect(stepped.state.halted).toBeNull();
    expect(stepped.state.internalQueue).toEqual([]);
    expect(exhausted(stepped.effects)).toEqual([]);
  });

  // Sabotage: answering the spent-budget effect for every failure past the
  // budget, rather than the first, turns this red.
  it("queues every failure past the budget and answers the halt once", () => {
    const twice = chartOf(`<scxml ${SCXML} initial="awaiting_copy" name="notice">
      <state id="awaiting_copy"><transition event="copy.available" target="notifying"/></state>
      <state id="notifying">
        <onentry>
          <send id="notice" type="library:notice" target="patron:ada" event="hold.ready"/>
          <send id="reminder" type="library:notice" target="patron:ada" event="hold.reminder"/>
        </onentry>
        <transition event="error.communication" target="notifying"/>
      </state>
    </scxml>`);
    const desk = notices(CAP);
    const options = { sendTypes: { "library:notice": desk.processor } };
    const started = ok(start(twice, { sessionId: "hold-ada", maxMacrostepRounds: 3, ...options }));
    const stepped = ok(step(twice, started.state, { name: "copy.available" }, options));
    expect(stepped.state.halted).toBe("budget_exhausted");
    expect(exhausted(stepped.effects)).toHaveLength(1);
    // Three failures raised and run; the five after them queued, each send handed once.
    expect(stepped.state.internalQueue.map((event) => event.sendid)).toEqual([
      "reminder",
      "notice",
      "reminder",
      "notice",
      "reminder",
    ]);
    expect(desk.handed()).toBe(8);
  });

  // Sabotage: bounding an "infinity" budget as a number (the check made to
  // read it as zero) turns this red.
  it("keeps a call under the infinity budget unbounded", () => {
    const desk = notices(20);
    const options = { sendTypes: { "library:notice": desk.processor } };
    const started = ok(
      start(NOTICE, { sessionId: "hold-ada", maxMacrostepRounds: "infinity", ...options }),
    );
    const stepped = ok(step(NOTICE, started.state, { name: "copy.available" }, options));
    expect(desk.handed()).toBe(21);
    expect(stepped.state.halted).toBeNull();
  });
});

// Each `shelve` re-shelves one copy and sends the cart itself `shelve` again,
// until the cap the datamodel counts to: a cap the bound does not reach
// first ends the call with no halt.
const CART = chartOf(`<scxml ${SCXML} initial="returns" name="cart">
  <datamodel><data id="shelved" expr="0"/></datamodel>
  <state id="returns">
    <transition event="shelve" cond="shelved &lt; ${CAP}">
      <assign location="shelved" expr="shelved + 1"/>
      <send event="shelve"/>
    </transition>
  </state>
</scxml>`);

describe("a call over a chart that sends itself an event without end", () => {
  // Sabotage: taking external events without counting them (the budget
  // check in `drain` removed) turns this red: the cart is shelved to the cap
  // and the call answers no halt.
  it("returns with the budget_exhausted halt once the events it took spend the budget", () => {
    const started = ok(start(CART, { sessionId: "cart-1", maxMacrostepRounds: 5 }));
    const stepped = ok(step(CART, started.state, { name: "shelve" }));
    expect(stepped.state.halted).toBe("budget_exhausted");
    // Five events taken: the host's and four the cart sent itself.
    expect(stepped.state.datamodel.shelved).toBe("5");
    expect(stepped.state.externalQueue.map((event) => event.name)).toEqual(["shelve"]);
    const [halt, ...more] = exhausted(stepped.effects);
    expect(more).toEqual([]);
    expect(halt?.budget).toBe(5);
    expect(halt?.pendingInternalEvents).toEqual([]);
    expect(viaJson(stepped.state)).toEqual(stepped.state);
  });

  // Sabotage: counting the events taken against one less than the budget
  // turns this red: the cart halts after four.
  it("leaves a call that takes no more events than the budget as it was", () => {
    const short = chartOf(`<scxml ${SCXML} initial="returns" name="cart">
      <datamodel><data id="shelved" expr="0"/></datamodel>
      <state id="returns">
        <transition event="shelve" cond="shelved &lt; 4">
          <assign location="shelved" expr="shelved + 1"/>
          <send event="shelve"/>
        </transition>
      </state>
    </scxml>`);
    const started = ok(start(short, { sessionId: "cart-1", maxMacrostepRounds: 5 }));
    const stepped = ok(step(short, started.state, { name: "shelve" }));
    expect(stepped.state.halted).toBeNull();
    expect(stepped.state.externalQueue).toEqual([]);
  });
});
