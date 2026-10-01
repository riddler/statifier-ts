// The w3c case runner: a case driven to quiescence and compared, a planted
// wrong configuration failing, an invoke case driven through its child, and a
// case that needs a feature named as not run failing before the drive,
// naming the feature.
//
// The cases are the vendored corpus's own; the one chart written here is
// parcel delivery: a parcel scanned from depot to doorstep.

import { describe, expect, it } from "vitest";
import type { CorpusCase } from "../../scripts/lib/corpus.mjs";
import { loadSuites } from "../../scripts/lib/corpus.mjs";
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
