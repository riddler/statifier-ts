// The main entry point.
//
// This is the package's first surface and, for now, its only one: the version
// of the build a host is running. The interpreter core arrives behind it.

import { version as packageVersion } from "../package.json";

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
