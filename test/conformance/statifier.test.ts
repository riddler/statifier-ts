// The statifier case runner: a plain case driven as a scion case is, a host
// case's registered send types handed to the driver and its expected sends
// compared, a planted wrong expected send failing its case, a send the case
// marks failed reported through the driver, the accepts case's check
// compared before it is driven, the exchange with the loopback front
// bounded, and a step's expected position compared with the reference's
// rendering of the exported one.
//
// The cases are the vendored corpus's own; the charts written here are the
// library loan, a returned copy routed to the branch's hold queue, and a
// hold that checks its place in the queue through the Basic HTTP processor.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CorpusCase } from "../../scripts/lib/corpus.mjs";
import { loadSuites } from "../../scripts/lib/corpus.mjs";
import { BASIC_HTTP_EVENT_PROCESSOR } from "../../src/basichttp/index.js";
import { type Chart, compile } from "../../src/compiler.js";
import { type State, start } from "../../src/driver.js";
import {
  comparePosition,
  compareSends,
  EXCHANGE_NOT_SETTLED,
  expectsPosition,
  MAX_EXCHANGE_ROUNDS,
  renderPosition,
  runHostCase,
  runStatifierCase,
  type SendItem,
  setExchangeRoundYield,
} from "./statifier.js";

const statifier = loadSuites().find((suite) => suite.suite === "statifier");

function statifierCase(id: string): CorpusCase {
  const found = statifier?.cases.find((testCase) => testCase.id === `statifier/${id}`);
  if (found === undefined) throw new Error(`no statifier/${id} in the vendored corpus`);
  return found;
}

function expectSends(testCase: CorpusCase): SendItem[] {
  return (testCase.host?.expect_sends ?? []) as SendItem[];
}

function withHost(testCase: CorpusCase, host: Record<string, unknown>): CorpusCase {
  return { ...testCase, host: { ...testCase.host, ...host } };
}

// A loan whose return, carrying the copy's id as the event's data, routes the
// copy to the branch's hold queue through a registered send type.
const RETURN = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="predicator" initial="on_loan">
  <state id="on_loan">
    <transition event="copy.returned" target="returned">
      <send type="library:route" target="hold_queue" event="copy.available">
        <param name="copy_id" expr="_event.data.copy_id"/>
      </send>
    </transition>
  </state>
  <state id="returned"/>
