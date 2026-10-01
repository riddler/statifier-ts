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
  loadManifest,
  loadProvenance,
  loadReferenceRegistry,
  loadRegistry,
  unclaimed,
} from "../scripts/lib/corpus.mjs";

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
    .replaceAll('from "@riddler/statifier"', `from ${JSON.stringify(ENTRY)}`);
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

  function caseCount(suite: string): number {
    const entry = corpus.suites.find((candidate) => candidate.suite === suite);
    if (entry === undefined) throw new Error(`the vendored manifest has no ${suite} suite`);
    return entry.case_count;
  }

  // Sabotage: the README's entry count typed one higher turns this red.
  it("states the claim the registry makes, with the counts read from it", () => {
    const match =
      /claims the `(\w+)` suite, with (\d+) entries in its registry out of the suite's (\d+) cases/.exec(
        text,
      );
    expect(match, "the claim sentence").not.toBeNull();
    const [, suite = "", entries, cases] = match ?? [];
    expect(registry.claims).toEqual([suite]);
    expect(Number(entries)).toBe(registry.entries.filter((entry) => entry.suite === suite).length);
    expect(Number(entries)).toBe(registry.entries.length);
    expect(Number(cases)).toBe(caseCount(suite));
  });

  // Sabotage: the README's w3c count typed one higher turns this red.
  it("states the gap the two registries leave, counted from them", () => {
    const match =
      /the (\d+) w3c cases and the (\d+) statifier cases the reference's own registry lists/.exec(
        text,
      );
    expect(match, "the gap sentence").not.toBeNull();
    const [, w3c, statifier] = match ?? [];
    expect(Number(w3c)).toBe(unclaimed(reference, registry, ["w3c"]).length);
    expect(Number(statifier)).toBe(unclaimed(reference, registry, ["statifier"]).length);
    expect(unclaimed(reference, registry, ["scion"])).toEqual([]);
  });

  it("states no number in the conformance section that is not read here", () => {
    const counted = new Set<number>([
      registry.entries.length,
      caseCount("scion"),
      unclaimed(reference, registry, ["w3c"]).length,
      unclaimed(reference, registry, ["statifier"]).length,
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
  // Sabotage: the position proof called a parity claim turns this red.
  it("calls the position proof a self-consistency claim", () => {
    const position = prose(section("Position export and import"));
    expect(position).toContain("is a self-consistency claim");
    expect(position).toContain("nothing here claims parity with it");
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

  // Sabotage: the engine sentence saying the proof is run turns this red.
  it("says the engine proof is not yet run", () => {
    expect(prose(section("Engines"))).toContain("the engine proof is not yet run");
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
