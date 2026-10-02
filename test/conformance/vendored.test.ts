import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFORMANCE_ROOT,
  computeCorpusHash,
  loadManifest,
  loadProvenance,
  loadReferenceRegistry,
  PROVENANCE_FILE,
  REFERENCE_REPO,
  VENDORED_DIR,
} from "../../scripts/lib/corpus.mjs";

const vendored = join(CONFORMANCE_ROOT, VENDORED_DIR);
const manifest = loadManifest();

// The tag the copy was taken at and what it pins. A refresh to another tag
// rewrites the provenance record, and this test with it, in the same change.
const TAG = "v2.10.0";
const SHA = "c8894aea8b5b000215ea9597ca11de0dd0d89aea";
const CORPUS_HASH = "sha256:127a498eb4b44976bf6b1fe8d39d2c7412a4d31b63c991f2d54dd8a525e4eb1c";

describe("the provenance record", () => {
  it("is the one line the recipe writes: repo, tag, sha, corpus_hash", () => {
    expect(readFileSync(join(CONFORMANCE_ROOT, PROVENANCE_FILE), "utf8")).toBe(
      `${JSON.stringify({ repo: REFERENCE_REPO, tag: TAG, sha: SHA, corpus_hash: CORPUS_HASH })}\n`,
    );
    expect(loadProvenance().repo).toBe("https://github.com/riddler/statifier-ex");
  });
});

describe("the vendored copy", () => {
  it("carries the reference's conformance directory, licences included", () => {
    for (const path of [
      "README.md",
      "RATCHET.md",
      "manifest.json",
      "registry.json",
      "exclusions.json",
      "LICENSES/Apache-2.0.txt",
      "LICENSES/BSD-3-Clause-W3C.txt",
      "schema/case.json",
      "schema/corpus.json",
      "schema/manifest.json",
      "schema/registry.json",
      "schema/exclusions.json",
      "cases",
    ]) {
      expect(existsSync(join(vendored, path)), path).toBe(true);
    }
  });

  // The three suite files, held to the manifest that lists them: each file
  // the manifest names exists, holds its own suite and exactly the case count
  // the manifest gives, every id once under that suite; and their bytes,
  // concatenated in suite order, hash to the manifest's corpus_hash, the
  // provenance record's and the reference registry's.
  it("holds the three suite files the manifest lists, case for case", () => {
    expect(manifest.suites.map((entry) => [entry.suite, entry.file, entry.case_count])).toEqual([
      ["scion", "corpus/scion.json", 119],
      ["w3c", "corpus/w3c.json", 168],
      ["statifier", "corpus/statifier.json", 31],
    ]);
    const hash = createHash("sha256");
    for (const entry of manifest.suites) {
      const bytes = readFileSync(join(vendored, entry.file));
      hash.update(bytes);
      const corpus = JSON.parse(bytes.toString("utf8"));
      expect(corpus.suite).toBe(entry.suite);
      expect(corpus.cases).toHaveLength(entry.case_count);
      const ids = corpus.cases.map((testCase: { id: string }) => testCase.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const testCase of corpus.cases) {
        expect(testCase.suite).toBe(entry.suite);
        expect(testCase.id.startsWith(`${entry.suite}/`)).toBe(true);
      }
    }
    const digest = `sha256:${hash.digest("hex")}`;
    expect(digest).toBe(CORPUS_HASH);
    expect(computeCorpusHash()).toBe(CORPUS_HASH);
    expect(manifest.corpus_hash).toBe(CORPUS_HASH);
    expect(loadProvenance().corpus_hash).toBe(CORPUS_HASH);
    expect(loadReferenceRegistry().corpus_hash).toBe(CORPUS_HASH);
  });
});