</scxml>`;

function returnCase(sends: readonly SendItem[]): CorpusCase {
  return {
    id: "statifier/library/loan_return_routes_copy",
    suite: "statifier",
    spec: "library",
    conformance: null,
    description: "",
    required_features: ["basic_states", "event_transitions", "send_elements"],
    source: RETURN,
    initial_configuration: ["on_loan"],
    steps: [
      { event: { name: "copy.returned", data: { copy_id: "c-7" } }, configuration: ["returned"] },
    ],
    host: { send_types: ["library:route"], expect_sends: sends },
  };
}

const ROUTED: SendItem = {
  type: "library:route",
  target: "hold_queue",
  event: { name: "copy.available", data: { copy_id: "c-7" } },
};

describe("a statifier case with no host object", () => {
  it("is driven as a scion case is, and passes on its configurations", async () => {
    const testCase = statifierCase("library/patron_checkout_refused_while_owed");
    expect(testCase.host).toBeUndefined();
    expect(await runStatifierCase(testCase)).toEqual({ result: "pass" });
  });

  it("fails a planted wrong configuration, naming both leaf sets", async () => {
    const testCase = statifierCase("library/patron_initial_both_regions");
    const planted = { ...testCase, initial_configuration: ["nowhere"] };
    expect(await runStatifierCase(planted)).toMatchObject({
      result: "fail",
      reason: expect.stringMatching(
        /^the initial configuration: expected active leaf states \[nowhere\], got /,
      ),
    });
  });
});

describe("a statifier case with a host object", () => {
  it("passes when the sends handed to the host are exactly the expected ones", async () => {
    const testCase = statifierCase("send/registered_immediate");
    expect(expectSends(testCase)).toHaveLength(1);
    expect(await runStatifierCase(testCase)).toEqual({ result: "pass" });
  });

  // Sabotage: answering a pass without comparing the handed sends turns this
  // red. It was run and reverted.
  it("fails a planted wrong expected send, naming both lists", async () => {
    const testCase = statifierCase("send/registered_immediate");
    const [sent] = expectSends(testCase);
    const planted = withHost(testCase, {
      expect_sends: [{ ...sent, target: "returned_records" }],
    });
    const outcome = await runStatifierCase(planted);
    expect(outcome).toMatchObject({ result: "fail" });
    expect("reason" in outcome ? outcome.reason : "").toMatch(
      /^expected the sends handed to the host \[.*"target":"returned_records".*\], got \[.*"target":"joined_records".*\]$/,
    );
  });

  // Sabotage: comparing only the length of the two lists turns this red on
  // the swapped order. It was run and reverted.
  it("fails a send missing, a send extra, or two sends out of order", async () => {
    const testCase = statifierCase("library/loan_returned_sends_copy_available");
    const sends = expectSends(testCase);
    expect(sends).toHaveLength(3);
    for (const planted of [sends.slice(0, 2), [...sends, ROUTED], [sends[1], sends[0], sends[2]]]) {
      expect(await runStatifierCase(withHost(testCase, { expect_sends: planted }))).toMatchObject({
        result: "fail",
        reason: expect.stringMatching(/^expected the sends handed to the host /),
      });
    }
    expect(await runStatifierCase(testCase)).toEqual({ result: "pass" });
  });

  // Sabotage: passing no send types to the driver turns this red: the chart
  // finds no `myapp:sink` entry in `_ioprocessors` and rests in `unlisted`.
  // It was run and reverted.
  it("registers the case's send types, so `_ioprocessors` lists them", async () => {
    const testCase = statifierCase("system_variables/registered_ioprocessors");
    expect(await runStatifierCase(testCase)).toEqual({ result: "pass" });
    expect(await runStatifierCase(withHost(testCase, { send_types: [] }))).toEqual({
      result: "fail",
      reason: "the initial configuration: expected active leaf states [listed], got [unlisted]",
    });
  });

  // Sabotage: injecting the step's event with its name only, as the scion
  // drive does, turns this red: the routed send carries no copy id. It was run
  // and reverted.
  it("injects a step's data as the event's payload", async () => {
    expect(await runHostCase(returnCase([ROUTED]))).toEqual({ result: "pass" });
    expect(
      await runHostCase(
        returnCase([{ ...ROUTED, event: { name: "copy.available", data: { copy_id: "c-8" } } }]),
      ),
    ).toMatchObject({ result: "fail" });
  });

  it("writes a delayed send's delay and an author's send id into its item", async () => {
    const testCase = statifierCase("library/hold_queue_head_gets_pickup_timer");
    const [held] = expectSends(testCase);
    expect(held).toMatchObject({ delay_ms: 604800000, send_id: "pickup" });
    expect(await runStatifierCase(testCase)).toEqual({ result: "pass" });
    const { delay_ms: _delay, ...undelayed } = held as SendItem;
    expect(await runStatifierCase(withHost(testCase, { expect_sends: [undelayed] }))).toMatchObject(
      {
        result: "fail",
      },
    );
  });
});

describe("a cancelled send", () => {
  it("agrees when a cancel naming it reached the host", async () => {
    const testCase = statifierCase("send/registered_delayed_cancel");
    expect(expectSends(testCase)[0]?.outcome).toBe("cancelled");
    expect(await runStatifierCase(testCase)).toEqual({ result: "pass" });
  });

  // Sabotage: marking every delayed send the expectation asks for, whether a
  // cancel reached it or not, turns this red. It was run and reverted.
  it("disagrees when its item says cancelled and no cancel reached it", async () => {
    const testCase = statifierCase("library/hold_queue_head_gets_pickup_timer");
    const [held] = expectSends(testCase);
    const planted = withHost(testCase, { expect_sends: [{ ...held, outcome: "cancelled" }] });
    expect(await runStatifierCase(planted)).toMatchObject({
      result: "fail",
      reason: expect.stringMatching(/^expected the sends handed to the host /),
    });
  });

  it("is not compared when its item claims nothing about a cancel", async () => {
    const testCase = statifierCase("send/registered_delayed_cancel");
    const [held] = expectSends(testCase);
    const { outcome: _outcome, ...unmarked } = held as SendItem;
    expect(await runStatifierCase(withHost(testCase, { expect_sends: [unmarked] }))).toEqual({
      result: "pass",
    });
  });
});

describe("a send the host reports failed", () => {
  // Sabotage: the runner not reporting the marked send (`takeFailed`
  // answering an empty list), or not marking its item failed, turns this red.
  it("is reported through the driver, and the sender takes the transition naming its sendid", async () => {
    const testCase = statifierCase("send/registered_send_failed");
    expect(expectSends(testCase)[0]?.outcome).toBe("fail");
    expect(await runStatifierCase(testCase)).toEqual({ result: "pass" });
  });

  // The pass is not vacuous: the same case with its item claiming nothing
  // about a failure is not reported, and the chart rests where the send left
  // it, so it is the report that moves the chart to the state the case expects.
  it("is not reported when its item claims nothing, so the pass rests on the report", async () => {
    const testCase = statifierCase("send/registered_send_failed");
    const [failing] = expectSends(testCase);
    const { outcome: _outcome, ...unmarked } = failing as SendItem;
    expect(await runStatifierCase(withHost(testCase, { expect_sends: [unmarked] }))).toEqual({
      result: "fail",
      reason:
        'step 1 (event "copy.available"): expected active leaf states [notice_failed], got [notifying]',
    });
  });
});

describe("the accepts case", () => {
  const ID = "accepts/loan_declares_an_unreachable_event";

  function expectAccepts(testCase: CorpusCase): { unreachable: string[]; undeclared: string[] } {
    return testCase.host?.expect_accepts as { unreachable: string[]; undeclared: string[] };
  }

  // Sabotage: `checkAccepts` keeping the descriptors that DO match a declared
  // name in `undeclared` turns this red. It was run and reverted.
  it("passes: the check answers the expected lists before the case is driven", async () => {
    expect(await runStatifierCase(statifierCase(ID))).toEqual({ result: "pass" });
  });

  // The pass is not vacuous: the runner compares the check's two lists with
  // the expected ones, order included, before the case is driven, as the
  // reference's harness does, so an expectation the check does not answer
  // fails the case naming both.
  it("fails an expectation the check does not answer, order included", async () => {
    const testCase = statifierCase(ID);
    const { unreachable, undeclared } = expectAccepts(testCase);
    const reordered = { unreachable, undeclared: [...undeclared].reverse() };
    expect(await runStatifierCase(withHost(testCase, { expect_accepts: reordered }))).toEqual({
      result: "fail",
      reason:
        'expected the accepts check {"undeclared":["dispute.resolved","loan.lost","loan.due","loan.due_soon","copy.disputed"],"unreachable":["loan.archived"]}, got {"undeclared":["copy.disputed","loan.due_soon","loan.due","loan.lost","dispute.resolved"],"unreachable":["loan.archived"]}',
    });
    const reachable = { unreachable: [], undeclared };
    expect(await runStatifierCase(withHost(testCase, { expect_accepts: reachable }))).toMatchObject(
      {
        result: "fail",
        reason: expect.stringMatching(/^expected the accepts check /),
      },
    );
  });

  // The declaration is what the check reads: declaring every name the chart
  // listens for leaves nothing undeclared, so the expected lists no longer
  // agree.
  it("reads the case's declared events", async () => {
    const testCase = statifierCase(ID);
    const declared = [
      "loan.renew",
      "copy.returned",
      "loan.archived",
      "copy.disputed",
      "loan.due_soon",
      "loan.due",
      "loan.lost",
      "dispute.resolved",
    ];
    expect(await runStatifierCase(withHost(testCase, { declared_events: declared }))).toEqual({
      result: "fail",
      reason:
        'expected the accepts check {"undeclared":["copy.disputed","loan.due_soon","loan.due","loan.lost","dispute.resolved"],"unreachable":["loan.archived"]}, got {"undeclared":[],"unreachable":["loan.archived"]}',
    });
  });

  // Sabotage: comparing the check only when both keys are present, and
  // otherwise driving the case, turns this red. It was run and reverted.
  it("fails either key without the other, as the reference's harness does", async () => {
    const testCase = statifierCase(ID);
    const { declared_events, expect_accepts, ...rest } = testCase.host ?? {};
    expect(await runStatifierCase({ ...testCase, host: { ...rest, declared_events } })).toEqual({
      result: "fail",
      reason: "declared_events is present without expect_accepts",
    });
    expect(await runStatifierCase({ ...testCase, host: { ...rest, expect_accepts } })).toEqual({
      result: "fail",
      reason: "expect_accepts is present without declared_events",
    });
    expect(await runStatifierCase({ ...testCase, host: rest })).toEqual({ result: "pass" });
  });
});

describe("a diff case", () => {
  const diff = statifier?.cases.filter((testCase) => testCase.spec === "diff") ?? [];

  // Sabotage: failing a case that carries `to_source` before it is driven, as
  // this runner did before, turns this red. It was run and reverted.
  it("is driven as any other host case, and passes on its configurations and sends", async () => {
    expect(diff).toHaveLength(10);
    for (const testCase of diff) {
      expect(Object.hasOwn(testCase.host ?? {}, "to_source"), testCase.id).toBe(true);
      expect(await runStatifierCase(testCase), testCase.id).toEqual({ result: "pass" });
    }
  });

  // Sabotage: answering a pass without comparing the initial configuration
  // turns this red. It was run and reverted.
  it("fails a planted wrong configuration, so the pass is not vacuous", async () => {
    for (const testCase of diff) {
      const planted = { ...testCase, initial_configuration: ["nowhere"] };
      expect(await runStatifierCase(planted), testCase.id).toMatchObject({
        result: "fail",
        reason: expect.stringMatching(
          /^the initial configuration: expected active leaf states \[nowhere\], got /,
        ),
      });
    }
  });

  // Sabotage: answering a pass without comparing the handed sends turns this
  // red. It was run and reverted.
  it("fails a planted extra expected send, so the pass is not vacuous", async () => {
    for (const testCase of diff) {
      const planted = withHost(testCase, { expect_sends: [...expectSends(testCase), ROUTED] });
      expect(await runStatifierCase(planted), testCase.id).toMatchObject({
        result: "fail",
        reason: expect.stringMatching(/^expected the sends handed to the host /),
      });
    }
  });

  // The four diff keys are compared by the reference's own test suite, never
  // by its runner, so changing them changes nothing here.
  it("compares none of the four diff keys, as the reference's runner compares none", async () => {
    for (const testCase of diff) {
      const planted = withHost(testCase, {
        to_source: "<scxml/>",
        mapping: { nowhere: "elsewhere" },
        expect_diff: { class: "breaking", reasons: [] },
        expect_compatible_at: !testCase.host?.expect_compatible_at,
      });
      expect(await runStatifierCase(planted), testCase.id).toEqual({ result: "pass" });
    }
  });
});

describe("the comparison of the handed sends", () => {
  it("ignores the order of an item's keys and keeps the order of the list", () => {
    const reordered = { event: ROUTED.event, target: ROUTED.target, type: ROUTED.type };
    expect(compareSends([ROUTED], [reordered])).toBeNull();
    expect(compareSends([ROUTED, reordered], [ROUTED])).toMatch(
      /^expected the sends handed to the host /,
    );
  });
});

// A hold that checks its place in the queue by sending itself `hold.checked`
// through the Basic HTTP processor, once on entry and again on every check
// it takes until it has made `checks` of them; with `checks` null it never
// stops. Each check comes back on its own round of the exchange.
function holdCase(checks: number | null): CorpusCase {
  const again = checks === null ? "" : ` cond="checks &lt; ${checks}"`;
  const source = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="predicator" initial="waiting">
  <datamodel>
    <data id="checks" expr="0"/>
  </datamodel>
  <state id="waiting">
    <onentry>
      <assign location="checks" expr="checks + 1"/>
      <send event="hold.checked" type="basichttp" targetexpr="_ioprocessors['basichttp']['location']"/>
    </onentry>
    <transition event="hold.checked"${again} target="waiting"/>
    <transition event="hold.checked" target="ready"/>
  </state>
  <state id="ready"/>
</scxml>`;
  return {
    id: "statifier/library/hold_checks_its_place",
    suite: "statifier",
    spec: "library",
    conformance: null,
    description: "",
    required_features: ["basic_states", "event_transitions", "send_elements"],
    source,
    initial_configuration: [checks === null ? "waiting" : "ready"],
    steps: [],
    host: { event_io_processors: [BASIC_HTTP_EVENT_PROCESSOR] },
  };
}

