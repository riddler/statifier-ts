// SHA-256 and the UTF-8 encoding under it, held to the standard's own test
// vectors and to Node's implementations of both, which the package cannot
// use but a test can.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex, utf8Bytes } from "../src/sha256.js";

function nodeSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function ascii(text: string): Uint8Array {
  return utf8Bytes(text);
}

describe("sha256Hex", () => {
  // Sabotage: changing the first round constant from 0x428a2f98 to
  // 0x428a2f99 turns every vector red.
  it("answers the FIPS 180-4 example digests", () => {
    expect(sha256Hex(ascii(""))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex(ascii("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex(ascii("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  // Sabotage: padding to (length + 8) / 64 blocks instead of (length + 9)
  // drops the length word at 56 bytes and turns this red.
  it("agrees with Node's digest across every padding boundary", () => {
    for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000]) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 31 + 7) & 0xff);
      expect(sha256Hex(bytes), `length ${length}`).toBe(nodeSha256(bytes));
    }
  });

  // Sabotage: writing the digest in upper case turns this red.
  it("answers 64 lowercase hexadecimal digits", () => {
    expect(sha256Hex(ascii("loan"))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("utf8Bytes", () => {
  // Sabotage: writing a two-byte point's lead as 0xe0 instead of 0xc0 turns
  // this red.
  it("encodes one-, two-, three- and four-byte points as Node does", () => {
    for (const text of ["copy", "è", "€", "\u{1F4DA}", "aè€\u{1F4DA}z"]) {
      expect(Array.from(utf8Bytes(text)), text).toEqual(Array.from(Buffer.from(text, "utf8")));
    }
  });

  // Sabotage: dropping the lone-surrogate replacement (encoding the unit as
  // a three-byte point) turns this red.
  it("writes a lone surrogate as U+FFFD, as Node does", () => {
    for (const text of ["\ud83d", "\ud83dz", "\udcda", "a\udcdab", "\ud83d\ud83d"]) {
      expect(Array.from(utf8Bytes(text)), JSON.stringify(text)).toEqual(
        Array.from(Buffer.from(text, "utf8")),
      );
    }
  });
});
