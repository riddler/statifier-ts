// The engine-neutrality stage claims two things about itself, and both are
// claims about regular expressions: that a doc comment in shipped source can
// state every rule without tripping the check, and that every rule actually
// catches what it says it catches.
//
// Those claims were written carefully, and kept turning out to be wrong.
// A sentence describing a pattern is exactly as hard to verify as the pattern,
// so this suite stops describing and starts executing. Each rule carries the
// sentence that documents it and a line that violates it, right beside the
// pattern; `--rules` hands that table over, and the two tests below run the
// REAL check - the same file the gate runs, as a subprocess - against both.
//
// Adding a rule whose documenting sentence trips some other rule, or whose
// violation its own pattern misses, turns this suite red. That is the point:
// the sentence that states the property is the fixture that proves it.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const checker = fileURLToPath(new URL("../scripts/engine-neutrality.mjs", import.meta.url));

interface Rule {
  readonly id: string;
  readonly documentedBy: string;
  readonly violation: string;
}

function runChecker(args: readonly string[]): { status: number; output: string } {
  const result = spawnSync(process.execPath, [checker, ...args], { encoding: "utf8" });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/**
 * Scan source text as the only file in a throwaway directory, emptied first,
 * named `fixture` with the given extension.
 */
function scanLine(
  root: string,
  line: string,
  extension = ".ts",
): { status: number; output: string } {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, `fixture${extension}`), `${line}\n`, "utf8");
  return runChecker([root]);
}

/**
 * Write a throwaway project: each path relative to its root, with its text.
 * It is an ES module package, as this repository is, so its build config
 * loads the way this repository's does.
 */
function project(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "engine-neutrality-project-"));
  const withPackage = { "package.json": '{ "type": "module" }\n', ...files };
  for (const [path, text] of Object.entries(withPackage)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text, "utf8");
  }
  return dir;
}

/** The findings a run reported, as `file:line: rule`. */
function findings(output: string): string[] {
  return [...output.matchAll(/^(\S+):(\d+):\d+: ([\w-]+)$/gm)].map(
    (match) => `${match[1]}:${match[2]}: ${match[3]}`,
  );
}

/**
 * The rule ids a run reported, one per finding. Matching the id as a whole
 * word of the finding line, rather than as a substring of the output, keeps
 * one rule's id from standing in for another that it happens to prefix.
 */
function firedRules(output: string): string[] {
  return [...output.matchAll(/^\S+:\d+:\d+: ([\w-]+)$/gm)].map((match) => match[1] ?? "");
}

const rulesRun = runChecker(["--rules"]);
const rules: readonly Rule[] = JSON.parse(rulesRun.output) as Rule[];

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "engine-neutrality-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the engine-neutrality rule table", () => {
  // Sabotage: dropping `documentedBy` or `violation` from any rule in
  // scripts/engine-neutrality.mjs turns this red.
  it("gives every rule a documenting sentence and a violation", () => {
    expect(rulesRun.status).toBe(0);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.documentedBy.length, `${rule.id} documentedBy`).toBeGreaterThan(0);
      expect(rule.violation.length, `${rule.id} violation`).toBeGreaterThan(0);
    }
  });
});

describe("a doc comment may state the rules without tripping them", () => {
  // Sabotage: rewording any `documentedBy` sentence in
  // scripts/engine-neutrality.mjs so that it names a construct directly - for
  // instance spelling the module-path global rather than describing it - turns
  // that rule's case red. The prose-regression block below is what pins the
  // patterns; this block pins the sentences.
  it.each(rules.map((rule) => [rule.id, rule.documentedBy] as const))(
    "%s: its documenting sentence is clean as a comment",
    (id, documentedBy) => {
      const { status, output } = scanLine(root, `// ${documentedBy}`);
      expect(output, `${id} documenting sentence fired the check`).toContain("clean");
      expect(status, `${id} documenting sentence fired the check`).toBe(0);
    },
  );

  // Sabotage: this is the whole-comment version of the case above. Pasting
  // every documenting sentence into one comment block is what a real module
  // header looks like, and the per-rule test would still pass if two sentences
  // only collided with each other.
  it("every documenting sentence together, as one comment block, is clean", () => {
    const block = rules.map((rule) => `// ${rule.documentedBy}`).join("\n");
    const { status, output } = scanLine(root, block);
    expect(output).toContain("clean");
    expect(status).toBe(0);
  });
});

