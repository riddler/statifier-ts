// The engine-neutrality check: one gate stage that refuses the constructs
// shipped source may never contain.
//
// `src/` has to run unchanged on a server runtime, in a browser, and on React
// Native's JavaScript engine. Most of the rules below protect that; the
// `bigint` rules protect conformance instead. They are stated as prose in
// CLAUDE.md, which is where the reasoning belongs. This file is what makes
// them mechanical, so the author, the gate, CI and a reviewer all run the same
// check instead of each retyping a pattern from memory.
//
// What the rest of the gate already catches, and what it does not: `window`
// and `document` fail `tsc` because the `dom` lib is not in tsconfig, and a
// bare `eval()` is a Biome error. Everything else this file refuses
// typechecks and lints clean - locale-sensitive comparison and formatting,
// `bigint` in every literal base, `new Function()`, a builtin import in every
// specifier form and the builtin globals, for example. That is the reason
// this stage exists; the overlap with the other two is deliberate, because a
// stage that states the whole rule survives a tsconfig or Biome change that
// quietly drops half of it. Biome's builtin-import rule is a WARNING and does
// not fail the lint stage, so it is not a backstop for anything here.
//
// ---------------------------------------------------------------------------
// EVERY RULE CARRIES THE SENTENCE THAT DOCUMENTS IT, AND THAT SENTENCE IS A
// TEST FIXTURE. Read this before adding a rule.
//
// This check has been revised repeatedly, and revision after revision
// introduced a fresh instance of the same defect: a sentence describing the
// patterns that was not true of the patterns. A claim about a regular
// expression turns out to be exactly as hard to verify as the regular
// expression, so stating it carefully is not enough - it has to be executed.
// (Note that this paragraph gives no count of the revisions. A count in prose
// beside a live thing is the defect itself, in miniature.)
//
// So each rule below carries two strings beside its pattern. `documentedBy` is
// the sentence a doc comment in shipped source would use to state that rule;
// `violation` is a line that genuinely breaks it. `test/engine-neutrality.
// test.ts` reads this table through `--rules` and asserts, for every rule,
// that the documenting sentence passes the WHOLE check as a comment and that
// the violation fires that exact rule. A rule added without a CLEAN
// `documentedBy`, or with a `violation` the pattern does not catch, fails the
// suite. The sentence that states the property is the fixture that proves it.
// Note what that does not do: the suite checks the sentence is quiet, never
// that it is ACCURATE. A sentence that scans clean and says nothing true about
// its rule passes. Accuracy is still read by a human, so write it as though
// nothing will check it, because nothing will.
//
// ANCHORING. One property governs every rule here, and it is the thing to
// learn rather than a list of cases.
//
// Each pattern matches a forbidden NAME together with an ANCHOR: whatever is
// written beside the name to turn it into a use of the thing, most often
// punctuation. The anchors differ from rule to rule, and these are examples,
// not a list: an opening parenthesis after a dynamic-evaluation name, a
// dotted member or a parenthesis after a capitalised constructor, a dotted
// member or an opening bracket after a global, the type punctuation around a
// type name, a quoted specifier after an import keyword. This file reads text
// and does not parse it, so it CANNOT TELL AN ANCHOR IN A COMMENT FROM THE
// SAME ANCHOR IN CODE. Therefore:
//
//     A forbidden name is quiet in prose exactly when its anchor is absent,
//     and fires in prose exactly when its anchor is present.
//
// `eval` reads clean and `eval (` does not. `BigInt` reads clean and
// `BigInt.asIntN` does not. `Intl` reads clean and `Intl.DateTimeFormat` does
// not. A name with no anchor at all - the two module-path globals in the bare
// rule below are the only ones - fires on every mention, which is why this
// comment describes them rather than spelling them.
//
// THAT IS A RULE, NOT A CENSUS, AND IT HAS TO STAY ONE. Every previous version
// of this paragraph tried to enumerate the cases where prose trips the check,
// and every one of them was falsified by the next reading, because a count
// over a live pattern is wrong the moment a pattern moves. The property above
// survives a rule being added, widened or narrowed. If you add a rule you do
// not update this paragraph; you inherit it, and you add the two fixtures the
// suite wants.
//
// Two corollaries, both consequences of the property and not additions to it.
// First, a word that merely CONTAINS a forbidden name - "evaluator",
// "documentation" - is never matched at all, because a longer word supplies no
// anchor. Second, the full stop ending an English sentence is the same
// character as a member access, so A FORBIDDEN NAME SHOULD NEVER BE THE LAST
// WORD OF A SENTENCE - there it can supply its own anchor. Put a word after it.
// Whether a particular rule is fooled by a trailing stop depends on whether
// that rule demands a word character after the dot, which is why this is
// stated as an always-do and not as a list of the rules that care. This
// paragraph's own first draft tripped exactly here.
//
// WHAT THIS STAGE CANNOT SEE, stated plainly rather than papered over. A text
// scanner reads the written form, so it catches a construct that is written
// down and misses one that is assembled at run time. It does not follow a
// value: a reference captured into a variable and called later through that
// variable, a constructor reached through a computed member access
// (`host[key](source)`), a function pulled out of a data structure, or
// anything arriving from a caller is invisible to it. A `require` or an
// import whose specifier is not a literal is invisible for the same reason,
// and so is source text turned into a URL at run time rather than written
// out as a data URL. A module outside the directory of every build entry is
// not scanned even when an entry imports it, because the scanned set is those
// directories and this stage follows no import. The written aliases below -
// assigning `eval` or `Function` to a name, the `(0, eval)` indirect call,
// reaching either through `globalThis`, and calling `.constructor()` - ARE
// caught, and so are a script data URL written as a string and the
// module-resolution accessor written as a member chain, because those are the
// shapes a developer actually writes. The rest is what code review and the ISA
// contract are for, and no sentence here or in CLAUDE.md may claim otherwise.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// The plain JavaScript extensions are scanned beside the TypeScript ones. The
// source typecheck does not compile them, because `allowJs` is not set, but
// the bundler bundles such a file when an entry imports it, so leaving them
// to that setting would leave them unchecked.
const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

