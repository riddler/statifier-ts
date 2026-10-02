import { describe, expect, it } from "vitest";
import type {
  CaseResult,
  CorpusCase,
  CorpusSuite,
  Registry,
  SuiteReport,
} from "../../scripts/lib/corpus.mjs";
import {
  claimsOf,
  encodeRegistry,
  indexCases,
  loadManifest,
  loadRegistry,
  loadSuites,
  ratchet,
  readRegistryText,
  registryFindings,
  unclaimed,
} from "../../scripts/lib/corpus.mjs";
import { runSuite } from "./runner.js";

// A small corpus for the rules, in the reference's case shape. Its ids are
// shaped like the corpus's; the rules never read a case's source.
const HASH = `sha256:${"a".repeat(64)}`;
const OTHER_HASH = `sha256:${"b".repeat(64)}`;

function fixtureCase(id: string, conformance: "mandatory" | "optional" | null = null): CorpusCase {
  const suite = id.slice(0, id.indexOf("/")) as CorpusCase["suite"];
  return {
    id,
    suite,
    spec: "basic",
    conformance,
    description: "",
    required_features: [],
    source: "<scxml/>",
    initial_configuration: ["a"],
    steps: [],
  };
}

const fixtureSuites: CorpusSuite[] = [
  {
    suite: "scion",
    file: "corpus/scion.json",
    cases: [fixtureCase("scion/basic/basic0"), fixtureCase("scion/basic/basic1")],
  },
  {
    suite: "w3c",
    file: "corpus/w3c.json",
    cases: [fixtureCase("w3c/test144", "mandatory"), fixtureCase("w3c/test201", "optional")],
  },
];

function registry(entries: Registry["entries"], claims?: readonly string[]): Registry {
  return {
    implementation: "statifier-ts",
    corpus_hash: HASH,
    claims: claims ?? claimsOf(entries, indexCases(fixtureSuites)),
    entries,
  };
}

function reportOf(suite: CorpusSuite, passing: readonly string[]): SuiteReport {
  return runSuite(suite, HASH, (testCase) =>
    passing.includes(testCase.id)
      ? { result: "pass" }
      : { result: "fail", reason: "core not implemented" },
  );
}

function resultsOf(passing: readonly string[]): CaseResult[] {
  return fixtureSuites.flatMap((suite) => reportOf(suite, passing).results);
}

const basic0 = { case_id: "scion/basic/basic0", suite: "scion" } as const;
const basic1 = { case_id: "scion/basic/basic1", suite: "scion" } as const;
const test144 = { case_id: "w3c/test144", suite: "w3c" } as const;

describe("this package's registry, as committed", () => {
  const manifest = loadManifest();
  const suites = loadSuites();
  const committed = loadRegistry();
  const results = suites.flatMap((suite) => runSuite(suite, manifest.corpus_hash).results);

  it("is pinned, in the ratchet's encoding, and claims every statifier case, every diff case among them", () => {
    expect(committed.implementation).toBe("statifier-ts");
    expect(committed.corpus_hash).toBe(manifest.corpus_hash);
    expect(committed.claims).toEqual(["scion", "statifier", "w3c-mandatory", "w3c-optional"]);
    expect(committed.entries.length).toBeGreaterThan(0);
    const statifier = committed.entries
      .filter((entry) => entry.suite === "statifier")
      .map((entry) => entry.case_id);
    expect(statifier.length).toBeGreaterThan(0);
    expect(statifier).toContain("statifier/send/registered_send_failed");
    const statifierCases = suites.find((suite) => suite.suite === "statifier")?.cases ?? [];
    const diffIds = statifierCases
      .filter((testCase) => testCase.spec === "diff")
      .map((testCase) => testCase.id);
    expect(diffIds).toHaveLength(10);
    expect(statifier.filter((id) => id.startsWith("statifier/diff/"))).toEqual(diffIds.sort());
    expect(statifier).toEqual(statifierCases.map((testCase) => testCase.id).sort());
    const scion = suites.find((suite) => suite.suite === "scion")?.cases ?? [];
    expect(
      committed.entries.filter((entry) => entry.suite === "scion").map((entry) => entry.case_id),
    ).toEqual(scion.map((testCase) => testCase.id).sort());
    expect(readRegistryText()).toBe(encodeRegistry(committed));
  });

  it("passes the five checks and makes a claim", () => {
    expect(
      registryFindings({
        registry: committed,
        manifestHash: manifest.corpus_hash,
        suites,
        results,
      }),
    ).toEqual({
      findings: [],
      claimMade: true,
    });
  });
});