// Prose that this check has actually fired on at some point in its history.
// Each line is a regression fixture: it is ordinary English or an ordinary
// evaluator identifier, and none of it may fire again.
const prosePreviouslyTripping: readonly string[] = [
  // The unanchored DOM rule matched across a sentence break.
  "// The evaluator documentation says a window. Documentation of an evaluator.",
  // The unanchored CommonJS rule matched the English verb followed by a paren.
  "// This module does not require (or want) a Node global of any kind.",
  // A review demonstration: a module header comment that states the rules.
  "// This module never reaches for Intl, and never produces a bigint. It does",
  "// not use eval or the Function constructor, touches no window or document,",
  "// imports no node builtin, and calls no process or Buffer global.",
  // The forbidden numeric type named in prose, in the positions that are safe.
  "// The bigint type is never used here, and a bigint would be a conformance",
  "// break wearing a precision argument.",
  // The anchor property, safe side: a forbidden name with no anchor after it
  // is quiet, whatever the name is.
  "// Neither eval nor Function is reachable here, BigInt is not part of the",
  "// value space, and Intl is never consulted for an ordering decision.",
  // The corollary's two spellings of a sentence about the same name: with a
  // word after the name, and with the name as the last word. The capitalised
  // constructor's dot arm once accepted a bare trailing dot, so the second
  // line fired where the same sentence ending in any other anchored forbidden
  // name did not. Its fire side is the dotted-member line in the list below.
  "// No BigInt value is ever constructed here.",
  "// The value space contains no BigInt.",
];

// Forbidden names as the last word of a sentence. A full stop with no word
// character after it is not a member access, so none of these fires,
// whichever name ends the sentence. The list is every name in the script's
// DOM global and Node global lists and in its written bare builtin specifier
// list, the members of the toLocale family, and each other forbidden name the
// rules spell out, the two URL schemes included. The names the script folds
// in from the running Node's builtin list are not in it. The module-path
// globals are absent because they have no anchor and fire on every mention.
const namesEndingASentence: readonly string[] = [
  // The DOM global list.
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "XMLHttpRequest",
  "HTMLElement",
  "alert",
  // The Node global list.
  "process",
  "Buffer",
  "global",
  "setImmediate",
  "clearImmediate",
  // The CommonJS names with an anchor.
  "module",
  "exports",
  "require",
  // The import forms, the two URL schemes and the resolution accessor.
  "import",
  "node",
  "data",
  "meta",
  "resolve",
  // The written bare builtin specifier list.
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
  // Dynamic code and its aliases.
  "eval",
  "Function",
  "constructor",
  "globalThis",
  // The numeric type and its constructor.
  "bigint",
  "BigInt",
  // Locale data.
  "Intl",
  "localeCompare",
  "toLocaleString",
  "toLocaleDateString",
  "toLocaleTimeString",
  "toLocaleUpperCase",
  "toLocaleLowerCase",
  // The directive's tag name.
  "reference",
];