// Node built-ins are importable as `node:fs` and as a bare `fs`. The bare
// forms have to be listed, because a bare specifier is otherwise just a
// package name.
const listedNodeBuiltins = [
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
];

// The list above is written down, so it does not move when Node adds a
// module. The running Node's own list is folded in beside it, cut to the
// module name before any subpath, so a builtin the running Node has and the
// written list lacks is refused as well. The names Node lists only with the
// `node:` prefix are left out: without the prefix each is an ordinary package
// name, and the prefixed rule already refuses them with it.
const bareNodeBuiltins = [
  ...new Set([
    ...listedNodeBuiltins,
    ...builtinModules.filter((name) => !name.startsWith("node:")).map((name) => name.split("/")[0]),
  ]),
];

// A specifier reaches source in four shapes, not three. The fourth - a
// SIDE-EFFECT import, `import "node:fs";` with no binding and no keyword after
// it - was missed by the version of this rule that claimed to cover every
// specifier form. `\bimport\s*` matching right up to the quote is what catches
// it; the parenthesised alternative beside it is the dynamic form.
const specifierPrefix = String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)`;
const bareNodeAlternation = bareNodeBuiltins.join("|");
// Several builtins ship subpaths - the promises-flavoured ones especially -
// and a pattern that demands the closing quote right after the module name
// lets every one of them through.
const subpath = String.raw`(?:/[\w.-]+)*`;

// A BARE specifier - one that is neither relative, nor absolute, nor carrying
// a URL scheme - names a package rather than a file. The bundler leaves a
// package that the manifest lists under `dependencies` out of the bundle, and
// a consumer installs it; any other package it inlines, so the published
// tarball would carry a copy of that package while the manifest said nothing
// of it. A package listed only under `devDependencies` is the second case: it
// is installed for the gate and never for a consumer.
//
// The body below is the character set a package name is written in, matched
// to the closing quote, and it does three jobs rather than one. It is what
// makes the rule specific: `from` is a keyword of the language this package
// parses, so its lexer and its parser write that word as a quoted string
// beside other quoted strings, and a body that accepted a comma or a space
// read the text between two such strings as a specifier. Both fired that way
// before this was narrowed. The first character excludes a dot and a slash,
// which is every relative and absolute form. And no character of it is a
// colon, so a specifier carrying a scheme cannot reach the closing quote
// through it - which is what keeps this rule off the prefixed builtin form
// and off source text written into a URL, each of which has a rule of its own.
//
// The first lookahead does the remaining exclusion: a bare builtin name with
// its optional subpath, the alternation the rule above matches. What is left
// is exactly the specifiers no other rule here looks at, so the rules that
// read a specifier divide them up and an import is reported once, never twice.
// The second lookahead, when the manifest lists any runtime dependency, admits
// those names and their subpaths, which the bundler leaves out on the same
// terms. The names are read from the manifest when the stage runs, not
// written here, so this rule cannot drift from the list it enforces; a name
// that merely begins with a listed one is a different package and still fires,
// because a listed name has to be followed by a subpath or the closing quote.
//
// A type-only import is refused on the same terms as a value import. The
// bundler erases it, so it ships no code; the declaration build keeps it, and
// the emitted types would name a package the consumer has not installed. That
// is the same undeclared dependency arriving through the other file the
// tarball ships.
const escapedForPattern = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bareSpecifier = (admitted) => {
  const admits =
    admitted.length === 0
      ? ""
      : `(?!(?:${admitted.map(escapedForPattern).join("|")})${subpath}["'])`;
  return String.raw`(?!(?:${bareNodeAlternation})${subpath}["'])${admits}[\w@][\w.@/+-]*`;
};

// Globals that only exist in a browser. Four names a browser also defines are
// absent on purpose, because each is a plausible identifier in a compiler:
// `location` in a lexer that tracks token positions, `Node` and `Element` in
// anything that builds a tree, and `fetch`, which is not DOM-specific anyway.
// What those would be reaching for is I/O, which this package does not do for
// reasons of its own; policing that is not this stage's job.
const domGlobals = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "XMLHttpRequest",
  "HTMLElement",
  "alert",
];

