// The w3c case runner: a case driven to quiescence and compared, a planted
// wrong configuration failing, an invoke case driven through its child, and a
// case that needs a feature named as not run failing before the drive,
// naming the feature, and a case that names an Event I/O Processor no
// registration here answers failing before the drive, naming the processor.
//
// The cases are the vendored corpus's own; the one chart written here is
// parcel delivery: a parcel scanned from depot to doorstep.

import { describe, expect, it } from "vitest";
import type { CorpusCase } from "../../scripts/lib/corpus.mjs";
import { loadSuites } from "../../scripts/lib/corpus.mjs";
import {
  FEATURES_NOT_RUN,
  featuresNotRun,
  PROCESSOR_NOT_REGISTERED,
  PROCESSORS_REGISTERED,
  processorsNotRegistered,
  runW3cCase,
} from "./w3c.js";

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
  it("passes when the chart, run to quiescence, rests in the expected configuration", () => {
    const testCase = w3cCase("w3c/test144");
    expect(testCase.steps).toEqual([]);
    expect(testCase.initial_configuration).toEqual(["pass"]);
    expect(runW3cCase(testCase)).toEqual({ result: "pass" });
  });

  // Sabotage: answering a pass before the comparison is made turns this red.
  // It was run and reverted.
  it("fails a planted wrong configuration, naming both leaf sets", () => {
    const planted = { ...w3cCase("w3c/test144"), initial_configuration: ["fail"] };
    expect(runW3cCase(planted)).toEqual({
      result: "fail",
      reason: "the initial configuration: expected active leaf states [fail], got [pass]",
    });
  });

  it("waits out a delayed send under the configuration deadline before it compares", () => {
    const testCase = w3cCase("w3c/test175");
    expect(testCase.required_features).toContain("send_delay_expressions");
    expect(runW3cCase(testCase)).toEqual({ result: "pass" });
  });
});

describe("an invoke case", () => {
  // Sabotage: answering `#_parent` from a child with `error.communication`, as
  // the driver did before it ran a child, turns this red: the depot never
  // hears the parcel delivered.
  it("is driven through its child, which answers its parent", () => {
    expect(runW3cCase(depotCase(["basic_states", "invoke_elements"]))).toEqual({
      result: "pass",
    });
  });

  it("passes the vendored corpus's own, its child run on the parent's clock", () => {
    const testCase = w3cCase("w3c/test207");
    expect(testCase.required_features).toContain("invoke_elements");
    expect(runW3cCase(testCase)).toEqual({ result: "pass" });
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
  it("fails a case that needs a feature named not run before the drive, naming the feature", () => {
    expect(runW3cCase(depotCase(["basic_states", "invoke_elements"]), ["invoke_elements"])).toEqual(
      {
        result: "fail",
        reason: "depends on a feature this package does not run: invoke_elements",
      },
    );
  });
});

const BASIC_HTTP = "http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor";

describe("an Event I/O Processor this runner does not register", () => {
  it("is every one: none is registered yet", () => {
    expect(PROCESSORS_REGISTERED).toEqual([]);
    expect(PROCESSOR_NOT_REGISTERED).toBe(
      "names an Event I/O Processor this runner does not register",
    );
  });

  it("is read off the case's host.event_io_processors, and a case without the key names none", () => {
    expect(processorsNotRegistered(w3cCase("w3c/test509"))).toEqual([BASIC_HTTP]);
    expect(processorsNotRegistered(w3cCase("w3c/test144"))).toEqual([]);
    expect(processorsNotRegistered({ ...depotCase(["basic_states"]), host: {} })).toEqual([]);
  });

  // Sabotage: naming every processor a case names, whatever the list holds,
  // turns this red. It was run and reverted.
  it("is judged against the list a caller names", () => {
    expect(processorsNotRegistered(w3cCase("w3c/test509"), [BASIC_HTTP])).toEqual([]);
    expect(processorsNotRegistered(w3cCase("w3c/test509"), ["basichttp"])).toEqual([BASIC_HTTP]);
  });

  // Sabotage: answering no processor for a value that is not a list turns this
  // red: the malformed key reads as naming nothing and the case is driven. It
  // was run and reverted.
  it("names a value that is not a list of URIs whole, so its case fails rather than drives", () => {
    const malformed = { ...depotCase(["basic_states"]), host: { event_io_processors: BASIC_HTTP } };
    expect(processorsNotRegistered(malformed)).toEqual([JSON.stringify(BASIC_HTTP)]);
    expect(runW3cCase(malformed)).toEqual({
      result: "fail",
      reason: `${PROCESSOR_NOT_REGISTERED}: ${JSON.stringify(BASIC_HTTP)}`,
    });
  });

  // Sabotage: driving the case without the processor check turns this red:
  // the case then fails on the comparison instead. It was run and reverted.
  it("fails a case that names one before the drive, naming the processor", () => {
    for (const id of ["w3c/test509", "w3c/test577", "w3c/test201"]) {
      expect(runW3cCase(w3cCase(id))).toEqual({
        result: "fail",
        reason: `${PROCESSOR_NOT_REGISTERED}: ${BASIC_HTTP}`,
      });
    }
  });

  it("is checked before the features, and a case whose processor is registered is driven", () => {
    const testCase = w3cCase("w3c/test509");
    const [feature] = testCase.required_features;
    if (feature === undefined) throw new Error("w3c/test509 names no feature");
    expect(runW3cCase(testCase, [feature])).toMatchObject({
      reason: `${PROCESSOR_NOT_REGISTERED}: ${BASIC_HTTP}`,
    });
    expect(runW3cCase(testCase, [feature], [BASIC_HTTP])).toEqual({
      result: "fail",
      reason: `depends on a feature this package does not run: ${feature}`,
    });
    expect(runW3cCase(testCase, [], [BASIC_HTTP])).toMatchObject({
      result: "fail",
      reason: expect.stringMatching(/^the initial configuration: expected active leaf states /),
    });
  });
});