// The other side of the same property. A forbidden name fires in prose as
// soon as its anchor is present, because this scanner reads text and cannot
// tell a comment's anchor from code's. Each line below is ordinary English
// that happens to write a name with its anchor, and each one fires the rule
// it is paired with - that rule by name, not merely some rule, so a line that
// also trips a second rule cannot hide the loss of the arm it was written
// for.
//
// These are not a list of the cases - the cases are whatever the patterns
// currently say. They are a sample of the FAMILY, wide enough that a rewrite
// of the anchoring paragraph which quietly re-narrows the property to one
// rule, or to one kind of punctuation, goes red here.
const proseCarryingAnAnchor: readonly (readonly [string, string])[] = [
  // A type name reached by the type punctuation around it.
  ["bigint-type", "// Rule 9: bigint never."],
  ["bigint-type", "// | bigint | never allowed |"],
  ["bigint-type", "// The rule is simple: bigint is out."],
  ["bigint-type", "// Forbidden: bigint, and every literal base of it."],
  // A dynamic-evaluation name reached by a following parenthesis, even with a
  // space between, and even mid-sentence.
  ["dynamic-code-eval", "// Never write eval (like this) in shipped source."],
  ["dynamic-code-function", "// Calling Function (or any alias of it) is refused."],
  // A capitalised constructor reached by a dotted member or a parenthesis.
  ["bigint-type", "// BigInt.asIntN is unavailable on a constrained engine."],
  ["bigint-type", "// Converting with BigInt(value) is refused outright."],
  // A namespace reached by a dotted member.
  ["locale-sensitive", "// Intl.DateTimeFormat is absent on some engines."],
  // A global reached by a dotted member.
  ["node-global", "// Reading process.env here would break the browser build."],
  // A global reached by a call.
  ["dom-global-call", "// Raising alert(message) would break every other runtime."],
  ["dom-global-call", "// Opening a new XMLHttpRequest() here is refused."],
  ["node-global-call", "// Deferring with setImmediate(callback) is refused."],
  ["node-global-call", "// Cancelling with clearImmediate(handle) is refused."],
  // A name with no anchor at all fires on every mention, in a comment too.
  ["node-global-bare", "// Nothing here reads __dirname to find a fixture file."],
  // A data URL reached by the quote that opens it, and the resolution
  // accessor reached by the member chain that spells it.
  ["dynamic-code-data-url", '// Loading "data:text/javascript,..." is refused.'],
  ["module-resolve", "// Asking import.meta.resolve for a path is refused."],
  // A DOM global reached as a member of the global object is the global
  // itself, so the member lookbehind does not quiet it.
  ["dom-global", "// Reading globalThis.document.cookie here is refused."],
  // A doc-style line that opens with the directive is the directive, whatever
  // follows it.
  ["reference-directive", '/// <reference lib="es2022" /> is refused under src/.'],
  // One line tripping two rules, listed once for each. Killing either arm
  // leaves the line firing the other, so only the per-rule assertion notices.
  ["locale-sensitive", "// Neither Intl.Collator nor process.env is read here."],
  ["node-global", "// Neither Intl.Collator nor process.env is read here."],
];

// Ordinary code beside the rules that look at specifiers, data URLs, the
// module's metadata and called globals. None of it constructs code or
// reaches a builtin, and none of it may fire.
const ordinaryModuleCode: readonly string[] = [
  'const values = await import("./values.js");',
  'import { parse } from "./parser.js";',
  'export * from "./instructions.js";',
  "const payload = response.data;",
  "const settled = Promise.resolve(value);",
  "const here = import.meta.url;",
  'const logo = "data:image/png;base64,iVBORw0KGgo=";',
  "scheduler.setImmediate(run);",
  "banner.alert(message);",
  "const level = alertLevel(amount);",
];

// Identifiers an evaluator legitimately carries. The check omits `location`,
// `Node`, `Element` and `fetch` for exactly this reason, and the same
// principle has to hold for the builtin-global names added later.
const plausibleEvaluatorCode: readonly string[] = [
  "const a = scope.global.frame;",
  "const b = env.process.id;",
  "const c = token.location.offset;",
  "const d = ast.Node.kind;",
  "const e = form.Element.name;",
  // A field named for a DOM global on an options object.
  "const f = velocity.window.minutes;",
  "const g = wizard.document.title;",
  "const h = step.navigator[0];",
];

