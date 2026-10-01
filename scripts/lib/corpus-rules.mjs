// The corpus rules: what a case counts toward, what the registry must say
// about the cases, and what the ratchet may write. Pure functions over data.
//
// Every reader of the vendored corpus - the corpus check, the registry check,
// the ratchet, the conformance runner's Node half and its tests - needs the
// same rules, and a rule implemented once per reader is a chance for each
// reader to implement it differently. So the rules live here once.
//
// This module reaches nothing outside the language: no file, no clock, no
// hash. A reader given the corpus as data, inside a host with no filesystem,
// can import it; the loading that reads the copy off disk is
// `scripts/lib/corpus.mjs`, which re-exports everything here.
//
// The rules are the reference's, read in its `conformance/RATCHET.md` (vendored
// at `conformance/statifier/RATCHET.md`): the claim names, the five checks a
// sibling's registry check runs, the ordering and encoding of a registry, and
// the three ratchet rules. Where this file and that document disagree, that
// document wins.

/** The suites, in the order the corpus hash concatenates their files. */
export const SUITE_ORDER = Object.freeze(["scion", "w3c", "statifier"]);

/** The four claim names, sorted. */
export const CLAIM_NAMES = Object.freeze(["scion", "statifier", "w3c-mandatory", "w3c-optional"]);

/** This package's name in its own registry. */
export const IMPLEMENTATION = "statifier-ts";

/**
 * The claim a case counts toward: its suite, with the w3c suite split by the
 * case's conformance class. A w3c case with no class counts toward nothing,
 * which the registry check reports rather than guesses.
 */
export function claimOf(testCase) {
  if (testCase.suite === "w3c") {
    return testCase.conformance === "mandatory" || testCase.conformance === "optional"
      ? `w3c-${testCase.conformance}`
      : null;
  }
  return testCase.suite;
}

/** Orders entries by suite, then by case id, as the registry stores them. */
export function compareEntries(left, right) {
  if (left.suite !== right.suite) return left.suite < right.suite ? -1 : 1;
  if (left.case_id === right.case_id) return 0;
  return left.case_id < right.case_id ? -1 : 1;
}

/**
 * The sorted set of claim names the entries count toward. An entry whose case
 * the corpus lacks counts toward nothing here; rule 1 is where it fails.
 */
export function claimsOf(entries, casesById) {
  const claims = new Set();
  for (const entry of entries) {
    const testCase = casesById.get(entry.case_id);
    if (testCase === undefined) continue;
    const claim = claimOf(testCase);
    if (claim !== null) claims.add(claim);
  }
  return [...claims].sort();
}

/**
 * The registry as its file holds it: the four top-level keys in order, the
 * claims on one line, one entry per line, entries sorted by suite then case id
 * - the reference's encoding (`Mix.Statifier.Corpus.Registry.encode/1`). A
 * registry with no entries writes `[]`, as the record's worked example shows
 * the registry before its first claim.
 */
export function encodeRegistry(registry) {
  const entries = registry.entries
    .map((entry) => `    ${JSON.stringify({ case_id: entry.case_id, suite: entry.suite })}`)
    .join(",\n");
  const entriesText = registry.entries.length === 0 ? "[]" : `[\n${entries}\n  ]`;
  return (
    "{\n" +
    `  "implementation": ${JSON.stringify(registry.implementation)},\n` +
    `  "corpus_hash": ${JSON.stringify(registry.corpus_hash)},\n` +
    `  "claims": ${JSON.stringify(registry.claims)},\n` +
    `  "entries": ${entriesText}\n` +
    "}\n"
  );
}

/** Indexes every case of every suite by its id. */
export function indexCases(suites) {
  const casesById = new Map();
  for (const suite of suites) {
    for (const testCase of suite.cases) casesById.set(testCase.id, testCase);
  }
  return casesById;
}

/**
 * The four-hash check: the hash recomputed from the copy against each field
 * that must equal it. Answers one sentence per field that disagrees or is
 * absent; an empty list is agreement.
 *
 * Sabotage: comparing only the first field leaves a provenance record written
 * by hand undetected, and the corpus-check test that edits the provenance
 * record's hash goes red. It was run and reverted.
 */
