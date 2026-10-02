// The statifier case runner: a plain case driven as a scion case is, a host
// case's registered send types handed to the driver and its expected sends
// compared, a planted wrong expected send failing its case, a send the case
// marks failed reported through the driver, and the case the host here cannot
// run failing with its reason.
//
// The cases are the vendored corpus's own; the one chart written here is the
// library loan: a returned copy routed to the branch's hold queue.

import { describe, expect, it } from "vitest";
import type { CorpusCase } from "../../scripts/lib/corpus.mjs";
import { loadSuites } from "../../scripts/lib/corpus.mjs";
import {
  compareSends,
  notPorted,
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
  it("is driven as a scion case is, and passes on its configurations", () => {
    const testCase = statifierCase("library/patron_checkout_refused_while_owed");
    expect(testCase.host).toBeUndefined();
    expect(runStatifierCase(testCase)).toEqual({ result: "pass" });
  });

  it("fails a planted wrong configuration, naming both leaf sets", () => {
    const testCase = statifierCase("library/patron_initial_both_regions");
    const planted = { ...testCase, initial_configuration: ["nowhere"] };
    expect(runStatifierCase(planted)).toMatchObject({
      result: "fail",
      reason: expect.stringMatching(
        /^the initial configuration: expected active leaf states \[nowhere\], got /,
      ),
    });
  });
});

describe("a statifier case with a host object", () => {
  it("passes when the sends handed to the host are exactly the expected ones", () => {
    const testCase = statifierCase("send/registered_immediate");
    expect(expectSends(testCase)).toHaveLength(1);
    expect(runStatifierCase(testCase)).toEqual({ result: "pass" });
  });

  // Sabotage: answering a pass without comparing the handed sends turns this
  // red. It was run and reverted.
  it("fails a planted wrong expected send, naming both lists", () => {
    const testCase = statifierCase("send/registered_immediate");
    const [sent] = expectSends(testCase);
    const planted = withHost(testCase, {
      expect_sends: [{ ...sent, target: "returned_records" }],
    });
    const outcome = runStatifierCase(planted);
    expect(outcome).toMatchObject({ result: "fail" });
    expect("reason" in outcome ? outcome.reason : "").toMatch(
      /^expected the sends handed to the host \[.*"target":"returned_records".*\], got \[.*"target":"joined_records".*\]$/,
    );
  });

  // Sabotage: comparing only the length of the two lists turns this red on
  // the swapped order. It was run and reverted.
  it("fails a send missing, a send extra, or two sends out of order", () => {
    const testCase = statifierCase("library/loan_returned_sends_copy_available");
    const sends = expectSends(testCase);
    expect(sends).toHaveLength(3);
    for (const planted of [sends.slice(0, 2), [...sends, ROUTED], [sends[1], sends[0], sends[2]]]) {
      expect(runStatifierCase(withHost(testCase, { expect_sends: planted }))).toMatchObject({
        result: "fail",
        reason: expect.stringMatching(/^expected the sends handed to the host /),
      });
    }
    expect(runStatifierCase(testCase)).toEqual({ result: "pass" });
  });

  // Sabotage: passing no send types to the driver turns this red: the chart
  // finds no `myapp:sink` entry in `_ioprocessors` and rests in `unlisted`.
  // It was run and reverted.
  it("registers the case's send types, so `_ioprocessors` lists them", () => {
    const testCase = statifierCase("system_variables/registered_ioprocessors");
    expect(runStatifierCase(testCase)).toEqual({ result: "pass" });
    expect(runStatifierCase(withHost(testCase, { send_types: [] }))).toEqual({
      result: "fail",
      reason: "the initial configuration: expected active leaf states [listed], got [unlisted]",
    });
  });

  // Sabotage: injecting the step's event with its name only, as the scion
  // drive does, turns this red: the routed send carries no copy id. It was run
  // and reverted.
  it("injects a step's data as the event's payload", () => {
    expect(runHostCase(returnCase([ROUTED]))).toEqual({ result: "pass" });
    expect(
      runHostCase(
        returnCase([{ ...ROUTED, event: { name: "copy.available", data: { copy_id: "c-8" } } }]),
      ),
    ).toMatchObject({ result: "fail" });
  });

  it("writes a delayed send's delay and an author's send id into its item", () => {
    const testCase = statifierCase("library/hold_queue_head_gets_pickup_timer");
    const [held] = expectSends(testCase);
    expect(held).toMatchObject({ delay_ms: 604800000, send_id: "pickup" });
    expect(runStatifierCase(testCase)).toEqual({ result: "pass" });
    const { delay_ms: _delay, ...undelayed } = held as SendItem;
    expect(runStatifierCase(withHost(testCase, { expect_sends: [undelayed] }))).toMatchObject({
      result: "fail",
    });
  });
});

