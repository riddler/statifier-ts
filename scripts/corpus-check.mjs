// The corpus check: a gate stage that holds the vendored copy, its provenance
// record and both registries to one corpus hash.
//
//   node scripts/corpus-check.mjs [--root <conformance dir>]
//
// It recomputes the corpus hash from the copy exactly as the reference's
// vendoring recipe does - SHA-256 over the bytes of the corpus files
// concatenated in suite order, scion, w3c, statifier, skipping a suite with no
// file - and requires it to equal each of four fields:
//
//   1. the vendored manifest's corpus_hash;
//   2. the provenance record's corpus_hash, beside the copy;
//   3. this package's registry's corpus_hash, outside the copy;
//   4. the vendored reference registry's corpus_hash, inside the copy.
//
// A mismatch fails naming the field that disagrees, and is never repaired by
// rewriting a hash: an edit to the copy, a record written by hand, a registry
// pinned to another corpus and a reference copy out of step with its own
// manifest all land here. It also fails when the manifest lists a suite file
// the copy lacks or a suite whose case count is not the file's, and when there
// is no corpus file at all. It writes nothing and reads nothing outside the
// conformance directory: no network, no reference checkout.
//
// `--root` points the check at another conformance directory, which is how the
// tests hold it to a copy they have altered.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CONFORMANCE_ROOT,
  computeCorpusHash,
  hashFindings,
  PROVENANCE_FILE,
  REGISTRY_FILE,
  VENDORED_DIR,
} from "./lib/corpus.mjs";

function readArguments(argv) {
  if (argv.length === 0) return CONFORMANCE_ROOT;
  if (argv.length === 2 && argv[0] === "--root") return resolve(argv[1]);
  process.stderr.write("usage: node scripts/corpus-check.mjs [--root <conformance dir>]\n");
  process.exit(2);
}

/** A JSON file's field, or the sentence saying why it cannot be read. */
function readField(path, label, field, problems) {
  if (!existsSync(path)) {
    problems.push(`${label} is missing`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"))[field];
  } catch (error) {
    problems.push(`${label} is not JSON: ${error.message}`);
    return undefined;
  }
}

function main() {
  const root = readArguments(process.argv.slice(2));
  const problems = [];
  const vendored = join(root, VENDORED_DIR);
  const manifestPath = join(vendored, "manifest.json");

  const fields = [
    [
      "the vendored manifest's corpus_hash",
      readField(manifestPath, "the vendored manifest", "corpus_hash", problems),
    ],
    [
      "the provenance record's corpus_hash",
      readField(join(root, PROVENANCE_FILE), "the provenance record", "corpus_hash", problems),
    ],
    [
      "this package's registry's corpus_hash",
      readField(join(root, REGISTRY_FILE), "this package's registry", "corpus_hash", problems),
    ],
    [
      "the vendored reference registry's corpus_hash",
      readField(
        join(vendored, "registry.json"),
        "the vendored reference registry",
        "corpus_hash",
        problems,
      ),
    ],
  ];

  const computed = computeCorpusHash(root);
  problems.push(...hashFindings(computed, fields));

  const suites = readField(manifestPath, "the vendored manifest", "suites", []) ?? [];
  for (const entry of suites) {
    const path = join(vendored, entry.file);
    if (!existsSync(path)) {
      problems.push(`the manifest lists ${entry.file}, which the copy lacks`);
      continue;
    }
    const cases = JSON.parse(readFileSync(path, "utf8")).cases;
    if (cases.length !== entry.case_count) {
      problems.push(
        `${entry.file} holds ${cases.length} cases, the manifest says ${entry.case_count}`,
      );
    }
  }

  if (problems.length > 0) {
    process.stderr.write(`corpus:check: ${problems.length} problems\n`);
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.exit(1);
  }
  const counts = suites.map((entry) => `${entry.suite} ${entry.case_count}`).join(", ");
  process.stdout.write(`corpus:check: the copy hashes to ${computed}, as all four fields say\n`);
  process.stdout.write(`corpus:check: ${counts} cases\n`);
}

main();
