// The package resolves under legacy module resolution, and the exports map
// still wins everywhere it is honored.
//
//   node scripts/legacy-resolution.mjs
//
// TypeScript's `node10` resolution - what a consumer on an older tsconfig
// still uses, and what `moduleResolution: node` means - does not read the
// `exports` map at all. It looks for a top-level `types`, then a top-level
// `main`, then `index.*` at the package root. A package that declares only
// `exports` does not resolve for such a consumer: the compiler reports that
// it cannot find the module, with a hint to change resolution mode, which is
// advice the consumer may not be free to take.
//
// So the manifest carries a top-level `main` and `types` beside the exports
// map, pointing at the CommonJS build and its declarations. They are a
// fallback for resolvers that ignore `exports`, never a second answer for
// resolvers that honor it, and this stage pins both halves of that:
//
//   - a consumer compiled with `moduleResolution: node10` resolves the
//     package, and resolves it through the `types` field rather than through
//     `exports`, so a check cannot pass because a modern resolver answered;
//   - a consumer compiled with `moduleResolution: nodenext` still resolves
//     through the `exports` map, in both module formats - an ESM consumer to
//     the module build's declarations under the `import` condition, a
//     CommonJS one to the CommonJS declarations under `require` - exactly as
//     each did before the fields were added, and by way of the map rather
//     than by way of the new top-level fields;
//   - the file `main` names loads under `require` and exports the API, and
//     the two fields name the same CommonJS pair the map names under its
//     `require` condition, so the declarations match the file they sit beside.
//
// The evidence is the compiler's own resolution trace, read rather than
// inferred: each run passes `--traceResolution`, and the assertions are made
// against the trace block for this package's own specifier. A resolution
// argued from what a resolver ought to do is not evidence; this file only
// believes what a run printed.
//
// Removing either field fails this stage: without `types` the node10 run
// reports the module unresolved, and without `main` the require half has
// nothing to load.
//
// The Basic HTTP entry point, the `./basichttp` subpath, is held to the
// modern half only: a nodenext consumer of either format resolves it through
// the exports map's matching condition to the declarations that condition
// names. A node10 resolver reads no exports map, so it cannot see a subpath
// export at all, and the top-level fields do not stand in for one: a legacy
// consumer reaches the main entry point and nothing else.
//
// The consumer is written into a temporary directory outside the repository,
// with this package reached through a `node_modules` link, so the ancestor
// lookup a bare specifier performs finds it the way a real consumer's would.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const name = manifest.name;

const failures = [];

function die(message) {
  console.error(`resolution: ${message}`);
  process.exit(1);
}

function check(label, condition) {
  if (condition) {
    console.log(`resolution: ok   ${label}`);
  } else {
    console.error(`resolution: FAIL ${label}`);
    failures.push(label);
  }
}

// The two fields this stage exists for, read from the manifest rather than
// written here, so the check follows the manifest instead of duplicating it.
const mainField = manifest.main;
const typesField = manifest.types;
if (typeof mainField !== "string" || mainField.length === 0) {
  die("package.json has no top-level 'main'; a legacy consumer has nothing to load");
}
if (typeof typesField !== "string" || typesField.length === 0) {
  die("package.json has no top-level 'types'; a legacy consumer has no declarations to read");
}
for (const [field, value] of [
  ["main", mainField],
  ["types", typesField],
]) {
  if (!existsSync(join(packageRoot, value))) {
    die(`package.json '${field}' names ${value}, which the build did not write`);
  }
  // A field pointing outside the published file list would resolve here and
  // not in an installed package, which is the failure this stage is for.
  const top = value.replace(/^\.\//, "").split("/")[0];
  if (!(manifest.files ?? []).includes(top)) {
    die(`package.json '${field}' names ${value}, which 'files' does not publish`);
  }
}

// The fallback names the same CommonJS pair the map names under `require`.
// This is the pairing that makes the two fields safe together: `main` is a
// CommonJS file, so the declarations beside it have to be the CommonJS ones.
// Declarations from the module build beside a CommonJS entry typecheck, which
// is why this is asserted rather than left to the compile - a consumer would
// read module semantics off a file it loads as CommonJS.
const requireDefault = manifest.exports?.["."]?.require?.default;
const requireTypes = manifest.exports?.["."]?.require?.types;
check(
  `'main' names the same file the exports map names under 'require' (${requireDefault})`,
  mainField === requireDefault,
);
check(
  `'types' names the same file the exports map names under 'require' (${requireTypes})`,
  typesField === requireTypes,
);

// The compiler, found through the package's own dependency graph rather than
// by a path guess, so this runs the same TypeScript the typecheck stage does.
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve("typescript")), "tsc.js");
if (!existsSync(tsc)) die(`the TypeScript compiler is not installed at ${tsc}`);

