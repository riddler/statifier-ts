// Runs every suite of the conformance corpus under a standalone Hermes VM and
// diffs the reports against a run of the same corpus under Node.
//
//   node scripts/hermes-conformance.mjs --tools <dir> [--out <dir>]
//
// WHAT THIS IS EVIDENCE OF. The README says this package's source assumes no
// host environment, so it runs unchanged on a server runtime, in a browser and
// on React Native's JavaScript engine. A gate stage checks the source for the
// constructs that would make that false, which is a check on the text. This is
// a check on a run: the same corpus, through the same conformance runner, on
// the engine React Native uses, compared case by case with what Node answered.
// A text check cannot see a behaviour difference between two engines, and a
// behaviour difference is what would make the sentence untrue.
//
// ZERO DIFFERENCES ON EVERY SUITE IS THE RESULT THAT MEANS ANYTHING. A
// difference is a finding about this package or about the engine, to be
// recorded and explained; it is never answered by dropping the case from the
// run or by narrowing what the README claims. So this script excludes nothing:
// it runs every case of every suite the vendored manifest lists, and it exits
// non-zero when any suite's reports differ, naming every row that diverged.
//
// WHAT IT BUILDS, AND WHY THE VM NEEDS A BUNDLE AT ALL. The VM has no module
// loader and no filesystem: there is no `require`, no `import`, and nothing to
// read the vendored corpus off disk with. So the run is bundled into one
// self-contained file, and the corpus travels in it as data. That is why
// `test/conformance/runner.ts` takes the corpus as an argument instead of
// finding it: reading it off disk is `test/conformance/reports.ts`'s, and the
// runner itself reaches nothing outside the language. The runner drives the
// scion, w3c and statifier suites through the interpreter, so a run proves
// agreement on the cases of every suite. The bundle is checked
// for a host module specifier before it is run, and the check refuses rather
// than warns - a bundle that reached one would not be evidence about a host
// that has none.
//
// THE NODE SIDE RUNS THE SAME BUNDLE INPUTS. Both engines are given one
// generated entry, one corpus, one bundler. What differs between the two
// artifacts is the engine and one lowering pass, so a difference in the
// reports is a difference in the engine rather than in what was fed to it.
//
// THE LOWERING PASS, AND THE LIMIT IT PUTS ON THE CLAIM. The standalone VM
// distributed as a command-line build is an older release than the engine
// current React Native ships: it refuses the `class` keyword outright, where
// the newer engine's compiler parses it. A bundler targeting an older output
// language lowers class FIELDS but keeps the keyword, so the bundle is put
// through a class transform before the VM sees it. The same VM refuses an
// `async` function, which the Basic HTTP processor and the runner's host-case
// drive both use, so the VM's bundle targets an output language older than
// `async`, and the bundler lowers each one to a generator, which the VM runs.
// Both passes are for the standalone VM, and the proof this script produces
// is a proof against that VM. It is evidence about the engine family and about
// this package's use of the language; it is not a run on the exact engine
// build an application ships, and the README says so rather than claiming
// more.
//
// WHY THE TOOLCHAIN IS NOT A DEPENDENCY. The VM, the bundler and the class
// transform are development tools for producing this evidence by hand, not
// things this package needs to build or to run. They live in a tool directory
// outside the repository, named by `--tools` or by STATIFIER_HERMES_TOOLS,
// and nothing here is added to `package.json`. What a gate stage would need is
// the same directory on the machine running the gate; this script is the stage
// such a step would call, and whether one exists is a separate decision.
//
// HOW TO FILL A TOOL DIRECTORY. The VM comes from the command-line release
// archive published for this platform by the engine's own project, unpacked in
// that directory so that `hermes` sits at its top; there is no package manager
// channel that ships a runnable VM for macOS, only the compiler. The bundler
// and the class transform are installed into that same directory with the
// pinned Node's own package manager, run with that directory as the working
// directory.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadManifest, loadSuites } from "./lib/corpus.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

/**
 * The host module specifiers a bundle for the VM must not carry.
 *
 * The rule is the prefix and the bare names together: a bundler asked for a
 * platform-neutral output refuses to resolve either, so one appearing in the
 * output would mean it was written rather than resolved. The check reads the
 * built file because that is the artifact the VM is handed, and a check of the
 * import graph would not see a specifier a plugin put there.
 */
