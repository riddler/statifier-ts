import { describe, expect, it } from "vitest";
import type { CorpusCase, CorpusSuite } from "../../scripts/lib/corpus.mjs";
import {
  loadManifest,
  loadReferenceRegistry,
  loadRegistry,
  loadSuites,
  reportFindings,
  unclaimed,
} from "../../scripts/lib/corpus.mjs";
import { gapLines, unclaimedByEither, unclaimedByEitherLines } from "./reports.js";
import { type RunCase, runCorpusCase, runSuite, suiteNotDriven } from "./runner.js";
import { featuresNotRun } from "./w3c.js";

const manifest = loadManifest();
const suites = loadSuites();

function suiteNamed(name: string): CorpusSuite {
  const suite = suites.find((candidate) => candidate.suite === name);
  if (suite === undefined) throw new Error(`no ${name} suite in the vendored manifest`);
  return suite;
}

describe("the runner over the vendored corpus", () => {
  // Sabotage: making the default case runner fail every case with one reason
  // turns this red on the failures. It was run and reverted.
  it("drives every scion case through the interpreter, and every one passes", () => {
    const report = runSuite(suiteNamed("scion"), manifest.corpus_hash);
    expect(report.suite).toBe("scion");
    expect(report.corpus_hash).toBe(manifest.corpus_hash);
    expect(report.results).toHaveLength(119);
    expect(report.results.filter((result) => result.result !== "pass")).toEqual([]);
  });

  // Sabotage: answering the w3c suite with the not-driven reason turns this red
  // on the passes. It was run and reverted.
  it("drives every w3c case through the interpreter, and every case it claims passes", () => {
    const report = runSuite(suiteNamed("w3c"), manifest.corpus_hash);
    expect(report.suite).toBe("w3c");
    expect(report.results).toHaveLength(156);
    const passed = new Set(
      report.results.filter((result) => result.result === "pass").map((result) => result.case_id),
    );
    expect(passed.size).toBeGreaterThanOrEqual(120);
    const claimed = loadRegistry().entries.filter((entry) => entry.suite === "w3c");
    expect(claimed.length).toBeGreaterThanOrEqual(120);
    expect(claimed.filter((entry) => !passed.has(entry.case_id))).toEqual([]);
    for (const result of report.results) {
      if (result.result === "fail") expect(result.reason).not.toBe(suiteNotDriven("w3c"));
    }
  });

  // Sabotage: answering a w3c fail without the feature it needs turns this red
  // on every invoke case. It was run and reverted.
  it("names the feature it does not run in every w3c fail of a case that needs it", () => {
    const report = runSuite(suiteNamed("w3c"), manifest.corpus_hash);
    const cases = new Map(suiteNamed("w3c").cases.map((testCase) => [testCase.id, testCase]));
    const fails = report.results.filter((result) => result.result === "fail");
    expect(fails.length).toBeGreaterThan(0);
    const needing = suiteNamed("w3c")
      .cases.filter((testCase) => featuresNotRun(testCase).length > 0)
      .map((testCase) => testCase.id);
    expect(needing.length).toBeGreaterThan(0);
    expect(fails.map((result) => result.case_id)).toEqual(expect.arrayContaining(needing));
    for (const result of fails) {
      const testCase = cases.get(result.case_id);
      if (testCase === undefined) throw new Error(`${result.case_id} is not in the w3c suite`);
      const missing = featuresNotRun(testCase);
      if (missing.length > 0) {
        expect(result.reason).toBe(
          `depends on a feature this package does not run: ${missing.join(", ")}`,
        );
      } else {
        expect(result.reason).toMatch(/^the initial configuration: expected active leaf states /);
      }
    }
  });

  // Sabotage: answering the statifier suite with the not-driven reason turns
  // this red on the passes. It was run and reverted.
  it("drives every statifier case, and every case it claims passes", () => {
    const report = runSuite(suiteNamed("statifier"), manifest.corpus_hash);
    expect(report.results).toHaveLength(28);
    const passed = new Set(
      report.results.filter((result) => result.result === "pass").map((result) => result.case_id),
    );
    const claimed = loadRegistry().entries.filter((entry) => entry.suite === "statifier");
    expect(claimed.filter((entry) => !passed.has(entry.case_id))).toEqual([]);
    const fails = report.results.filter((result) => result.result === "fail");
    expect(fails.map((result) => result.case_id)).toEqual([
      "statifier/accepts/loan_declares_an_unreachable_event",
      ...suiteNamed("statifier")
        .cases.filter((testCase) => testCase.spec === "diff")
        .map((testCase) => testCase.id),
      "statifier/send/registered_send_failed",
    ]);
    for (const result of fails) expect(result.reason).not.toBe(suiteNotDriven("statifier"));
  });

  it("fails every case of a suite it does not drive, naming the suite", () => {
    const [first] = suiteNamed("scion").cases;
    if (first === undefined) throw new Error("an empty scion suite");
    const other = { ...first, suite: "parcel" } as unknown as CorpusCase;
    expect(runCorpusCase(other)).toEqual({ result: "fail", reason: suiteNotDriven("parcel") });
    expect(suiteNotDriven("parcel")).toBe(
      "the parcel suite is not driven: the runner drives the scion, w3c and statifier suites only",
    );
  });

  it("never shortens a suite: every case of every suite, once, in corpus order", () => {
    for (const suite of suites) {
      const report = runSuite(suite, manifest.corpus_hash);
      const expected = manifest.suites.find((entry) => entry.suite === suite.suite)?.case_count;
      expect(report.results.map((result) => result.case_id)).toEqual(
        suite.cases.map((testCase) => testCase.id),
      );
      expect(report.results).toHaveLength(expected ?? -1);
      expect(reportFindings(report, manifest.corpus_hash, suites)).toEqual([]);
    }
  });
});