describe("the exchange with the loopback front", () => {
  // Each round of an exchange here yields to the timer queue, so a round
  // count gone wrong fails on the test's own timeout rather than holding the
  // run: the settles run on the job queue alone, and without the yield no
  // timer, the timeout included, could end one.
  beforeAll(() => {
    setExchangeRoundYield(() => new Promise((resolve) => setTimeout(resolve, 0)));
  });
  afterAll(() => {
    setExchangeRoundYield(null);
  });

  // Sabotage: halving the bound turns this red. It was run and reverted.
  it("names its bound in the reason a case past it fails with", () => {
    expect(MAX_EXCHANGE_ROUNDS).toBe(100);
    expect(EXCHANGE_NOT_SETTLED).toBe(
      "the exchange with the loopback front did not settle within 100 rounds",
    );
  });

  // Sabotage: dropping the bound turns this red on the test's own timeout
  // rather than holding the run. It was run and reverted. The test below is
  // the one a dropped bound turns red on an assertion.
  it("fails a chart that sends to itself through the processor on every delivery, rather than holding the run", async () => {
    expect(await runHostCase(holdCase(null))).toEqual({
      result: "fail",
      reason: EXCHANGE_NOT_SETTLED,
    });
  });

  // Sabotage: dropping the bound turns this red on the fail, and failing the
  // round that reaches the bound rather than the one past it turns it red on
  // the pass. Each was run and reverted.
  it("hands on every round up to the bound, and fails the first round past it", async () => {
    expect(await runHostCase(holdCase(MAX_EXCHANGE_ROUNDS))).toEqual({ result: "pass" });
    expect(await runHostCase(holdCase(MAX_EXCHANGE_ROUNDS + 1))).toEqual({
      result: "fail",
      reason: EXCHANGE_NOT_SETTLED,
    });
    expect(await runHostCase(holdCase(2))).toEqual({ result: "pass" });
  });

  // Sabotage: dropping the exchange's await of the round yield turns this red.
  // It was run and reverted.
  it("lets a timer fire while an exchange runs, so a run that never settles meets the test's timeout", async () => {
    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 0);
    expect(await runHostCase(holdCase(2))).toEqual({ result: "pass" });
    expect(fired).toBe(true);
  });
});

