// Lowering over the vendored corpus: every scion source lowers to a typed
// Document, counted against the manifest's case count for the suite.
//
// The cases come through the conformance apparatus's loader, and the number
// they are counted against is the manifest's `case_count`, never a number
// written here: a refresh of the corpus moves both together.

import { describe, expect, it } from "vitest";
import { loadManifest, loadSuites } from "../../scripts/lib/corpus.mjs";
import { lower } from "../../src/lowering.js";
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

describe("every scion source in the vendored corpus lowers", () => {
  // Sabotage: a loader that drops the last case of each suite
  // (`cases: corpus.cases.slice(0, -1)` in `loadSuites`) turns this red on
  // the count; lowering with the `history` builder removed turns it red on
  // the failure list. Both were run and reverted.
  it("lowers every scion source to a Document, as many as the manifest lists", () => {
    const failures: string[] = [];
    let lowered = 0;
    for (const testCase of casesOf(SUITE)) {
      const parsed = parseXml(testCase.source);
      if (!parsed.ok) {
        failures.push(`${testCase.id}: does not parse: ${parsed.error.message}`);
        continue;
      }
      const result = lower(parsed.root, testCase.source);
      if (!result.ok) {
        failures.push(`${testCase.id}: ${result.errors.map((error) => error.message).join("; ")}`);
        continue;
      }
      if (result.document.states.length === 0) {
        failures.push(`${testCase.id}: the Document holds no state`);
        continue;
      }
      lowered += 1;
    }
    expect(failures).toEqual([]);
    expect(lowered).toBe(caseCount(SUITE));
  });
});
