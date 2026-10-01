// The corpus check and the registry check, run as the gate runs them, against
// a copy of the conformance directory a test has altered. The copy lives in a
// temporary directory and is removed after each test; nothing here touches
// this repository's own conformance directory.

import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFORMANCE_ROOT, encodeRegistry } from "../../scripts/lib/corpus.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
let root = "";

beforeEach(() => {
  const scratch = mkdtempSync(join(tmpdir(), "statifier-conformance-"));
  root = join(scratch, "conformance");
  cpSync(CONFORMANCE_ROOT, root, { recursive: true });
});

afterEach(() => {
  rmSync(join(root, ".."), { recursive: true, force: true });
});

function run(script: string, viaTsx = false) {
  const args = viaTsx ? ["--import", "tsx", script, "--root", root] : [script, "--root", root];
  return spawnSync(process.execPath, args, { cwd: repoRoot, encoding: "utf8" });
}

describe("corpus:check", () => {
  it("passes on the copy as vendored", () => {
    const result = run("scripts/corpus-check.mjs");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  // The planted byte flip: one byte of the scion corpus file changed, so the
  // copy no longer hashes to any of the four fields, and each is named.
  it("fails on a flipped byte in the scion corpus file, naming all four fields", () => {
    const path = join(root, "statifier", "corpus", "scion.json");
    const bytes = readFileSync(path);
    const at = bytes.indexOf("basic0");
    bytes[at] = bytes[at] === 0x62 ? 0x63 : 0x62;
    writeFileSync(path, bytes);
    const result = run("scripts/corpus-check.mjs");
    expect(result.status).toBe(1);
    for (const field of [
      "the vendored manifest's corpus_hash",
      "the provenance record's corpus_hash",
      "this package's registry's corpus_hash",
      "the vendored reference registry's corpus_hash",
    ]) {
      expect(result.stderr).toContain(`${field} is sha256:c79612f0`);
    }
  });

  // A flip that breaks the scion file's JSON structure: the four fields are
  // still named, beside the file that does not parse, and nothing crashes.
  // Sabotage: parsing the suite file with no guard lets the SyntaxError escape
  // before the fields are named, and this goes red. It was run and reverted.
  it("fails on a structure-breaking byte flip, naming the file and all four fields", () => {
    const path = join(root, "statifier", "corpus", "scion.json");
    const bytes = readFileSync(path);
    bytes[bytes.indexOf("{")] = 0x5b;
    writeFileSync(path, bytes);
    const result = run("scripts/corpus-check.mjs");
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("SyntaxError");
    expect(result.stderr).toContain("corpus/scion.json is not JSON: ");
    for (const field of [
      "the vendored manifest's corpus_hash",
      "the provenance record's corpus_hash",
      "this package's registry's corpus_hash",
      "the vendored reference registry's corpus_hash",
    ]) {
      expect(result.stderr).toContain(`${field} is sha256:c79612f0`);
    }
  });

  it("fails on a provenance record whose hash was written by hand, naming only that field", () => {
    const path = join(root, "statifier.vendored.json");
    const record = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(
      path,
      `${JSON.stringify({ ...record, corpus_hash: `sha256:${"0".repeat(64)}` })}\n`,
    );
    const result = run("scripts/corpus-check.mjs");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("1 problems");
    expect(result.stderr).toContain(
      `the provenance record's corpus_hash is sha256:${"0".repeat(64)}`,
    );
  });

  it("fails when there is no corpus file at all", () => {
    rmSync(join(root, "statifier", "corpus"), { recursive: true, force: true });
    const result = run("scripts/corpus-check.mjs");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no corpus file: there is nothing to hash");
  });
});

describe("the registry check", () => {
  it("passes on the registry as committed and reports the claim it checked", () => {
    const result = run("scripts/registry-check.mjs", true);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/registry: \d+ entries pass today; claims \["scion"\]/);
  });

  it("passes on the empty pinned registry and says no claim is made", () => {
    const path = join(root, "registry.json");
    const registry = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, encodeRegistry({ ...registry, claims: [], entries: [] }));
    const result = run("scripts/registry-check.mjs", true);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no claim is made");
  });

  // Sabotage: comparing the file with the encoding of its entries in the order
  // given, and dropping the order check, passes this file. It was run and
  // reverted.
  it("fails on a registry whose entries were reordered by hand", () => {
    const path = join(root, "registry.json");
    const registry = JSON.parse(readFileSync(path, "utf8"));
    const [first, second, ...rest] = registry.entries;
    writeFileSync(path, encodeRegistry({ ...registry, entries: [second, first, ...rest] }));
    const result = run("scripts/registry-check.mjs", true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `the order: ${first.case_id} comes after ${second.case_id}; entries are sorted by suite, then case id`,
    );
  });

  // A hand-added entry: a case id the corpus lacks, with the claim beside it.
  it("fails on a hand-added entry, under rule 1, naming the case", () => {
    const path = join(root, "registry.json");
    const registry = JSON.parse(readFileSync(path, "utf8"));
    registry.claims = ["scion"];
    registry.entries = [{ case_id: "scion/basic/basic99", suite: "scion" }];
    writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`);
    const result = run("scripts/registry-check.mjs", true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "rule 1: scion/basic/basic99 is in the registry but not in the corpus",
    );
  });

  it("fails on an entry the corpus has but that does not pass today", () => {
    const path = join(root, "registry.json");
    const registry = JSON.parse(readFileSync(path, "utf8"));
    registry.claims = ["scion"];
    registry.entries = [{ case_id: "scion/script/test0", suite: "scion" }];
    writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`);
    const result = run("scripts/registry-check.mjs", true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "the ratchet: scion/script/test0 fails today: missing feature script_elements",
    );
  });

  it("fails on a registry reflowed by hand", () => {
    const path = join(root, "registry.json");
    writeFileSync(path, `${JSON.stringify(JSON.parse(readFileSync(path, "utf8")))}\n`);
    const result = run("scripts/registry-check.mjs", true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not in the encoding the ratchet writes");
  });
});
