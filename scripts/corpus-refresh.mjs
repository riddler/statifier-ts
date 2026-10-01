// Vendors the reference's conformance corpus into this repository, by the
// reference's own recipe.
//
//   node scripts/corpus-refresh.mjs --tag <tag> [--from <git dir>] [--check]
//
// The recipe is the sequence under "Vendoring the corpus" in the reference's
// `conformance/RATCHET.md`, with DEST set to `conformance/statifier`, and this
// script does what it does: every file under `conformance/` at the tag,
// written through `git show` as git stores it, with no edit of any kind; the
// copy's corpus hash recomputed and required to equal its manifest's; and the
// provenance record `{repo, tag, sha, corpus_hash}` written as one line beside
// the copy, at `conformance/statifier.vendored.json`. Nothing is written until
// the copy has hashed to its manifest's hash.
//
// `--from` names a local git checkout or clone of the reference to read the
// tag from; without it the reference is cloned bare from its public URL into a
// temporary directory, as the recipe does. Either way the tag must exist as a
// tag - a branch is never what is recorded - and the record names the public
// repository, never the local path.
//
// A refresh is a reviewed change, never a silent update: it refuses when the
// copy or the provenance record has uncommitted changes, so it never overwrites
// work that is not in git, and its diff is reviewed like code. No gate stage
// and no test runs it.
//
// `--check` re-runs the recipe into a temporary directory and compares, file by
// file, with the copy and the provenance record already here, writing nothing.
// The recipe reproduces a copy exactly, so a difference means the copy was
// edited. Every difference is named and the exit is 1.

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFORMANCE_ROOT,
  computeCorpusHash,
  PROVENANCE_FILE,
  REFERENCE_REPO,
  VENDORED_DIR,
} from "./lib/corpus.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

function usage(problem) {
  process.stderr.write(`corpus:refresh: ${problem}\n\n`);
  process.stderr.write(
    "usage: node scripts/corpus-refresh.mjs --tag <tag> [--from <git dir>] [--check]\n",
  );
  process.exit(2);
}

function refuse(problem) {
  process.stderr.write(`corpus:refresh: ${problem}\n`);
  process.exit(1);
}

function readArguments(argv) {
  const parsed = { tag: null, from: null, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--check") {
      parsed.check = true;
      continue;
    }
    if (flag === "--tag" || flag === "--from") {
      const value = argv[index + 1];
      if (value === undefined) usage(`${flag} wants a value`);
      parsed[flag.slice(2)] = value;
      index += 1;
      continue;
    }
    usage(`unknown argument ${flag}`);
  }
  if (parsed.tag === null) usage("no tag: pass --tag, the reference tag to vendor");
  return parsed;
}

function git(gitDir, args, options = {}) {
  return execFileSync("git", ["-C", gitDir, ...args], { maxBuffer: 1 << 28, ...options });
}

/** The commit a tag resolves to; refuses a name that is not a tag. */
function resolveTag(gitDir, tag) {
  try {
    git(gitDir, ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], { stdio: "ignore" });
  } catch {
    refuse(`${tag} is not a tag in ${gitDir}; a tag is what is recorded, never a branch`);
  }
  return git(gitDir, ["rev-parse", `${tag}^{commit}`], { encoding: "utf8" }).trim();
}

/** Every file under conformance/ at the commit, written into `dest` as git stores it. */
function copyAt(gitDir, sha, dest) {
  const listing = git(gitDir, ["ls-tree", "-r", "--name-only", sha, "--", "conformance/"], {
    encoding: "utf8",
  });
  const paths = listing.split("\n").filter((line) => line !== "");
  if (paths.length === 0) refuse(`there is no conformance/ at ${sha}`);
  for (const path of paths) {
    const out = join(dest, path.slice("conformance/".length));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, git(gitDir, ["show", `${sha}:${path}`]));
  }
  return paths.length;
}

function filesUnder(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(relative(root, path));
    }
  };
  if (existsSync(root)) walk(root);
  return found.sort();
}

/** Uncommitted changes to the copy or the record, as git reports them. */
function dirtyPaths() {
  const output = execFileSync(
    "git",
    [
      "-C",
      repoRoot,
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      join("conformance", VENDORED_DIR),
      join("conformance", PROVENANCE_FILE),
    ],
    { encoding: "utf8" },
  );
  return output.split("\n").filter((line) => line !== "");
}

function main() {
  const parsed = readArguments(process.argv.slice(2));
  const scratch = mkdtempSync(join(tmpdir(), "statifier-corpus-"));
  try {
    let gitDir = parsed.from;
    if (gitDir === null) {
      gitDir = join(scratch, "reference.git");
      execFileSync("git", ["clone", "--quiet", "--bare", REFERENCE_REPO, gitDir]);
    }
    const sha = resolveTag(gitDir, parsed.tag);
    const stagedRoot = join(scratch, "root");
    const staged = join(stagedRoot, VENDORED_DIR);
    const count = copyAt(gitDir, sha, staged);

    const manifest = JSON.parse(readFileSync(join(staged, "manifest.json"), "utf8"));
    const computed = computeCorpusHash(stagedRoot);
    if (computed === null) refuse(`the copy at ${parsed.tag} has no corpus file`);
    if (computed !== manifest.corpus_hash) {
      refuse(
        `the copy at ${parsed.tag} hashes to ${computed}, its manifest says ${manifest.corpus_hash}`,
      );
    }
    const record = `${JSON.stringify({
      repo: REFERENCE_REPO,
      tag: parsed.tag,
      sha,
      corpus_hash: computed,
    })}\n`;

    const dest = join(CONFORMANCE_ROOT, VENDORED_DIR);
    const recordPath = join(CONFORMANCE_ROOT, PROVENANCE_FILE);

    if (parsed.check) {
      const differences = [];
      const ours = filesUnder(dest);
      const theirs = filesUnder(staged);
      for (const path of theirs) {
        if (!ours.includes(path)) differences.push(`${path}: at the tag, absent from the copy`);
        else if (!readFileSync(join(dest, path)).equals(readFileSync(join(staged, path)))) {
          differences.push(`${path}: differs from the tag`);
        }
      }
      for (const path of ours) {
        if (!theirs.includes(path)) differences.push(`${path}: in the copy, absent at the tag`);
      }
      const recordHere = existsSync(recordPath) ? readFileSync(recordPath, "utf8") : null;
      if (recordHere !== record) {
        differences.push(`${PROVENANCE_FILE}: is not the record the recipe writes at the tag`);
      }
      process.stdout.write(`corpus:refresh --check: ${parsed.tag} (${sha}), ${count} files\n`);
      for (const difference of differences) process.stdout.write(`  ${difference}\n`);
      if (differences.length > 0) {
        refuse(`${differences.length} differences; the copy is not the tag's`);
      }
      process.stdout.write("the copy and the record are the tag's, byte for byte\n");
      return;
    }

    const dirty = dirtyPaths();
    if (dirty.length > 0) {
      refuse(
        `the copy or its record has uncommitted changes; commit or discard them first:\n${dirty.join("\n")}`,
      );
    }
    rmSync(dest, { recursive: true, force: true });
    cpSync(staged, dest, { recursive: true });
    writeFileSync(recordPath, record);
    process.stdout.write(
      `corpus:refresh: ${count} files from ${parsed.tag} (${sha}) into conformance/${VENDORED_DIR}, ${computed}\n`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main();
