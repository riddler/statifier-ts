// The publish guard's checks of a build's output, run for real against
// throwaway packages. Each package is built by hand - an output directory with
// one module and its map, and the source that map names - so no bundler runs;
// what is under test is what the guard concludes about the tarball, and that
// comes from the packaging tool, which runs for real here too.
//
// Every package ignores its build output the way this repository does, so a
// manifest with no file list is exactly the case where the tool ships the
// source and leaves the build out.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkBuildOutput, packedFiles } from "../scripts/lib/publish-checks.mjs";

const made: string[] = [];

afterEach(() => {
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const MAP = JSON.stringify({ version: 3, sources: ["../src/index.ts"], mappings: "AAAA" });

/**
 * A built package whose manifest carries `files` when it is given (and no
 * list at all when it is not), with `overrides` replacing or adding files.
 */
function builtPackage(
  files: readonly string[] | undefined,
  overrides: Readonly<Record<string, string>> = {},
): string {
  const root = mkdtempSync(join(tmpdir(), "publish-guard-"));
  made.push(root);
  const manifest = {
    name: "publish-guard-fixture",
    version: "0.0.0",
    type: "module",
    main: "./dist/index.js",
    exports: { ".": "./dist/index.js" },
    ...(files === undefined ? {} : { files }),
  };
  const tree: Record<string, string> = {
    "package.json": `${JSON.stringify(manifest)}\n`,
    ".gitignore": "node_modules/\ndist/\n",
    "dist/index.js": "export const value = 1;\n//# sourceMappingURL=index.js.map\n",
    "dist/index.js.map": MAP,
    "src/index.ts": "export const value = 1;\n",
    ...overrides,
  };
  for (const [path, text] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  }
  return root;
}

function failed(root: string): string[] {
  const { checks, stop } = checkBuildOutput(root);
  expect(stop).toBeNull();
  return checks.filter((check) => !check.ok).map((check) => check.label);
}

describe("what the tarball will contain", () => {
  it("is the packaging tool's answer, ignore rules included", () => {
    const packed = packedFiles(builtPackage(undefined));
    expect(packed).toBeInstanceOf(Set);
    expect([...(packed as Set<string>)].sort()).toEqual(["package.json", "src/index.ts"]);
  });
});

describe("the publish guard's checks of the output", () => {
  it("pass a manifest whose file list ships the build and the source", () => {
    expect(failed(builtPackage(["dist", "src"]))).toEqual([]);
  });

  // Sabotage: answering `true` for an entry point's shipped check in
  // scripts/lib/publish-checks.mjs turns this red.
  it("refuse a manifest with no file list, which ships the source and no build", () => {
    const root = builtPackage(undefined);
    const { checks } = checkBuildOutput(root);
    expect(checks.some((check) => /ships every file/.test(check.label))).toBe(false);
    expect(failed(root)).toEqual(["./dist/index.js is shipped"]);
  });

  // Sabotage: testing the map's source against the `files` entries read as
  // literal paths and their ancestors, not the tool's list, turns this red.
  it("pass a manifest whose list entries are patterns naming the right files", () => {
    expect(failed(builtPackage(["dist/*", "src/**/*.ts"]))).toEqual([]);
  });

  // Sabotage: answering `true` for a map source's shipped check turns this red.
  it("refuse a manifest whose list leaves out the source the maps name", () => {
    expect(failed(builtPackage(["dist"]))).toEqual([
      "src/index.ts is shipped, so the maps that name it resolve",
    ]);
  });

  // Sabotage: testing the map's source against the `files` entries read as
  // literal paths and their ancestors, not the tool's list, turns this red.
  it("refuse a manifest whose list negates the source a directory entry ships", () => {
    expect(failed(builtPackage(["dist", "src", "!src/index.ts"]))).toEqual([
      "src/index.ts is shipped, so the maps that name it resolve",
    ]);
  });

  // Sabotage: reading every map as carrying no embedded source turns this red.
  it("refuse a map that carries its source text", () => {
    const embedded = JSON.stringify({
      version: 3,
      sources: ["../src/index.ts"],
      sourcesContent: ["export const value = 1;\n"],
      mappings: "AAAA",
    });
    expect(failed(builtPackage(["dist", "src"], { "dist/index.js.map": embedded }))).toEqual([
      "dist/index.js.map carries no embedded source",
    ]);
  });
});
