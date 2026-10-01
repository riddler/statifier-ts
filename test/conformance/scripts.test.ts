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
import { CONFORMANCE_ROOT } from "../../scripts/lib/corpus.mjs";

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
  it("passes on the empty pinned registry and says no claim is made", () => {
    const result = run("scripts/registry-check.mjs", true);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no claim is made");
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
    registry.entries = [{ case_id: "scion/basic/basic0", suite: "scion" }];
    writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`);
    const result = run("scripts/registry-check.mjs", true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "the ratchet: scion/basic/basic0 fails today: core not implemented",
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
