// Records, in this package's conformance registry, the corpus cases a run
// observed to pass.
//
//   node scripts/ratchet.mjs [--reports <dir>]
//
// Its only input is the runner's reports, `reports/<suite>.json` as
// `pnpm conformance` writes them. There is no command that adds a case by id,
// and `conformance/registry.json` is never edited by hand.
//
// It refuses, writing nothing and naming each problem, when there is no report;
// when a report is of another corpus than the vendored manifest's, or is not a
// run of a whole suite in corpus order, or carries a value other than a pass or
// a reasoned fail; and when an entry already recorded did not pass in these
// reports - it never removes an entry to get past one, so the registry only
// grows. Otherwise it writes the union of the recorded entries and the cases
// the reports passed, pinned to the vendored manifest's hash, with exactly the
// claims those entries count toward, in the reference's encoding: the four
// top-level keys in order, the claims on one line, one entry per line, entries
// sorted by suite then case id. A partial claim is legal and is exactly its
// entries.
//
// A run that passed nothing new writes nothing and says so: no claim is made
// by a run that passed no case. When no registry exists yet it writes the one
// state before a first entry - the pin, no claims, no entries.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFORMANCE_ROOT,
  encodeRegistry,
  IMPLEMENTATION,
  loadManifest,
  loadSuites,
  REGISTRY_FILE,
  ratchet,
} from "./lib/corpus.mjs";

const defaultReports = fileURLToPath(new URL("../reports/", import.meta.url));

function readArguments(argv) {
  if (argv.length === 0) return defaultReports;
  if (argv.length === 2 && argv[0] === "--reports") return resolve(argv[1]);
  process.stderr.write("usage: node scripts/ratchet.mjs [--reports <dir>]\n");
  process.exit(2);
}

function refuse(problems) {
  process.stderr.write(`ratchet: refused, nothing written (${problems.length} problems)\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}

function main() {
  const reportsDir = readArguments(process.argv.slice(2));
  const reports = existsSync(reportsDir)
    ? readdirSync(reportsDir)
        .filter((name) => name.endsWith(".json"))
        .sort()
        .map((name) => JSON.parse(readFileSync(join(reportsDir, name), "utf8")))
    : [];
  const manifest = loadManifest();
  const suites = loadSuites(CONFORMANCE_ROOT, manifest);
  const registryPath = join(CONFORMANCE_ROOT, REGISTRY_FILE);
  const present = existsSync(registryPath);
  const registry = present
    ? JSON.parse(readFileSync(registryPath, "utf8"))
    : {
        implementation: IMPLEMENTATION,
        corpus_hash: manifest.corpus_hash,
        claims: [],
        entries: [],
      };

  const outcome = ratchet({ registry, reports, manifestHash: manifest.corpus_hash, suites });
  if (outcome.refusals !== undefined) refuse(outcome.refusals);

  const ran = reports.map((report) => `${report.suite} ${report.results.length}`).join(", ");
  process.stdout.write(`ratchet: reports for ${ran} cases\n`);
  const text = encodeRegistry(outcome.registry);
  if (present && outcome.added.length === 0 && readFileSync(registryPath, "utf8") === text) {
    process.stdout.write(
      `ratchet: the run passed no case the registry lacks; no claim written, the registry keeps its ${registry.entries.length} entries\n`,
    );
    return;
  }
  writeFileSync(registryPath, text);
  process.stdout.write(
    `ratchet: wrote ${REGISTRY_FILE}: ${outcome.added.length} entries added, ${outcome.registry.entries.length} in all, claims ${JSON.stringify(outcome.registry.claims)}\n`,
  );
  for (const entry of outcome.added) process.stdout.write(`  + ${entry.case_id}\n`);
}

main();