// The corpus's position cases, each stating the position after its steps.
const POSITION_CASES = [
  "library/loan_position_counts_renewals",
  "library/loan_position_records_history",
  "library/patron_position_in_every_region",
];

// The case with every stated position passed through `change`.
function withPositions(
  testCase: CorpusCase,
  change: (position: Record<string, unknown>) => Record<string, unknown>,
): CorpusCase {
  return {
    ...testCase,
    steps: testCase.steps.map((corpusStep) =>
      corpusStep.expect_position === undefined
        ? corpusStep
        : {
            ...corpusStep,
            expect_position: change({ ...(corpusStep.expect_position as object) }),
          },
    ),
  };
}

function chartOf(source: string): Chart {
  const compiled = compile(source);
  if (!compiled.ok)
    throw new Error(`the chart did not compile: ${JSON.stringify(compiled.errors)}`);
  return compiled.chart;
}

function started(chart: Chart): State {
  const result = start(chart, { sessionId: "statifier/library/hold_desk" });
  if (!result.ok) throw new Error(`start was refused: ${result.reason}`);
  return result.state;
}

// A hold desk whose datamodel holds a list, a map, a variable with no value
// and a number, beside the system variables every chart carries.
const HOLD_DESK = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="predicator" initial="open">
  <datamodel>
    <data id="queue" expr="['p-2', 'p-1']"/>
    <data id="copy" expr="{id: 'c-4', branch: 'main', holds: ['h-1']}"/>
    <data id="notice"/>
    <data id="position" expr="2"/>
  </datamodel>
  <state id="open"><transition event="hold.placed" target="held"/></state>
  <state id="held"/>
