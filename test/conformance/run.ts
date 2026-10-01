// Runs the conformance corpus and writes the reports.
//
//   pnpm conformance [--suite <name>]...
//
// Runs every suite the vendored manifest lists, or only those named, writes
// `reports/<suite>.json` for each, and prints for each suite how many cases
// passed and failed. When the scion suite ran, it prints the position
// round-trip property's counts over it (`test/conformance/position.ts`): the
// points, the round trips that agree, and the points not carried with each
// reason. Then it prints what is not yet claimed: every case the
// reference's registry claims, for the suites run, that this package's
// registry does not, each with the features it needs and the reason this run
// failed it. That list is the distance between this package and the
// reference, read off the two registries; it changes only when the ratchet
// writes an entry here or a refresh moves the corpus. Last it prints the
// cases of the suites run that neither registry claims, each with the reason
// this run failed it.
//
// The exit is 0 whatever the cases answered: a failing case is a report line,
// and what holds a claim is the registry check, not this run.

import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import {
  CONFORMANCE_ROOT,
  IMPLEMENTATION,
  loadManifest,
  loadReferenceRegistry,
  loadRegistry,
  loadSuites,
  REGISTRY_FILE,
  unclaimed,
} from "../../scripts/lib/corpus.mjs";
import { positionLines, runPositionProperty } from "./position.js";
import {
  gapLines,
  runVendored,
  unclaimedByEither,
  unclaimedByEitherLines,
  writeReports,
} from "./reports.js";

function readSuites(argv: readonly string[]): string[] {
  const names: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] !== "--suite" || value === undefined) {
      process.stderr.write("usage: pnpm conformance [--suite <name>]...\n");
      process.exit(2);
    }
    names.push(value);
    index += 1;
  }
  return names;
}

const reports = runVendored(readSuites(process.argv.slice(2)));
const written = writeReports(reports);

for (const [index, report] of reports.entries()) {
  const passed = report.results.filter((result) => result.result === "pass").length;
  const failed = report.results.length - passed;
  const path = relative(process.cwd(), written[index] ?? "");
  process.stdout.write(
    `${report.suite}: ${report.results.length} cases, ${passed} pass, ${failed} fail -> ${path}\n`,
  );
}

const scion = loadSuites().find((suite) => suite.suite === "scion");
if (scion !== undefined && reports.some((report) => report.suite === "scion")) {
  process.stdout.write("\n");
  for (const line of positionLines(runPositionProperty(scion.cases))) {
    process.stdout.write(`${line}\n`);
  }
}

// Before the ratchet has written a registry, this package claims nothing.
const registry = existsSync(join(CONFORMANCE_ROOT, REGISTRY_FILE))
  ? loadRegistry()
  : {
      implementation: IMPLEMENTATION,
      corpus_hash: loadManifest().corpus_hash,
      claims: [],
      entries: [],
    };
const suitesRun = reports.map((report) => report.suite);
const results = reports.flatMap((report) => report.results);
const reference = loadReferenceRegistry();
const gap = unclaimed(reference, registry, suitesRun);
process.stdout.write(
  `\nwhat is not yet claimed: ${gap.length} cases the reference's registry claims and this package's does not (${suitesRun.join(", ")})\n`,
);
for (const line of gapLines(gap, loadSuites(), results)) process.stdout.write(`  ${line}\n`);

const neither = unclaimedByEither(reference, registry, loadSuites(), suitesRun);
process.stdout.write(
  `\nwhat neither registry claims: ${neither.length} cases of the suites run that the reference's registry does not claim either\n`,
);
for (const line of unclaimedByEitherLines(neither, results)) process.stdout.write(`  ${line}\n`);