describe("prose and plausible identifiers do not fire the check", () => {
  // Sabotage: restoring the unanchored `\brequire\s*\(` pattern in
  // scripts/engine-neutrality.mjs turns the "require (or want)" line red, and
  // widening the DOM rule back to `\s*\.\s*` turns the first line red.
  it.each(prosePreviouslyTripping.map((line, i) => [i, line] as const))(
    "prose %i stays clean",
    (_i, line) => {
      const { status, output } = scanLine(root, line);
      expect(output).toContain("clean");
      expect(status).toBe(0);
    },
  );

  // Sabotage: dropping the `(?<![.\w$])` lookbehind from the builtin-global
  // rule in scripts/engine-neutrality.mjs turns the first two lines red, and
  // dropping it from the DOM rule turns the three options-object lines red.
  it.each(plausibleEvaluatorCode.map((line, i) => [i, line] as const))(
    "evaluator identifier %i stays clean",
    (_i, line) => {
      const { status, output } = scanLine(root, line);
      expect(output).toContain("clean");
      expect(status).toBe(0);
    },
  );

  // Sabotage: dropping the `\w` after the dot in the `\bBigInt\s*\.\w` arm
  // of scripts/engine-neutrality.mjs turns "contains no BigInt." red here.
  it.each(namesEndingASentence.map((name) => [name] as const))(
    "a sentence ending in %s is quiet",
    (name) => {
      const { status, output } = scanLine(root, `// The value space contains no ${name}.`);
      expect(output).toContain("clean");
      expect(status).toBe(0);
    },
  );

  // Sabotage: widening the media type in `dynamic-code-data-url` to any data
  // URL turns the image line red; widening `module-resolve` to the whole
  // metadata object turns the `url` line red; dropping the `(?<![.\w$])`
  // lookbehind from either call rule turns the member-call lines red.
  it.each(ordinaryModuleCode.map((line, i) => [i, line] as const))(
    "ordinary module code %i stays clean",
    (_i, line) => {
      const { status, output } = scanLine(root, line);
      expect(output).toContain("clean");
      expect(status).toBe(0);
    },
  );

  // Sabotage: dropping any one anchor alternative in
  // scripts/engine-neutrality.mjs - the `[:<|&]` arm of `bigint-type`, the
  // `\s*` before the parenthesis in `dynamic-code-eval`, the `\bBigInt\s*\.\w`
  // arm, the `\bIntl` arm of `locale-sensitive` - turns the matching lines
  // below red, the last one even though its line still fires another rule.
  // Together they pin the anchor property itself rather than any one rule's
  // wording.
  it.each(proseCarryingAnAnchor.map(([id, line], i) => [i, id, line] as const))(
    "a name with its anchor fires even in prose (%i, %s)",
    (_i, id, line) => {
      const { status, output } = scanLine(root, line);
      expect(status, "this line must fire; the anchor property depends on it").toBe(1);
      expect(firedRules(output), `this line must fire ${id}`).toContain(id);
    },
  );
});

// A DOM global reached through the global object, or written with an anchor
// the formatter does not produce, is still the DOM global. Each line fires the
// DOM rule and nothing else, once.
const domGlobalSpellings: readonly (readonly [string, string])[] = [
  ["a member of self", "const a = self.document.cookie;"],
  ["an optional-chained member of globalThis", "const a = globalThis?.window.innerWidth;"],
  ["an optional-chained member of self", "const a = self?.document.title;"],
  ["a member of globalThis with space before the dot", "const a = globalThis .document.title;"],
  ["an optional-chaining dot", "const a = window?.innerWidth;"],
  ["an optional-chaining index", "const a = window?.[key];"],
  ["space before the dot", "const a = window .innerWidth;"],
  ["a dollar sign after the dot", "const a = window.$loans;"],
];

// The other side: the same spellings on a field of some other object, which
// is what the member lookbehind keeps quiet, and prose with space after a dot.
const domGlobalLookalikes: readonly (readonly [string, string])[] = [
  ["a field named self on an options object", "const a = form.self.document.title;"],
  ["a word ending in self", "const a = myself.document.title;"],
  ["an optional-chained field named for a DOM global", "const a = wizard?.document.title;"],
  ["an optional-chained field of an options object", "const a = velocity?.window?.minutes;"],
  ["a field with space before the dot", "const a = patron.window .minutes;"],
  ["prose with space after the dot", "// Renewals within the window. Documents are due."],
];

describe("a DOM global reached another way", () => {
  // Sabotage: in scripts/engine-neutrality.mjs, dropping `self` from
  // `globalObjectMember` turns the two self lines red; dropping its `\??`
  // turns the optional-chained globalThis line red; dropping its `\s*` turns
  // the space-before-the-dot globalThis line red; dropping the `\??` from the
  // DOM rule's dotted anchor turns the optional-chaining dot line red; dropping
  // the `\s*\?\.\[` arm turns the optional-chaining index line red; dropping
  // the `\s*` from the dotted anchor turns the space-before-the-dot line red;
  // and narrowing `[\w$]` after the dot to `\w` turns the dollar sign line red.
  it.each(domGlobalSpellings)("fires on %s", (_name, line) => {
    const { status, output } = scanLine(root, line);
    expect(status, line).toBe(1);
    expect(firedRules(output), line).toEqual(["dom-global"]);
  });

  // Sabotage: in scripts/engine-neutrality.mjs, dropping the `(?<![.\w$])`
  // lookbehind in front of `self` in `globalObjectMember` turns the self field
  // line and the word ending in self red, dropping it from the DOM rule turns
  // every field line red, and allowing space after the dot in the DOM rule's
  // anchor turns the prose line red.
  it.each(domGlobalLookalikes)("leaves %s alone", (_name, line) => {
    const { status, output } = scanLine(root, line);
    expect(output, line).toContain("clean");
    expect(status, line).toBe(0);
  });
});

