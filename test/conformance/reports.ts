// The Node half of the conformance runner: reads the vendored corpus off disk,
// runs the suites asked for, and writes one report per suite under `reports/`.
//
// Reports are build artifacts: `reports/` is ignored by git, nothing reads a
// report from the repository, and the ratchet reads only what a run just
// wrote. The runner itself (`test/conformance/runner.ts`) reaches nothing
// outside the language; everything that touches the filesystem is here.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CaseResult,
  CorpusSuite,
  Registry,
  RegistryEntry,
  SuiteReport,
} from "../../scripts/lib/corpus.mjs";
import {
  CONFORMANCE_ROOT,
  compareEntries,
  indexCases,
  loadManifest,
  loadSuites,
} from "../../scripts/lib/corpus.mjs";
import { type RunCase, runSuite } from "./runner.js";

/** Where reports are written: `reports/` at the repository root. */
export const REPORTS_DIR = fileURLToPath(new URL("../../reports/", import.meta.url));

/** The suites to run: the ones named, in the manifest's order, or all of them. */
export function selectSuites(
  suites: readonly CorpusSuite[],
  names: readonly string[],
): CorpusSuite[] {
  const unknown = names.filter((name) => !suites.some((suite) => suite.suite === name));
  if (unknown.length > 0) {
    throw new Error(`no such suite in the vendored manifest: ${unknown.join(", ")}`);
  }
  return names.length === 0 ? [...suites] : suites.filter((suite) => names.includes(suite.suite));
}

/** Runs the suites named (all when none is) against the vendored corpus. */
export function runVendored(
  names: readonly string[] = [],
  runCase?: RunCase,
  root: string = CONFORMANCE_ROOT,
): SuiteReport[] {
  const manifest = loadManifest(root);
  const suites = selectSuites(loadSuites(root, manifest), names);
  return suites.map((suite) => runSuite(suite, manifest.corpus_hash, runCase));
}

/**
 * Writes each report as `<dir>/<suite>.json` and answers the paths written.
 * Every report already in the directory is removed first, so the directory
 * holds only what this run produced and the ratchet never reads a report left
 * over from an earlier run of another suite.
 */
export function writeReports(reports: readonly SuiteReport[], dir: string = REPORTS_DIR): string[] {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".json")) rmSync(join(dir, name), { force: true });
  }
  return reports.map((report) => {
    const path = join(dir, `${report.suite}.json`);
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    return path;
  });
}

/**
 * What a run found for one case, as a clause a gap line ends with: the reason
 * a fail carries, or that a pass is not recorded yet. No clause when the run
 * did not hold the case.
 */
function runClause(result: CaseResult | undefined): string {
  if (result === undefined) return "";
  return result.result === "pass"
    ? "; this run passed it, and the ratchet has not recorded it"
    : `; this run failed it: ${result.reason}`;
}

function byCaseId(results: readonly CaseResult[]): Map<string, CaseResult> {
  return new Map(results.map((result) => [result.case_id, result]));
}

/**
 * The gap list's lines: each case not yet claimed, with the features it
 * needs in the corpus's own words (its `required_features`, the reference's
 * feature detector's atoms), and, given the results of a run, what that run
 * found: the reason it failed the case, which names a feature this package
 * does not run when the case needs one. A case no suite here holds is named
 * as such.
 *
 * Sabotage: dropping the run's clause from every line turns the runner test
 * that reads a w3c fail's reason off its gap line red. It was run and
 * reverted.
 */
export function gapLines(
  gap: readonly RegistryEntry[],
  suites: readonly CorpusSuite[],
  results: readonly CaseResult[] = [],
): string[] {
  const cases = indexCases(suites);
  const found = byCaseId(results);
  return gap.map((entry) => {
    const testCase = cases.get(entry.case_id);
    if (testCase === undefined) return `${entry.case_id}: not in the vendored corpus`;
    const features = testCase.required_features;
    const needs =
      features.length === 0
        ? `${entry.case_id}: needs no named feature`
        : `${entry.case_id}: needs ${features.join(", ")}`;
    return `${needs}${runClause(found.get(entry.case_id))}`;
  });
}

/**
 * The cases of the suites named that neither registry claims: in the corpus,
 * absent from the reference's registry and from this package's. The gap list
 * is read off the reference's registry, so it never holds these.
 */
export function unclaimedByEither(
  referenceRegistry: Registry,
  registry: Registry,
  suites: readonly CorpusSuite[],
  suiteNames: readonly string[],
): RegistryEntry[] {
  const claimed = new Set(
    [...referenceRegistry.entries, ...registry.entries].map((entry) => entry.case_id),
  );
  return suites
    .filter((suite) => suiteNames.includes(suite.suite))
    .flatMap((suite) => suite.cases)
    .filter((testCase) => !claimed.has(testCase.id))
    .map((testCase) => ({ case_id: testCase.id, suite: testCase.suite }))
    .sort(compareEntries);
}

/**
 * The lines for the cases neither registry claims: each says the reference
 * does not claim it either and, given the results of a run, what that run
 * found.
 *
 * Sabotage: dropping the run's clause from these lines turns the runner test
 * that reads the two reference-unclaimed w3c cases' reasons red. It was run
 * and reverted.
 */
export function unclaimedByEitherLines(
  entries: readonly RegistryEntry[],
  results: readonly CaseResult[] = [],
): string[] {
  const found = byCaseId(results);
  return entries.map(
    (entry) =>
      `${entry.case_id}: the reference's registry does not claim it either${runClause(found.get(entry.case_id))}`,
  );
}
