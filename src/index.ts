// The main entry point.
//
// Two surfaces so far: the version of the build a host is running, and
// `compile`, which turns SCXML text into a Chart - its identity and the
// compiled Machine the interpreter will run.

import { version as packageVersion } from "../package.json";

export {
  type Chart,
  type ChartIdentity,
  type CompileError,
  type CompileOptions,
  type CompileResult,
  compile,
} from "./compiler.js";
export type { Machine } from "./machine.js";

/**
 * The version of this build, as `package.json` carries it.
 *
 * The manifest is the one place the version is written. The bundler inlines
 * that one field at build time, so the answer is the version the published
 * build was cut at, and nothing is read from disk when this is called.
 */
export function version(): string {
  return packageVersion;
}