// A called global's name used as a definition. The call rules stay quiet on a
// method of that name called on some other object - the member-call lines in
// the ordinary module code above - but a definition writes the bare name and
// its parenthesis, so each line below fires the call rule for its name and
// nothing else, once. This is an over-refusal the call rules accept.
const calledGlobalDefinitions: readonly (readonly [string, string, string])[] = [
  ["a method definition", "  alert(message) {", "dom-global-call"],
  ["a private method definition", "  #alert(message) {", "dom-global-call"],
  ["a call to a private method", "this.#alert(message);", "dom-global-call"],
  ["a function declaration", "function setImmediate(run) {", "node-global-call"],
  [
    "a method on an object literal",
    "const holds = { clearImmediate(handle) { return handle; } };",
    "node-global-call",
  ],
];

describe("a called global's name used as a definition", () => {
  // Sabotage: in scripts/engine-neutrality.mjs, adding `#` to the lookbehind
  // of `calledAsBareGlobal` turns the two private method lines red; adding
  // `\s` to it turns the method definition, the function declaration and the
  // object literal lines red.
  it.each(calledGlobalDefinitions)("fires on %s", (_name, line, id) => {
    const { status, output } = scanLine(root, line);
    expect(status, line).toBe(1);
    expect(firedRules(output), line).toEqual([id]);
  });
});

// A reference directive widens what the source typecheck checks against from
// inside a source file, whichever of its forms it takes; the compiler reads
// the tag name in any case, allows space around the three slashes, and reads
// a directive that follows a block comment's close. Each fixture below fires
// the directive rule and nothing else, once. The last is an over-refusal the
// rule accepts: it reads text line by line, so a line inside a block comment
// that opens with the directive fires although the compiler ignores it.
const referenceDirectiveSpellings: readonly (readonly [string, string])[] = [
  ["the library form", '/// <reference lib="es2022" />'],
  ["the library form with a single-quoted component", "/// <reference lib='es2022.array' />"],
  ["the types form", '/// <reference types="node" />'],
  ["the path form", '/// <reference path="../widened.d.ts" />'],
  ["the default-library form", '/// <reference no-default-lib="true" />'],
  ["no space after the slashes", '///<reference lib="es2022" />'],
  ["an indented directive", '  /// <reference lib="es2022" />'],
  ["the tag name in capitals", '/// <REFERENCE lib="es2022" />'],
  ["after a block comment on the same line", '/* note */ /// <reference lib="es2022" />'],
  ["after a block comment closed on that line", '/* a\n*/ /// <reference lib="es2022" />'],
  ["a line inside a block comment", '/*\n/// <reference lib="es2022" />\n*/'],
];

// The other side: text that mentions a directive without being one, which the
// compiler ignores and the rule leaves alone.
const referenceDirectiveLookalikes: readonly (readonly [string, string])[] = [
  [
    "prose naming the directive",
    "// A reference directive naming a later library is refused here.",
  ],
  ["the directive in a string", 'const directive = "/// <reference lib=\\"es2022\\" />";'],
  ["the directive on a doc comment line", ' * /// <reference lib="es2022" /> is not read there.'],
  ["a fourth slash", '//// <reference lib="es2022" />'],
  ["a field named reference", "const reference = hold.reference;"],
];

