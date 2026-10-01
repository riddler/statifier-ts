// The w3c case runner: a case driven to quiescence and compared, a planted
// wrong configuration failing, and a case that needs a feature this package
// does not run failing before the drive, naming the feature.
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
// parcel delivered; with no invocation run, nothing ever reports.
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

describe("a feature this package does not run", () => {
  it("is invoke, in the reference's feature name", () => {
    expect(FEATURES_NOT_RUN).toEqual(["invoke_elements"]);
    expect(featuresNotRun(depotCase(["basic_states", "invoke_elements"]))).toEqual([
      "invoke_elements",
    ]);
    expect(featuresNotRun(depotCase(["basic_states"]))).toEqual([]);
  });

  // Sabotage: driving the case and answering the comparison's fail, without
  // the feature, turns this red. It was run and reverted.
  it("fails a case that needs it before the drive, naming the feature", () => {
    expect(runW3cCase(depotCase(["basic_states", "invoke_elements"]))).toEqual({
      result: "fail",
      reason: "depends on a feature this package does not run: invoke_elements",
    });
  });

  it("is not named when the case does not declare it", () => {
    expect(runW3cCase(depotCase(["basic_states"]))).toEqual({
      result: "fail",
      reason: "the initial configuration: expected active leaf states [doorstep], got [depot]",
    });
  });

  // Sabotage: driving a case that needs the feature, as the runner did before
  // the reference's rule was applied, turns this red: the chart rests in
  // `pass` with no invocation run. It was run and reverted.
  it("fails a case that needs it even when the chart would reach its expectation without it", () => {
    const testCase = w3cCase("w3c/test187");
    expect(testCase.required_features).toContain("invoke_elements");
    expect(runW3cCase(testCase)).toEqual({
      result: "fail",
      reason: "depends on a feature this package does not run: invoke_elements",
    });
  });
});