const HOST_MODULE_PATTERN =
  /\bnode:[a-z_]+|\b(?:require|import)\(\s*["'](?:fs|path|url|process|os|crypto|child_process)["']/;

function usage(problem) {
  process.stderr.write(`${problem}\n\n`);
  process.stderr.write("usage: node scripts/hermes-conformance.mjs --tools <dir>");
  process.stderr.write(" [--out <dir>]\n");
  process.stderr.write("  --tools  a directory holding the VM and the bundling tools,\n");
  process.stderr.write("           or set STATIFIER_HERMES_TOOLS instead\n");
  process.exit(2);
}

function readArguments(argv) {
  const parsed = { tools: process.env.STATIFIER_HERMES_TOOLS ?? null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--tools" || flag === "--out") {
      if (value === undefined) usage(`${flag} wants a value`);
      parsed[flag.slice(2)] = value;
      index += 1;
      continue;
    }
    usage(`unknown argument ${flag}`);
  }
  if (parsed.tools === null) usage("no tool directory: pass --tools or set STATIFIER_HERMES_TOOLS");
  return parsed;
}

/**
 * The tools, resolved out of the tool directory.
 *
 * Each one is reported by what it is rather than by the path it was looked for
 * at, and every missing one is named at once: a reader filling the directory
 * for the first time should learn the whole list from one run.
 */
function resolveTools(toolsDir) {
  const root = resolve(toolsDir);
  const missing = [];
  const vm = join(root, "hermes");
  if (!existsSync(vm)) missing.push("the VM, as `hermes` at the top of the directory");
  const require = createRequire(pathToFileURL(join(root, "noop.mjs")));
  const load = (specifier, what) => {
    try {
      return require(specifier);
    } catch {
      missing.push(`${what}, as \`${specifier}\` installed in the directory`);
      return null;
    }
  };
  const esbuild = load("esbuild", "the bundler");
  const babel = load("@babel/core", "the transform runner");
  const classes = load("@babel/plugin-transform-classes", "the class transform");
  if (missing.length > 0) {
    process.stderr.write(`the tool directory ${root} is missing:\n`);
    for (const item of missing) process.stderr.write(`  - ${item}\n`);
    process.stderr.write("\nThe header of this script says what fills it.\n");
    process.exit(2);
  }
  return { root, vm, esbuild, babel, classes };
}

/** The entry both engines run, and the corpus it carries. */
function writeSources(outDir, corpus) {
  mkdirSync(outDir, { recursive: true });
  const runner = join(repoRoot, "test", "conformance", "runner.ts");
  writeFileSync(
    join(outDir, "corpus-data.ts"),
    `export const corpus = ${JSON.stringify(corpus)};\n`,
    "utf8",
  );
  // `print` is the VM's only output channel and the only one it has; a server
  // runtime has the console instead. The entry asks which it is given rather
  // than being generated twice, so both engines run one text. Each suite is
  // awaited, because a case whose host runs an Event I/O Processor settles on
  // the job queue: its deliveries go through the runner's in-memory loopback
  // front, which answers on that queue and opens no socket, so the BasicHTTP
  // rows run on the VM through the same front as on the server runtime. Both
  // engines run the job queue once the script itself has run; a throw that
  // escapes the run prints one line, which the report count then refuses.
  writeFileSync(
    join(outDir, "entry.ts"),
    [
      `import { runSuite } from ${JSON.stringify(runner)};`,
      `import { corpus } from "./corpus-data.js";`,
      ``,
      `const emit =`,
      `  typeof print === "function" ? print : (line) => { console.log(line); };`,
      ``,
      `async function main() {`,
      `  for (const suite of corpus.suites) {`,
      `    emit(JSON.stringify(await runSuite(suite, corpus.corpus_hash)));`,
      `  }`,
      `}`,
      ``,
      `main().catch((error) => {`,
      `  emit(`,
      `    "the run threw: " + (error instanceof Error ? error.message : String(error)),`,
      `  );`,
      `});`,
      ``,
    ].join("\n"),
    "utf8",
  );
  return join(outDir, "entry.ts");
}

/**
 * Bundles the entry for one engine.
 *
 * The VM has no module loader, so its bundle is a single script; the server
 * runtime reads a module. Neither is given a platform, because a bundle that
 * resolved a host module for either one would not be the same run.
 */
async function bundle(esbuild, entry, outfile, forVM) {
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "neutral",
    format: forVM ? "iife" : "esm",
    target: forVM ? "es2016" : "es2020",
    logLevel: "warning",
  });
  return outfile;
}

/**
 * Lowers the class keyword out of the bundle the VM will run.
 *
 * The bundler's older output target rewrites class fields and keeps the
 * keyword, and the standalone VM refuses the keyword, so this pass is what
 * stands between the two. It is the whole reason the VM's artifact differs
 * from the server runtime's.
 */
function lower(babel, classes, source) {
  const lowered = babel.transformSync(source, {
    babelrc: false,
    configFile: false,
    compact: false,
    plugins: [classes],
  });
  if (lowered === null || typeof lowered.code !== "string") {
    throw new Error("the class transform answered no code");
  }
  return lowered.code;
}