describe("a reference directive in shipped source", () => {
  // Sabotage: in scripts/engine-neutrality.mjs, deleting the
  // `reference-directive` rule turns every line here red; dropping its `i`
  // flag turns the capitals line red; dropping the `\s*` after the slashes
  // turns the no-space line red; dropping the `\s*` before them turns the
  // indented line and the two block-comment-close lines red; and dropping the
  // `\*\/` alternative turns the two block-comment-close lines red.
  it.each(referenceDirectiveSpellings)("fires on %s", (_name, line) => {
    const { status, output } = scanLine(root, line);
    expect(status, line).toBe(1);
    expect(firedRules(output), line).toEqual(["reference-directive"]);
  });

  // Sabotage: in scripts/engine-neutrality.mjs, dropping the `^` from the
  // `reference-directive` pattern turns the string, doc comment line and
  // fourth slash lines red.
  it.each(referenceDirectiveLookalikes)("leaves %s alone", (_name, line) => {
    const { status, output } = scanLine(root, line);
    expect(output, line).toContain("clean");
    expect(status, line).toBe(0);
  });
});

describe("every rule catches what it documents", () => {
  // Sabotage: weakening any pattern in scripts/engine-neutrality.mjs so that
  // it no longer matches its own `violation` line turns this red - that is the
  // case a green check cannot otherwise answer.
  it.each(rules.map((rule) => [rule.id, rule.violation] as const))(
    "%s: its violation fires that rule",
    (id, violation) => {
      const { status, output } = scanLine(root, violation);
      expect(status, `${id} violation did not fail the check`).toBe(1);
      expect(firedRules(output), `${id} violation fired some other rule`).toContain(id);
    },
  );
});

describe("the bare builtin list", () => {
  // Sabotage: dropping the running Node's list from `bareNodeBuiltins` in
  // scripts/engine-neutrality.mjs, leaving the written list alone, turns this
  // red on the builtins the written list lacks; deleting the summary line that
  // file writes after its findings turns the completeness assertion red alone.
  it("refuses every builtin the running Node lists, bare and by subpath", () => {
    const bare = builtinModules.filter((name) => !name.startsWith("node:"));
    expect(bare.length).toBeGreaterThan(0);
    const { status, output } = scanLine(root, bare.map((name) => `import "${name}";`).join("\n"));
    expect(status).toBe(1);
    // This is by far the longest report the check writes, and it is read back
    // out of a pipe. Its summary line is the last thing written, so asking for
    // that line here separates a report that arrived short from a builtin that
    // was not refused - two different failures which otherwise look the same,
    // a findings list that stops early. The count is the enumeration above.
    expect(output).toContain(`engine-neutrality: ${bare.length} findings in 1 files`);
    expect(findings(output)).toEqual(
      bare.map((_name, i) => `fixture.ts:${i + 1}: node-builtin-import-bare`),
    );
  });

  // A name Node lists only with the prefix is a builtin with it and an
  // ordinary package name without it, so the two halves are refused by
  // different rules and neither half is quiet. Sabotage: letting these names
  // into `bareNodeBuiltins` with the prefix stripped, in
  // scripts/engine-neutrality.mjs, turns the bare half red - it is then
  // reported as a builtin rather than as a package.
  it("refuses a prefix-only builtin as a builtin with its prefix and as a package without it", () => {
    const prefixOnly = builtinModules.filter((name) => name.startsWith("node:"));
    expect(prefixOnly.length).toBeGreaterThan(0);
    for (const name of prefixOnly) {
      const prefixed = scanLine(root, `import "${name}";`);
      expect(firedRules(prefixed.output), name).toEqual(["node-builtin-import"]);
      const bareName = name.slice("node:".length);
      const bare = scanLine(root, `import "${bareName}";`);
      expect(firedRules(bare.output), bareName).toEqual(["package-import"]);
      expect(bare.status, bareName).toBe(1);
    }
  });
});

