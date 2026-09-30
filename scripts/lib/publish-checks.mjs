// The checks the publish guard makes of a build that has already run, apart
// from the build itself, so they can be run against a throwaway package as
// well as this one.
//
// What the tarball will contain is asked of the packaging tool rather than
// worked out here. The manifest's `files` list looks simple and is not: an
// entry can be a directory, a pattern or a negation, an ignore file inside a
// listed directory still drops files from it, and a manifest with no list at
// all ships whatever the ignore rules leave - which in this repository leaves
// out the build output, because the build output is not tracked. An earlier
// version of the guard modelled the list by hand. It read an entry written as
// a pattern as a literal path and refused a manifest that shipped the right
// files, and it read a missing list as "everything ships" and passed a
// manifest that shipped no build at all. Any hand-written model has the same
// shape of problem: it is a claim about the tool, and the tool is right here
// to ask.
//
// So the list comes from `npm pack --dry-run --json --ignore-scripts`: npm is
// what the release checklist publishes with, `--dry-run` writes no tarball,
// and `--ignore-scripts` keeps this from re-entering the `prepack` script that
// called it. Other package managers pack by their own rules; this answers for
// npm's.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";

/**
 * The paths the packaging tool would put in the tarball of the package at
 * `root`, relative to it with `/` separators, or a string saying why it could
 * not be asked.
 */
export function packedFiles(root) {
  const run = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    return `npm pack --dry-run failed (exit ${run.status ?? "signal"}): ${run.stderr ?? ""}`.trim();
  }
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    return "npm pack --dry-run answered something other than JSON";
  }
  const files = Array.isArray(report) ? report[0]?.files : undefined;
  if (!Array.isArray(files)) {
    return "npm pack --dry-run answered no file list";
  }
  return new Set(files.map((file) => file.path));
}

function filesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...filesUnder(full));
    } else {
      found.push(full);
    }
  }
  return found;
}

function toPackagePath(root, path) {
  return relative(root, path).split(sep).join("/");
}

function entryPointPaths(node, found) {
  if (typeof node === "string") {
    found.add(node);
  } else if (node && typeof node === "object") {
    for (const value of Object.values(node)) {
      entryPointPaths(value, found);
    }
  }
  return found;
}

/**
 * Checks 2 to 4 of the publish guard over the package at `root`, whose build
 * output is `outDir` (relative to `root`). Answers the checks in the order
 * made, each a label and whether it held, and `stop`: why the checks could not
 * be made at all, or null.
 */
export function checkBuildOutput(root, outDir = "dist") {
  const checks = [];
  const check = (label, ok) => checks.push({ label, ok: Boolean(ok) });
  const halt = (stop) => ({ checks, stop });

  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const out = join(root, outDir);
  if (!existsSync(out)) {
    return halt("the build wrote no output directory");
  }

  // 2. No emitted map carries embedded source content.
  const maps = filesUnder(out).filter((file) => file.endsWith(".map"));
  if (maps.length === 0) {
    return halt("the build emitted no maps, so the map check has nothing to read");
  }

  const pointedAt = new Set();
  for (const map of maps) {
    const emitted = JSON.parse(readFileSync(map, "utf8"));
    const embedded = emitted.sourcesContent;
    const carries = Array.isArray(embedded) && embedded.some((text) => text != null);
    check(`${toPackagePath(root, map)} carries no embedded source`, !carries);
    for (const source of emitted.sources ?? []) {
      pointedAt.add(toPackagePath(root, resolve(dirname(map), source)));
    }
  }

  if (pointedAt.size === 0) {
    return halt(
      "the emitted maps name no sources, so the shipped-source check has nothing to read",
    );
  }

  const packed = packedFiles(root);
  if (typeof packed === "string") {
    return halt(`the tarball's contents could not be read: ${packed}`);
  }

  // 3. The files those maps point at are files the tarball will contain.
  for (const source of [...pointedAt].sort()) {
    if (source.startsWith("..")) {
      check(`the maps' source ${source} is inside the package`, false);
      continue;
    }
    check(`${source} is shipped, so the maps that name it resolve`, packed.has(source));
  }

  // 4. Every file the manifest's entry points name exists in the output, and
  // is one the tarball will contain: an entry point that is built but not
  // shipped is a package that installs and then cannot be imported.
  const named = entryPointPaths(manifest.exports, new Set());
  for (const field of [manifest.main, manifest.types]) {
    if (typeof field === "string") {
      named.add(field);
    }
  }
  if (named.size === 0) {
    return halt("the manifest names no entry point, so the entry-point check has nothing to read");
  }

  for (const entry of [...named].sort()) {
    check(`${entry} exists in the output`, existsSync(join(root, entry)));
    check(`${entry} is shipped`, packed.has(posix.normalize(entry)));
  }

  return { checks, stop: null };
}
