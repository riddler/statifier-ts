// Reads the vendored corpus, the provenance record and the registries off
// disk, and recomputes the corpus hash.
//
// The layout is the one the reference's vendoring recipe writes (its
// `conformance/RATCHET.md`, "Vendoring the corpus"), with `DEST` set to
// `conformance/statifier`:
//
//   conformance/statifier/                 the reference's conformance/ at a tag, byte for byte
//   conformance/statifier.vendored.json    the provenance record: repo, tag, sha, corpus_hash
//   conformance/registry.json              this package's registry, outside the copy
//
// Every function takes the conformance root, defaulting to this repository's,
// so a test can point a reader at a copy it has altered.
//
// The rules a reader applies to what it reads are `scripts/lib/corpus-rules.mjs`,
// which reaches nothing outside the language; this module re-exports them so a
// reader that wants the loader and the rules together asks one module for both.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SUITE_ORDER } from "./corpus-rules.mjs";

export * from "./corpus-rules.mjs";

/** The upstream the copy is taken from, as the recipe records it. */
export const REFERENCE_REPO = "https://github.com/riddler/statifier-ex";

/** This repository's conformance root. */
export const CONFORMANCE_ROOT = fileURLToPath(new URL("../../conformance/", import.meta.url));

/** Where the copy lands, relative to the conformance root: the recipe's DEST. */
export const VENDORED_DIR = "statifier";

/** The provenance record, beside the copy: the recipe's "$DEST.vendored.json". */
export const PROVENANCE_FILE = `${VENDORED_DIR}.vendored.json`;

/** This package's registry, outside the copy. */
export const REGISTRY_FILE = "registry.json";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The vendored manifest. */
export function loadManifest(root = CONFORMANCE_ROOT) {
  return readJson(join(root, VENDORED_DIR, "manifest.json"));
}

/** The provenance record. */
export function loadProvenance(root = CONFORMANCE_ROOT) {
  return readJson(join(root, PROVENANCE_FILE));
}

/** This package's registry, parsed. */
export function loadRegistry(root = CONFORMANCE_ROOT) {
  return readJson(join(root, REGISTRY_FILE));
}

/** This package's registry as its file holds it, byte for byte. */
export function readRegistryText(root = CONFORMANCE_ROOT) {
  return readFileSync(join(root, REGISTRY_FILE), "utf8");
}

/** The reference's own registry, inside the copy: its claim, never ours. */
export function loadReferenceRegistry(root = CONFORMANCE_ROOT) {
  return readJson(join(root, VENDORED_DIR, "registry.json"));
}

/**
 * The corpus, suite by suite in the manifest's order: `{ suite, file, cases }`
 * for every suite the manifest lists. A suite file is read whole; the corpus
 * check is where a file the manifest lists but the copy lacks is reported.
 */
export function loadSuites(root = CONFORMANCE_ROOT, manifest = loadManifest(root)) {
  return manifest.suites.map((entry) => {
    const corpus = readJson(join(root, VENDORED_DIR, entry.file));
    return { suite: entry.suite, file: entry.file, cases: corpus.cases };
  });
}

/**
 * The corpus hash recomputed from the copy, exactly as the recipe computes
 * it: `sha256:` and the hex SHA-256 of the bytes of `corpus/<suite>.json`
 * concatenated in suite order - scion, w3c, statifier - skipping a suite with
 * no file. `null` when no corpus file exists, which is a failure for every
 * caller.
 */
export function computeCorpusHash(root = CONFORMANCE_ROOT) {
  const hash = createHash("sha256");
  let files = 0;
  for (const suite of SUITE_ORDER) {
    const path = join(root, VENDORED_DIR, "corpus", `${suite}.json`);
    if (!existsSync(path)) continue;
    hash.update(readFileSync(path));
    files += 1;
  }
  return files === 0 ? null : `sha256:${hash.digest("hex")}`;
}
