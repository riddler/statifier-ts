// The w3c case runner: drives one case of the w3c suite through the in-memory
// driver and compares what the reference compares.
//
// The reference's harness drives a w3c case exactly as it drives a scion
// case: one function, `test_scxml/4` in `lib/statifier/testing/case.ex` at
// v2.9.0, routes every document of both suites the same way. So this runner
// drives a w3c case through the scion runner's one drive
// (`test/conformance/scion.ts`): compile, start, run to quiescence under the
// virtual clock's two knobs, and compare the active leaf set with the case's
// expectation. Every w3c case of the vendored corpus carries no step and
// expects the `pass` state, so the comparison that decides it is the one made
// after the start, once the chart has run as far as it can.
//
// A case whose chart needs a feature this package does not run yet fails
// before it is driven, naming the feature in the reference's feature names
// (the corpus's `required_features`, the atoms of
// `Statifier.Testing.FeatureDetector`). That is the reference's own rule for
// a feature it does not support: `validate_features!/2` in `case.ex` flunks
// such a document before it starts, "so an unimplemented feature can never
// masquerade as a passing test" (the module's documentation there), and
// ADR-0003 decision 6 carries the rule here. The reference itself runs every
// feature the w3c suite requires (`feature_registry/0` in
// `lib/statifier/testing/feature_detector.ex` marks `invoke_elements`
// supported); this package does not run `<invoke>` yet, so a case that needs
// it is not run at all, even one whose expectation the chart would reach
// without the invocation.
//
// Like the runner, this reaches nothing outside the language.

import type { CorpusCase } from "../../scripts/lib/corpus-rules.d.mts";
import type { CaseOutcome } from "./runner.js";
import { runScionCase } from "./scion.js";

/**
 * The features, in the reference's names, that a w3c chart may need and this
 * package does not run yet. `invoke_elements` is `<invoke>`: no invocation is
 * started, so a child session never runs and never answers.
 */
export const FEATURES_NOT_RUN: readonly string[] = Object.freeze(["invoke_elements"]);

/** The features a case needs that this package does not run, in corpus order. */
export function featuresNotRun(testCase: CorpusCase): string[] {
  return testCase.required_features.filter((feature) => FEATURES_NOT_RUN.includes(feature));
}

/**
 * Runs one w3c case: a fail naming every feature the case needs that this
 * package does not run, before anything is driven; otherwise the drive's pass,
 * or its fail with the comparison's finding.
 */
export function runW3cCase(testCase: CorpusCase): CaseOutcome {
  const missing = featuresNotRun(testCase);
  if (missing.length > 0) {
    return {
      result: "fail",
      reason: `depends on a feature this package does not run: ${missing.join(", ")}`,
    };
  }
  return runScionCase(testCase);
}
