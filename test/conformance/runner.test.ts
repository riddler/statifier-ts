import { evaluate, Undefined } from "@riddler/predicator";
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
import { eventValue } from "../../src/datamodel.js";
import { gapLines, KNOWN_CAUSES, unclaimedByEither, unclaimedByEitherLines } from "./reports.js";
import { type RunCase, runCorpusCase, runSuite, suiteNotDriven } from "./runner.js";
import { runScionCase } from "./scion.js";
import { runHostCase } from "./statifier.js";
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
  it("drives every scion case through the interpreter, and every one passes", async () => {
    const report = await runSuite(suiteNamed("scion"), manifest.corpus_hash);
    expect(report.suite).toBe("scion");
    expect(report.corpus_hash).toBe(manifest.corpus_hash);
    expect(report.results).toHaveLength(119);
    expect(report.results.filter((result) => result.result !== "pass")).toEqual([]);
  });

  // Sabotage: answering the w3c suite with the not-driven reason turns this red
  // on the passes. It was run and reverted.
  it("drives every w3c case through the interpreter, and every case it claims passes", async () => {
    const report = await runSuite(suiteNamed("w3c"), manifest.corpus_hash);
    expect(report.suite).toBe("w3c");
    expect(report.results).toHaveLength(168);
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

  // Sabotage: restoring `invoke_elements` to the features not run turns this
  // red on every invoke case, each failed before its drive.
  it("drives every w3c case, an invoke case and a case naming a processor included, and every fail is the comparison's", async () => {
    const report = await runSuite(suiteNamed("w3c"), manifest.corpus_hash);
    const cases = new Map(suiteNamed("w3c").cases.map((testCase) => [testCase.id, testCase]));
    const invoking = suiteNamed("w3c")
      .cases.filter((testCase) => testCase.required_features.includes("invoke_elements"))
      .map((testCase) => testCase.id);
    expect(invoking.length).toBeGreaterThan(0);
    for (const testCase of suiteNamed("w3c").cases) expect(featuresNotRun(testCase)).toEqual([]);
    for (const result of report.results.filter((candidate) => candidate.result === "fail")) {
      const testCase = cases.get(result.case_id);
      if (testCase === undefined) throw new Error(`${result.case_id} is not in the w3c suite`);
      expect(testCase.required_features).not.toContain("invoke_elements");
      expect(result.reason).toMatch(/^the initial configuration: expected active leaf states /);
    }
    const passed = report.results.filter((result) => result.result === "pass");
    expect(passed.map((result) => result.case_id)).toEqual(expect.arrayContaining(invoking));
  });

  // Sabotage: answering 204 from the loopback front without handing the event
  // on turns this red on every case but test577, whose send has no target and
  // fails within the run before any request is made. It was run and reverted.
  it("drives every w3c case naming a processor through the loopback: the reference's eleven pass and are claimed, test201 fails on the comparison", async () => {
    const report = await runSuite(suiteNamed("w3c"), manifest.corpus_hash);
    const naming = suiteNamed("w3c")
      .cases.filter((testCase) => testCase.host?.event_io_processors !== undefined)
      .map((testCase) => testCase.id);
    const referenceClaims = [
      "w3c/test509",
      "w3c/test510",
      "w3c/test518",
      "w3c/test519",
      "w3c/test520",
      "w3c/test522",
      "w3c/test531",
      "w3c/test532",
      "w3c/test534",
      "w3c/test567",
      "w3c/test577",
    ];
    expect(naming).toEqual(["w3c/test201", ...referenceClaims]);
    const reference = new Set(loadReferenceRegistry().entries.map((entry) => entry.case_id));
    expect(naming.filter((id) => reference.has(id))).toEqual(referenceClaims);
    for (const id of referenceClaims) {
      expect(report.results.find((result) => result.case_id === id)).toEqual({
        case_id: id,
        suite: "w3c",
        result: "pass",
      });
    }
    expect(report.results.find((result) => result.case_id === "w3c/test201")).toEqual({
      case_id: "w3c/test201",
      suite: "w3c",
      result: "fail",
      reason: "the initial configuration: expected active leaf states [pass], got [fail]",
    });
    const claimed = new Set(loadRegistry().entries.map((entry) => entry.case_id));
    expect(naming.filter((id) => claimed.has(id))).toEqual(referenceClaims);
  });

  // Sabotage: answering the statifier suite with the not-driven reason turns
  // this red on the passes. It was run and reverted.
  it("drives every statifier case, and every case it claims passes", async () => {
    const report = await runSuite(suiteNamed("statifier"), manifest.corpus_hash);
    expect(report.results).toHaveLength(31);
    const passed = new Set(
      report.results.filter((result) => result.result === "pass").map((result) => result.case_id),
    );
    const claimed = loadRegistry().entries.filter((entry) => entry.suite === "statifier");
    expect(claimed.filter((entry) => !passed.has(entry.case_id))).toEqual([]);
    const fails = report.results.filter((result) => result.result === "fail");
    expect(fails.map((result) => result.case_id)).toEqual([]);
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

  it("never shortens a suite: every case of every suite, once, in corpus order", async () => {
    for (const suite of suites) {
      const report = await runSuite(suite, manifest.corpus_hash);
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

  it("reports a pass as a pass and a fail with its own reason", async () => {
    const runCase: RunCase = (testCase) =>
      testCase.id === first.id
        ? { result: "pass" }
        : { result: "fail", reason: "event_transitions" };
    const report = await runSuite(small, manifest.corpus_hash, runCase);
    expect(report.results.map((result) => result.result)).toEqual(["pass", "fail", "fail"]);
    expect(report.results[0]).toEqual({ case_id: first.id, suite: "scion", result: "pass" });
    expect(report.results[1]).toMatchObject({ result: "fail", reason: "event_transitions" });
  });

  // Sabotage: letting a throw escape the case loop turns this red - the run
  // throws instead of reporting the other cases. It was run and reverted.
  it("reports a case runner that throws as a fail carrying what it threw", async () => {
    const runCase: RunCase = (testCase) => {
      if (testCase.id === first.id) throw new Error("no such state");
      return { result: "pass" };
    };
    const report = await runSuite(small, manifest.corpus_hash, runCase);
    expect(report.results[0]).toEqual({
      case_id: first.id,
      suite: "scion",
      result: "fail",
      reason: "the run threw: no such state",
    });
    expect(report.results.slice(1).map((result) => result.result)).toEqual(["pass", "pass"]);
  });

  it("refuses a third value rather than writing it into a report", async () => {
    const skip = (() => ({ result: "skip" })) as unknown as RunCase;
    await expect(runSuite(small, manifest.corpus_hash, skip)).rejects.toThrow(
      /neither a pass nor a fail with a reason/,
    );
  });

  it("refuses a fail with no reason", async () => {
    const silent = (() => ({ result: "fail", reason: "" })) as unknown as RunCase;
    await expect(runSuite(small, manifest.corpus_hash, silent)).rejects.toThrow(
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

  // The gap the reference's registry leaves is empty today, so the lines are
  // read over every w3c case the run fails, which is what a gap line would
  // carry for each of them.
  //
  // Sabotage: dropping the run's clause from every line turns this red. It was
  // run and reverted.
  it("ends each line with what a run found: the fail's reason, or a pass not yet recorded", async () => {
    expect(unclaimed(loadReferenceRegistry(), loadRegistry(), ["w3c"])).toEqual([]);
    const report = await runSuite(suiteNamed("w3c"), manifest.corpus_hash);
    const gap = report.results
      .filter((result) => result.result === "fail")
      .map(({ case_id, suite }) => ({ case_id, suite }));
    expect(gap.length).toBeGreaterThan(0);
    const lines = gapLines(gap, suites, report.results);
    for (const [index, entry] of gap.entries()) {
      const result = report.results.find((candidate) => candidate.case_id === entry.case_id);
      if (result === undefined || result.result !== "fail") {
        throw new Error(`${entry.case_id} did not fail`);
      }
      expect(lines[index]).toMatch(new RegExp(`^${entry.case_id}: needs `));
      const cause = KNOWN_CAUSES.get(entry.case_id);
      const known = cause === undefined ? "" : `; the cause: ${cause}`;
      expect(lines[index]?.endsWith(`; this run failed it: ${result.reason}${known}`)).toBe(true);
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

describe("the known causes", () => {
  // This names a cause of its own, for a case the table does not key, and
  // reads it through the same clause the known causes are printed by.
  //
  // Sabotage: dropping the cause from the clause turns this red. It was run
  // and reverted.
  it("are printed after the run's reason on a fail, and never on a pass", () => {
    const entry = { case_id: "w3c/test330", suite: "w3c" } as const;
    const cause = "a cause found by reading the case";
    const causes = new Map([[entry.case_id, cause]]);
    const fail = { ...entry, result: "fail", reason: "the comparison" } as const;
    expect(
      gapLines([entry], suites, [fail], causes)[0]?.endsWith(
        `; this run failed it: the comparison; the cause: ${cause}`,
      ),
    ).toBe(true);
    expect(gapLines([entry], suites, [fail])[0]).not.toContain("the cause");
    expect(gapLines([entry], suites, [{ ...entry, result: "pass" }], causes)[0]).not.toContain(
      "the cause",
    );
    expect(unclaimedByEitherLines([entry], [fail], causes)).toEqual([
      `w3c/test330: the reference's registry does not claim it either; this run failed it: the comparison; the cause: ${cause}`,
    ]);
  });

  // Sabotage: keying the cause to a case the run passes turns this red. It
  // was run and reverted.
  it("name only cases the run fails", async () => {
    const results = [];
    for (const suite of suites)
      results.push(...(await runSuite(suite, manifest.corpus_hash)).results);
    for (const caseId of KNOWN_CAUSES.keys()) {
      expect(results.find((result) => result.case_id === caseId)?.result).toBe("fail");
    }
  });
});

describe("w3c/test329", () => {
  // The case passes for the reason the reference passes it: the value of an
  // event that lacks its optional fields compares equal to itself and to a
  // copy, as two maps holding the same absent members compare equal in the
  // reference's expression language, and its condition Var2==_event is what
  // carries the chart to pass.
  //
  // Sabotage: pinning @riddler/predicator back to 0.4.0, whose member
  // equality answers two such maps unequal, turns this red. It was run and
  // reverted.
  it("passes at its _event comparison: an event value equals its copy", () => {
    const event = eventValue({ name: "foo", type: "internal", data: Undefined });
    expect(evaluate("a == b", { a: event, b: event })).toEqual({ ok: true, value: true });
    const copy = eventValue({ name: "foo", type: "internal", data: Undefined });
    expect(copy).not.toBe(event);
    expect(evaluate("a == b", { a: event, b: copy })).toEqual({ ok: true, value: true });
    const other = eventValue({ name: "bar", type: "internal", data: Undefined });
    expect(evaluate("a == b", { a: event, b: other })).toEqual({ ok: true, value: false });
    const testCase = suiteNamed("w3c").cases.find((candidate) => candidate.id === "w3c/test329");
    if (testCase === undefined) throw new Error("no w3c/test329 in the vendored corpus");
    expect(runScionCase(testCase)).toEqual({ result: "pass" });
    const condition = 'cond="Var2==_event"';
    expect(testCase.source).toContain(condition);
    const refused = { ...testCase, source: testCase.source.replace(condition, 'cond="false"') };
    expect(runScionCase(refused).result).toBe("fail");
  });
});

describe("w3c/test201", () => {
  // The case fails for the cause the known causes print: its onentry hands
  // event1 to the Basic HTTP processor, addressed to its own location, and
  // then sends timeout with no delay, which goes on the session's own
  // external queue in that step, so timeout is taken before the delivery
  // comes back and the wildcard transition carries the chart to fail. Once
  // that one send of timeout is delayed, the delivery is taken first and the
  // case passes; with the processor's send also taken out, the delayed
  // timeout alone carries it to fail, so that pass rests on the delivery.
  //
  // Sabotage: dropping an undelayed send's event for the session itself
  // rather than queueing it, so timeout never reaches the queue, turns this
  // red: the case then passes. So does keying the known cause to another
  // case. Each was run and reverted.
  it("fails at its timeout: the session's own undelayed send is taken before the delivery", async () => {
    const testCase = suiteNamed("w3c").cases.find((candidate) => candidate.id === "w3c/test201");
    if (testCase === undefined) throw new Error("no w3c/test201 in the vendored corpus");
    expect(KNOWN_CAUSES.get(testCase.id)).toEqual(
      expect.stringMatching(/^its onentry sends event1 /),
    );
    expect(await runHostCase(testCase)).toEqual({
      result: "fail",
      reason: "the initial configuration: expected active leaf states [pass], got [fail]",
    });
    const timeout = '<send event="timeout" />';
    expect(testCase.source).toContain(timeout);
    const delayed = {
      ...testCase,
      source: testCase.source.replace(timeout, '<send event="timeout" delay="1s" />'),
    };
    expect(await runHostCase(delayed)).toEqual({ result: "pass" });
    const delivery =
      /<send type="http:\/\/www\.w3\.org\/TR\/scxml\/#BasicHTTPEventProcessor"[^>]*\/>/;
    expect(testCase.source).toMatch(delivery);
    const undelivered = { ...delayed, source: delayed.source.replace(delivery, "") };
    expect(await runHostCase(undelivered)).toEqual({
      result: "fail",
      reason: "the initial configuration: expected active leaf states [pass], got [fail]",
    });
  });
});

describe("the cases neither registry claims", () => {
  // Sabotage: keeping the claimed cases instead of dropping them turns this
  // red. It was run and reverted.
  it("are the three w3c cases the reference leaves unclaimed, each with the run's reason and any known cause", async () => {
    const neither = unclaimedByEither(loadReferenceRegistry(), loadRegistry(), suites, ["w3c"]);
    expect(neither).toEqual([
      { case_id: "w3c/test201", suite: "w3c" },
      { case_id: "w3c/test330", suite: "w3c" },
      { case_id: "w3c/test552", suite: "w3c" },
    ]);
    const report = await runSuite(suiteNamed("w3c"), manifest.corpus_hash);
    const lines = unclaimedByEitherLines(neither, report.results);
    for (const [index, entry] of neither.entries()) {
      const result = report.results.find((candidate) => candidate.case_id === entry.case_id);
      if (result === undefined || result.result !== "fail") {
        throw new Error(`${entry.case_id} did not fail`);
      }
      const cause = KNOWN_CAUSES.get(entry.case_id);
      const known = cause === undefined ? "" : `; the cause: ${cause}`;
      expect(lines[index]).toBe(
        `${entry.case_id}: the reference's registry does not claim it either; this run failed it: ${result.reason}${known}`,
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
