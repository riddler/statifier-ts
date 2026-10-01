// The validator over the vendored corpus: every scion source validates with
// zero errors, counted against the manifest's case count for the suite.
//
// The cases come through the conformance apparatus's loader, and the number
// they are counted against is the manifest's `case_count`, never a number
// written here: a refresh of the corpus moves both together.

import { describe, expect, it } from "vitest";
import { loadManifest, loadSuites } from "../../scripts/lib/corpus.mjs";
import { lower } from "../../src/lowering.js";
import { validate } from "../../src/validator.js";
import { parseXml } from "../../src/xml/parser.js";

const SUITE = "scion";

const manifest = loadManifest();
const suites = loadSuites();

function caseCount(suite: string): number {
  const entry = manifest.suites.find((candidate) => candidate.suite === suite);
  if (entry === undefined) throw new Error(`the manifest lists no ${suite} suite`);
  return entry.case_count;
}

function casesOf(suite: string) {
  const loaded = suites.find((candidate) => candidate.suite === suite);
  if (loaded === undefined) throw new Error(`the loader read no ${suite} suite`);
  return loaded.cases;
}

describe("every scion source in the vendored corpus validates", () => {
  // Sabotage: a loader that drops the last case of each suite
  // (`cases: corpus.cases.slice(0, -1)` in `loadSuites`) turns this red on
  // the count; a target check that reports every target that DOES resolve
  // turns it red on the failure list. Both were run and reverted.
  it("validates every scion source with zero errors, as many as the manifest lists", () => {
    const failures: string[] = [];
    let valid = 0;
    for (const testCase of casesOf(SUITE)) {
      const parsed = parseXml(testCase.source);
      if (!parsed.ok) {
        failures.push(`${testCase.id}: does not parse: ${parsed.error.message}`);
        continue;
      }
      const lowered = lower(parsed.root, testCase.source);
      if (!lowered.ok) {
        failures.push(`${testCase.id}: does not lower: ${lowered.errors[0]?.message}`);
        continue;
      }
      const result = validate(lowered.document, testCase.source);
      if (!result.ok) {
        failures.push(
          `${testCase.id}: ${result.errors.map((error) => `${error.reason}: ${error.message}`).join("; ")}`,
        );
        continue;
      }
      valid += 1;
    }
    expect(failures).toEqual([]);
    expect(valid).toBe(caseCount(SUITE));
  });
});
