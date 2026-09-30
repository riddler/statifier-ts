// The tarball is built from the tree it is cut from, and carries no source
// text inside its maps.
//
//   node scripts/publish-guard.mjs
//
// This runs as the package's `prepack` script, so it runs on `npm pack` and
// on `npm publish` alike and on neither `npm install` nor `pnpm install`.
// That placement is the whole design: publishing is the one irreversible act
// here - a version number cannot be republished, and retiring it does not
// free it - while installing happens on every machine many times a day and
// must stay cheap.
//
// What it exists to stop happened. A published version carried a build made
// the day before its own tree: the build directory is not tracked, nothing
// rebuilt it, and the publish packed whatever was sitting there. The bytes
// that shipped were an earlier build's - including its maps, which still
// embedded the source that the build config had since stopped embedding, so
// the tarball carried the source three times over and unpacked to far more
// than the tree it was cut from. Nothing in the output said so. A
// checklist step telling a person to build first is exactly the step a person
// skips at the end of a release, so the refusal has to be mechanical.
//
// Four checks, in the order that matters:
//
//   1. the build runs from a removed output directory, so what is packed
//      cannot predate the tree - this alone answers the defect above, and the
//      three below are what catch it if the build itself is misconfigured;
//   2. no emitted map carries embedded source content, which is the one-line
//      property the shipped maps violated;
//   3. the files those maps point at are files the tarball will contain;
//   4. every file the manifest's entry points name exists in the output, so a
//      build that half-succeeded cannot pass for a build, and is a file the
//      tarball will contain, so a build that is never shipped cannot either.
//
// Checks 2 and 3 are one decision read from both ends, not two checks that
// happen to sit together. The build stopped embedding source text in its maps
// and the manifest's file list started shipping the source directory instead,
// and each half is worthless alone: source text back in the maps is bloat, and
// a file list that stops shipping the source leaves every map pointing at a
// file the tarball does not contain, which is a map that resolves to nothing.
// Undoing either half breaks the maps, so the guard refuses on either half.
// Both read the emitted bytes rather than the config that produced them - a
// config is a claim, and the map is the evidence - and check 3 follows each
// map's own `sources` entries wherever they lead rather than looking for a
// directory named here, so it still holds if the build's layout moves.
//
// Check 4 walks the manifest itself rather than a list written here, so a new
// entry point is covered with no edit: the top-level `main` and `types`, and
// every string leaf of the `exports` map, whatever conditions it nests under.
//
// What the tarball will contain, for checks 3 and 4, is asked of the packaging
// tool rather than worked out from the manifest's file list here: the list's
// rules are the tool's, and a guard that models them by hand is making a claim
// about the tool. Why, and how it is asked, is in
// `scripts/lib/publish-checks.mjs`, which holds checks 2 to 4 so they can be
// run against a throwaway package as well as this one.
//
// A refusal exits non-zero, which stops the pack or the publish before a
// tarball exists.
//
// One consequence worth knowing rather than discovering: a `prepack` script
// writes to the pack's own standard output, so `npm pack --json` no longer
// answers parseable JSON here - this script's lines and the bundler's come
// first. Nothing in this repository parses that output, and the fix is to read
// the tarball rather than npm's report of it. Silencing the build to keep the
// stream clean is the wrong trade: a build whose output nobody sees is how the
// defect above stayed invisible.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBuildOutput } from "./lib/publish-checks.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const failures = [];

function die(message) {
  console.error(`publish-guard: ${message}`);
  process.exit(1);
}

function check(label, condition) {
  if (condition) {
    console.log(`publish-guard: ok   ${label}`);
  } else {
    console.error(`publish-guard: FAIL ${label}`);
    failures.push(label);
  }
}

// 1. Build from clean.
//
// `tsup` is configured to clean its own output, but the removal is done here
// as well and before it: a build that fails to start leaves the previous
// output in place, and that stale directory is precisely what must not be
// packable. Removing it first means a failed build has nothing to fall back
// on.

const outDir = join(packageRoot, "dist");
rmSync(outDir, { recursive: true, force: true });
console.log("publish-guard: removed the output directory");

// The build is run as the manifest's own `build` script rather than by naming
// the bundler here, so the two cannot drift apart. `npm run` is used whichever
// package manager invoked this: a run script is a shell string either way, and
// `npm` is on the path wherever node is. `npm_execpath` is not used - it is
// unset under this repo's package manager, which ships as a native binary
// rather than as a script node could be pointed at.
const built = spawnSync("npm", ["run", "build"], {
  cwd: packageRoot,
  stdio: "inherit",
});

if (built.status !== 0) {
  die(`the build failed (exit ${built.status ?? "signal"}); nothing is packable`);
}
console.log("publish-guard: ok   the build ran from a removed output directory");

if (!existsSync(outDir)) {
  die("the build wrote no output directory");
}

// 2 to 4. What the build wrote, and what the tarball will carry of it.

const { checks, stop } = checkBuildOutput(packageRoot);
for (const { label, ok } of checks) {
  check(label, ok);
}
if (stop !== null) {
  die(stop);
}

if (failures.length > 0) {
  console.error("");
  if (failures.some((label) => label.includes("is shipped, so"))) {
    console.error(
      "publish-guard: the maps and the manifest's file list are one decision. The build stops",
    );
    console.error(
      "publish-guard: embedding source text in the maps only because the file list ships that",
    );
    console.error(
      "publish-guard: source instead; a file list that stops shipping it leaves every map",
    );
    console.error(
      "publish-guard: pointing at a file the tarball does not contain. Restore the half that",
    );
    console.error("publish-guard: was dropped, or change both halves together and deliberately.");
    console.error("");
  }
  die(
    "refusing to pack this output. The checks above that read FAIL say what is wrong with it; " +
      "a published version cannot be replaced, so this stops here rather than shipping it.",
  );
}

console.log("publish-guard: the output was built from this tree and is packable");
