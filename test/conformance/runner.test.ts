import { describe, expect, it } from "vitest";
import type { CorpusCase, CorpusSuite } from "../../scripts/lib/corpus.mjs";
import { loadManifest, loadSuites, reportFindings } from "../../scripts/lib/corpus.mjs";
import { SCRIPT_UNSUPPORTED } from "../../src/compiler.js";
import { type RunCase, runSuite, suiteNotDriven } from "./runner.js";

const manifest = loadManifest();
const suites = loadSuites();

function suiteNamed(name: string): CorpusSuite {
  const suite = suites.find((candidate) => candidate.suite === name);
  if (suite === undefined) throw new Error(`no ${name} suite in the vendored manifest`);
  return suite;
}

describe("the runner over the vendored corpus", () => {
  // The three scion cases a `<script>` body decides; every other scion case
  // passes through the interpreter.
  const SCRIPT_CASES = ["scion/script/test0", "scion/script/test1", "scion/script/test2"];

  // Sabotage: making the default case runner fail every case with one reason
  // turns this red on the count of passes. It was run and reverted.
  it("drives every scion case: each a pass, or a fail with the reason, and no third value", () => {
    const report = runSuite(suiteNamed("scion"), manifest.corpus_hash);
    expect(report.suite).toBe("scion");
    expect(report.corpus_hash).toBe(manifest.corpus_hash);
    expect(report.results).toHaveLength(119);
    const failed = report.results.filter((result) => result.result !== "pass");
    expect(failed).toEqual(
      SCRIPT_CASES.map((id) => ({
        case_id: id,
        suite: "scion",
        result: "fail",
        reason: `missing feature script_elements: ${SCRIPT_UNSUPPORTED}`,
      })),
    );
    expect(report.results.filter((result) => result.result === "pass")).toHaveLength(116);
  });

  it("fails every case of a suite it does not drive yet, naming the suite", () => {
    for (const name of ["w3c", "statifier"]) {
      const report = runSuite(suiteNamed(name), manifest.corpus_hash);
      expect(
        new Set(
          report.results.map((result) => ("reason" in result ? result.reason : result.result)),
        ),
      ).toEqual(new Set([suiteNotDriven(name)]));
    }
    expect(suiteNotDriven("w3c")).toBe(
      "the w3c suite is not driven yet: the runner drives the scion suite only",
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
