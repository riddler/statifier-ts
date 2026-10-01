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
import type { CorpusSuite, SuiteReport } from "../../scripts/lib/corpus.mjs";
import { CONFORMANCE_ROOT, loadManifest, loadSuites } from "../../scripts/lib/corpus.mjs";
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