describe("the runner with a case runner handed in", () => {
  const scion = suiteNamed("scion");
  const first = scion.cases[0] as CorpusCase;
  const small: CorpusSuite = { suite: "scion", file: scion.file, cases: scion.cases.slice(0, 3) };

  it("reports a pass as a pass and a fail with its own reason", () => {
    const runCase: RunCase = (testCase) =>
      testCase.id === first.id
        ? { result: "pass" }
        : { result: "fail", reason: "event_transitions" };
    const report = runSuite(small, manifest.corpus_hash, runCase);
    expect(report.results.map((result) => result.result)).toEqual(["pass", "fail", "fail"]);
    expect(report.results[0]).toEqual({ case_id: first.id, suite: "scion", result: "pass" });
    expect(report.results[1]).toMatchObject({ result: "fail", reason: "event_transitions" });
  });

  // Sabotage: letting a throw escape the case loop turns this red - the run
  // throws instead of reporting the other cases. It was run and reverted.
  it("reports a case runner that throws as a fail carrying what it threw", () => {
    const runCase: RunCase = (testCase) => {
      if (testCase.id === first.id) throw new Error("no such state");
      return { result: "pass" };
    };
    const report = runSuite(small, manifest.corpus_hash, runCase);
    expect(report.results[0]).toEqual({
      case_id: first.id,
      suite: "scion",
      result: "fail",
      reason: "the run threw: no such state",
    });
    expect(report.results.slice(1).map((result) => result.result)).toEqual(["pass", "pass"]);
  });

  it("refuses a third value rather than writing it into a report", () => {
    const skip = (() => ({ result: "skip" })) as unknown as RunCase;
    expect(() => runSuite(small, manifest.corpus_hash, skip)).toThrow(
      /neither a pass nor a fail with a reason/,
    );
  });

  it("refuses a fail with no reason", () => {
    const silent = (() => ({ result: "fail", reason: "" })) as unknown as RunCase;
    expect(() => runSuite(small, manifest.corpus_hash, silent)).toThrow(
      /neither a pass nor a fail with a reason/,
    );
  });
});

