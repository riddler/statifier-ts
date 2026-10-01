// The registry check: a gate stage that holds this package's conformance
// registry - which corpus cases it claims to pass - to the reference's rules.
//
//   tsx scripts/registry-check.mjs [--root <conformance dir>]
//
// It runs the five checks listed under "The check" in the reference's
// `conformance/RATCHET.md`, each a hard failure naming what it caught: the pin
// (the registry's corpus_hash is the vendored manifest's); rule 1 (every
// entry's case is in the pinned corpus, under the suite the entry names); the
// claims (exactly the sorted set of claim names the entries count toward); the
// ratchet (every entry's case passes when run today, so it runs every suite of
// the corpus through the conformance runner); and rule 3 (there is a corpus to
// read and a case run). It also fails when the file is not in the reference's
// encoding, which is what a hand edit that reflows or reorders it looks like.
//
// Until the ratchet writes a first entry this package claims nothing: the
// registry then carries the pin, no claims and no entries, and this check says
// that no claim is made rather than reporting a checked claim. From the first
// entry on, a registry with claims and no entries is refused.
//
// It runs under tsx rather than node because the runner it drives is
// TypeScript.

import { resolve } from "node:path";
import { runSuite } from "../test/conformance/runner.ts";
import {
  CONFORMANCE_ROOT,
  encodeRegistry,
  loadManifest,
  loadSuites,
  readRegistryText,
  registryFindings,
} from "./lib/corpus.mjs";

function readArguments(argv) {
  if (argv.length === 0) return CONFORMANCE_ROOT;
  if (argv.length === 2 && argv[0] === "--root") return resolve(argv[1]);
  process.stderr.write("usage: tsx scripts/registry-check.mjs [--root <conformance dir>]\n");
  process.exit(2);
}

function main() {
  const root = readArguments(process.argv.slice(2));
  const manifest = loadManifest(root);
  const suites = loadSuites(root, manifest);
  const text = readRegistryText(root);
  const registry = JSON.parse(text);
  const results = suites.flatMap((suite) => runSuite(suite, manifest.corpus_hash).results);

  const { findings, claimMade } = registryFindings({
    registry,
    manifestHash: manifest.corpus_hash,
    suites,
    results,
  });
  if (findings.length === 0 && text !== encodeRegistry(registry)) {
    findings.push("the file is not in the encoding the ratchet writes; it was edited by hand");
  }
  if (findings.length > 0) {
    process.stderr.write(`registry: ${findings.length} findings\n`);
    for (const finding of findings) process.stderr.write(`  - ${finding}\n`);
    process.exit(1);
  }
  const ran = suites.map((suite) => `${suite.suite} ${suite.cases.length}`).join(", ");
  process.stdout.write(`registry: pinned to ${manifest.corpus_hash}; ran ${ran} cases\n`);
  if (!claimMade) {
    process.stdout.write(
      "registry: no claim is made - no entries yet, so nothing is checked as passing\n",
    );
    return;
  }
  process.stdout.write(
    `registry: ${registry.entries.length} entries pass today; claims ${JSON.stringify(registry.claims)}\n`,
  );
}

main();