const scope = name.startsWith("@") ? name.split("/")[0] : null;
const consumerRoot = mkdtempSync(join(tmpdir(), "statifier-resolution-"));
try {
  const modules = join(consumerRoot, "node_modules");
  mkdirSync(scope ? join(modules, scope) : modules, { recursive: true });
  symlinkSync(packageRoot, join(modules, name), "dir");

  // Two consumers, one per module format, because `nodenext` picks the
  // `exports` condition from the format of the importing file: the root is a
  // module, `cjs/` is CommonJS.
  const source = [
    `import { version } from "${name}";`,
    "",
    "export const answered: string = version();",
    "",
  ].join("\n");
  writeFileSync(
    join(consumerRoot, "package.json"),
    `${JSON.stringify({ name: "resolution-consumer", private: true, version: "0.0.0", type: "module" }, null, 2)}\n`,
  );
  writeFileSync(join(consumerRoot, "consumer.ts"), source);
  mkdirSync(join(consumerRoot, "cjs"), { recursive: true });
  writeFileSync(
    join(consumerRoot, "cjs", "package.json"),
    `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  );
  writeFileSync(join(consumerRoot, "cjs", "consumer.ts"), source);
  // The Basic HTTP entry point's consumers, one per format as above.
  const subpathSource = [
    `import { basicHttp } from "${name}/basichttp";`,
    "",
    "export const named: string = typeof basicHttp;",
    "",
  ].join("\n");
  writeFileSync(join(consumerRoot, "subpath.ts"), subpathSource);
  writeFileSync(join(consumerRoot, "cjs", "subpath.ts"), subpathSource);

  const config = (file, entry, options) =>
    writeFileSync(
      join(consumerRoot, file),
      `${JSON.stringify({ compilerOptions: { target: "es2020", strict: true, noEmit: true, types: [], ...options }, files: [entry] }, null, 2)}\n`,
    );
  config("tsconfig.legacy.json", "consumer.ts", {
    module: "commonjs",
    moduleResolution: "node10",
  });
  config("tsconfig.modern-esm.json", "consumer.ts", {
    module: "nodenext",
    moduleResolution: "nodenext",
  });
  config("tsconfig.modern-cjs.json", "cjs/consumer.ts", {
    module: "nodenext",
    moduleResolution: "nodenext",
  });
  config("tsconfig.subpath-esm.json", "subpath.ts", {
    module: "nodenext",
    moduleResolution: "nodenext",
  });
  config("tsconfig.subpath-cjs.json", "cjs/subpath.ts", {
    module: "nodenext",
    moduleResolution: "nodenext",
  });

  // The trace block for one specifier: from the line that opens the
  // resolution to the line that closes it. Reading the block rather than the
  // whole trace keeps a claim about this package from being answered by some
  // other module's lines.
  const traceBlock = (trace, specifier) => {
    const lines = trace.split("\n");
    const start = lines.findIndex((l) => l.includes(`Resolving module '${specifier}' from`));
    if (start < 0) return null;
    const end = lines.findIndex(
      (l, i) => i > start && l.startsWith("========") && l.includes(`Module name '${specifier}'`),
    );
    if (end < 0) return null;
    return lines.slice(start, end + 1);
  };

  const compile = (file, specifier = name) => {
    const run = spawnSync(process.execPath, [tsc, "-p", file, "--traceResolution"], {
      cwd: consumerRoot,
      encoding: "utf8",
    });
    const trace = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    return { status: run.status, trace, block: traceBlock(trace, specifier) };
  };

  const legacy = compile("tsconfig.legacy.json");
  if (legacy.block === null) die("the node10 run printed no resolution trace for the package");
  const legacyText = legacy.block.join("\n");
  check("a node10 consumer compiles against the package", legacy.status === 0);
  check(
    "the node10 run resolved in node10 mode",
    legacyText.includes("Explicitly specified module resolution kind: 'Node10'"),
  );
  check(
    `the node10 run read the 'types' field '${typesField}'`,
    legacyText.includes(`has 'types' field '${typesField}'`),
  );
  check(
    "the node10 run resolved the package through that field",
    legacyText.includes(
      `Module name '${name}' was successfully resolved to '${join(packageRoot, typesField.replace(/^\.\//, ""))}'`,
    ),
  );
  // The guard against a green that a modern resolver produced: node10 must
  // never enter the exports map, so if these lines are present the run that
  // passed was not a legacy one.
  check(
    "the node10 run did not read the exports map",
    !legacyText.includes("Entering conditional exports"),
  );

  // The exports map still wins wherever it is honored. Each format is held
  // to the condition it should match AND to the file that condition names, so
  // a top-level field answering in the map's place would fail here rather
  // than pass as "still compiles".
  for (const [format, file, condition] of [
    ["an ESM", "tsconfig.modern-esm.json", "import"],
    ["a CommonJS", "tsconfig.modern-cjs.json", "require"],
  ]) {
    const target = manifest.exports?.["."]?.[condition]?.types;
    if (typeof target !== "string") {
      die(`package.json exports does not name the main entry's ${condition} types`);
    }
    const modern = compile(file);
    if (modern.block === null) {
      die(`the nodenext run for ${format} consumer printed no resolution trace for the package`);
    }
    const modernText = modern.block.join("\n");
    check(`${format} nodenext consumer compiles against the package`, modern.status === 0);
    check(
      `${format} nodenext consumer resolved through the exports map's '${condition}' condition`,
      modernText.includes(`Matched 'exports' condition '${condition}'`) &&
        modernText.includes(`Using 'exports' subpath '.' with target '${target}'`),
    );
    check(
      `${format} nodenext consumer resolved the package to '${target}'`,
      modernText.includes(
        `Module name '${name}' was successfully resolved to '${join(packageRoot, target.replace(/^\.\//, ""))}'`,
      ),
    );
  }

  // The Basic HTTP entry point, through the exports map only, in both formats.
  const subpath = `${name}/basichttp`;
  for (const [format, file, condition] of [
    ["an ESM", "tsconfig.subpath-esm.json", "import"],
    ["a CommonJS", "tsconfig.subpath-cjs.json", "require"],
  ]) {
    const target = manifest.exports?.["./basichttp"]?.[condition]?.types;
    if (typeof target !== "string") {
      die(`package.json exports does not name the './basichttp' entry's ${condition} types`);
    }
    const run = compile(file, subpath);
    if (run.block === null) {
      die(`the nodenext run for ${format} consumer printed no resolution trace for ${subpath}`);
    }
    const text = run.block.join("\n");
    check(`${format} nodenext consumer compiles against ${subpath}`, run.status === 0);
    check(
      `${format} nodenext consumer resolved ${subpath} through the exports map's '${condition}' condition`,
      text.includes(`Matched 'exports' condition '${condition}'`) &&
        text.includes(`Using 'exports' subpath './basichttp' with target '${target}'`),
    );
    check(
      `${format} nodenext consumer resolved ${subpath} to '${target}'`,
      text.includes(
        `Module name '${subpath}' was successfully resolved to '${join(packageRoot, target.replace(/^\.\//, ""))}'`,
      ),
    );
  }
} finally {
  rmSync(consumerRoot, { recursive: true, force: true });
}

// The runtime half of the fallback: `main` is what a resolver that ignores
// `exports` loads, so it is loaded here the way such a resolver would - by
// path, not by name, because loading by name would go through `exports`.
const loaded = require(join(packageRoot, mainField));
check(`the file 'main' names exports the API`, typeof loaded.version === "function");
check(
  `the file 'main' names answers the version the manifest carries (${manifest.version})`,
  loaded.version() === manifest.version,
);

if (failures.length > 0) {
  die(
    "the package does not resolve under legacy module resolution, or the exports map no longer answers a modern one",
  );
}
console.log(
  "resolution: a node10 consumer resolves the package through 'types', a nodenext consumer still resolves through 'exports', and the file 'main' names loads under require",
);
