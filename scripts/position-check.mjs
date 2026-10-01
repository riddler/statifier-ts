// The position round-trip property as a gate stage: runs it over every scion
// case of the vendored corpus and prints its counts - the points, the round
// trips that agree, and the points not carried with each reason. Any point
// that was carried and disagreed fails the stage, each one named.
//
//   tsx scripts/position-check.mjs [--root <conformance dir>]
//
// The property itself is `test/conformance/position.ts`. It is a
// self-consistency claim: it shows the package agreeing with itself, not its
// export agreeing with the reference's, and `conformance/README.md` says so.
// It runs under tsx because the property is TypeScript.

import { resolve } from "node:path";
import { positionLines, runPositionProperty } from "../test/conformance/position.ts";
import { CONFORMANCE_ROOT, loadSuites } from "./lib/corpus.mjs";

function readArguments(argv) {
  if (argv.length === 0) return CONFORMANCE_ROOT;
  if (argv.length === 2 && argv[0] === "--root") return resolve(argv[1]);
  process.stderr.write("usage: tsx scripts/position-check.mjs [--root <conformance dir>]\n");
  process.exit(2);
}

function main() {
  const root = readArguments(process.argv.slice(2));
  const scion = loadSuites(root).find((suite) => suite.suite === "scion");
  if (scion === undefined || scion.cases.length === 0) {
    process.stderr.write("position: the vendored corpus holds no scion case to run\n");
    process.exit(1);
  }
  const report = runPositionProperty(scion.cases);
  const lines = positionLines(report);
  const out = report.disagreements.length > 0 ? process.stderr : process.stdout;
  for (const line of lines) out.write(`${line}\n`);
  if (report.disagreements.length > 0) process.exit(1);
}

main();
