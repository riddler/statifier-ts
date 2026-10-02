// The main entry point's export surface.
//
// A runtime name is pinned by listing it: the module's own keys, sorted, must
// be exactly the list below, so a name added or dropped at the entry point
// fails here until the list moves with it. A type-only export leaves no
// runtime name, so it is pinned by a declaration that names it through the
// entry point: `tsc` refuses the file when the type is no longer exported.
// Later changes add their names here.

import { describe, expect, it } from "vitest";
import type {
  HttpAnswer,
  HttpFailure,
  HttpRequest,
  HttpStatus,
  HttpTransport,
} from "../src/index.js";
import * as entry from "../src/index.js";

const RUNTIME_NAMES = [
  "advance",
  "compile",
  "configuration",
  "exportPosition",
  "importPosition",
  "isDone",
  "start",
  "step",
  "version",
];

// The transport types, each named through the entry point. Removing one of
// them from `src/index.ts` makes this declaration fail to typecheck.
type TransportTypes = [HttpTransport, HttpRequest, HttpAnswer, HttpStatus, HttpFailure];
const transportTypesNamed: TransportTypes | undefined = undefined;

describe("the main entry point", () => {
  // Sabotage: exporting one more function from `src/index.ts`, or dropping
  // `version`, turns this red.
  it("exports exactly the runtime names listed", () => {
    expect(Object.keys(entry).sort()).toEqual(RUNTIME_NAMES);
  });

  it("exports the HTTP transport types, as types only", () => {
    expect(transportTypesNamed).toBeUndefined();
    expect(Object.keys(entry).filter((name) => name.startsWith("Http"))).toEqual([]);
  });
});
