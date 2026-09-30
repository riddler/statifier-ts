// The corpus rules that more than one thing has to agree about, and the
// loading that reads the vendored copy off disk.
//
// The runner, which runs a surface, reads the vendored corpus; so do the
// registry check, which reads membership, and the ratchet, which decides
// whether a claim is complete. Each of them needs the same three rules, and a
// rule implemented once per reader is a chance for each reader to implement
// it differently. So the rules live once, for a reader to import rather than
// restate. Which files import them is the import graph's to say, not this
// header's.
//
// THE RULES THEMSELVES ARE `scripts/lib/corpus-rules.mjs`, and this module
// re-exports all three, so a reader that wants the loader and the rules
// together still asks one module for both. They were separated from the
// loading because a reader given the corpus as data, inside a host with no
// filesystem, needs the rules and cannot have `node:fs` - and a module holding
// both hands it `node:fs` through the import graph whether it calls the loader
// or not. Nothing about the rules moved with them.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT READ. A case's instructions, context
// and expectation are values, and reading those correctly needs the corpus's
// own float-preserving decoder, which is TypeScript under `src/`. So a case
// here carries its metadata - the plain JSON a rule is written in terms of -
// and the raw line it came from, and a reader that needs the values decodes
// that line itself. Nothing here decides what a value is.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { throughTier } from "./corpus-rules.mjs";

export { runnableCases, runsAtVersion, surfaceCaseSet, throughTier } from "./corpus-rules.mjs";

const conformanceRoot = fileURLToPath(new URL("../../conformance/", import.meta.url));

/** Reads the vendored manifest. */
export function loadManifest() {
  return JSON.parse(readFileSync(join(conformanceRoot, "manifest.json"), "utf8"));
}

/**
 * The cases for tiers 1 through `tier`, in ascending tier order.
 *
 * The manifest says which files exist and what tier each one carries, so
 * nothing here globs a directory: a tier file the manifest does not list is
 * drift, and the corpus check is where drift is caught.
 *
 * A line that does not parse is reported rather than thrown raw. The file and
 * the line number are known here and nowhere above, so they are what this adds;
 * the parser's own message is kept, because a refusal that loses the reason is
 * worse for whoever is debugging a real corpus than the stack trace it
 * replaces. It throws rather than exits: this module is a reader with no
 * console and no process of its own, and a caller that is a script decides what
 * a refusal looks like.
 *
 * Sabotage: removing the try around the parse turns the ratchet's
 * unreadable-corpus case red - the refusal still prints, but with the parser's
 * bare message where the file and the line belong, so the case that asserts the
 * tier file's path fails. It was run and reverted.
 */
export function loadCases(tier, manifest = loadManifest()) {
  const files = throughTier(manifest.tiers, tier).sort((left, right) => left.tier - right.tier);
  const cases = [];
  for (const entry of files) {
    const path = join(conformanceRoot, entry.file);
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line === "") continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch (error) {
        throw new Error(`${path} line ${index + 1} is not JSON: ${error.message}`);
      }
      cases.push({
        id: record.id,
        tier: record.tier,
        source: record.source,
        features: record.features ?? [],
        line,
      });
    }
  }
  return cases;
}
