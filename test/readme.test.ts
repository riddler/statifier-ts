// The README as a tested reference.
//
// Every fenced block in README.md is accounted for here. A `ts` block is run
// as its own module, its `@riddler/statifier` import pointed at `src/`, and
// each line of the form `<expression>; // => <value>` becomes an assertion
// that the expression equals the value. A `bash` block is a list of commands,
// and each one is checked against what it names - a script `package.json`
// declares, the package's own name - rather than run: running the gate from
// inside the gate's own test stage is a loop. A block in any other language
// fails, so nothing in the README goes unchecked by being new.
//
// The numbers the README states about the claim, the gap, the corpus tag and
// the pins are read here from the registry, the reference's registry, the
// vendored manifest, the provenance record and `package.json`, and compared
// with the sentence that states them, so a count is never only typed.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import manifest from "../package.json";
import {
  claimOf,
  loadManifest,
  loadProvenance,
  loadReferenceRegistry,
  loadRegistry,
  loadSuites,
  unclaimed,
} from "../scripts/lib/corpus.mjs";
import { unclaimedByEither } from "./conformance/reports.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const README = readFileSync(join(ROOT, "README.md"), "utf8");
const ENTRY = pathToFileURL(resolve(ROOT, "src/index.ts")).href;

interface Fence {
  readonly lang: string;
  readonly line: number;
  readonly body: string;
}

/** Every fenced block, with the README line its opening fence is on. */
function fences(text: string): Fence[] {
  const lines = text.split("\n");
  const found: Fence[] = [];
  let open: { lang: string; line: number; body: string[] } | null = null;
  lines.forEach((line, index) => {
    const fence = /^```(\S*)\s*$/.exec(line);
    if (fence === null && /^\s*(```|~~~)/.test(line)) {
      throw new Error(`README.md line ${index + 1}: a fence this test does not read`);
    }
    if (open === null) {
      if (fence !== null) open = { lang: fence[1] ?? "", line: index + 1, body: [] };
    } else if (fence !== null && fence[1] === "") {
      found.push({ lang: open.lang, line: open.line, body: open.body.join("\n") });
      open = null;
    } else {
      open.body.push(line);
    }
  });
  if (open !== null) throw new Error("README.md has a fence that is never closed");
  return found;
}