describe("a bare specifier names a package", () => {
  // The package declares no dependencies, so a bundler inlines whatever a
  // source file imports by name. Sabotage: widening the specifier body in
  // `bareSpecifier` in scripts/engine-neutrality.mjs back to everything up to
  // the closing quote turns the two keyword cases below red, because `from` is
  // a keyword of the language this package parses and its lexer and parser
  // write it as a quoted string beside other quoted strings.
  it.each([
    ["a package by name", 'import { luhn } from "card-validator";'],
    ["a scoped package", 'import { track } from "@signup/ab-testing";'],
    ["a subpath of a package", 'import { cvv } from "card-validator/checks";'],
    ["a side-effect import", 'import "card-validator";'],
    ["a dynamic import", 'const form = await import("card-validator");'],
    ["a type-only import", 'import type { Card } from "card-validator";'],
  ] as const)("refuses %s", (_name, line) => {
    const { status, output } = scanLine(root, line);
    expect(status, line).toBe(1);
    expect(firedRules(output), line).toEqual(["package-import"]);
  });

  // Sabotage: letting the body of `bareSpecifier` in
  // scripts/engine-neutrality.mjs begin with a dot or a slash turns the three
  // relative cases red.
  it.each([
    ["a relative specifier", 'import { parse } from "./parser.js";'],
    ["a parent-relative specifier", 'import { parse } from "../parser.js";'],
    ["a relative re-export", 'export * from "./instructions.js";'],
    ["the from keyword written as a token", 'const t = [["from", ["from_op", "from"]]];'],
    ["the from keyword written in a comment", '// duration ("ago" | "from" "now")?'],
  ] as const)("leaves %s alone", (_name, line) => {
    const { status, output } = scanLine(root, line);
    expect(output, line).toContain("clean");
    expect(status, line).toBe(0);
  });

  // The rules that look at a specifier divide the specifiers between them:
  // each line below is reported by one of them and never by two. Sabotage:
  // letting a colon into the body of `bareSpecifier` in
  // scripts/engine-neutrality.mjs reports the prefixed builtin and the data
  // URL twice, and dropping its builtin lookahead reports the two bare
  // builtin lines twice.
  it.each([
    ['import "node:fs";', "node-builtin-import"],
    ['import "fs";', "node-builtin-import-bare"],
    ['import "fs/promises";', "node-builtin-import-bare"],
    ['import "card-validator";', "package-import"],
    [
      'const card = await import("data:text/javascript,export default 1");',
      "dynamic-code-data-url",
    ],
  ] as const)("reports %s once, as %s", (line, id) => {
    const { status, output } = scanLine(root, line);
    expect(status, line).toBe(1);
    expect(firedRules(output), line).toEqual([id]);
  });
});

describe("the plain JavaScript extensions are scanned", () => {
  // Sabotage: removing an extension from `sourceExtensions` in
  // scripts/engine-neutrality.mjs turns its case red.
  it.each([".js", ".jsx", ".mjs", ".cjs"].map((extension) => [extension] as const))(
    "a violation in a %s file fires",
    (extension) => {
      const { status, output } = scanLine(root, "const a = process.env.HOME;", extension);
      expect(status).toBe(1);
      expect(findings(output)).toEqual([`fixture${extension}:1: node-global`]);
    },
  );
});