// Globals that only exist on Node. Refusing the import while allowing the
// global was the asymmetry in the first version of this file: `process.env`
// and `Buffer.from` break a constrained engine exactly as an import would,
// and they are the two an author reaches for without thinking.
const nodeGlobals = ["process", "Buffer", "global", "setImmediate", "clearImmediate"];

const domAlternation = domGlobals.join("|");
const nodeGlobalAlternation = nodeGlobals.join("|");

// The globals in the lists above whose realistic use is a call or a
// construction, which the property-or-index anchor below never meets, so
// each list gets a call rule of its own as well.
const domCalledGlobals = ["alert", "XMLHttpRequest"];
const nodeCalledGlobals = ["setImmediate", "clearImmediate"];

// A global is only a global when it is USED as one: a property access or an
// index with no space in it, which is what the formatter produces and what
// prose never does. Allowing whitespace around the dot was tried and
// reverted - it made the English sentence "a sliding window. Documentation of
// ..." match, which is the same prose-fires-the-check defect this stage exists
// to retire.
//
// And a global is not a MEMBER of that name. `process` and `global` are
// ordinary words an evaluator uses: a scope object carries a global frame, an
// environment record carries a process field. The lookbehind is what tells
// `process.env` (a global) from `env.process.id` (a member), and it applies
// the principle already stated above for `location`, `Node` and `Element` -
// leave out what is plausible in a compiler - to the names added later.
const usedAsBareGlobal = (alternation) => String.raw`(?<![.\w$])(?:${alternation})(?:\.\w|\[)`;

