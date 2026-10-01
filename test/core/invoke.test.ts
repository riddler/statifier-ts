// The invoke passes: invocations started at the end of a stable macrostep,
// their ids and `idlocation`, an argument that fails, the cancel when the
// invoking state exits, `<finalize>` before selection, autoforward, and what
// the core does with a `done.invoke` event that arrives from an invocation.
//
// The charts are the library loan: a loan that, while open, invokes a patron
// notice and a branch transfer. Where a case ports one of the reference's own
// tests, the test file and the test name at statifier-ex v2.9.0 are quoted
// above it, with the answer the reference asserts. The core starts no child:
// every case reads the effects and the state, never a running child.

import { Undefined, type Value } from "@riddler/predicator";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compiler.js";
import type { TraceFinalizeAutoforward, TraceInvokePass } from "../../src/core/effects.js";
import {
  handleEvent,
  type InterpreterEffect,
  initialize,
  type MachineState,
  type Stepped,
} from "../../src/core/interpreter.js";
import type { Autoforward, Invoke } from "../../src/core/invoke.js";
import { builtInInvokeType } from "../../src/core/invoke.js";
import type { Event } from "../../src/datamodel.js";
import type { Machine } from "../../src/machine.js";

const SCXML = 'xmlns="http://www.w3.org/2005/07/scxml" version="1.0"';

function machineOf(source: string): Machine {
  const result = compile(source);
  if (!result.ok) throw new Error(`fixture does not compile: ${JSON.stringify(result.errors)}`);
  return result.chart.machine;
}

function start(source: string, rounds?: number): Stepped {
  const machine = machineOf(source);
  if (rounds === undefined) return initialize(machine, { sessionId: "desk" });
  return initialize(machine, { sessionId: "desk", maxMacrostepRounds: rounds });
}

function external(name: string, extra: Partial<Event> = {}): Event {
  return { name, type: "external", data: Undefined, ...extra };
}

function deliver(stepped: Stepped, event: Event): Stepped {
  const outcome = handleEvent(stepped.state, event);
  if (!outcome.ok) throw new Error(`refused: ${outcome.reason}`);
  return outcome;
}

function idx(machine: Machine, id: string): number {
  const index = machine.idToIndex.get(id);
  if (index === undefined) throw new Error(`no state ${id}`);
  return index;
}

function invokes(effects: readonly InterpreterEffect[]): Invoke[] {
  return effects.filter((e): e is Invoke => e.kind === "invoke");
}

function forwards(effects: readonly InterpreterEffect[]): Autoforward[] {
  return effects.filter((e): e is Autoforward => e.kind === "autoforward");
}