describe("the registry check's five checks", () => {
  const ok = { manifestHash: HASH, suites: fixtureSuites };

  it("passes a registry whose every entry passes today, and reports the claim made", () => {
    const passing = registry([basic0, test144]);
    expect(passing.claims).toEqual(["scion", "w3c-mandatory"]);
    expect(
      registryFindings({
        ...ok,
        registry: passing,
        results: resultsOf(["scion/basic/basic0", "w3c/test144"]),
      }),
    ).toEqual({ findings: [], claimMade: true });
  });

  // Sabotage: dropping the order check passes a registry whose entries are
  // swapped, and this goes red. It was run and reverted.
  it("fails a registry whose entries are not sorted by suite, then case id, naming the pair", () => {
    const swapped = registry([test144, basic0]);
    expect(
      registryFindings({
        ...ok,
        registry: swapped,
        results: resultsOf(["scion/basic/basic0", "w3c/test144"]),
      }).findings,
    ).toEqual([
      "the order: scion/basic/basic0 comes after w3c/test144; entries are sorted by suite, then case id",
    ]);
  });

  // Sabotage: dropping the pin comparison turns this red. It was run and reverted.
  it("1. the pin: fails a registry pinned to another corpus", () => {
    const pinned = { ...registry([]), corpus_hash: OTHER_HASH };
    expect(registryFindings({ ...ok, registry: pinned, results: resultsOf([]) }).findings).toEqual([
      `the pin: corpus_hash is ${OTHER_HASH}, the vendored manifest's is ${HASH}`,
    ]);
  });

  // Sabotage: skipping an entry the corpus lacks, instead of reporting it,
  // turns this red. It was run and reverted.
  it("2. rule 1: fails an entry the corpus lacks, and one under another suite, naming each", () => {
    const stray = { case_id: "scion/basic/basic9", suite: "scion" } as const;
    const moved = { case_id: "w3c/test144", suite: "scion" } as const;
    const findings = registryFindings({
      ...ok,
      registry: registry([stray, moved], ["scion"]),
      results: resultsOf(["w3c/test144"]),
    }).findings;
    expect(findings).toContain(
      "rule 1: scion/basic/basic9 is in the registry but not in the corpus",
    );
    expect(findings).toContain(
      "rule 1: w3c/test144: the registry says suite scion, the corpus says w3c",
    );
  });

  it("3. the claims: fails claims that are not exactly the sorted set the entries count toward", () => {
    const passingResults = resultsOf(["scion/basic/basic0"]);
    const extra = registry([basic0], ["scion", "w3c-optional"]);
    expect(registryFindings({ ...ok, registry: extra, results: passingResults }).findings).toEqual([
      'the claims: claims is ["scion","w3c-optional"], the entries count toward ["scion"]',
    ]);
    const claimOfNothing = registry([], ["scion"]);
    const refused = registryFindings({ ...ok, registry: claimOfNothing, results: passingResults });
    expect(refused.claimMade).toBe(true);
    expect(refused.findings).toEqual([
      'the claims: claims is ["scion"], the entries count toward []',
    ]);
  });

  // Sabotage: reading an entry's result as a pass whatever it says turns this
  // red. It was run and reverted.
  it("4. the ratchet: fails an entry whose case does not pass when run today", () => {
    const findings = registryFindings({
      ...ok,
      registry: registry([basic0, basic1]),
      results: resultsOf(["scion/basic/basic0"]),
    }).findings;
    expect(findings).toEqual(["the ratchet: scion/basic/basic1 fails today: core not implemented"]);
  });

  it("5. rule 3: fails when there is no case to read or no case was run", () => {
    expect(
      registryFindings({ manifestHash: HASH, suites: [], registry: registry([]), results: [] })
        .findings,
    ).toEqual(["rule 3: there is no corpus case to read", "rule 3: no case was run"]);
    expect(registryFindings({ ...ok, registry: registry([]), results: [] }).findings).toEqual([
      "rule 3: no case was run",
    ]);
  });

  it("fails a registry that names another implementation", () => {
    const foreign = { ...registry([]), implementation: "statifier-ex" };
    expect(registryFindings({ ...ok, registry: foreign, results: resultsOf([]) }).findings).toEqual(
      ['implementation is "statifier-ex", not "statifier-ts"'],
    );
  });
});

