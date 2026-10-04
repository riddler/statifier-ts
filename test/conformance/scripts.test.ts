// The corpus check, the registry check and the position round-trip stage, run
// as the gate runs them, against a copy of the conformance directory a test
// has altered. The copy lives in a temporary directory and is removed after
// each test; nothing here touches this repository's own conformance directory.

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
      expect(result.stderr).toContain(`${field} is sha256:0477273e`);
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
      expect(result.stderr).toContain(`${field} is sha256:0477273e`);
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
    expect(result.stdout).toMatch(
      /registry: \d+ entries pass today; claims \["scion","statifier","w3c-mandatory","w3c-optional"\]/,
    );
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
    registry.claims = ["w3c-mandatory"];
    registry.entries = [{ case_id: "w3c/test330", suite: "w3c" }];
    writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`);
    const result = run("scripts/registry-check.mjs", true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "the ratchet: w3c/test330 fails today: the initial configuration: expected active leaf states [pass], got [fail]",
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

describe("the position round-trip stage", () => {
  it("passes on the corpus as vendored and prints the points, the agreements and each reason", () => {
    const result = run("scripts/position-check.mjs", true);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^position: \d+ points over \d+ scion cases \(/);
    expect(result.stdout).toMatch(/position: \d+ round trips agree, 0 disagree\n/);
    expect(result.stdout).toMatch(/position: \d+ points not carried/);
  });

  // One parcel case, written over the copy's scion corpus.
  function onlyCase(source: string, steps: unknown[] = []) {
    const path = join(root, "statifier", "corpus", "scion.json");
    const corpus = JSON.parse(readFileSync(path, "utf8"));
    const parcel = {
      id: "scion/parcel/route0",
      suite: "scion",
      spec: "parcel",
      conformance: null,
      description: "",
      required_features: ["basic_states"],
      source,
      initial_configuration: ["depot"],
      steps,
    };
    writeFileSync(path, JSON.stringify({ ...corpus, cases: [parcel] }));
  }

  const SCXML = 'xmlns="http://www.w3.org/2005/07/scxml" version="1.0"';

  // The depot sorts a parcel 50 ms after it arrives, so the one point, its
  // start, is not carried for its pending timer: an expected reason, but
  // nothing was compared. Sabotage: exiting on disagreements alone, as the
  // stage did, turns this red. It was run and reverted.
  it("fails a run where no point agrees, rather than holding over nothing", () => {
    onlyCase(`<scxml ${SCXML} initial="depot">
      <state id="depot">
        <onentry><send event="parcel.sorted" delay="50ms"/></onentry>
        <transition event="parcel.sorted" target="sorted"/>
      </state>
      <state id="sorted"/>
    </scxml>`);
    const result = run("scripts/position-check.mjs", true);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("position: 1 points not carried: pending_timers 1\n");
    expect(result.stderr).toContain(
      "position: no round trip agrees over 1 points, so nothing was compared\n",
    );
  });

  // The van holds a state with no written id, which the export refuses to
  // name; the depot's start agrees. Sabotage: as above, run and reverted.
  it("fails a point not carried for a reason outside the two expected", () => {
    onlyCase(
      `<scxml ${SCXML} initial="depot">
        <state id="depot"><transition event="parcel.loaded" target="van"/></state>
        <state id="van"><state/></state>
      </scxml>`,
      [{ event: { name: "parcel.loaded" }, configuration: ["van"] }],
    );
    const result = run("scripts/position-check.mjs", true);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("position: 1 round trips agree, 0 disagree\n");
    expect(result.stderr).toContain(
      "position: 1 points not carried for unnameable_states, outside the expected internal_queue_not_empty and pending_timers\n",
    );
  });

  // Sabotage: answering success when the suite is empty, as a property over
  // no point vacuously holds, turns this red. It was run and reverted.
  it("fails when the corpus holds no scion case, rather than holding over nothing", () => {
    const path = join(root, "statifier", "corpus", "scion.json");
    const corpus = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...corpus, cases: [] }));
    const result = run("scripts/position-check.mjs", true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("position: the vendored corpus holds no scion case to run");
  });
});