export function hashFindings(computed, fields) {
  if (computed === null) return ["no corpus file: there is nothing to hash"];
  const findings = [];
  for (const [field, value] of fields) {
    if (value === undefined || value === null) {
      findings.push(`${field} is absent; the corpus hashes to ${computed}`);
    } else if (value !== computed) {
      findings.push(`${field} is ${value}; the corpus hashes to ${computed}`);
    }
  }
  return findings;
}

/**
 * The registry check: the five checks under "The check" in the reference's
 * RATCHET.md, given the registry, the vendored manifest's hash, the corpus's
 * suites and the results of a run made today. Answers `{ findings, claimMade }`:
 * every finding is a failure, and `claimMade` is false for the one registry
 * that makes no claim - the pin, no claims, no entries - which the record
 * holds lawful before the first claim and reports as no claim rather than as
 * a pass of anything.
 */
export function registryFindings({ registry, manifestHash, suites, results }) {
  const findings = [];
  const casesById = indexCases(suites);
  const caseCount = casesById.size;

  if (registry.implementation !== IMPLEMENTATION) {
    findings.push(
      `implementation is ${JSON.stringify(registry.implementation)}, not ${JSON.stringify(IMPLEMENTATION)}`,
    );
  }

  // 1. The pin.
  if (registry.corpus_hash !== manifestHash) {
    findings.push(
      `the pin: corpus_hash is ${registry.corpus_hash}, the vendored manifest's is ${manifestHash}`,
    );
  }

  // The order: entries sorted by suite then case id, as RATCHET.md stores
  // them. A registry reordered by hand is named here.
  //
  // Sabotage: dropping this check lets a reordered registry through, and the
  // registry test with two entries swapped goes red. It was run and reverted.
  for (let index = 1; index < registry.entries.length; index += 1) {
    const before = registry.entries[index - 1];
    const entry = registry.entries[index];
    if (compareEntries(before, entry) > 0) {
      findings.push(
        `the order: ${entry.case_id} comes after ${before.case_id}; entries are sorted by suite, then case id`,
      );
    }
  }

  // 2. Rule 1: every entry's case is in the pinned corpus, under its suite.
  const seen = new Set();
  for (const entry of registry.entries) {
    if (seen.has(entry.case_id)) findings.push(`${entry.case_id}: entered more than once`);
    seen.add(entry.case_id);
    const testCase = casesById.get(entry.case_id);
    if (testCase === undefined) {
      findings.push(`rule 1: ${entry.case_id} is in the registry but not in the corpus`);
    } else if (testCase.suite !== entry.suite) {
      findings.push(
        `rule 1: ${entry.case_id}: the registry says suite ${entry.suite}, the corpus says ${testCase.suite}`,
      );
    }
  }

  // 3. The claims are exactly the sorted set the entries count toward.
  const expectedClaims = claimsOf(registry.entries, casesById);
  if (JSON.stringify(registry.claims) !== JSON.stringify(expectedClaims)) {
    findings.push(
      `the claims: claims is ${JSON.stringify(registry.claims)}, the entries count toward ${JSON.stringify(expectedClaims)}`,
    );
  }

  // 4. The ratchet: every entry's case passes when run today.
  const resultById = new Map(results.map((result) => [result.case_id, result]));
  for (const entry of registry.entries) {
    if (!casesById.has(entry.case_id)) continue;
    const result = resultById.get(entry.case_id);
    if (result === undefined) {
      findings.push(`the ratchet: ${entry.case_id} was not run today`);
    } else if (result.result !== "pass") {
      findings.push(`the ratchet: ${entry.case_id} fails today: ${result.reason}`);
    }
  }

  // 5. Rule 3: there is something to check.
  if (caseCount === 0) findings.push("rule 3: there is no corpus case to read");
  if (results.length === 0) findings.push("rule 3: no case was run");

  const claimMade = registry.entries.length > 0 || registry.claims.length > 0;
  return { findings, claimMade };
}

/**
 * Checks one runner report against the corpus it claims to be a run of:
 * the pinned hash, a suite the corpus has, every case of that suite in the
 * corpus's order and nothing else, and each result `pass` or `fail` with a
 * reason on every `fail`. Answers one sentence per problem.
 */