describe("the gap list", () => {
  // Sabotage: printing only the case id, as the list did before, turns this
  // red on every line. It was run and reverted.
  it("names each unclaimed case with the features it needs, in the corpus's words", () => {
    const script = suiteNamed("scion").cases.find(
      (testCase) => testCase.id === "scion/script/test0",
    );
    if (script === undefined) throw new Error("no scion/script/test0 in the vendored corpus");
    const lines = gapLines(
      [
        { case_id: "scion/script/test0", suite: "scion" },
        { case_id: "scion/parcel/route9", suite: "scion" },
      ],
      suites,
    );
    expect(lines).toEqual([
      `scion/script/test0: needs ${script.required_features.join(", ")}`,
      "scion/parcel/route9: not in the vendored corpus",
    ]);
    expect(lines[0]).toContain("script_elements");
  });

  // Sabotage: dropping the run's clause from every line turns this red. It was
  // run and reverted.
  it("ends each line with what a run found: the fail's reason, or a pass not yet recorded", () => {
    const report = runSuite(suiteNamed("w3c"), manifest.corpus_hash);
    const gap = unclaimed(loadReferenceRegistry(), loadRegistry(), ["w3c"]);
    expect(gap.length).toBeGreaterThan(0);
    const lines = gapLines(gap, suites, report.results);
    for (const [index, entry] of gap.entries()) {
      const result = report.results.find((candidate) => candidate.case_id === entry.case_id);
      if (result === undefined || result.result !== "fail") {
        throw new Error(`${entry.case_id} is unclaimed but did not fail`);
      }
      expect(lines[index]).toMatch(new RegExp(`^${entry.case_id}: needs `));
      expect(lines[index]?.endsWith(`; this run failed it: ${result.reason}`)).toBe(true);
    }
    const [first] = gap;
    if (first === undefined) throw new Error("an empty gap");
    expect(gapLines([first], suites, [{ ...first, result: "pass" }])[0]).toMatch(
      /; this run passed it, and the ratchet has not recorded it$/,
    );
  });

  it("says so when a case names no feature", () => {
    const [first] = suiteNamed("scion").cases;
    if (first === undefined) throw new Error("an empty scion suite");
    const bare = { ...first, required_features: [] };
    expect(
      gapLines(
        [{ case_id: first.id, suite: "scion" }],
        [{ ...suiteNamed("scion"), cases: [bare] }],
      ),
    ).toEqual([`${first.id}: needs no named feature`]);
  });
});

describe("the cases neither registry claims", () => {
  // Sabotage: keeping the claimed cases instead of dropping them turns this
  // red. It was run and reverted.
  it("are the w3c cases the reference leaves unclaimed, each with the run's reason", () => {
    const neither = unclaimedByEither(loadReferenceRegistry(), loadRegistry(), suites, ["w3c"]);
    expect(neither).toEqual([
      { case_id: "w3c/test330", suite: "w3c" },
      { case_id: "w3c/test552", suite: "w3c" },
    ]);
    const report = runSuite(suiteNamed("w3c"), manifest.corpus_hash);
    const lines = unclaimedByEitherLines(neither, report.results);
    for (const [index, entry] of neither.entries()) {
      const result = report.results.find((candidate) => candidate.case_id === entry.case_id);
      if (result === undefined || result.result !== "fail") {
        throw new Error(`${entry.case_id} did not fail`);
      }
      expect(lines[index]).toBe(
        `${entry.case_id}: the reference's registry does not claim it either; this run failed it: ${result.reason}`,
      );
    }
  });

  it("are none for a suite the reference claims whole", () => {
    expect(unclaimedByEither(loadReferenceRegistry(), loadRegistry(), suites, ["scion"])).toEqual(
      [],
    );
    expect(unclaimedByEitherLines([{ case_id: "w3c/test330", suite: "w3c" }])).toEqual([
      "w3c/test330: the reference's registry does not claim it either",
    ]);
  });
});
