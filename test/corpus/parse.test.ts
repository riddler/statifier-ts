// The parser over the vendored corpus: every scion and w3c source parses to
// an element tree, counted against the manifest's case counts.
//
// The cases come through the conformance apparatus's loader, and the number
// they are counted against is the manifest's `case_count` for the suite, never
// a number written here: a refresh of the corpus moves both together.

import { describe, expect, it } from "vitest";
import { loadManifest, loadSuites } from "../../scripts/lib/corpus.mjs";
import { parseXml } from "../../src/xml/parser.js";

const SCXML = "http://www.w3.org/2005/07/scxml";

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

describe("every source in the vendored corpus parses", () => {
  // Sabotage: a loader that drops the last case of each suite
  // (`cases: corpus.cases.slice(0, -1)` in `loadSuites`) turns both rows red
  // on the count; a parser whose `xmlns` declaration never sets the default
  // namespace turns both rows red on the failure list. Both were run and
  // reverted.
  for (const suite of ["scion", "w3c"]) {
    it(`parses every ${suite} source to an <scxml> element, as many as the manifest lists`, () => {
      const failures: string[] = [];
      let parsed = 0;
      for (const testCase of casesOf(suite)) {
        const result = parseXml(testCase.source);
        if (!result.ok) {
          failures.push(`${testCase.id}: ${result.error.message}`);
          continue;
        }
        const root = result.root;
        if (root.namespace !== SCXML || root.name.split(":").pop() !== "scxml") {
          failures.push(`${testCase.id}: the root is ${root.name} in ${root.namespace}`);
          continue;
        }
        parsed += 1;
      }
      expect(failures).toEqual([]);
      expect(parsed).toBe(caseCount(suite));
    });
  }
});