describe("the scanned roots come from the build's entry list", () => {
  const violation = "export const home = process.env.HOME;\n";
  const clean = "export const answer = 1;\n";

  // Sabotage: replacing the derived roots in scripts/engine-neutrality.mjs
  // with the `src` directory alone turns this red.
  it("scans a new entry in a new directory", () => {
    const dir = project({
      "tsup.config.ts": 'export default { entry: ["src/index.ts", "extra/entry.ts"] };\n',
      "src/index.ts": clean,
      "extra/entry.ts": violation,
    });
    const { status, output } = runChecker(["--config", join(dir, "tsup.config.ts")]);
    rmSync(dir, { recursive: true, force: true });
    expect(status).toBe(1);
    expect(findings(output)).toEqual(["extra/entry.ts:1: node-global"]);
  });

  // Sabotage: the same replacement turns this red too, and reading only the
  // array form of `entry` turns it red on the named form.
  it("follows an entry moved to another directory, in the named form", () => {
    const dir = project({
      "tsup.config.ts": 'export default { entry: { index: "lib/index.ts" } };\n',
      "lib/index.ts": clean,
      "lib/nested/helper.ts": violation,
    });
    const { status, output } = runChecker(["--config", join(dir, "tsup.config.ts")]);
    rmSync(dir, { recursive: true, force: true });
    expect(status).toBe(1);
    expect(findings(output)).toEqual(["lib/nested/helper.ts:1: node-global"]);
  });

  // Sabotage: pointing the default run at a build config that does not exist
  // in scripts/engine-neutrality.mjs turns this red.
  it("derives the gate's roots from the repository's own build config", () => {
    const { status, output } = runChecker([]);
    expect(output).toMatch(/files clean under src\/, /);
    expect(status).toBe(0);
  });

  // Sabotage: dropping the filter that keeps a root inside another root out
  // of the scanned set in scripts/engine-neutrality.mjs reports the nested
  // file once per root, and turns this red.
  it("scans a file under two entry directories once", () => {
    const dir = project({
      "tsup.config.ts": 'export default { entry: ["src/index.ts", "src/nested/entry.ts"] };\n',
      "src/index.ts": clean,
      "src/nested/entry.ts": violation,
    });
    const { status, output } = runChecker(["--config", join(dir, "tsup.config.ts")]);
    rmSync(dir, { recursive: true, force: true });
    expect(status).toBe(1);
    expect(findings(output)).toEqual(["src/nested/entry.ts:1: node-global"]);
  });

  // Sabotage: deleting any one refusal in `entryRoots` in
  // scripts/engine-neutrality.mjs turns its case red, and the case of an
  // entry directory holding no source file is the per-root empty guard in
  // `run`, not a refusal in `entryRoots`: deleting that guard turns it red,
  // with the directory test at the end of this file. Each case asserts its
  // own refusal's message, because without the refusal the stage either
  // passes or fails on something else. The pattern case names a file that
  // exists under the pattern's own spelling, so only the pattern refusal can
  // stop it; the case above the config nests the config one level down, so
  // the entry above it exists.
  it.each([
    [
      "no entry list",
      "tsup.config.ts",
      "export default { format: ['esm'] };\n",
      {},
      "cannot read an entry list",
    ],
    [
      "an empty entry list",
      "tsup.config.ts",
      "export default { entry: [] };\n",
      {},
      "cannot read an entry list",
    ],
    [
      "a non-string entry",
      "tsup.config.ts",
      "export default { entry: [1] };\n",
      {},
      "cannot read an entry list",
    ],
    [
      "an entry directory holding no source file",
      "tsup.config.ts",
      'export default { entry: ["src/index.ts", "assets/signup.json"] };\n',
      { "src/index.ts": clean, "assets/signup.json": "{}\n" },
      "no source files found under assets/",
    ],
    [
      "a pattern entry",
      "tsup.config.ts",
      'export default { entry: ["src/[a].ts"] };\n',
      { "src/[a].ts": clean },
      "is a pattern",
    ],
    [
      "a missing entry",
      "tsup.config.ts",
      'export default { entry: ["src/gone.ts"] };\n',
      { "src/a.ts": clean },
      "does not exist",
    ],
    [
      "an entry beside the config",
      "tsup.config.ts",
      'export default { entry: ["index.ts"] };\n',
      { "index.ts": clean },
      "not inside a directory below",
    ],
    [
      "an entry above the config",
      "pkg/tsup.config.ts",
      'export default { entry: ["../index.ts"] };\n',
      { "index.ts": clean, "pkg/package.json": '{ "type": "module" }\n' },
      "not inside a directory below",
    ],
  ] as const)("refuses %s", (_name, configPath, config, files, message) => {
    const dir = project({ [configPath]: config, ...files });
    const { status, output } = runChecker(["--config", join(dir, configPath)]);
    rmSync(dir, { recursive: true, force: true });
    expect(output).toContain(message);
    expect(status).toBe(1);
  });
});

describe("the checker refuses to pass on nothing", () => {
  // Sabotage: deleting either refusal of the build config in
  // scripts/engine-neutrality.mjs turns its half red.
  it("fails on a build config flag with no path, and on a config that is not there", () => {
    const noPath = runChecker(["--config"]);
    expect(noPath.output).toContain("--config needs a path");
    expect(noPath.status).toBe(1);
    const missing = runChecker(["--config", join(root, "definitely-not-here.ts")]);
    expect(missing.output).toContain("cannot read the build config");
    expect(missing.status).toBe(1);
  });

  // Sabotage: deleting the empty-file-set guard in
  // scripts/engine-neutrality.mjs turns this red, and a check that reports
  // success on a directory it could not read is worse than no check.
  it("fails on a directory with no source files, and on a missing one", () => {
    const empty = mkdtempSync(join(tmpdir(), "engine-neutrality-empty-"));
    expect(runChecker([empty]).status).toBe(1);
    rmSync(empty, { recursive: true, force: true });
    expect(runChecker([join(root, "definitely-not-here")]).status).toBe(1);
  });
});
