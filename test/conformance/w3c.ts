// The w3c case runner: drives one case of the w3c suite through the in-memory
// driver and compares what the reference compares.
//
// The reference's runner routes a w3c case by whether it carries a `host`
// object, as it routes a statifier case (`run_case/1` in
// `lib/mix/statifier/corpus/runner.ex` at v2.10.0), and this runner routes it
// the same way.
//
// A case with no host object runs through the reference's `test_scxml/4` in
// `lib/statifier/testing/case.ex`, the one function that drives every scion
// document too, so this runner drives it through the scion runner's one drive
// (`test/conformance/scion.ts`): compile, start, run to quiescence under the
// virtual clock's two knobs, and compare the active leaf set with the case's
// expectation. Every w3c case of the vendored corpus carries no step and
// expects the `pass` state, so the comparison that decides it is the one made
// after the start, once the chart has run as far as it can.
//
// Such a case whose chart needs a feature this package does not run fails
// before it is driven, naming the feature in the reference's feature names
// (the corpus's `required_features`, the atoms of
// `Statifier.Testing.FeatureDetector`). That is the reference's own rule for
// a feature it does not support: `validate_features!/2` in `case.ex` flunks
// such a document before it starts, "so an unimplemented feature can never
// masquerade as a passing test" (the module's documentation there), and
// ADR-0003 decision 6 carries the rule here. The reference itself runs every
// feature the w3c suite requires (`feature_registry/0` in
// `lib/statifier/testing/feature_detector.ex` marks `invoke_elements`
// supported), and so does this package now that the driver runs an invoked
// child in process, so no feature is listed and every case is driven. The
// rule stays: a feature added to the list fails every case that needs it
// before the drive.
//
// A case with a host object runs through the reference's host-case harness
// (`Mix.Statifier.Corpus.HostCase.run/2` in
// `lib/mix/statifier/corpus/host_case.ex` at v2.10.0), which never makes the
// feature check, so this runner drives it through the host-case drive
// (`runHostCase` in `test/conformance/statifier.ts`) and makes none either.
// A w3c host object carries one key, `event_io_processors`, naming the Event
// I/O Processors the host runs, by URI (the vendored `RATCHET.md`, "The host
// object"). The drive registers each with a loopback front, as the
// reference's `with_event_io_processors/2` does, under the URI and the short
// form its constructor names it under; the front is in memory here
// (`test/conformance/loopback.ts`). A case naming a processor outside the
// closed set fails before it is driven, naming the processor.
//
// Like the runner, this reaches nothing outside the language.

import type { CorpusCase } from "../../scripts/lib/corpus-rules.d.mts";
import { EVENT_IO_PROCESSORS, type EventIoProcessors } from "./loopback.js";
import type { CaseOutcome } from "./runner.js";
import { runScionCase } from "./scion.js";
import { runHostCase } from "./statifier.js";

/**
 * The features, in the reference's names, that a w3c chart may need and this
 * package does not run yet: none. `invoke_elements`, `<invoke>`, was the last;
 * the driver runs an invoked SCXML child in process.
 */
export const FEATURES_NOT_RUN: readonly string[] = Object.freeze([]);

/**
 * The features a case needs that this package does not run, in corpus order,
 * judged against `notRun` (the package's list unless a caller names another).
 */
export function featuresNotRun(
  testCase: CorpusCase,
  notRun: readonly string[] = FEATURES_NOT_RUN,
): string[] {
  return testCase.required_features.filter((feature) => notRun.includes(feature));
}

/**
 * Runs one w3c case. A case with a host object goes to the host-case drive,
 * with the Event I/O Processors `registered` holds (the closed set unless a
 * caller names another) and no feature check. Any other case fails naming
 * every feature it needs that this package does not run (`notRun`, the
 * package's list unless a caller names another) before anything is driven;
 * otherwise the drive's pass, or its fail with the comparison's finding.
 *
 * Sabotage: making the feature check before routing a host case turns the w3c
 * test that drives a host case past a feature named not run red. It was run
 * and reverted.
 */
export function runW3cCase(
  testCase: CorpusCase,
  notRun: readonly string[] = FEATURES_NOT_RUN,
  registered: EventIoProcessors = EVENT_IO_PROCESSORS,
): CaseOutcome | Promise<CaseOutcome> {
  if (testCase.host !== undefined) return runHostCase(testCase, registered);
  const missing = featuresNotRun(testCase, notRun);
  if (missing.length > 0) {
    return {
      result: "fail",
      reason: `depends on a feature this package does not run: ${missing.join(", ")}`,
    };
  }
  return runScionCase(testCase);
}