/** Reads one report per suite out of an engine's output, one per line. */
function readReports(text, engine, expected) {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (lines.length !== expected) {
    throw new Error(
      `${engine} printed ${lines.length} lines where ${expected} reports were expected`,
    );
  }
  return lines.map((line) => JSON.parse(line));
}

/**
 * Every way two reports of one run differ.
 *
 * The comparison is per field and per case rather than over the serialized
 * text, so a difference is reported as the case it is about. A case present on
 * one side and absent on the other is a difference in its own right: the case
 * sets are derived from the same corpus by the same rule, so a divergence
 * there says the rule answered differently, which is exactly as much a finding
 * as a case that changed its outcome.
 */
function reportDifferences(node, vm) {
  const differences = [];
  for (const field of ["implementation", "corpus_hash", "suite"]) {
    if (node[field] !== vm[field]) {
      differences.push(`${field}: the server runtime answered ${node[field]}, the VM ${vm[field]}`);
    }
  }
  const byId = (report) => new Map(report.results.map((result) => [result.case_id, result]));
  const left = byId(node);
  const right = byId(vm);
  for (const [id, result] of left) {
    const other = right.get(id);
    if (other === undefined) {
      differences.push(`${id}: reported by the server runtime and absent from the VM's report`);
      continue;
    }
    if (result.result !== other.result) {
      differences.push(`${id}: ${result.result} on the server runtime, ${other.result} on the VM`);
      continue;
    }
    if ((result.reason ?? null) !== (other.reason ?? null)) {
      differences.push(
        `${id}: the reasons differ - the server runtime says ${JSON.stringify(result.reason ?? null)}, the VM says ${JSON.stringify(other.reason ?? null)}`,
      );
    }
  }
  for (const id of right.keys()) {
    if (!left.has(id)) {
      differences.push(`${id}: reported by the VM and absent from the server runtime's report`);
    }
  }
  return differences;
}

async function main() {
  const parsed = readArguments(process.argv.slice(2));
  const tools = resolveTools(parsed.tools);
  const manifest = loadManifest();
  const outDir = parsed.out === null ? join(repoRoot, "tmp", "hermes") : resolve(parsed.out);

  const suites = loadSuites(undefined, manifest);
  const corpus = { corpus_hash: manifest.corpus_hash, suites };
  const counts = suites.map((suite) => `${suite.suite} ${suite.cases.length}`).join(", ");
  process.stdout.write(`corpus: ${counts} cases, ${manifest.corpus_hash}\n`);

  const entry = writeSources(outDir, corpus);
  const nodeBundle = await bundle(tools.esbuild, entry, join(outDir, "on-node.mjs"), false);
  const builtForVM = await bundle(tools.esbuild, entry, join(outDir, "on-vm.js"), true);
  const vmBundle = join(outDir, "on-vm-lowered.js");
  writeFileSync(vmBundle, lower(tools.babel, tools.classes, readFileSync(builtForVM, "utf8")));

  const vmText = readFileSync(vmBundle, "utf8");
  const found = HOST_MODULE_PATTERN.exec(vmText);
  process.stdout.write(`host-module check on the VM bundle: ${HOST_MODULE_PATTERN}\n`);
  if (found !== null) {
    process.stderr.write(`the bundle carries a host module specifier: ${found[0]}\n`);
    process.exit(1);
  }
  process.stdout.write("host-module check: no match, so the bundle reaches no host module\n");

  const version = execFileSync(tools.vm, ["--version"], { encoding: "utf8" });
  process.stdout.write(`the VM answers:\n${version}`);
  // The command is printed with the bundle named relative to the repository,
  // so that what a reader is asked to compare against is the same text
  // wherever the checkout and the tool directory happen to sit.
  process.stdout.write(`the run: hermes -w ${relative(repoRoot, vmBundle)}\n`);

  const vmOut = execFileSync(tools.vm, ["-w", vmBundle], { encoding: "utf8", maxBuffer: 1 << 28 });
  const nodeOut = execFileSync(process.execPath, [nodeBundle], {
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });

  const vmReports = readReports(vmOut, "the VM", suites.length);
  const nodeReports = readReports(nodeOut, "the server runtime", suites.length);

  let differing = 0;
  for (let index = 0; index < nodeReports.length; index += 1) {
    const node = nodeReports[index];
    const vm = vmReports[index];
    const differences = reportDifferences(node, vm);
    process.stdout.write(
      `${node.suite}: ${node.results.length} rows on the server runtime, ${vm.results.length} on the VM, ${differences.length} differences\n`,
    );
    for (const difference of differences) process.stdout.write(`  ${difference}\n`);
    if (differences.length > 0) differing += 1;
  }
  if (differing > 0) {
    process.stderr.write(
      `${differing} of ${nodeReports.length} suites differ; each difference above is a finding\n`,
    );
    process.exit(1);
  }
  process.stdout.write("every suite agrees, row for row\n");
}

await main();
