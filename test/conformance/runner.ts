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
// with a reason naming what is missing. The scion suite's cases are driven
// through the interpreter by `test/conformance/scion.ts`, the w3c suite's by
// `test/conformance/w3c.ts` and the statifier suite's by
// `test/conformance/statifier.ts`; a case of any other suite fails with the
// reason that its suite is not driven, and running a case is a function the
// caller may hand in instead.
//
// A suite's report is a promise, because a case whose host runs an Event I/O
// Processor settles on the job queue, as its deliveries do. The cases still
// run one after another in corpus order, each settled before the next starts.

import type {
  CaseResult,
  CorpusCase,
  CorpusSuite,
  SuiteReport,
} from "../../scripts/lib/corpus-rules.d.mts";
import { runScionCase } from "./scion.js";
import { runStatifierCase } from "./statifier.js";
import { runW3cCase } from "./w3c.js";

/** What running one case answers: a pass, or a fail with its reason. */
export type CaseOutcome =
  | { readonly result: "pass" }
  | { readonly result: "fail"; readonly reason: string };

/**
 * Runs one case, answering its outcome or a promise of it: a case whose host
 * runs an Event I/O Processor settles on the job queue, as its deliveries do.
 */
export type RunCase = (testCase: CorpusCase) => CaseOutcome | Promise<CaseOutcome>;

/** The reason a case of a suite the runner does not drive yet fails with. */
export function suiteNotDriven(suite: string): string {
  return `the ${suite} suite is not driven: the runner drives the scion, w3c and statifier suites only`;
}

/**
 * The default case runner: a scion, w3c or statifier case is driven through
 * the interpreter, a case of any other suite fails naming its suite.
 *
 * Sabotage: answering the w3c suite with the not-driven reason, as the runner
 * did before, turns the runner test that drives every w3c case red. It was run
 * and reverted.
 *
 * Sabotage: answering the statifier suite with the not-driven reason, as the
 * runner did before, turns the runner test that drives every statifier case
 * red. It was run and reverted.
 */
export const runCorpusCase: RunCase = (testCase) => {
  if (testCase.suite === "scion") return runScionCase(testCase);
  if (testCase.suite === "w3c") return runW3cCase(testCase);
  if (testCase.suite === "statifier") return runStatifierCase(testCase);
  return { result: "fail", reason: suiteNotDriven(testCase.suite) };
};

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
async function runOne(testCase: CorpusCase, runCase: RunCase): Promise<CaseResult> {
  let outcome: unknown;
  try {
    outcome = await runCase(testCase);
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
 * Runs every case of one suite, one after another in corpus order, each
 * settled before the next starts, and answers the report: the corpus hash it
 * is a run of, the suite, and one result per case.
 */
export async function runSuite(
  suite: CorpusSuite,
  corpusHash: string,
  runCase: RunCase = runCorpusCase,
): Promise<SuiteReport> {
  const results: CaseResult[] = [];
  for (const testCase of suite.cases) results.push(await runOne(testCase, runCase));
  return {
    implementation: "statifier-ts",
    corpus_hash: corpusHash,
    suite: suite.suite,
    results,
  };
}
