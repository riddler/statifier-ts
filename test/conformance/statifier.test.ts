// The statifier case runner: a plain case driven as a scion case is, a host
// case's registered send types handed to the driver and its expected sends
// compared, a planted wrong expected send failing its case, a send the case
// marks failed reported through the driver, the accepts case's check
// compared before it is driven, and the exchange with the loopback front
// bounded.
//
// The cases are the vendored corpus's own; the charts written here are the
// library loan, a returned copy routed to the branch's hold queue, and a
// hold that checks its place in the queue through the Basic HTTP processor.

import { describe, expect, it } from "vitest";
import type { CorpusCase } from "../../scripts/lib/corpus.mjs";
import { loadSuites } from "../../scripts/lib/corpus.mjs";
import { BASIC_HTTP_EVENT_PROCESSOR } from "../../src/basichttp/index.js";
import {
  compareSends,
  EXCHANGE_NOT_SETTLED,
  MAX_EXCHANGE_ROUNDS,
  runHostCase,
  runStatifierCase,
  type SendItem,
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
  // Sabotage: halving the bound turns this red. It was run and reverted.
  it("names its bound in the reason a case past it fails with", () => {
    expect(MAX_EXCHANGE_ROUNDS).toBe(100);
    expect(EXCHANGE_NOT_SETTLED).toBe(
      "the exchange with the loopback front did not settle within 100 rounds",
    );
  });

  // Without the bound this test never answers: the exchange runs on the job
  // queue alone, so no timer, the test's own timeout included, can end it.
  // The test below is the one a dropped bound turns red on an assertion.
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
});
