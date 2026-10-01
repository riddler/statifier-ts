// The compiler over the vendored corpus: every scion source compiles to a
// Machine, counted against the manifest's case count for the suite.
//
// The cases come through the conformance apparatus's loader, and the number
// they are counted against is the manifest's `case_count`, never a number
// written here: a refresh of the corpus moves both together.

import { describe, expect, it } from "vitest";
import { loadManifest, loadSuites } from "../../scripts/lib/corpus.mjs";
import { compile } from "../../src/index.js";

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

describe("every scion source in the vendored corpus compiles", () => {
  // Sabotage: a loader that drops the last case of each suite
  // (`cases: corpus.cases.slice(0, -1)` in `loadSuites`) turns this red on
  // the count; an expression compile handed every expression with a stray
  // `)` appended turns it red on the failure list. Both were run and
  // reverted.
  it("compiles every scion source to a Machine, as many as the manifest lists", () => {
    const failures: string[] = [];
    let compiled = 0;
    for (const testCase of casesOf(SUITE)) {
      const result = compile(testCase.source);
      if (!result.ok) {
        failures.push(
          `${testCase.id}: ${result.errors.map((error) => `${error.reason}: ${error.message}`).join("; ")}`,
        );
        continue;
      }
      const { identity, machine } = result.chart;
      if (machine.states.length === 0 || !identity.contentHash.startsWith("sha256:")) {
        failures.push(`${testCase.id}: the Chart holds no state or no identity hash`);
        continue;
      }
      compiled += 1;
    }
    expect(failures).toEqual([]);
    expect(compiled).toBe(caseCount(SUITE));
  });
});