</scxml>`;

// A hold whose datamodel holds a date, a value with no JSON form.
const HOLD_DUE = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="predicator" initial="waiting">
  <datamodel><data id="due_on" expr="#2026-10-21#"/></datamodel>
  <state id="waiting"><transition event="hold.ready" target="ready"/></state>
  <state id="ready"/>
</scxml>`;

function holdDueCase(source: string): CorpusCase {
  return {
    id: "statifier/library/hold_due_on",
    suite: "statifier",
    spec: "library",
    conformance: null,
    description: "",
    required_features: ["basic_states", "data_elements", "datamodel", "event_transitions"],
    source,
    initial_configuration: ["waiting"],
    steps: [
      {
        event: { name: "hold.ready" },
        configuration: ["ready"],
        expect_position: {
          configuration: ["ready"],
          entered_states: ["ready", "waiting"],
          states_to_invoke: [],
          history_values: {},
          active_invocations: [],
          running: true,
          datamodel: {},
        },
      },
    ],
  };
}

describe("a step's expected position", () => {
  it("is stated by the corpus's position cases, and each passes", async () => {
    for (const id of POSITION_CASES) {
      const testCase = statifierCase(id);
      expect(expectsPosition(testCase), id).toBe(true);
      expect(await runStatifierCase(testCase), id).toEqual({ result: "pass" });
    }
  });

  // Sabotage: answering a pass without comparing a step's position turns
  // this red on every case. It was run and reverted.
  it("fails each position case whose stated running flag is inverted, naming the step and the member", async () => {
    for (const id of POSITION_CASES) {
      const planted = withPositions(statifierCase(id), (position) => ({
        ...position,
        running: !position.running,
      }));
      const first = statifierCase(id).steps.findIndex((corpusStep) =>
        Object.hasOwn(corpusStep, "expect_position"),
      );
      const event = statifierCase(id).steps[first]?.event.name;
      expect(await runStatifierCase(planted), id).toEqual({
        result: "fail",
        reason: `after step ${first + 1} (${event}), expect_position differs: running: expected false, but got true`,
      });
    }
  });

  // Sabotage: routing a case with no host object to the scion runner's
  // drive, which reads no position, turns this red. It was run and reverted.
  it("drives a case with no host object through the host-case drive, so its position is compared", async () => {
    const testCase = statifierCase("library/patron_position_in_every_region");
    expect(testCase.host).toBeUndefined();
    const planted = withPositions(testCase, (position) => ({
      ...position,
      datamodel: { patron_id: "p-2" },
    }));
    expect(await runStatifierCase(planted)).toEqual({
      result: "fail",
      reason:
        'after step 1 (fine.assessed), expect_position differs: datamodel: expected {"patron_id":"p-2"}, but got {"patron_id":"p-1"}',
    });
  });

  it("compares every member exactly: one missing, one extra, or a list out of order", async () => {
    const testCase = statifierCase("library/patron_position_in_every_region");
    const missing = withPositions(testCase, ({ running: _running, ...rest }) => rest);
    expect(await runStatifierCase(missing)).toMatchObject({
      result: "fail",
      reason:
        "after step 1 (fine.assessed), expect_position differs: running: expected nothing, but got true",
    });
    const extra = withPositions(testCase, (position) => ({ ...position, round: 0 }));
    expect(await runStatifierCase(extra)).toMatchObject({
      result: "fail",
      reason:
        "after step 1 (fine.assessed), expect_position differs: round: expected 0, but got nothing",
    });
    const reversed = withPositions(testCase, (position) => ({
      ...position,
      configuration: [...(position.configuration as string[])].reverse(),
    }));
    expect(await runStatifierCase(reversed)).toMatchObject({
      result: "fail",
      reason: expect.stringMatching(
        /^after step 1 \(fine\.assessed\), expect_position differs: configuration: expected \["waiting",.*\], but got \["desk",.*\]$/,
      ),
    });
  });

  // Sabotage: dropping the id check, so the export's own refusal answers
  // after the drive, turns this red. It was run and reverted.
  it("fails a case whose document has a state without an id before it is driven, as the reference does", async () => {
    const unnamed = HOLD_DUE.replace('<state id="ready"/>', '<state id="ready"><state/></state>');
    expect(await runStatifierCase(holdDueCase(unnamed))).toEqual({
      result: "fail",
      reason:
        "a case that expects a position needs every state to carry an id, and 1 state(s) of this document have none",
    });
  });

  // Sabotage: rendering a value with no JSON form through `toHost`, as an
  // object, turns this red. It was run and reverted.
  it("refuses a datamodel value with no JSON form, naming the variable, rather than comparing it", async () => {
    expect(await runStatifierCase(holdDueCase(HOLD_DUE))).toEqual({
      result: "fail",
      reason:
        "after step 1 (hold.ready), expect_position cannot be compared: the datamodel's due_on holds a date value, which has no JSON form here",
    });
  });
});

