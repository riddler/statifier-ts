// The conformance runner: runs one suite of the corpus and answers a report.
//
// It takes the corpus as data and reaches nothing outside the language - no
// file, no clock, no console - so the same text runs under a server runtime
// and bundled for an engine with no module loader and no filesystem. Reading
// the corpus off disk and writing the report are `test/conformance/reports.ts`'s.
//
// A case result is `pass` or `fail`, and a `fail` carries a reason. There is
// no third value: no skip, no pending, no not-applicable, and the runner never
// shortens the case set it was given. A case the package cannot yet run fails
// with a reason naming what is missing. Today that is every case: the
// interpreter core is not wired to the runner, so every case fails with the
// reason `core not implemented`, and running a case is a function the caller
// may hand in once one exists.

import type {
  CaseResult,
  CorpusCase,
  CorpusSuite,
  SuiteReport,
} from "../../scripts/lib/corpus-rules.d.mts";

/** What running one case answers: a pass, or a fail with its reason. */
export type CaseOutcome =
  | { readonly result: "pass" }
  | { readonly result: "fail"; readonly reason: string };

/** Runs one case. */
export type RunCase = (testCase: CorpusCase) => CaseOutcome;

/** The reason every case fails with while no interpreter core is wired in. */
export const CORE_NOT_IMPLEMENTED = "core not implemented";

/** The case runner used until the interpreter core is wired in. */
export const coreNotImplemented: RunCase = () => ({ result: "fail", reason: CORE_NOT_IMPLEMENTED });

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

/**
 * One case's result. A case runner that throws is a fail carrying what it
 * threw, so one broken case never hides the rest of the suite. A case runner
 * that answers anything but a pass or a reasoned fail is a bug in the runner,
 * and that throws: a third value is never written into a report.
 *
 * Sabotage: passing an unrecognised outcome through as it came turns the
 * runner test that hands in a third value red. It was run and reverted.
 */
function runOne(testCase: CorpusCase, runCase: RunCase): CaseResult {
  let outcome: unknown;
  try {
    outcome = runCase(testCase);
  } catch (error) {
    return {
      case_id: testCase.id,
      suite: testCase.suite,
      result: "fail",
      reason: `the run threw: ${messageOf(error)}`,
    };
  }
  const answer = outcome as { result?: unknown; reason?: unknown } | null;
  if (answer !== null && typeof answer === "object") {
    if (answer.result === "pass")
      return { case_id: testCase.id, suite: testCase.suite, result: "pass" };
    if (answer.result === "fail" && typeof answer.reason === "string" && answer.reason !== "") {
      return { case_id: testCase.id, suite: testCase.suite, result: "fail", reason: answer.reason };
    }
  }
  throw new Error(
    `${testCase.id}: the case runner answered ${JSON.stringify(outcome)}, which is neither a pass nor a fail with a reason`,
  );
}

/**
 * Runs every case of one suite, in corpus order, and answers the report: the
 * corpus hash it is a run of, the suite, and one result per case.
 */
export function runSuite(
  suite: CorpusSuite,
  corpusHash: string,
  runCase: RunCase = coreNotImplemented,
): SuiteReport {
  return {
    implementation: "statifier-ts",
    corpus_hash: corpusHash,
    suite: suite.suite,
    results: suite.cases.map((testCase) => runOne(testCase, runCase)),
  };
}