// The DOM rule takes the same lookbehind, so an options object with a field
// named for a window or a document stays quiet, plus one alternative the Node
// rule does not have: a name written as a member of `globalThis`, or of a
// `self` that is not itself a member, still fires, through a dot or an
// optional-chaining dot and with space allowed before either, because that
// member is the browser global itself. Its anchor is wider than the Node
// rule's in the same three ways: an optional-chaining dot counts as a dot,
// the character after the dot may be a dollar sign, and space may come BEFORE
// the dot. Space AFTER the dot still does not count, which is what keeps the
// sliding-window sentence above quiet.
const globalObjectMember = String.raw`(?<=(?:\bglobalThis|(?<![.\w$])self)\s*\??\.)`;
const usedAsBareOrGlobalObjectMember = (alternation) =>
  String.raw`(?:(?<![.\w$])|${globalObjectMember})(?:${alternation})(?:\s*\??\.[\w$]|\s*\?\.\[|\[)`;

// A called global: the opening parenthesis with no space before it, which is
// what the formatter writes and what prose rarely does, behind the same
// lookbehind, so a method of that name called on some other object stays
// quiet. A DEFINITION of that name is not quiet: a method or a private method
// declared with it, a call to such a private method, and a function declared
// with it all write the bare name and its parenthesis, and all fire. That
// over-refusal is accepted; the name is a browser or Node global's, so
// shipped source has no reason to reuse it.
const calledAsBareGlobal = (alternation) => String.raw`(?<![.\w$])(?:${alternation})\(`;