/** The README's prose: every line outside a fence, whitespace runs folded. */
function prose(text: string): string {
  return text
    .replace(/^```[\s\S]*?^```$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** One section of the README, from its `## ` heading to the next. */
function section(heading: string): string {
  const start = README.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`README.md has no "## ${heading}" section`);
  const next = README.indexOf("\n## ", start + 1);
  return README.slice(start, next < 0 ? undefined : next);
}

const ASSERTION = /^(\s*)(.+?);\s*\/\/ => (.+)$/;

/**
 * The module a `ts` block runs as: the package import pointed at `src/`, and
 * each `// =>` line turned into a call to `check`. Answers the source and how
 * many assertions it carries.
 */
function exampleModule(block: Fence): { source: string; assertions: number } {
  let assertions = 0;
  const lines = block.body.split("\n").map((line, index) => {
    if (!/\/\/\s*=>/.test(line)) return line;
    const match = ASSERTION.exec(line);
    if (match === null) {
      throw new Error(
        `README.md line ${block.line + 1 + index}: a "// =>" line is not "<expression>; // => <value>"`,
      );
    }
    assertions += 1;
    const [, indent, actual, expected] = match;
    return `${indent}globalThis.__readme.check((${actual}), (${expected}), ${block.line + 1 + index});`;
  });
  const source = lines
    .join("\n")
    .split('from "@riddler/statifier"')
    .join(`from ${JSON.stringify(ENTRY)}`);
  if (source.includes("@riddler/statifier")) {
    throw new Error(
      `README.md line ${block.line}: an import of the package this test cannot point at src/`,
    );
  }
  return { source, assertions };
}

interface Checker {
  check(actual: unknown, expected: unknown, line: number): void;
  ran: number;
}

declare global {
  var __readme: Checker | undefined;
}

const scratch = mkdtempSync(join(tmpdir(), "statifier-readme-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Runs one `ts` block as a module and answers how many assertions ran. */
async function runExample(block: Fence, name: string): Promise<number> {
  const { source } = exampleModule(block);
  const checker: Checker = {
    ran: 0,
    check(actual, expected, line) {
      expect(actual, `README.md line ${line}`).toEqual(expected);
      this.ran += 1;
    },
  };
  globalThis.__readme = checker;
  const file = join(scratch, `${name}.ts`);
  writeFileSync(file, source);
  try {
    await import(pathToFileURL(file).href);
  } finally {
    globalThis.__readme = undefined;
  }
  return checker.ran;
}

const BLOCKS = fences(README);
const TS = BLOCKS.filter((block) => block.lang === "ts");
const BASH = BLOCKS.filter((block) => block.lang === "bash");

describe("the README's fenced blocks", () => {
  // Sabotage: a `json` fence appended to the README turns this red.
  it("are each a ts example or a bash command list", () => {
    expect(BLOCKS.length).toBeGreaterThan(0);
    expect(BLOCKS.filter((block) => block.lang !== "ts" && block.lang !== "bash")).toEqual([]);
    expect(TS.length).toBeGreaterThan(0);
  });

  // Sabotage: `configuration` answering `[]`, or `isDone` always answering
  // `done: false`, turns the examples red on their assertions.
  it.each(TS.map((block) => [block.line, block] as const))(
    "runs the example at README.md line %i, every assertion holding",
    async (line, block) => {
      const { assertions } = exampleModule(block);
      const ran = await runExample(block, `example-${line}`);
      expect(ran).toBe(assertions);
      expect(assertions).toBeGreaterThan(0);
    },
  );

  // Sabotage: `pnpm conformance` misspelt in the README turns this red.
  it("names only commands that exist", () => {
    const scripts = manifest.scripts as Record<string, string>;
    function checkCommand(command: string, line: number): void {
      const words = command.split(/\s+/);
      if (words[0] === "mise" && words[1] === "install" && words.length === 2) return;
      if (words[0] === "mise" && words[1] === "exec" && words[2] === "--") {
        checkCommand(words.slice(3).join(" "), line);
        return;
      }
      expect(words[0], `README.md line ${line}: ${command}`).toBe("pnpm");
      if (words[1] === "install") {
        expect(words.slice(2), `README.md line ${line}`).toEqual(["--frozen-lockfile"]);
      } else if (words[1] === "add") {
        expect(words.length, `README.md line ${line}`).toBe(3);
        expect(words[2], `README.md line ${line}`).toMatch(/^.+@\^\d+\.\d+\.\d+$/);
        expect(words[2]?.slice(0, words[2].lastIndexOf("@"))).toBe(manifest.name);
      } else {
        const script = words[1] === "run" ? words[2] : words[1];
        expect(words.length, `README.md line ${line}`).toBe(words[1] === "run" ? 3 : 2);
        expect(Object.keys(scripts), `README.md line ${line}: ${command}`).toContain(script);
      }
    }
    let commands = 0;
    for (const block of BASH) {
      block.body.split("\n").forEach((raw, index) => {
        const command = raw.replace(/\s+#.*$/, "").trim();
        if (command === "") return;
        commands += 1;
        checkCommand(command, block.line + 1 + index);
      });
    }
    expect(commands).toBeGreaterThan(0);
  });
});

describe("the README's numbers", () => {
  const text = prose(README);
  const registry = loadRegistry();
  const reference = loadReferenceRegistry();
  const corpus = loadManifest();
  const suites = loadSuites();
  const claimByCase = new Map(
    suites.flatMap((suite) => suite.cases).map((testCase) => [testCase.id, claimOf(testCase)]),
  );

  function caseCount(suite: string): number {
    const entry = corpus.suites.find((candidate) => candidate.suite === suite);
    if (entry === undefined) throw new Error(`the vendored manifest has no ${suite} suite`);
    return entry.case_count;
  }

  // The entries the registry holds toward one claim, read off the corpus.
  function claimEntries(claim: string): number {
    return registry.entries.filter((entry) => claimByCase.get(entry.case_id) === claim).length;
  }

  // The cases of the corpus one claim could cover.
  function claimCases(claim: string): number {
    return [...claimByCase.values()].filter((value) => value === claim).length;
  }

  // Sabotage: the README's w3c-mandatory entry count typed one higher turns
  // this red.
  it("states the claims the registry makes, with the counts read from it", () => {
    const total = /makes (\w+) claims, with (\d+) entries in its\s+registry/.exec(text);
    expect(total, "the claim sentence").not.toBeNull();
    expect(Number(total?.[2])).toBe(registry.entries.length);
    const claims = [
      ...text.matchAll(
        /`([\w-]+)` with (\d+) entries out of (?:the|its) [\w\s']*?(\d+) [\w\s]*?cases/g,
      ),
    ].map((found) => ({ claim: found[1], entries: Number(found[2]), cases: Number(found[3]) }));
    expect(claims.map((found) => found.claim)).toEqual(registry.claims);
    expect(total?.[1]).toBe(["zero", "one", "two", "three", "four"][claims.length]);
    for (const found of claims) {
      const claim = found.claim ?? "";
      expect(found.entries, claim).toBe(claimEntries(claim));
      expect(found.cases, claim).toBe(claimCases(claim));
    }
    expect(claims.reduce((sum, found) => sum + found.entries, 0)).toBe(registry.entries.length);
    expect(claimCases("scion")).toBe(caseCount("scion"));
    expect(claimCases("w3c-mandatory") + claimCases("w3c-optional")).toBe(caseCount("w3c"));
  });

  // Sabotage: the README's w3c count typed one higher turns this red, and so
  // does the sentence that claims every case the reference lists while one is
  // unclaimed. The statifier clause is left out when no statifier case is
  // unclaimed, and the counted clause gives way to that sentence when no case
  // the reference lists is unclaimed.
  it("states the gap the two registries leave, counted from them", () => {
    const match =
      /(?:the (\d+) w3c cases?(?: and the (\d+) statifier cases?)?\s+the reference's own registry lists that this package's does not, nor|it\s+claims\s+every\s+case\s+the\s+reference's\s+own\s+registry\s+lists,\s+and\s+does\s+not\s+yet\s+claim)\s+the (\d+) w3c\s+cases the reference's registry does not\s+list either/.exec(
        text,
      );
    expect(match, "the gap sentence").not.toBeNull();
    const [, w3c, statifier, neither] = match ?? [];
    expect(Number(w3c ?? 0)).toBe(unclaimed(reference, registry, ["w3c"]).length);
    expect(Number(statifier ?? 0)).toBe(unclaimed(reference, registry, ["statifier"]).length);
    expect(Number(neither)).toBe(unclaimedByEither(reference, registry, suites, ["w3c"]).length);
    expect(unclaimed(reference, registry, ["scion"])).toEqual([]);
    expect(unclaimedByEither(reference, registry, suites, ["scion", "statifier"])).toEqual([]);
  });

  it("states no number in the conformance section that is not read here", () => {
    const counted = new Set<number>([
      registry.entries.length,
      ...registry.claims.flatMap((claim) => [claimEntries(claim), claimCases(claim)]),
      unclaimed(reference, registry, ["w3c"]).length,
      unclaimed(reference, registry, ["statifier"]).length,
      unclaimedByEither(reference, registry, suites, ["w3c"]).length,
    ]);
    const words = prose(section("Conformance")).replace(/`v[\d.]+`/g, "");
    const numbers = [...words.matchAll(/\b\d+\b/g)].map((found) => Number(found[0]));
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.filter((value) => !counted.has(value))).toEqual([]);
  });

  it("names the corpus tag the provenance record holds", () => {
    const match = /copied byte for byte from the reference at tag `(v[^`]+)`/.exec(text);
    expect(match?.[1]).toBe(loadProvenance().tag);
  });

  it("names the pins package.json holds", () => {
    const deps = manifest.dependencies as Record<string, string>;
    expect(Object.keys(deps)).toEqual(["@riddler/predicator"]);
    expect(/pinned at `([^`]+)`/.exec(text)?.[1]).toBe(deps["@riddler/predicator"]);
    expect(/`engines\.node` in `package\.json` is `([^`]+)`/.exec(text)?.[1]).toBe(
      manifest.engines.node,
    );
  });
});

describe("the README's claims", () => {
  // Sabotage: the position proof called a parity claim, or the parity claim
  // left unbounded, turns this red. Each was run and reverted.
  it("calls the position proof a self-consistency claim, and bounds the parity claim to the cases that state a position", () => {
    const position = prose(section("Position export and import"));
    expect(position).toContain("is a self-consistency claim");
    expect(position).toContain(
      "Parity with the reference's export is claimed for those cases and no further.",
    );
    expect(position).not.toContain("which the reference does not emit yet");
  });

  // Sabotage: `position` dropped from the gate script turns this red.
  it("calls a gate stage only what the gate script runs", () => {
    const gate = manifest.scripts.gate;
    const named = [...prose(README).matchAll(/`pnpm (?:run )?(\w[\w:]*)`?,? a gate stage/g)].map(
      (found) => found[1],
    );
    const commented = [...README.matchAll(/^pnpm (\w[\w:]*)\s+#.*a gate stage$/gm)].map(
      (found) => found[1],
    );
    const stages = [...named, ...commented];
    expect(stages.length).toBeGreaterThan(0);
    for (const stage of stages) expect(gate).toContain(`pnpm run ${stage}`);
    expect(prose(section("Engines"))).toContain("The neutrality lint, a gate stage");
    expect(gate).toContain("pnpm run neutrality");
  });

  // Sabotage: dropping either limit from the engine paragraph turns this red.
  it("states the engine proof with the limits of what it ran", () => {
    const engines = prose(section("Engines"));
    expect(engines).not.toContain("not yet run");
    expect(engines).toContain("not a run on the engine build an application ships");
    expect(engines).toContain("not a network round trip on a device");
  });

  // Sabotage: a typed row count that no suite holds turns this red.
  it("states the engine proof's rows as the vendored suites' case counts", () => {
    const engines = prose(section("Engines"));
    const rows = /scion (\d+) rows, w3c (\d+) and statifier (\d+)/.exec(engines);
    expect(rows).not.toBeNull();
    const counts = new Map(loadSuites().map((suite) => [suite.suite, suite.cases.length]));
    expect(rows?.slice(1).map(Number)).toEqual([
      counts.get("scion"),
      counts.get("w3c"),
      counts.get("statifier"),
    ]);
  });
});

interface ProofRecord {
  readonly date: string;
  readonly commit: string;
  readonly corpus_tag: string;
  readonly predicator: string;
  readonly vm_release: string;
  readonly bytecode_version: number;
  readonly suites: readonly {
    readonly suite: string;
    readonly node_rows: number;
    readonly vm_rows: number;
    readonly differences: number;
  }[];
}

/** The record the engine proof wrote with `--record`, which the dated values are held to. */
const PROOF: ProofRecord = JSON.parse(
  readFileSync(join(ROOT, "conformance", "engine-proof.json"), "utf8"),
);

/** The last dated result in conformance/README.md's "The engine proof" section. */
function lastProofResult(): string {
  const text = readFileSync(join(ROOT, "conformance", "README.md"), "utf8");
  const start = text.indexOf("\n## The engine proof\n");
  if (start < 0) throw new Error('conformance/README.md has no "## The engine proof" section');
  const next = text.indexOf("\n## ", start + 1);
  const proof = text.slice(start, next < 0 ? undefined : next);
  const results = proof.split("\n**The result, ");
  if (results.length < 2) throw new Error("the engine proof section states no result");
  return `**The result, ${results[results.length - 1]}`;
}

describe("the engine proof's dated values", () => {
  // Sabotage: the bytecode version typed as 88, and the commit typed as
  // another, in the Engines paragraph each turn this red. Each was run and
  // reverted.
  it("are, in the README's Engines paragraph, the values the recorded run wrote", () => {
    const engines = prose(section("Engines"));
    expect(engines).toContain(`last run on ${PROOF.date}, at commit \`${PROOF.commit}\` on`);
    expect(engines).toContain(`over the corpus at \`${PROOF.corpus_tag}\``);
    expect(engines).toContain(`\`@riddler/predicator\` ${PROOF.predicator} installed`);
    expect(engines).toContain(
      `release ${PROOF.vm_release}, bytecode version ${PROOF.bytecode_version}:`,
    );
    const rows = /scion (\d+) rows, w3c (\d+) and statifier (\d+)/.exec(engines);
    const counts = new Map(PROOF.suites.map((suite) => [suite.suite, suite]));
    for (const [index, name] of ["scion", "w3c", "statifier"].entries()) {
      expect(Number(rows?.[index + 1])).toBe(counts.get(name)?.node_rows);
      expect(counts.get(name)?.vm_rows).toBe(counts.get(name)?.node_rows);
    }
    expect(PROOF.suites.every((suite) => suite.differences === 0)).toBe(true);
    expect(engines).toContain("with zero differences");
  });

  // Sabotage: a VM row count typed as 167 in the last result's table, and the
  // release typed as 0.11.0 in its paragraph, each turn this red. Each was
  // run and reverted.
  it("are, in conformance/README.md's last result, the values the recorded run wrote", () => {
    const result = lastProofResult();
    const words = result.replace(/\s+/g, " ");
    expect(words.startsWith(`**The result, ${PROOF.date},`)).toBe(true);
    expect(words).toContain(`commit \`${PROOF.commit}\``);
    expect(words).toContain(`\`@riddler/predicator\` ${PROOF.predicator} installed`);
    expect(words).toContain(`the corpus at \`${PROOF.corpus_tag}\``);
    expect(words).toContain(
      `release ${PROOF.vm_release}, bytecode version ${PROOF.bytecode_version}`,
    );
    const table = [...result.matchAll(/^\| `(\w+)` \| (\d+) \| (\d+) \| (\d+) \|$/gm)].map(
      (row) => ({
        suite: row[1],
        node_rows: Number(row[2]),
        vm_rows: Number(row[3]),
        differences: Number(row[4]),
      }),
    );
    expect(table).toEqual(PROOF.suites);
  });
});

describe("the README's links", () => {
  // Sabotage: a relative link to docs/ (not in `files`) turns this red.
  it("links by relative path only to a file the package ships", () => {
    const shipped = manifest.files as string[];
    const relative = [...prose(README).matchAll(/\]\(([^)]+)\)/g)]
      .map((found) => found[1] ?? "")
      .filter((target) => !/^(?:[a-z]+:|#)/.test(target));
    for (const target of relative) {
      const path = target.split("#")[0] ?? "";
      expect(
        shipped.some((entry) => path === entry || path.startsWith(`${entry}/`)),
        `${target} leaves the package's files`,
      ).toBe(true);
    }
  });
});

describe("the example harness", () => {
  // Sabotage: making `check` pass without comparing turns this red.
  it("fails an example whose assertion does not hold", async () => {
    const block: Fence = {
      lang: "ts",
      line: 1,
      body: 'import { configuration } from "@riddler/statifier";\nconst n = 1 + 1;\nn; // => 3',
    };
    await expect(runExample(block, "planted-failure")).rejects.toThrow(/README\.md line 4/);
  });

  it("refuses a // => line it cannot read as an assertion", () => {
    for (const body of ["const n = 2 // => 2", "const n = 2; //=> 2"]) {
      const block: Fence = { lang: "ts", line: 1, body };
      expect(() => exampleModule(block)).toThrow(/is not "<expression>; \/\/ => <value>"/);
    }
  });

  // Sabotage: an assertion inside a branch that never runs counts fewer
  // assertions run than written, which the example test compares.
  it("counts an assertion that never runs as not run", async () => {
    const block: Fence = { lang: "ts", line: 1, body: "if (Number.NaN > 0) {\n  1; // => 1\n}" };
    expect(exampleModule(block).assertions).toBe(1);
    expect(await runExample(block, "never-reached")).toBe(0);
  });

  it("refuses an import of the package it cannot point at src/", () => {
    const block: Fence = {
      lang: "ts",
      line: 1,
      body: "import { start } from '@riddler/statifier';",
    };
    expect(() => exampleModule(block)).toThrow(/cannot point at src/);
  });

  it("refuses a fence it does not read", () => {
    expect(() => fences("text\n  ```ts\n1;\n  ```\n")).toThrow(/a fence this test does not read/);
    expect(() => fences("~~~ts\n1;\n~~~\n")).toThrow(/a fence this test does not read/);
  });
});