describe("a cancelled send", () => {
  it("agrees when a cancel naming it reached the host", () => {
    const testCase = statifierCase("send/registered_delayed_cancel");
    expect(expectSends(testCase)[0]?.outcome).toBe("cancelled");
    expect(runStatifierCase(testCase)).toEqual({ result: "pass" });
  });

  // Sabotage: marking every delayed send the expectation asks for, whether a
  // cancel reached it or not, turns this red. It was run and reverted.
  it("disagrees when its item says cancelled and no cancel reached it", () => {
    const testCase = statifierCase("library/hold_queue_head_gets_pickup_timer");
    const [held] = expectSends(testCase);
    const planted = withHost(testCase, { expect_sends: [{ ...held, outcome: "cancelled" }] });
    expect(runStatifierCase(planted)).toMatchObject({
      result: "fail",
      reason: expect.stringMatching(/^expected the sends handed to the host /),
    });
  });

  it("is not compared when its item claims nothing about a cancel", () => {
    const testCase = statifierCase("send/registered_delayed_cancel");
    const [held] = expectSends(testCase);
    const { outcome: _outcome, ...unmarked } = held as SendItem;
    expect(runStatifierCase(withHost(testCase, { expect_sends: [unmarked] }))).toEqual({
      result: "pass",
    });
  });
});

describe("a send the host reports failed", () => {
  // Sabotage: the runner not reporting the marked send (`takeFailed`
  // answering an empty list), or not marking its item failed, turns this red.
  it("is reported through the driver, and the sender takes the transition naming its sendid", () => {
    const testCase = statifierCase("send/registered_send_failed");
    expect(expectSends(testCase)[0]?.outcome).toBe("fail");
    expect(runStatifierCase(testCase)).toEqual({ result: "pass" });
  });

  // The pass is not vacuous: the same case with its item claiming nothing
  // about a failure is not reported, and the chart rests where the send left
  // it, so it is the report that moves the chart to the state the case expects.
  it("is not reported when its item claims nothing, so the pass rests on the report", () => {
    const testCase = statifierCase("send/registered_send_failed");
    const [failing] = expectSends(testCase);
    const { outcome: _outcome, ...unmarked } = failing as SendItem;
    expect(runStatifierCase(withHost(testCase, { expect_sends: [unmarked] }))).toEqual({
      result: "fail",
      reason:
        'step 1 (event "copy.available"): expected active leaf states [notice_failed], got [notifying]',
    });
  });
});

describe("what the host here cannot do", () => {
  // Sabotage: running the accepts case as any other host case turns this red.
  // It was run and reverted.
  it("fails the accepts case before it is driven, naming the keys", () => {
    const testCase = statifierCase("accepts/loan_declares_an_unreachable_event");
    expect(runStatifierCase(testCase)).toEqual({
      result: "fail",
      reason:
        "the case's host checks the chart's declared events (declared_events, expect_accepts), and this package does not port the reference's accepts check",
    });
  });
});

describe("a diff case", () => {
  const diff = statifier?.cases.filter((testCase) => testCase.spec === "diff") ?? [];

  // Sabotage: failing a case that carries `to_source` before it is driven, as
  // this runner did before, turns this red. It was run and reverted.
  it("is driven as any other host case, and passes on its configurations and sends", () => {
    expect(diff).toHaveLength(10);
    for (const testCase of diff) {
      expect(Object.hasOwn(testCase.host ?? {}, "to_source"), testCase.id).toBe(true);
      expect(runStatifierCase(testCase), testCase.id).toEqual({ result: "pass" });
    }
    expect(notPorted({ to_source: "", mapping: {}, expect_diff: {} })).toBeNull();
    expect(notPorted({ send_types: [], expect_sends: [] })).toBeNull();
  });

  // Sabotage: answering a pass without comparing the initial configuration
  // turns this red. It was run and reverted.
  it("fails a planted wrong configuration, so the pass is not vacuous", () => {
    for (const testCase of diff) {
      const planted = { ...testCase, initial_configuration: ["nowhere"] };
      expect(runStatifierCase(planted), testCase.id).toMatchObject({
        result: "fail",
        reason: expect.stringMatching(
          /^the initial configuration: expected active leaf states \[nowhere\], got /,
        ),
      });
    }
  });

  // Sabotage: answering a pass without comparing the handed sends turns this
  // red. It was run and reverted.
  it("fails a planted extra expected send, so the pass is not vacuous", () => {
    for (const testCase of diff) {
      const planted = withHost(testCase, { expect_sends: [...expectSends(testCase), ROUTED] });
      expect(runStatifierCase(planted), testCase.id).toMatchObject({
        result: "fail",
        reason: expect.stringMatching(/^expected the sends handed to the host /),
      });
    }
  });

  // The four diff keys are compared by the reference's own test suite, never
  // by its runner, so changing them changes nothing here.
  it("compares none of the four diff keys, as the reference's runner compares none", () => {
    for (const testCase of diff) {
      const planted = withHost(testCase, {
        to_source: "<scxml/>",
        mapping: { nowhere: "elsewhere" },
        expect_diff: { class: "breaking", reasons: [] },
        expect_compatible_at: !testCase.host?.expect_compatible_at,
      });
      expect(runStatifierCase(planted), testCase.id).toEqual({ result: "pass" });
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