describe("the rendering of a position", () => {
  // Sabotage: keeping `_sessionid` in the rendered datamodel turns this red.
  // It was run and reverted.
  it("leaves out the system variables and writes each value in its JSON form", () => {
    const rendered = renderPosition(started(chartOf(HOLD_DESK)));
    expect(rendered).toEqual({
      ok: true,
      rendering: {
        configuration: ["open"],
        entered_states: ["open"],
        states_to_invoke: [],
        history_values: {},
        active_invocations: [],
        running: true,
        datamodel: {
          copy: { branch: "main", holds: ["h-1"], id: "c-4" },
          notice: null,
          position: 2,
          queue: ["p-2", "p-1"],
        },
      },
    });
  });

  // Sabotage: keeping the invocations in the order the state holds them
  // turns this red. It was run and reverted.
  it("writes each active invocation as its state and index, sorted, without its id", () => {
    const state: State = {
      ...started(chartOf(HOLD_DESK)),
      activeInvocations: [
        { state: "open", invokeIndex: 1, invokeId: "open.inv_2" },
        { state: "held", invokeIndex: 0, invokeId: "held.inv_3" },
        { state: "open", invokeIndex: 0, invokeId: "open.inv_1" },
      ],
    };
    const rendered = renderPosition(state);
    expect(rendered.ok && rendered.rendering.active_invocations).toEqual([
      { state: "held", index: 0 },
      { state: "open", index: 0 },
      { state: "open", index: 1 },
    ]);
  });

  it("answers the export's refusal as the reason, and the comparison names the step", () => {
    const state: State = {
      ...started(chartOf(HOLD_DESK)),
      internalQueue: [{ name: "hold.placed" }] as unknown as State["internalQueue"],
    };
    expect(renderPosition(state)).toEqual({
      ok: false,
      reason: "the export refused the position: internal_queue_not_empty",
    });
    expect(comparePosition({}, state, 2, "hold.placed")).toBe(
      "after step 2 (hold.placed), expect_position cannot be compared: the export refused the position: internal_queue_not_empty",
    );
  });
});
