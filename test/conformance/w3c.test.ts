// The w3c case runner: a case driven to quiescence and compared, a planted
// wrong configuration failing, an invoke case driven through its child, and a
// case that needs a feature named as not run failing before the drive,
// naming the feature, and a case that names an Event I/O Processor routed to
// the host-case drive and driven through the loopback front, or failing
// before the drive when no registration answers the processor.
//
// The cases are the vendored corpus's own; the two charts written here are
// parcel delivery: a parcel scanned from depot to doorstep.

import { describe, expect, it } from "vitest";
import type { CorpusCase } from "../../scripts/lib/corpus.mjs";
import { loadSuites } from "../../scripts/lib/corpus.mjs";
import { basicHttp } from "../../src/basichttp/index.js";
import {
  EVENT_IO_PROCESSORS,
  type EventIoProcessors,
  LOOPBACK_BASE_URL,
  PROCESSOR_NOT_REGISTERED,
  processorsNotRegistered,
  wireEventIoProcessors,
} from "./loopback.js";
import { FEATURES_NOT_RUN, featuresNotRun, runW3cCase } from "./w3c.js";

const w3c = loadSuites().find((suite) => suite.suite === "w3c");

function w3cCase(id: string): CorpusCase {
  const found = w3c?.cases.find((testCase) => testCase.id === id);
  if (found === undefined) throw new Error(`no ${id} in the vendored corpus`);
  return found;
}

// A depot that starts a courier's session and waits for it to report the
// parcel delivered.
const DEPOT = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="depot">
  <state id="depot">
    <invoke type="http://www.w3.org/TR/scxml/" id="courier">
      <content>
        <scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="out">
          <state id="out"><onentry><send target="#_parent" event="parcel.delivered"/></onentry></state>
        </scxml>
      </content>
    </invoke>
    <transition event="parcel.delivered" target="doorstep"/>
  </state>
  <final id="doorstep"/>
</scxml>`;

function depotCase(features: readonly string[]): CorpusCase {
  return {
    id: "w3c/test9001",
    suite: "w3c",
    spec: "invoke",
    conformance: "mandatory",
    description: "",
    required_features: features,
    source: DEPOT,
    initial_configuration: ["doorstep"],
    steps: [],
  };
}

describe("a w3c case", () => {
  it("passes when the chart, run to quiescence, rests in the expected configuration", async () => {
    const testCase = w3cCase("w3c/test144");
    expect(testCase.steps).toEqual([]);
    expect(testCase.initial_configuration).toEqual(["pass"]);
    expect(await runW3cCase(testCase)).toEqual({ result: "pass" });
  });

  // Sabotage: answering a pass before the comparison is made turns this red.
  // It was run and reverted.
  it("fails a planted wrong configuration, naming both leaf sets", async () => {
    const planted = { ...w3cCase("w3c/test144"), initial_configuration: ["fail"] };
    expect(await runW3cCase(planted)).toEqual({
      result: "fail",
      reason: "the initial configuration: expected active leaf states [fail], got [pass]",
    });
  });

  it("waits out a delayed send under the configuration deadline before it compares", async () => {
    const testCase = w3cCase("w3c/test175");
    expect(testCase.required_features).toContain("send_delay_expressions");
    expect(await runW3cCase(testCase)).toEqual({ result: "pass" });
  });
});

describe("an invoke case", () => {
  // Sabotage: answering `#_parent` from a child with `error.communication`, as
  // the driver did before it ran a child, turns this red: the depot never
  // hears the parcel delivered.
  it("is driven through its child, which answers its parent", async () => {
    expect(await runW3cCase(depotCase(["basic_states", "invoke_elements"]))).toEqual({
      result: "pass",
    });
  });

  it("passes the vendored corpus's own, its child run on the parent's clock", async () => {
    const testCase = w3cCase("w3c/test207");
    expect(testCase.required_features).toContain("invoke_elements");
    expect(await runW3cCase(testCase)).toEqual({ result: "pass" });
  });
});

describe("a feature this package does not run", () => {
  it("is none: invoke, the last, now runs", () => {
    expect(FEATURES_NOT_RUN).toEqual([]);
    expect(featuresNotRun(depotCase(["basic_states", "invoke_elements"]))).toEqual([]);
  });

  it("is judged against the list a caller names", () => {
    const named = ["invoke_elements"];
    expect(featuresNotRun(depotCase(["basic_states", "invoke_elements"]), named)).toEqual([
      "invoke_elements",
    ]);
    expect(featuresNotRun(depotCase(["basic_states"]), named)).toEqual([]);
  });

  // Sabotage: driving the case and answering its pass, without the feature
  // check, turns this red.
  it("fails a case that needs a feature named not run before the drive, naming the feature", async () => {
    expect(
      await runW3cCase(depotCase(["basic_states", "invoke_elements"]), ["invoke_elements"]),
    ).toEqual({
      result: "fail",
      reason: "depends on a feature this package does not run: invoke_elements",
    });
  });
});

const BASIC_HTTP = "http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor";