describe("the ratchet", () => {
  const scion = fixtureSuites[0] as CorpusSuite;
  const w3c = fixtureSuites[1] as CorpusSuite;
  const base = { manifestHash: HASH, suites: fixtureSuites };

  it("writes nothing new from a run that passed nothing: no claim, no entries", () => {
    const outcome = ratchet({ ...base, registry: registry([]), reports: [reportOf(scion, [])] });
    expect(outcome.refusals).toBeUndefined();
    expect(outcome.added).toEqual([]);
    expect(outcome.registry).toEqual(registry([]));
  });

  it("adds the cases a run passed, sorted, with exactly the claims they count toward", () => {
    const outcome = ratchet({
      ...base,
      registry: registry([basic1]),
      reports: [
        reportOf(scion, ["scion/basic/basic0", "scion/basic/basic1"]),
        reportOf(w3c, ["w3c/test144"]),
      ],
    });
    expect(outcome.added).toEqual([basic0, test144]);
    expect(outcome.registry).toEqual({
      implementation: "statifier-ts",
      corpus_hash: HASH,
      claims: ["scion", "w3c-mandatory"],
      entries: [basic0, basic1, test144],
    });
  });

  it("refuses when a recorded entry did not pass in the run, naming it, and removes nothing", () => {
    const outcome = ratchet({
      ...base,
      registry: registry([basic0, basic1]),
      reports: [reportOf(scion, ["scion/basic/basic0"])],
    });
    expect(outcome).toEqual({
      refusals: ["scion/basic/basic1 is recorded and did not pass in this run"],
    });
  });

  it("refuses a recorded entry whose suite the run did not report", () => {
    const outcome = ratchet({
      ...base,
      registry: registry([test144]),
      reports: [reportOf(scion, [])],
    });
    expect(outcome.refusals).toEqual(["w3c/test144 is recorded and did not pass in this run"]);
  });

  // Sabotage: dropping the recorded-suite check lets the run rewrite the
  // entry's suite and its claim, and this goes red. It was run and reverted.
  it("refuses a recorded entry whose suite is not the corpus's, naming it", () => {
    const misfiled = { case_id: "scion/basic/basic0", suite: "w3c" } as const;
    const outcome = ratchet({
      ...base,
      registry: registry([misfiled], ["scion"]),
      reports: [reportOf(scion, ["scion/basic/basic0"])],
    });
    expect(outcome).toEqual({
      refusals: ["scion/basic/basic0 is recorded under suite w3c; the corpus puts it in scion"],
    });
  });

  it("refuses a report of another corpus", () => {
    const stale = { ...reportOf(scion, ["scion/basic/basic0"]), corpus_hash: OTHER_HASH };
    expect(ratchet({ ...base, registry: registry([]), reports: [stale] }).refusals).toEqual([
      `the scion report is of corpus ${OTHER_HASH}, the vendored manifest is ${HASH}`,
    ]);
  });

  it("refuses a report that is not a run of the whole suite", () => {
    const report = reportOf(scion, ["scion/basic/basic0"]);
    const shortened = { ...report, results: report.results.slice(0, 1) };
    expect(ratchet({ ...base, registry: registry([]), reports: [shortened] }).refusals).toEqual([
      "the scion report is not a run of the whole suite: 1 results for 2 cases, or not in corpus order",
    ]);
  });

  it("refuses a report carrying a third value", () => {
    const report = reportOf(scion, []);
    const skipped = {
      ...report,
      results: [{ ...report.results[0], result: "skip" }, report.results[1]],
    } as unknown as SuiteReport;
    expect(ratchet({ ...base, registry: registry([]), reports: [skipped] }).refusals).toEqual([
      'the scion report: scion/basic/basic0 reports "skip"',
    ]);
  });

  it("refuses with no report, and with two reports of one suite", () => {
    expect(ratchet({ ...base, registry: registry([]), reports: [] }).refusals).toEqual([
      "no report: there is no run to ratchet from",
    ]);
    expect(
      ratchet({
        ...base,
        registry: registry([]),
        reports: [reportOf(scion, []), reportOf(scion, [])],
      }).refusals,
    ).toEqual(["two reports for the scion suite"]);
  });
});

describe("the registry's encoding", () => {
  it("writes the reference's encoding: keys in order, claims on one line, one entry per line", () => {
    expect(encodeRegistry(registry([basic0, test144]))).toBe(
      [
        "{",
        '  "implementation": "statifier-ts",',
        `  "corpus_hash": "${HASH}",`,
        '  "claims": ["scion","w3c-mandatory"],',
        '  "entries": [',
        '    {"case_id":"scion/basic/basic0","suite":"scion"},',
        '    {"case_id":"w3c/test144","suite":"w3c"}',
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("writes the registry before its first entry as the record's worked example shows it", () => {
    expect(encodeRegistry(registry([]))).toBe(
      `{\n  "implementation": "statifier-ts",\n  "corpus_hash": "${HASH}",\n  "claims": [],\n  "entries": []\n}\n`,
    );
  });
});

describe("what is not yet claimed", () => {
  it("lists the reference's entries for the suites asked about that ours lacks, sorted", () => {
    const reference = { ...registry([test144, basic1, basic0]), implementation: "statifier-ex" };
    expect(unclaimed(reference, registry([basic0]), ["scion"])).toEqual([basic1]);
    expect(unclaimed(reference, registry([]), ["scion", "w3c"])).toEqual([basic0, basic1, test144]);
  });
});