function active(state: MachineState): [string, string][] {
  return [...state.activeInvocations].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function ids(state: MachineState): string[] {
  const { machine, configuration } = state;
  return [...configuration]
    .filter((index) => index !== 0)
    .map((index) => machine.states[index]?.id ?? `#${index}`)
    .sort();
}

function dm(state: MachineState, root: string): Value | undefined {
  return state.datamodel.get(root);
}

// ---------------------------------------------------------------------------
// The invoke pass: started at the end of the macrostep
// ---------------------------------------------------------------------------

// A loan opens two regions: one notifies the patron, one moves the copy to
// the patron's branch with two invocations.
const OPEN_LOAN = `<scxml ${SCXML} initial="loan">
  <parallel id="loan">
    <onentry><log label="opened"/></onentry>
    <state id="notice">
      <invoke id="patron-notice" type="scxml" src="patron-notice.scxml"/>
    </state>
    <state id="transfer">
      <invoke type="t.transfer.request"/>
      <invoke type="t.transfer.confirm"/>
    </state>
  </parallel>
</scxml>`;

describe("the invoke pass", () => {
  // statifier-ex v2.9.0, test/statifier/interpreter/invoke_pass_test.exs: "the
  // invoke pass emits effects in entry order across states, document order
  // within a state" - alpha's invocation, then beta's two in document order,
  // and the states to invoke cleared.
  // Sabotage: walking the states to invoke in reverse document order in
  // runInvokePass turns this red.
  it("starts invocations in entry order across states and document order within one", () => {
    const { state, effects } = start(OPEN_LOAN);
    const m = state.machine;
    expect(invokes(effects).map((e) => [e.stateIndex, e.invokeIndex, e.type] as const)).toEqual([
      [idx(m, "notice"), 0, "scxml"],
      [idx(m, "transfer"), 0, "t.transfer.request"],
      [idx(m, "transfer"), 1, "t.transfer.confirm"],
    ]);
    expect(state.statesToInvoke.size).toBe(0);
  });

  // Appendix D runs the invoke pass after the macrostep is stable, not as
  // each state is entered, so the effects of the macrostep's rounds come
  // first: here the eventless transition's log.
  // Sabotage: prepending the invoke pass's effects ahead of the macrostep's
  // in mainEventLoop turns this red.
  it("answers the invoke effects after the macrostep's own effects", () => {
    const source = `<scxml ${SCXML} initial="desk">
      <state id="desk"><transition target="loan"><log label="checked out"/></transition></state>
      <state id="loan"><invoke id="notice" type="scxml"/></state>
    </scxml>`;
    const { effects } = start(source);
    expect(effects.map((e) => e.kind)).toEqual(["datamodel_init", "log", "invoke"]);
  });

  // A state entered and left inside one macrostep never reaches the pass:
  // exit drops it from the states to invoke before the macrostep ends.
  // Sabotage: keeping the exit set in the states to invoke in exitStates
  // turns this red.
  it("never starts an invocation whose state was left before the macrostep ended", () => {
    const source = `<scxml ${SCXML} initial="desk">
      <state id="desk">
        <invoke id="desk-notice" type="scxml"/>
        <transition target="shelved"/>
      </state>
      <state id="shelved"><invoke id="shelf-notice" type="scxml"/></state>
    </scxml>`;
    const { state, effects } = start(source);
    expect(invokes(effects).map((e) => e.invokeId)).toEqual(["shelf-notice"]);
    expect(effects.some((e) => e.kind === "cancel_invoke")).toBe(false);
    expect(active(state)).toEqual([[`${idx(state.machine, "shelved")}:0`, "shelf-notice"]]);
  });

  // statifier-ex v2.9.0, invoke_pass_test.exs: "each invoke effect's round
  // matches the machine state's round it was stamped from".
  // Sabotage: stamping `round: 0` on the Invoke effect in invokeOne turns
  // this red.
  it("stamps each invoke with the counters as the pass found them", () => {
    const { state, effects } = start(OPEN_LOAN);
    for (const effect of invokes(effects)) {
      expect([effect.macrostep, effect.microstep, effect.round]).toEqual([
        state.macrostep,
        state.microstep,
        state.round,
      ]);
    }
  });

  // `src` is carried as written and nothing reads what it names; a
  // `<content>` and the `namelist` and `<param>` values are resolved into
  // the effect.
  // Sabotage: answering `params: Undefined` in invokeOne turns this red.
  it("carries src unread, and the resolved params and content", () => {
    const source = `<scxml ${SCXML} initial="loan">
      <datamodel>
        <data id="patron" expr="'p-17'"/>
        <data id="branch" expr="'north'"/>
      </datamodel>
      <state id="loan">
        <invoke id="notice" type="scxml" srcexpr="'notices/' + branch + '.scxml'">
          <param name="patron" expr="patron"/>
          <param name="days" expr="14"/>
        </invoke>
        <invoke id="reminder" type="scxml" namelist="patron branch"/>
        <invoke id="hold" type="scxml"><content expr="{'copy': 'c-3'}"/></invoke>
        <invoke id="slip" type="scxml"><content>  printed   slip </content></invoke>
      </state>
    </scxml>`;
    const [notice, reminder, hold, slip] = invokes(start(source).effects);
    expect(notice).toMatchObject({
      invokeId: "notice",
      src: "notices/north.scxml",
      params: { patron: "p-17", days: 14 },
      content: null,
      autoforward: false,
    });
    expect(reminder?.params).toEqual({ patron: "p-17", branch: "north" });
    expect(hold).toMatchObject({ src: null, params: Undefined, content: { copy: "c-3" } });
    expect(slip?.content).toBe("printed slip");
  });
});

// ---------------------------------------------------------------------------
// The invoke id and idlocation
// ---------------------------------------------------------------------------

describe("the invoke id", () => {
  // statifier-ex v2.9.0, invoke_pass_test.exs: "an author-written id is used
  // verbatim", "a generated id is qualified by the owning state's id" and
  // "the invoke counter is session-global, starts at 1, and advances per
  // generation" - inv-alpha, then beta.inv_1 and beta.inv_2.
  // Sabotage: dropping the state-id qualifier in generateInvokeId turns this red.
  it("uses an author's id as written and qualifies a generated one by its state", () => {
    const { state, effects } = start(OPEN_LOAN);
    expect(invokes(effects).map((e) => e.invokeId)).toEqual([
      "patron-notice",
      "transfer.inv_1",
      "transfer.inv_2",
    ]);
    expect(state.invokeCounter).toBe(2);
  });

  // statifier-ex v2.9.0, invoke_pass_test.exs: "the invoke counter is
  // session-global, starts at 1, and advances per generation"; and
  // cancel_invoke_test.exs: "re-entering a state produces a new invokeid on
  // the next invoke pass".
  // Sabotage: resetting invokeCounter to 0 in beginMacrostep turns this red.
  it("mints a fresh id from the session-wide counter each time a state is entered", () => {
    const source = `<scxml ${SCXML} initial="desk">
      <state id="desk">
        <invoke type="scxml"/>
        <transition event="copy.returned" target="desk"/>
      </state>
    </scxml>`;
    const first = start(source);
    const second = deliver(first, external("copy.returned"));
    expect(invokes(first.effects).map((e) => e.invokeId)).toEqual(["desk.inv_1"]);
    expect(invokes(second.effects).map((e) => e.invokeId)).toEqual(["desk.inv_2"]);
    expect(second.effects.map((e) => e.kind)).toEqual(["cancel_invoke", "invoke"]);
  });

  // statifier-ex v2.9.0, invoke_pass_test.exs: "generating an invoke id twice
  // from the same machine_state is deterministic".
  // Sabotage: seeding invokeCounter from Math.random in newMachineState turns
  // this red.
  it("answers the same ids from the same chart every time", () => {
    const a = invokes(start(OPEN_LOAN).effects).map((e) => e.invokeId);
    const b = invokes(start(OPEN_LOAN).effects).map((e) => e.invokeId);
    expect(a).toEqual(b);
  });

  // statifier-ex v2.9.0, invoke_pass_test.exs: "idlocation writes the
  // generated invoke id into the datamodel".
  // Sabotage: skipping the writeLocation call for idlocation in invokeOne
  // turns this red.
  it("writes the id to idlocation, and a later invocation reads it", () => {
    const source = `<scxml ${SCXML} initial="loan">
      <datamodel><data id="noticeId"/></datamodel>
      <state id="loan">
        <invoke idlocation="noticeId" type="scxml"/>
        <invoke id="transfer" type="scxml"><param name="after" expr="noticeId"/></invoke>
      </state>
    </scxml>`;
    const { state, effects } = start(source);
    const [notice, transfer] = invokes(effects);
    expect(notice?.invokeId).toBe("loan.inv_1");
    expect(dm(state, "noticeId")).toBe("loan.inv_1");
    expect(transfer?.params).toEqual({ after: "loan.inv_1" });
  });

  // statifier-ex v2.9.0, interpreter.ex `invoke_one`: the id is minted
  // before idlocation is written, so a write that fails aborts the start
  // with the counter already advanced.
  // Sabotage: answering the abort with the state from before the id was
  // minted in invokeOne turns this red (the sibling becomes loan.inv_1).
  it("aborts the start when idlocation cannot be written, having consumed the id", () => {
    const source = `<scxml ${SCXML} initial="loan">
      <state id="loan">
        <invoke idlocation="nowhere" type="scxml"/>
        <invoke type="scxml"/>
      </state>
    </scxml>`;
    const { state, effects } = start(source);
    expect(invokes(effects).map((e) => [e.invokeIndex, e.invokeId])).toEqual([[1, "loan.inv_2"]]);
    expect(active(state)).toEqual([[`${idx(state.machine, "loan")}:1`, "loan.inv_2"]]);
  });
});

// ---------------------------------------------------------------------------
// An argument that fails
// ---------------------------------------------------------------------------

function errorOrigins(effects: readonly InterpreterEffect[]): unknown[] {
  return effects.flatMap((e) => (e.kind === "log" && e.label === "err" ? [e.value] : []));
}

// The loan logs every error.execution's name, so a test can see that it was
// raised and taken inside the same call.
const ERROR_LOG = `<transition event="error.execution"><log label="err" expr="_event.name"/></transition>`;

describe("an argument that fails", () => {
  // statifier-ex v2.9.0, invoke_pass_test.exs: "a failing typeexpr raises
  // error.execution and produces no effect, but a sibling still does", and "a
  // deferred namelist compile failure raises error.execution with the
  // invoke's origin, and produces no effect, but a sibling still does".
  // Sabotage: resolving the type as null instead of evaluating it in
  // invokeOne turns this red.
  it.each([
    ["a typeexpr", `<invoke typeexpr="missingType"/>`],
    ["a srcexpr", `<invoke type="scxml" srcexpr="missingSrc"/>`],
    ["a param", `<invoke type="scxml"><param name="due" expr="missingDue"/></invoke>`],
    ["a namelist entry that did not compile", `<invoke type="scxml" namelist="&quot;patron"/>`],
    ["a content expr", `<invoke type="scxml"><content expr="missingSlip"/></invoke>`],
  ])(
    "abandons the start on %s, raising error.execution, and the sibling still starts",
    (_, bad) => {
      const source = `<scxml ${SCXML} initial="loan">
      <state id="loan">
        ${bad}
        <invoke id="ok" type="scxml"/>
        ${ERROR_LOG}
      </state>
    </scxml>`;
      const { state, effects } = start(source);
      expect(invokes(effects).map((e) => e.invokeId)).toEqual(["ok"]);
      expect(errorOrigins(effects)).toEqual(["error.execution"]);
      expect(active(state)).toEqual([[`${idx(state.machine, "loan")}:1`, "ok"]]);
      expect(state.invokeCounter).toBe(0);
      expect(state.internalQueue).toEqual([]);
    },
  );

  // The raised event names the failing `<invoke>` by its state and position.
  // Sabotage: naming the origin's invokeIndex 0 for every invocation in
  // invokeOne's abort turns this red.
  it("names the failing invoke as the event's origin", () => {
    const source = `<scxml ${SCXML} initial="loan">
      <state id="loan">
        <invoke id="ok" type="scxml"/>
        <invoke type="scxml"><param name="due" expr="missingDue"/></invoke>
      </state>
    </scxml>`;
    const machine = machineOf(source);
    const begun = initialize(machine, { sessionId: "desk", maxMacrostepRounds: 0 });
    const [raised] = begun.state.internalQueue;
    expect(raised?.name).toBe("error.execution");
    expect(raised?.cause?.origin).toEqual({
      kind: "invoke",
      stateIndex: idx(machine, "loan"),
      invokeIndex: 1,
    });
  });

  // statifier-ex v2.9.0, invoke_pass_test.exs: "the post-invoke re-check
  // handles a raised error.execution inside the same handle_event/2 call".
  // Sabotage: returning from mainEventLoop after the invoke pass without
  // re-checking the internal queue turns this red.
  it("takes the raised error.execution inside the same call", () => {
    const source = `<scxml ${SCXML} initial="desk">
      <state id="desk"><transition event="copy.checked_out" target="loan"/></state>
      <state id="loan">
        <invoke typeexpr="missingType"/>
        <transition event="error.execution" target="desk"/>
      </state>
    </scxml>`;
    const after = deliver(start(source), external("copy.checked_out"));
    expect(ids(after.state)).toEqual(["desk"]);
  });

  // statifier-ex v2.9.0, invoke_pass_test.exs: "the round budget spans invoke
  // re-entries and exhausts rather than looping forever" - one
  // budget_exhausted with budget 5, the chart still running.
  // Sabotage: answering a re-entry's spent budget as a stable macrostep in
  // mainEventLoop turns this red.
  it("spends one round budget across the re-entries two failing states hand each other", () => {
    const source = `<scxml ${SCXML} initial="desk">
      <state id="desk">
        <invoke typeexpr="missingType"/>
        <transition event="error.execution" target="shelf"/>
      </state>
      <state id="shelf">
        <invoke typeexpr="missingType"/>
        <transition event="error.execution" target="desk"/>
      </state>
    </scxml>`;
    const { state, effects } = start(source, 5);
    expect(effects.filter((e) => e.kind === "budget_exhausted")).toMatchObject([{ budget: 5 }]);
    expect(state.running).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Which invocations are live
// ---------------------------------------------------------------------------

describe("a live invocation", () => {
  // Sabotage: dropping the URI without its trailing slash from
  // builtInInvokeType turns this red.
  it.each([
    [null, true],
    ["scxml", true],
    ["http://www.w3.org/TR/scxml/", true],
    ["http://www.w3.org/TR/scxml", true],
    ["http://www.w3.org/TR/scxml/#SCXMLEventProcessor", false],
    ["t.transfer.request", false],
  ])("judges the type %s built in: %s", (type, builtIn) => {
    expect(builtInInvokeType(type)).toBe(builtIn);
  });

  // statifier-ex v2.9.0, invoke_pass_test.exs: "an unsupported static invoke
  // type is absent from invoke_ids and active_invocations, but its
  // Effect.Invoke survives", and cancel_invoke_test.exs: "an invocation with
  // an unsupported type produces no cancel on exit, only its supported
  // sibling does".
  // Sabotage: recording every started invocation live in invokeOne turns
  // this red.
  it("answers an invoke for any type but records only the built-in type live", () => {
    const source = `<scxml ${SCXML} initial="loan">
      <state id="loan">
        <invoke id="courier" type="http://example.com/courier"/>
        <invoke id="notice" type="scxml"/>
        <transition event="copy.returned" target="desk"/>
      </state>
      <state id="desk"/>
    </scxml>`;
    const begun = start(source);
    expect(invokes(begun.effects).map((e) => e.invokeId)).toEqual(["courier", "notice"]);
    expect(active(begun.state)).toEqual([[`${idx(begun.state.machine, "loan")}:1`, "notice"]]);
    const returned = deliver(begun, external("copy.returned"));
    expect(returned.effects.filter((e) => e.kind === "cancel_invoke")).toMatchObject([
      { invokeId: "notice" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The cancel when the invoking state exits
// ---------------------------------------------------------------------------

describe("the cancel on exit", () => {
  // statifier-ex v2.9.0, cancel_invoke_test.exs: "a transition out of an
  // invoking state cancels each invocation after onexit, in document order".
  // Sabotage: putting the cancels ahead of the onexit effects in depart
  // turns this red.
  it("cancels each live invocation after onexit, in document order", () => {
    const source = `<scxml ${SCXML} initial="loan">
      <state id="loan">
        <onexit><log label="closing"/></onexit>
        <invoke id="notice" type="scxml"/>
        <invoke id="transfer" type="scxml"/>
        <transition event="copy.returned" target="desk"/>
      </state>
      <state id="desk"/>
    </scxml>`;
    const returned = deliver(start(source), external("copy.returned"));
    const loan = idx(returned.state.machine, "loan");
    expect(returned.effects).toMatchObject([
      { kind: "log", label: "closing" },
      { kind: "cancel_invoke", invokeId: "notice", stateIndex: loan },
      { kind: "cancel_invoke", invokeId: "transfer", stateIndex: loan },
    ]);
    expect(returned.state.activeInvocations.size).toBe(0);
  });

  // statifier-ex v2.9.0, cancel_invoke_test.exs: "an invocation whose
  // arguments failed produces no cancel on exit".
  // Sabotage: cancelling every compiled invoke of the state, live or not, in
  // cancelInvocationsForState turns this red.
  it("cancels nothing for an invocation that never started", () => {
    const source = `<scxml ${SCXML} initial="loan">
      <state id="loan">
        <invoke type="scxml"><param name="due" expr="missingDue"/></invoke>
        <transition event="copy.returned" target="desk"/>
      </state>
      <state id="desk"/>
    </scxml>`;
    const returned = deliver(start(source), external("copy.returned"));
    expect(returned.effects.some((e) => e.kind === "cancel_invoke")).toBe(false);
  });

  // A transition to a top-level final leaves the invoking state, so its
  // invocation is cancelled on that exit, before the chart answers done.
  // Sabotage: answering no cancels from the call to cancelInvocationsForState
  // in depart turns this red.
  it("cancels a live invocation when a transition stops the chart", () => {
    const source = `<scxml ${SCXML} initial="loan">
      <state id="loan">
        <invoke id="notice" type="scxml"/>
        <transition event="loan.closed" target="closed"/>
      </state>
      <final id="closed"/>
    </scxml>`;
    const closed = deliver(start(source), external("loan.closed"));
    expect(closed.effects.map((e) => e.kind)).toEqual(["cancel_invoke", "done"]);
  });
});

// ---------------------------------------------------------------------------
// <finalize> before selection
// ---------------------------------------------------------------------------

const TWO_NOTICES = `<scxml ${SCXML} initial="loan">
  <datamodel>
    <data id="noticeRan" expr="false"/>
    <data id="transferRan" expr="false"/>
  </datamodel>
  <state id="loan">
    <invoke id="notice" type="scxml">
      <finalize><assign location="noticeRan" expr="true"/><log label="finalized" expr="_event.name"/></finalize>
    </invoke>
    <invoke id="transfer" type="scxml">
      <finalize><assign location="transferRan" expr="true"/></finalize>
    </invoke>
    <transition event="notice.sent" cond="noticeRan" target="noticed"/>
  </state>
  <state id="noticed"/>
</scxml>`;

describe("finalize", () => {
  // statifier-ex v2.9.0, test/statifier/interpreter/finalize_test.exs: "only
  // the matching invocation's finalize runs, and no other's (test234's rule)".
  // Sabotage: running every live invocation's finalize regardless of the
  // event's invokeid in applyInvokePasses turns this red.
  it("runs only the finalize of the invocation the event came from", () => {
    const after = deliver(start(TWO_NOTICES), external("loan.update", { invokeid: "notice" }));
    expect(dm(after.state, "noticeRan")).toBe(true);
    expect(dm(after.state, "transferRan")).toBe(false);
  });

  // statifier-ex v2.9.0, finalize_test.exs: "finalize runs before transition
  // selection".
  // Sabotage: selecting against the state from before the finalize pass in
  // handleEvent turns this red.
  it("runs before selection, so a condition reads what it wrote", () => {
    const after = deliver(start(TWO_NOTICES), external("notice.sent", { invokeid: "notice" }));
    expect(ids(after.state)).toEqual(["noticed"]);
    expect(after.effects.map((e) => e.kind)).toEqual([
      "datamodel_change",
      "log",
      "cancel_invoke",
      "cancel_invoke",
    ]);
  });

  // An event from no invocation runs no finalize.
  // Sabotage: treating an absent invokeid as matching in applyInvokePasses
  // turns this red.
  it("runs no finalize for an event with no invokeid", () => {
    const after = deliver(start(TWO_NOTICES), external("loan.update"));
    expect(dm(after.state, "noticeRan")).toBe(false);
    expect(after.effects).toEqual([]);
  });

  // A finalize's content runs as a block of its own: a failure names the
  // finalize as the owner of the failing node.
  // Sabotage: running the finalize block with an onentry owner in
  // applyFinalize turns this red.
  it("runs a populated finalize as its own block", () => {
    const source = `<scxml ${SCXML} initial="loan">
      <state id="loan">
        <invoke id="notice" type="scxml">
          <finalize><assign location="nowhere" expr="1"/></finalize>
        </invoke>
      </state>
    </scxml>`;
    const begun = start(source);
    const after = handleEvent(
      { ...begun.state, maxMacrostepRounds: 0 },
      external("loan.update", { invokeid: "notice" }),
    );
    if (!after.ok) throw new Error("refused");
    const loan = idx(after.state.machine, "loan");
    expect(after.state.internalQueue.map((e) => e.cause?.origin)).toEqual([
      { kind: "content", cIndex: 0, owner: { kind: "finalize", stateIndex: loan, invokeIndex: 0 } },
    ]);
  });

  // statifier-ex v2.9.0, finalize_test.exs: "an empty <finalize> auto-assigns
  // matching namelist names; an absent one does not", and "an empty
  // <finalize> auto-assigns a matching <param location> target".
  // Sabotage: running an empty finalize as an ordinary (empty) block in
  // applyFinalize turns this red.
  it("writes the returned values back for an empty finalize, and not for an absent one", () => {
    const source = `<scxml ${SCXML} initial="loan">
      <datamodel>
        <data id="dueDate"/>
        <data id="fine"/>
        <data id="branch"/>
      </datamodel>
      <state id="loan">
        <invoke id="renewal" type="scxml" namelist="dueDate"><finalize/></invoke>
        <invoke id="fines" type="scxml">
          <param name="charge" location="fine"/>
          <param name="days" expr="14"/>
          <finalize/>
        </invoke>
        <invoke id="transfer" type="scxml" namelist="branch"/>
      </state>
    </scxml>`;
    const begun = start(source);
    const renewed = deliver(
      begun,
      external("renewal.done", { invokeid: "renewal", data: { dueDate: "2026-10-15" } }),
    );
    expect(dm(renewed.state, "dueDate")).toBe("2026-10-15");
    const charged = deliver(
      begun,
      external("fines.done", { invokeid: "fines", data: { charge: 2, days: 99 } }),
    );
    expect(dm(charged.state, "fine")).toBe(2);
    const moved = deliver(
      begun,
      external("transfer.done", { invokeid: "transfer", data: { branch: "north" } }),
    );
    expect(dm(moved.state, "branch")).toBe(null);
  });

  // Only data that is a map carries named values.
  // Sabotage: reading a list's members by name in autoAssignFinalize (dropping
  // the map check) turns this red.
  it("writes nothing back from data that is not a map", () => {
    const source = `<scxml ${SCXML} initial="loan">
      <datamodel><data id="length"/></datamodel>
      <state id="loan">
        <invoke id="renewal" type="scxml" namelist="length"><finalize/></invoke>
      </state>
    </scxml>`;
    const after = deliver(
      start(source),
      external("renewal.done", { invokeid: "renewal", data: ["a", "b"] }),
    );
    expect(dm(after.state, "length")).toBe(null);
  });

  // statifier-ex v2.9.0, interpreter.ex `auto_assign_finalize`: the value
  // is read with Map.fetch and written as it is, so a returned null is
  // written as null, never as undefined.
  // Sabotage: reading the value as `data[param.name] ?? Undefined` in
  // autoAssignFinalize turns this red.
  it("writes a returned null back as null", () => {
    const source = `<scxml ${SCXML} initial="loan">
      <datamodel><data id="dueDate" expr="'2026-10-15'"/></datamodel>
      <state id="loan">
        <invoke id="renewal" type="scxml" namelist="dueDate"><finalize/></invoke>
      </state>
    </scxml>`;
    const after = deliver(
      start(source),
      external("renewal.done", { invokeid: "renewal", data: { dueDate: null } }),
    );
    expect(dm(after.state, "dueDate")).toBe(null);
  });

  // statifier-ex v2.9.0, interpreter.ex `write_finalize_target`: a write that
  // fails raises error.execution with the finalize as its origin and leaves
  // the other writes standing.
  // Sabotage: stopping at the first failed write in autoAssignFinalize turns
  // this red.
  it("raises error.execution for a write back that fails and keeps the others", () => {
    const source = `<scxml ${SCXML} initial="loan">
      <datamodel><data id="fine"/></datamodel>
      <state id="loan">
        <invoke id="renewal" type="scxml">
          <param name="sealed" location="_sessionid"/>
          <param name="charge" location="fine"/>
          <finalize/>
        </invoke>
      </state>
    </scxml>`;
    const begun = start(source);
    const after = handleEvent(
      { ...begun.state, maxMacrostepRounds: 0 },
      external("renewal.done", { invokeid: "renewal", data: { sealed: "x", charge: 3 } }),
    );
    if (!after.ok) throw new Error("refused");
    expect(dm(after.state, "fine")).toBe(3);
    expect(dm(after.state, "_sessionid")).toBe("desk");
    const loan = idx(after.state.machine, "loan");
    expect(after.state.internalQueue.map((e) => [e.name, e.cause?.origin])).toEqual([
      ["error.execution", { kind: "finalize", stateIndex: loan, invokeIndex: 0 }],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Autoforward
// ---------------------------------------------------------------------------

const FORWARDING = `<scxml ${SCXML} initial="loan">
  <datamodel><data id="noticeRan" expr="false"/></datamodel>
  <state id="loan">
    <invoke id="notice" type="scxml" autoforward="true">
      <finalize><assign location="noticeRan" expr="true"/><log label="finalized"/></finalize>
    </invoke>
    <invoke id="transfer" type="scxml"/>
  </state>
</scxml>`;

describe("autoforward", () => {
  // statifier-ex v2.9.0, finalize_test.exs: "an event with no invokeid
  // triggers no finalize but still autoforwards", and "the autoforward
  // effect's round matches the machine state's round it was stamped from" -
  // round 0, ahead of the macrostep's first round.
  // Sabotage: building the forwarded event from its name alone in
  // applyInvokePasses turns this red.
  it("forwards the external event whole to an invocation that asks for it", () => {
    const begun = start(FORWARDING);
    const event = external("copy.renewed", { data: { days: 7 }, sendid: "s-1" });
    const after = deliver(begun, event);
    expect(dm(after.state, "noticeRan")).toBe(false);
    expect(forwards(after.effects)).toEqual([
      {
        kind: "autoforward",
        invokeId: "notice",
        stateIndex: idx(begun.state.machine, "loan"),
        event,
        macrostep: 2,
        microstep: 0,
        round: 0,
      },
    ]);
  });

  // statifier-ex v2.9.0, finalize_test.exs: "a matching and autoforwarding
  // invocation produces both the datamodel write and Effect.Autoforward".
  // Sabotage: putting the autoforward test in an else of the invokeid test in
  // applyInvokePasses turns this red.
  it("finalizes and forwards an event from the same invocation, finalize first", () => {
    const after = deliver(start(FORWARDING), external("notice.sent", { invokeid: "notice" }));
    expect(dm(after.state, "noticeRan")).toBe(true);
    expect(after.effects.map((e) => e.kind)).toEqual(["datamodel_change", "log", "autoforward"]);
  });

  // An invocation that is not live is never forwarded to.
  // Sabotage: forwarding for every compiled autoforward invoke of the
  // configuration, live or not, turns this red.
  it("forwards nothing to an invocation that never started", () => {
    const source = `<scxml ${SCXML} initial="loan">
      <state id="loan">
        <invoke type="scxml" autoforward="true"><param name="due" expr="missingDue"/></invoke>
        <invoke id="ok" type="scxml"/>
      </state>
    </scxml>`;
    const after = deliver(start(source), external("copy.renewed"));
    expect(forwards(after.effects)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// done.invoke
// ---------------------------------------------------------------------------

describe("done.invoke", () => {
  // statifier-ex v2.9.0, interpreter.ex `handle_event`: the core has no
  // special case for done.invoke. The event a finished invocation sends
  // back is an ordinary external event; its invokeid runs that
  // invocation's finalize before selection, a transition on its name is
  // taken, and the invocation stays live until its state exits. Raising
  // done.invoke when a child finishes is the driver's.
  // Sabotage: forgetting the invocation whose done.invoke arrives (deleting
  // its activeInvocations entry in applyInvokePasses) turns this red.
  it("finalizes, then selects on the done.invoke event, and leaves the invocation live", () => {
    const source = `<scxml ${SCXML} initial="loan">
      <datamodel><data id="outcome"/></datamodel>
      <state id="loan">
        <invoke type="scxml">
          <finalize><assign location="outcome" expr="_event.data.status"/></finalize>
        </invoke>
        <transition event="done.invoke" cond="outcome == 'sent'"><log label="notice" expr="outcome"/></transition>
      </state>
    </scxml>`;
    const begun = start(source);
    const [started] = invokes(begun.effects);
    const invokeId = started?.invokeId ?? "";
    expect(invokeId).toBe("loan.inv_1");
    const done = deliver(
      begun,
      external(`done.invoke.${invokeId}`, { invokeid: invokeId, data: { status: "sent" } }),
    );
    expect(dm(done.state, "outcome")).toBe("sent");
    expect(done.effects).toMatchObject([
      { kind: "datamodel_change", locationPath: ["outcome"], newValue: "sent" },
      { kind: "log", label: "notice", value: "sent" },
    ]);
    expect(active(done.state)).toEqual([[`${idx(done.state.machine, "loan")}:0`, invokeId]]);
  });
});

// ---------------------------------------------------------------------------
// The passes' traces
// ---------------------------------------------------------------------------

function startTraced(source: string): Stepped {
  return initialize(machineOf(source), { sessionId: "desk", trace: true });
}

function passTraces(effects: readonly InterpreterEffect[]): TraceInvokePass[] {
  return effects.filter(
    (e): e is TraceInvokePass => e.kind === "trace" && e.trace === "invoke_pass",
  );
}

function finalizeTraces(effects: readonly InterpreterEffect[]): TraceFinalizeAutoforward[] {
  return effects.filter(
    (e): e is TraceFinalizeAutoforward => e.kind === "trace" && e.trace === "finalize_autoforward",
  );
}

describe("the invoke pass's trace", () => {
  // statifier-ex v2.9.0, lib/statifier/effect/trace/invoke_pass.ex: the
  // states walked, one that owns no <invoke> included, and the ids of the
  // invocations started and left live.
  // Sabotage: listing every invoke effect's id in liveInvokeIds, live or
  // not, turns this red.
  it("names the states walked in entry order and only the invocations left live", () => {
    const { effects, state } = startTraced(OPEN_LOAN);
    const { machine } = state;
    const [pass] = passTraces(effects);
    expect(pass?.stateIndexes).toEqual([
      0,
      idx(machine, "loan"),
      idx(machine, "notice"),
      idx(machine, "transfer"),
    ]);
    expect(pass?.invokeIds).toEqual(["patron-notice"]);
    expect(tags(effects).slice(-5)).toEqual([
      "invoke",
      "invoke",
      "invoke",
      "trace:invoke_pass",
      "trace:macrostep_stable",
    ]);
  });

  // statifier-ex v2.9.0, invoke_pass.ex: "Emitted every time the pass runs,
  // even when both lists are empty".
  // Sabotage: answering nothing for an empty pass in runInvokePass turns
  // this red.
  it("is answered when the pass has no state to walk", () => {
    const begun = startTraced(FORWARDING);
    const next = deliver(begun, external("loan.update"));
    expect(passTraces(next.effects)).toMatchObject([{ stateIndexes: [], invokeIds: [] }]);
  });
});

describe("the finalize and autoforward pass's trace", () => {
  // statifier-ex v2.9.0, lib/statifier/effect/trace/finalize_autoforward.ex:
  // the invocations finalized and forwarded to, after the pass's effects.
  // Sabotage: leaving finalized empty in applyInvokePasses turns this red.
  it("names the invocation finalized and those forwarded to, after the pass's effects", () => {
    const event = external("notice.sent", { invokeid: "notice" });
    const next = deliver(startTraced(FORWARDING), event);
    expect(finalizeTraces(next.effects)).toMatchObject([
      { event, finalized: ["notice"], forwarded: ["notice"] },
    ]);
    expect(tags(next.effects).slice(0, 7)).toEqual([
      "trace:event_dequeued",
      "datamodel_change",
      "log",
      "trace:content_executed",
      "autoforward",
      "trace:finalize_autoforward",
      "trace:transitions_selected",
    ]);
  });

  // statifier-ex v2.9.0, lib/statifier/interpreter.ex, `apply_invoke_passes/2`:
  // with no live invocation the pass still answers its trace, both lists
  // empty.
  // Sabotage: answering nothing in applyInvokePasses's empty short cut turns
  // this red.
  it("is answered with both lists empty when no invocation is live", () => {
    const event = external("copy.returned");
    const next = deliver(
      startTraced(`<scxml ${SCXML} initial="desk"><state id="desk"/></scxml>`),
      event,
    );
    expect(finalizeTraces(next.effects)).toMatchObject([{ event, finalized: [], forwarded: [] }]);
  });
});

function tags(effects: readonly InterpreterEffect[]): string[] {
  return effects.map((e) => (e.kind === "trace" ? `trace:${e.trace}` : e.kind));
}
