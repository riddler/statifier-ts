// The main entry point.

import { describe, expect, it } from "vitest";
import manifest from "../package.json";
import { version } from "../src/index.js";

describe("version", () => {
  // Sabotage: returning the string "0.0.1" instead of the manifest's field
  // turns this red.
  it("answers the version the manifest carries", () => {
    expect(version()).toBe(manifest.version);
    expect(version()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