export function reportFindings(report, manifestHash, suites) {
  const name = `the ${report.suite} report`;
  if (report.corpus_hash !== manifestHash) {
    return [`${name} is of corpus ${report.corpus_hash}, the vendored manifest is ${manifestHash}`];
  }
  const suite = suites.find((candidate) => candidate.suite === report.suite);
  if (suite === undefined) return [`${name} names a suite the corpus does not have`];
  const findings = [];
  const expected = suite.cases.map((testCase) => testCase.id);
  const actual = report.results.map((result) => result.case_id);
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    findings.push(
      `${name} is not a run of the whole suite: ${actual.length} results for ${expected.length} cases, or not in corpus order`,
    );
  }
  for (const result of report.results) {
    if (result.result === "fail") {
      if (typeof result.reason !== "string" || result.reason === "") {
        findings.push(`${name}: ${result.case_id} fails with no reason`);
      }
    } else if (result.result !== "pass") {
      findings.push(`${name}: ${result.case_id} reports ${JSON.stringify(result.result)}`);
    }
  }
  return findings;
}

/**
 * The ratchet: the registry a set of runner reports earns, or the refusal.
 *
 * Its only input is reports from a run. Every report must be a run of a whole
 * suite of the pinned corpus. Every entry already recorded must have passed in
 * these reports; if any did not, it refuses naming each such case and writes
 * nothing, and it never removes an entry to get past one. Otherwise the
 * registry is the union of the recorded entries and the cases the reports
 * passed, pinned to the vendored manifest's hash, with exactly the claims
 * those entries count toward. Answers `{ refusals }` or `{ registry, added }`.
 *
 * Sabotage: dropping the check on recorded entries lets a registry shrink
 * by omission, and the ratchet test whose recorded entry fails in the run goes
 * red. It was run and reverted.
 */
export function ratchet({ registry, reports, manifestHash, suites }) {
  const refusals = [];
  if (reports.length === 0) refusals.push("no report: there is no run to ratchet from");
  const seenSuites = new Set();
  for (const report of reports) {
    if (seenSuites.has(report.suite)) refusals.push(`two reports for the ${report.suite} suite`);
    seenSuites.add(report.suite);
    refusals.push(...reportFindings(report, manifestHash, suites));
  }
  if (refusals.length > 0) return { refusals };

  // A recorded entry under a suite the corpus does not put its case in is
  // refused, naming it, rather than carried into a registry whose claims are
  // then recomputed from the corpus's suite.
  //
  // Sabotage: dropping this check lets the ratchet rewrite the recorded
  // entry's suite and claims silently, and the ratchet test with a recorded
  // entry under the wrong suite goes red. It was run and reverted.
  const casesById = indexCases(suites);
  for (const entry of registry.entries) {
    const testCase = casesById.get(entry.case_id);
    if (testCase !== undefined && testCase.suite !== entry.suite) {
      refusals.push(
        `${entry.case_id} is recorded under suite ${entry.suite}; the corpus puts it in ${testCase.suite}`,
      );
    }
  }
  if (refusals.length > 0) return { refusals };

  const passed = new Set();
  for (const report of reports) {
    for (const result of report.results) {
      if (result.result === "pass") passed.add(result.case_id);
    }
  }
  for (const entry of registry.entries) {
    if (!passed.has(entry.case_id)) {
      refusals.push(`${entry.case_id} is recorded and did not pass in this run`);
    }
  }
  if (refusals.length > 0) return { refusals };

  const recorded = new Set(registry.entries.map((entry) => entry.case_id));
  const added = [];
  for (const id of passed) {
    if (!recorded.has(id)) added.push({ case_id: id, suite: casesById.get(id).suite });
  }
  const entries = [...registry.entries, ...added].sort(compareEntries);
  return {
    added: added.sort(compareEntries),
    registry: {
      implementation: IMPLEMENTATION,
      corpus_hash: manifestHash,
      claims: claimsOf(entries, casesById),
      entries,
    },
  };
}

/**
 * The reference's claim this package does not yet make: every entry of the
 * reference's registry, for the suites asked about, with no entry in ours.
 */
export function unclaimed(referenceRegistry, registry, suiteNames) {
  const ours = new Set(registry.entries.map((entry) => entry.case_id));
  return referenceRegistry.entries
    .filter((entry) => suiteNames.includes(entry.suite) && !ours.has(entry.case_id))
    .sort(compareEntries);
}