// A depot that tells itself, through the Basic HTTP processor named by
// `type`, that the parcel was scanned, and waits to hear it back.
function scanCase(type: string): CorpusCase {
  return {
    id: "w3c/test9002",
    suite: "w3c",
    spec: "basichttp",
    conformance: "optional",
    description: "",
    required_features: ["basic_states", "send_elements"],
    source: `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="depot" datamodel="predicator">
  <state id="depot">
    <onentry>
      <send event="parcel.lost" delay="30s"/>
      <send event="parcel.scanned" type="${type}" targetexpr="_ioprocessors['basichttp']['location']">
        <param name="route" expr="9"/>
      </send>
    </onentry>
    <transition event="parcel.scanned" cond="_event.data.route == 9" target="doorstep"/>
    <transition event="*" target="lost"/>
  </state>
  <final id="doorstep"/>
  <final id="lost"/>
</scxml>`,
    initial_configuration: ["doorstep"],
    steps: [],
    host: { event_io_processors: [BASIC_HTTP] },
  };
}

// A registration of the built-in processor whose transport answers every
// request 204 and hands nothing on: the processor runs, and no event comes
// back.
const SILENT: EventIoProcessors = new Map([
  [
    BASIC_HTTP,
    (options) =>
      basicHttp({
        ...options,
        transport: { post: () => Promise.resolve({ kind: "status", status: 204 }) },
      }),
  ],
]);

describe("a w3c case naming an Event I/O Processor", () => {
  it("names the processors read off its host.event_io_processors that the closed set does not hold", () => {
    expect([...EVENT_IO_PROCESSORS.keys()]).toEqual([BASIC_HTTP]);
    expect(processorsNotRegistered(w3cCase("w3c/test509"))).toEqual([]);
    expect(processorsNotRegistered(w3cCase("w3c/test509"), new Map())).toEqual([BASIC_HTTP]);
    expect(processorsNotRegistered(w3cCase("w3c/test144"), new Map())).toEqual([]);
    expect(processorsNotRegistered({ ...depotCase(["basic_states"]), host: {} })).toEqual([]);
  });

  it("fails before the drive when the registration does not hold the processor, naming it", async () => {
    expect(await runW3cCase(w3cCase("w3c/test509"), [], new Map())).toEqual({
      result: "fail",
      reason: `${PROCESSOR_NOT_REGISTERED}: ${BASIC_HTTP}`,
    });
  });

  // Sabotage: skipping the processor check in the host-case drive turns this
  // red: the malformed key reads as naming nothing and the case is driven. It
  // was run and reverted.
  it("names a value that is not a list of URIs whole, so its case fails rather than drives", async () => {
    const malformed = { ...depotCase(["basic_states"]), host: { event_io_processors: BASIC_HTTP } };
    expect(processorsNotRegistered(malformed)).toEqual([JSON.stringify(BASIC_HTTP)]);
    expect(await runW3cCase(malformed)).toEqual({
      result: "fail",
      reason: `${PROCESSOR_NOT_REGISTERED}: ${JSON.stringify(BASIC_HTTP)}`,
    });
  });

  it("is registered under its URI and its short form, each answering with the case's location", () => {
    const wired = wireEventIoProcessors([BASIC_HTTP], () => true);
    if (!wired.ok) throw new Error(wired.reason);
    expect(Object.keys(wired.wire.sendTypes).sort()).toEqual([BASIC_HTTP, "basichttp"].sort());
    for (const processor of Object.values(wired.wire.sendTypes)) {
      expect(processor.ioprocessorsEntry?.("basichttp", { sessionId: "w3c/test509" })).toEqual({
        location: `${LOOPBACK_BASE_URL}/w3c/test509`,
      });
    }
  });

  // Sabotage: making the feature check before routing a host case turns this
  // red on the first assertion: the case fails naming the feature. It was run
  // and reverted.
  it("is routed to the host-case drive, which makes no feature check, as the reference's harness makes none", async () => {
    const testCase = w3cCase("w3c/test509");
    const [feature] = testCase.required_features;
    if (feature === undefined) throw new Error("w3c/test509 names no feature");
    expect(await runW3cCase(testCase, [feature])).toEqual({ result: "pass" });
    const { host: _host, ...hostless } = testCase;
    expect(await runW3cCase(hostless, [feature])).toEqual({
      result: "fail",
      reason: `depends on a feature this package does not run: ${feature}`,
    });
  });

  // Sabotage: stepping nothing the loopback front takes turns this red: the
  // depot never hears the scan and rests in its first state. It was run and
  // reverted.
  it("is driven through the loopback, whichever of the processor's two types the chart names", async () => {
    expect(await runW3cCase(scanCase(BASIC_HTTP))).toEqual({ result: "pass" });
    expect(await runW3cCase(scanCase("basichttp"))).toEqual({ result: "pass" });
  });

  it("passes because the event came back through the front: a front that answers and hands nothing on fails it", async () => {
    expect(await runW3cCase(scanCase(BASIC_HTTP), [], SILENT)).toEqual({
      result: "fail",
      reason: "the initial configuration: expected active leaf states [doorstep], got [depot]",
    });
    expect(await runW3cCase(w3cCase("w3c/test509"), [], SILENT)).toEqual({
      result: "fail",
      reason: "the initial configuration: expected active leaf states [pass], got [s0]",
    });
  });

  // Sabotage: exchanging with the front only once the clock has moved past
  // the call's time turns this red: the three-second timeout fires first. It
  // was run and reverted.
  it("takes the delivered event before a timer the clock has yet to reach", async () => {
    const testCase = w3cCase("w3c/test531");
    expect(testCase.source).toContain('delay="3s"');
    expect(await runW3cCase(testCase)).toEqual({ result: "pass" });
  });
});