const rules = [
  {
    id: "dom-global",
    pattern: new RegExp(usedAsBareOrGlobalObjectMember(domAlternation), "g"),
    why: "shipped source may not touch a DOM global; it has to run where there is no DOM",
    documentedBy:
      "This module touches no browser global: no window object, no document object, and nothing else the DOM defines.",
    violation: "const a = window.innerWidth;",
  },
  {
    id: "node-global",
    pattern: new RegExp(usedAsBareGlobal(nodeGlobalAlternation), "g"),
    why: "shipped source may not touch a Node global; it has to run where there is no Node",
    documentedBy:
      "This module touches no Node global, so it never reads the process environment and never builds a Buffer.",
    violation: "const a = process.env.HOME;",
  },
  {
    id: "dom-global-call",
    pattern: new RegExp(calledAsBareGlobal(domCalledGlobals.join("|")), "g"),
    why: "shipped source may not call a DOM global; it has to run where there is no DOM",
    documentedBy:
      "This module calls no browser global: it raises no dialog and opens no request object.",
    violation: 'alert("declined");',
  },
  {
    id: "node-global-call",
    pattern: new RegExp(calledAsBareGlobal(nodeCalledGlobals.join("|")), "g"),
    why: "shipped source may not call a Node global; it has to run where there is no Node",
    documentedBy:
      "This module calls no Node global, so it schedules nothing on the Node event loop.",
    violation: "setImmediate(run);",
  },
  {
    id: "node-global-bare",
    // `require` is anchored to its string literal: without that anchor an
    // ordinary English sentence containing "require (" fired the check, which
    // is the very defect this stage exists to retire. `__dirname` and
    // `__filename` are the two documented bare-word exceptions; see the header.
    pattern: /\b__dirname\b|\b__filename\b|\bmodule\.exports\b|\brequire\s*\(\s*["'`]/g,
    why: "shipped source may not touch a Node global; it has to run where there is no Node",
    documentedBy:
      "This module uses no CommonJS-only global: it asks for no module path, exports through no CommonJS object, and calls no synchronous loader.",
    violation: "const a = __dirname;",
  },
  {
    id: "node-builtin-import",
    pattern: new RegExp(`${specifierPrefix}["']node:`, "g"),
    why: "shipped source may not import a Node built-in; it has to run where there is no Node",
    documentedBy:
      "This module imports no prefixed Node built-in, under any specifier spelling, whether or not it binds a name.",
    violation: 'import "node:fs";',
  },
  {
    id: "node-builtin-import-bare",
    pattern: new RegExp(`${specifierPrefix}["'](?:${bareNodeAlternation})${subpath}["']`, "g"),
    why: "shipped source may not import a Node built-in; it has to run where there is no Node",
    documentedBy:
      "This module names no bare Node built-in specifier and no subpath of one, in any of the four import shapes.",
    violation: 'import "fs/promises";',
  },
  {
    id: "package-import",
    // Built when the stage runs, from the names the manifest lists under
    // `dependencies`; see `bareSpecifier` above and `admittedPackages` below.
    patternFor: (admitted) =>
      new RegExp(`${specifierPrefix}["']${bareSpecifier(admitted)}["']`, "g"),
    why: "shipped source may import only a package the manifest lists under dependencies, read from package.json when this stage runs; the bundler inlines any other package, a development dependency included",
    documentedBy:
      "This module names no bare import specifier beyond the runtime dependencies its package manifest lists, so no undeclared package can be bundled into it.",
    violation: 'import { luhn } from "card-validator";',
  },
  {
    id: "module-resolve",
    // The resolution accessor on the module's own metadata reaches a builtin
    // by name with none of the import shapes above, and a constrained engine
    // has no module loader to answer it. The member chain written out is the
    // anchor, so the metadata object's other members stay quiet.
    pattern: /\bimport\.meta\.resolve\b/g,
    why: "shipped source may not ask the module loader to resolve a specifier; it reaches a builtin by name and has to run where there is no loader",
    documentedBy:
      "This module asks the module loader to resolve no specifier, builtin or otherwise.",
    violation: 'const a = import.meta.resolve("fs");',
  },
  {
    id: "dynamic-code-eval",
    // The call form, so that the word "evaluator" cannot match: `eval` has to
    // be followed by its own open parenthesis, with or without spaces between.
    pattern: /\beval\s*\(/g,
    why: "authoring a condition is not authoring code, and dynamic code is unavailable on a locked-down engine",
    documentedBy: "This module never evaluates a string as code.",
    violation: 'const a = eval("1");',
  },
  {
    id: "dynamic-code-function",
    pattern: /\b(?:new\s+)?Function\s*\(/g,
    why: "authoring a condition is not authoring code, and dynamic code is unavailable on a locked-down engine",
    documentedBy: "This module never constructs a function from source text.",
    violation: 'const a = new Function("return 1");',
  },
  {
    id: "dynamic-code-data-url",
    // A data URL whose media type is a script, or WebAssembly, carries its
    // own source, so importing it constructs and runs code exactly as the
    // Function constructor does - and it is not a builtin, so the specifier
    // rules never look at it. The anchor is the quote that opens the string,
    // not the import keyword, so a long import the formatter wraps onto a
    // second line is still caught. Media types match in any case, as they do
    // in a URL; a data URL of any other type, an image say, stays quiet.
    pattern: /["'`]data:(?:(?:text|application)\/(?:x-)?(?:java|ecma)script|application\/wasm)\b/gi,
    why: "authoring a condition is not authoring code, and source text in a URL is dynamic code by another name",
    documentedBy: "This module never imports source text written into a URL.",
    violation: 'const a = await import("data:text/javascript,export default 1");',
  },
  {
    id: "dynamic-code-alias",
    // The written escapes: `const f = Function`, `const e = eval`, the
    // `(0, eval)` indirect call, either one through `globalThis`, and reaching
    // the Function constructor off an instance with `.constructor(...)`. A
    // reference that flows through a parameter or a computed member access is
    // NOT caught - see the header.
    pattern:
      /=\s*(?:eval|Function)\b(?!\s*\()|\(\s*0\s*,\s*eval\s*\)|\bglobalThis\s*(?:\.\s*(?:eval|Function)\b|\[\s*["'](?:eval|Function)["']\s*\])|\.\s*constructor\s*\(/g,
    why: "aliasing eval or the Function constructor is the same dynamic code by another name",
    documentedBy:
      "This module never aliases the dynamic code entry points, reaches them through the global object, or gets at them by way of a constructor property.",
    violation: "const F = Function;",
  },
  {
    id: "bigint-literal",
    // Every base, not just decimal: 1n, 0x1fn, 0b1010n, 0o17n.
    pattern: /\b(?:\d[\d_]*|0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+)n\b/g,
    why: "the value space is the one the ISA and the corpus define; a numeric tower the siblings lack is a conformance break",
    documentedBy: "This module writes no arbitrary-precision integer literal, in any numeric base.",
    violation: "const a = 0x1fn;",
  },
  {
    id: "bigint-type",
    // Anchored to a type position or a call, so that a doc comment saying this
    // module never produces one of these reads clean while `x: bigint` does not.
    pattern:
      /[:<|&]\s*bigint\b|\bas\s+bigint\b|\bbigint\s*\[\s*\]|\bBigInt\s*\(|\bBigInt\s*\.\w|[:<|&]\s*BigInt\b|\bas\s+BigInt\b|=\s*BigInt\b(?!\s*\()/g,
    why: "the value space is the one the ISA and the corpus define; a numeric tower the siblings lack is a conformance break",
    documentedBy:
      "This module declares no arbitrary-precision integer type and calls no arbitrary-precision integer constructor.",
    violation: "const a = BigInt(2);",
  },
  {
    id: "reference-directive",
    // The source typecheck holds `src/` to the target's library and to no
    // host's type declarations, and a triple-slash reference directive in a
    // source file widens that from inside the file: the library form brings
    // back a later edition's members, the types form a host's globals, and
    // the path form any declaration file it names. The source typecheck then
    // passes code that ships a member the target engine may not have. The
    // anchor is the directive itself: three slashes and the tag name after
    // them, opening the line or directly after the close of a block comment,
    // because the compiler reads a directive from any comment before the
    // first statement, including one that follows a block comment on the
    // same line. The tag name matches in any case because the compiler reads
    // it in any case. This file reads text line by line, so a line that opens
    // with the directive fires even inside a block comment or a template
    // literal, where the compiler ignores it; that over-refusal is accepted.
    // The same text inside a string, after the asterisk of a doc comment
    // line, or after a fourth slash stays quiet.
    pattern: /(?:^|\*\/)\s*\/\/\/\s*<reference\b/gi,
    why: "shipped source may not widen the library or the type declarations it is checked against; a member the target lacks would then typecheck and ship",
    documentedBy:
      "This module writes no triple-slash directive, so it is checked against no library or type declarations beyond the ones the source typecheck names.",
    violation: '/// <reference lib="es2022" />',
  },
  {
    id: "locale-sensitive",
    // The hazard is not the identifier `Intl`, it is any comparison or
    // rendering whose answer depends on the engine's locale data. String
    // ordering inside a comparison opcode is how that actually gets into a
    // predicate evaluator, and `localeCompare` typechecks and lints clean.
    pattern: /\bIntl\s*(?:\.\w|\[)|\.\s*localeCompare\s*\(|\.\s*toLocale[A-Za-z]*\s*\(/g,
    why: "locale data is absent, stubbed or version-dependent across engines, so this would decide differently on two runtimes running the same instruction list",
    documentedBy:
      "This module consults no locale data: it compares strings by code unit, and leaves rendering for a human to the host.",
    violation: 'const a = "x".localeCompare("y");',
  },
];

const args = process.argv.slice(2);

// HOW THIS STAGE LEAVES, AND WHY IT MATTERS THAT IT LEAVES THIS WAY.
//
// Every path below finishes by returning a status to the bottom of this file,
// which sets `process.exitCode` and lets the process end on its own. None of
// them calls `process.exit`, and that is deliberate: `process.exit` does not
// wait for a write to stdout or stderr that has not finished, so a report long
// enough to be written in more than one piece can be cut short while the exit
// status survives intact. A caller that reads this stage through a pipe - the
// suite does, and so does anything else that captures it - would then see a
// check that reported fewer findings than it made, with nothing in the status
// to say so. Under-reporting is the one failure a check like this must not
// have, so the exit is written the way the runtime guarantees the output
// arrives whole.
//
// The same reasoning covers the rule table, which is JSON that a reader parses
// rather than prose a human skims: a short read there is a parse error, not a
// missing line.

// A refusal carries its message out to the bottom of the file rather than
// printing and exiting on the spot, so that `fail` never returns to its caller
// and the message still goes through the one exit path above.
class Refusal extends Error {}

function fail(message) {
  throw new Refusal(message);
}

// The scanned set is the directory of every entry the build lists, so a new
// entry in a new directory, or an entry moved to another one, is scanned with
// no edit here. The build's config is loaded rather than read as text, so the
// entry list is the value the config exports, however it is written. Where
// that list cannot be turned into directories below the config, the stage
// stops rather than guessing.
async function entryRoots(configPath) {
  const base = dirname(configPath);
  const { tsImport } = await import("tsx/esm/api");
  const loaded = await tsImport(pathToFileURL(configPath).href, import.meta.url);
  const config = loaded.default;
  const configs = Array.isArray(config) ? config : [config];
  const entries = [];
  for (const one of configs) {
    const entry = one?.entry;
    const listed = Array.isArray(entry)
      ? entry
      : entry !== null && typeof entry === "object"
        ? Object.values(entry)
        : undefined;
    if (listed === undefined || listed.length === 0 || listed.some((e) => typeof e !== "string")) {
      fail(`cannot read an entry list from ${relative(base, configPath)}`);
    }
    entries.push(...listed);
  }
  const roots = new Set();
  for (const entry of entries) {
    if (/[*?[\]{}!]/.test(entry)) {
      fail(`the entry ${entry} is a pattern, and this stage derives its roots from file paths`);
    }
    const file = resolve(base, entry);
    if (!existsSync(file)) fail(`the entry ${entry} does not exist`);
    const root = dirname(file);
    if (root === base || relative(base, root).startsWith("..")) {
      fail(`the entry ${entry} is not inside a directory below the config`);
    }
    roots.add(root);
  }
  // A root inside another root is already scanned through it.
  const sorted = [...roots].sort();
  return {
    base,
    roots: sorted.filter(
      (root) => !sorted.some((other) => other !== root && !relative(other, root).startsWith("..")),
    ),
  };
}

// A path as the output shows it: relative to the config's directory, or to
// the directory given, which then shows as itself.
const shown = (base, dir) => `${relative(base, dir).split(sep).join("/") || dir}/`;

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (sourceExtensions.some((ext) => entry.endsWith(ext))) {
      found.push(full);
    }
  }
  return found.sort();
}

// The runtime dependencies the manifest lists, which the package-import rule
// admits. The manifest is the one beside the build config the roots came from,
// or this repository's own when the stage is pointed at a directory, and it is
// read on every run so the admitted names are always the declared ones. A
// manifest that cannot be read stops the stage rather than admitting nothing
// or guessing: either would report a result about a list it never saw. Only
// `dependencies` is read. A development dependency is not installed for a
// consumer, so it stays refused like any other package. So does a package
// listed only under `peerDependencies`: the bundler leaves one out too, but
// the one package this one may carry is a runtime dependency, and a peer
// would be a second thing a host has to install that this rule never names.
const packageName = /^(?:@[\w.-]+\/)?[\w.-]+$/;

function admittedPackages(manifestDir) {
  const manifestPath = join(manifestDir, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    fail(`cannot read the package manifest ${manifestPath}`);
  }
  const listed = manifest?.dependencies;
  if (listed === undefined) return [];
  if (listed === null || typeof listed !== "object" || Array.isArray(listed)) {
    fail(`cannot read a dependency list from ${manifestPath}`);
  }
  const names = Object.keys(listed);
  for (const name of names) {
    if (!packageName.test(name)) fail(`the dependency ${name} is not a package name`);
  }
  return names;
}

// The rule table as one run applies it: a rule whose pattern depends on the
// manifest has it built from the admitted names here, and every other rule is
// used exactly as the table writes it.
const rulesAdmitting = (admitted) =>
  rules.map((rule) => (rule.patternFor ? { ...rule, pattern: rule.patternFor(admitted) } : rule));

function findingsIn(file, base, activeRules) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const found = [];
  for (const [index, line] of lines.entries()) {
    for (const rule of activeRules) {
      for (const match of line.matchAll(rule.pattern)) {
        found.push({
          file: relative(base, file).split(sep).join("/"),
          line: index + 1,
          column: (match.index ?? 0) + 1,
          rule,
          text: line.trim(),
        });
      }
    }
  }
  return found;
}

async function run() {
  // `--rules` hands the table to the suite, so the documenting sentences live
  // exactly once - here, beside the pattern they describe.
  if (args.includes("--rules")) {
    console.log(
      JSON.stringify(
        rules.map(({ id, documentedBy, violation }) => ({ id, documentedBy, violation })),
        null,
        2,
      ),
    );
    return 0;
  }

  // With a directory argument the stage scans that directory, which is how the
  // suite points the real check at a fixture. With `--config` it derives its
  // roots from that build config, and with neither from the repository's own
  // `tsup.config.ts`, which is what the gate runs.
  const configFlag = args.indexOf("--config");
  let base;
  let sourceRoots;
  let admitted;
  if (configFlag !== -1 || args.length === 0) {
    const configArg = configFlag === -1 ? "tsup.config.ts" : args[configFlag + 1];
    if (configArg === undefined) fail("--config needs a path");
    const configPath = isAbsolute(configArg) ? configArg : resolve(repoRoot, configArg);
    if (!existsSync(configPath)) fail(`cannot read the build config ${configArg}`);
    // Read before the config is loaded, because loading it reads the same
    // manifest for its module type and would fail on a broken one first.
    admitted = admittedPackages(dirname(configPath));
    ({ base, roots: sourceRoots } = await entryRoots(configPath));
  } else {
    sourceRoots = [resolve(repoRoot, args[0])];
    base = sourceRoots[0];
    admitted = admittedPackages(repoRoot);
  }

  const files = [];
  for (const root of sourceRoots) {
    let found;
    try {
      found = sourceFiles(root);
    } catch {
      fail(`cannot read ${shown(base, root)}`);
    }
    // A check that silently scanned nothing would report the same success as a
    // clean tree. It is not allowed to, for any one root.
    if (found.length === 0) fail(`no source files found under ${shown(base, root)}`);
    files.push(...found);
  }

  const activeRules = rulesAdmitting(admitted);
  const findings = files.flatMap((file) => findingsIn(file, base, activeRules));

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line}:${finding.column}: ${finding.rule.id}`);
      console.error(`    ${finding.text}`);
      console.error(`    ${finding.rule.why}`);
    }
    const plural = findings.length === 1 ? "" : "s";
    console.error(
      `engine-neutrality: ${findings.length} finding${plural} in ${files.length} files`,
    );
    console.error("Do not silence this by narrowing the rule. See Conventions in CLAUDE.md.");
    return 1;
  }

  console.log(
    `engine-neutrality: ${files.length} files clean under ${sourceRoots
      .map((root) => shown(base, root))
      .join(", ")}, ${rules.length} rules`,
  );
  return 0;
}

// The one exit. A refusal prints its message here, so that every path leaves
// through the same statement and none of them cuts its own output short.
try {
  process.exitCode = await run();
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  console.error(`engine-neutrality: ${error.message}`);
  process.exitCode = 1;
}
