// The Basic HTTP processor's hand encoder, pinned against the reference.
//
// Every expected string below was printed by the reference's own clauses at
// statifier-ex v2.10.0, run on the reference's pinned Elixir (1.18.3 on OTP
// 27): `encode/1` and `form/1` (`URI.encode_query(pairs, :www_form)`) and
// `escape/1` from `lib/statifier/send/basic_http.ex`, and `URI.query_decoder/2`
// with `:www_form` and `URI.decode/1`, which `decode/1` calls. A row is the
// reference's value, the value as this package holds it, the text `encode/1`
// wrote, and the form body `form([{"k", text}])` wrote.

import { float, Undefined, type Value } from "@riddler/predicator";
import { describe, expect, it } from "vitest";
import {
  decodeField,
  decodeForm,
  encodeForm,
  encodeValue,
  escapeField,
  floatText,
  wellFormed,
} from "../src/basichttp/encoding.js";

// [the reference's value, as Elixir prints it; this package's value; encode/1; form/1]
const VALUE_ROWS: readonly (readonly [string, Value, string, string])[] = [
  ['"plain"', "plain", "plain", "k=plain"],
  ['""', "", "", "k="],
  ['"a b"', "a b", "a b", "k=a+b"],
  ['"a+b"', "a+b", "a+b", "k=a%2Bb"],
  ['"a&b=c"', "a&b=c", "a&b=c", "k=a%26b%3Dc"],
  ['"100%"', "100%", "100%", "k=100%25"],
  ['"~-._"', "~-._", "~-._", "k=~-._"],
  ['"*\'()!"', "*'()!", "*'()!", "k=%2A%27%28%29%21"],
  ['"café"', "café", "café", "k=caf%C3%A9"],
  ['"\u{1F4DA}"', "\u{1F4DA}", "\u{1F4DA}", "k=%F0%9F%93%9A"],
  ['"line\\nbreak"', "line\nbreak", "line\nbreak", "k=line%0Abreak"],
  ['"/?#[]@"', "/?#[]@", "/?#[]@", "k=%2F%3F%23%5B%5D%40"],
  ["nil", null, "null", "k=null"],
  [":undefined", Undefined, "", "k="],
  ["true", true, "true", "k=true"],
  ["false", false, "false", "k=false"],
  ["0", 0, "0", "k=0"],
  ["2", 2, "2", "k=2"],
  ["-7", -7, "-7", "k=-7"],
  ["123456789", 123456789, "123456789", "k=123456789"],
  ["9007199254740991", 9007199254740991, "9007199254740991", "k=9007199254740991"],
  ["1.5", float(1.5), "1.5", "k=1.5"],
  ["2.0", float(2), "2.0", "k=2.0"],
  ["0.1", float(0.1), "0.1", "k=0.1"],
  ["-0.5", float(-0.5), "-0.5", "k=-0.5"],
  ["1.0e20", float(1e20), "1.0e20", "k=1.0e20"],
  ["1.0e21", float(1e21), "1.0e21", "k=1.0e21"],
  ["1000000000000000.0", float(1e15), "1.0e15", "k=1.0e15"],
  ["1.0e16", float(1e16), "1.0e16", "k=1.0e16"],
  ["123456789.0", float(123456789), "123456789.0", "k=123456789.0"],
  ["0.0001", float(0.0001), "0.0001", "k=0.0001"],
  ["0.001", float(0.001), "0.001", "k=0.001"],
  ["1.0e-7", float(1e-7), "1.0e-7", "k=1.0e-7"],
  ["12.5", float(12.5), "12.5", "k=12.5"],
  ["-0.0", float(-0), "-0.0", "k=-0.0"],
  ["100.0", float(100), "100.0", "k=100.0"],
];

// [the reference's float; the text `to_string/1` wrote]
const FLOAT_ROWS: readonly (readonly [number, string])[] = [
  [1000, "1.0e3"],
  [10000, "1.0e4"],
  [100000, "1.0e5"],
  [12345, "12345.0"],
  [123456, "123456.0"],
  [1234567, "1234567.0"],
  [0.00012, "1.2e-4"],
  [1.5e-5, "1.5e-5"],
  [1e100, "1.0e100"],
  [5e-324, "5.0e-324"],
  [1.7976931348623157e308, "1.7976931348623157e308"],
  [0.30000000000000004, "0.30000000000000004"],
  [1e-5, "1.0e-5"],
  [0.012, "0.012"],
  [99999, "99999.0"],
  [1.25e6, "1.25e6"],
  [12.5, "12.5"],
  [0.5, "0.5"],
  [1, "1.0"],
  [10, "10.0"],
  [1e22, "1.0e22"],
  [0.0025, "0.0025"],
  [1e9, "1.0e9"],
  [1e10, "1.0e10"],
  [123.456, "123.456"],
  // Around 2^53, past which the reference writes every float in scientific
  // notation even where decimal would be shorter, and the small end.
  [4503599627370496, "4503599627370496.0"],
  [9007199254740990, "9007199254740990.0"],
  [9007199254740992, "9.007199254740992e15"],
  [9007199254740994, "9.007199254740994e15"],
  [-9007199254740992, "-9.007199254740992e15"],
  [1.2345678901234568e16, "1.2345678901234568e16"],
  [2e16, "2.0e16"],
  [123456789012345680, "1.2345678901234568e17"],
  [1.2e17, "1.2e17"],
  [9.87654321e18, "9.87654321e18"],
  [8e15, "8.0e15"],
  [8.5e15, "8.5e15"],
  [0.0001, "0.0001"],
  [1.25e-5, "1.25e-5"],
  [0.000123456, "1.23456e-4"],
];

// [the text; URI.query_decoder(text, :www_form) as pairs]
const DECODE_ROWS: readonly (readonly [string, readonly (readonly [string, string])[]])[] = [
  [
    "a=1&&b=2",
    [
      ["a", "1"],
      ["", ""],
      ["b", "2"],
    ],
  ],
  ["a", [["a", ""]]],
  ["a=", [["a", ""]]],
  ["=v", [["", "v"]]],
  ["a=1=2", [["a", "1=2"]]],
  ["a+b=c+d%20e", [["a b", "c d e"]]],
  ["", []],
  ["&", [["", ""]]],
  ["x=%C3%A9", [["x", "é"]]],
  [
    "k=%F0%9F%93%9A&k=2",
    [
      ["k", "\u{1F4DA}"],
      ["k", "2"],
    ],
  ],
  ["x=%zz", [["x", "%zz"]]],
  ["x=%", [["x", "%"]]],
  ["a=1&", [["a", "1"]]],
  [
    "&a=1",
    [
      ["", ""],
      ["a", "1"],
    ],
  ],
  [
    "a=1&&",
    [
      ["a", "1"],
      ["", ""],
    ],
  ],
  ["x=%c3%a9", [["x", "é"]]],
  ["x=%2", [["x", "%2"]]],
  ["x=%%41", [["x", "%A"]]],
  ["k=a%2Bb+c", [["k", "a+b c"]]],
];

describe("the form body encoder, against the reference's encodings", () => {
  // Sabotage: writing undefined as "undefined" in `encodeValue`, or a space
  // as %20 in the form encoder, turns rows red.
  it.each(VALUE_ROWS)("encodes the reference's %s as it does", (_ref, value, text, form) => {
    expect(encodeValue(value)).toBe(text);
    expect(encodeForm([["k", encodeValue(value)]])).toBe(form);
  });

  // Sabotage: breaking the tie toward scientific notation in `floatText`
  // turns the 0.0001 and 0.0025 rows red; dropping the 2^53 switch turns the
  // 9.007199254740992e15 and 1.2345678901234568e17 rows red.
  it.each(FLOAT_ROWS)("writes the float %d as the reference writes it", (n, text) => {
    expect(floatText(n)).toBe(text);
  });

  it("writes a plain non-integral number as a float, as the reference holds one", () => {
    expect(encodeValue(1.5)).toBe("1.5");
    expect(encodeValue(1e21)).toBe("1.0e21");
  });

  it("encodes pairs in the order given, joined by &", () => {
    expect(
      encodeForm([
        ["_scxmleventname", "test"],
        ["Var1", "2"],
        ["a b", "c&d"],
      ]),
    ).toBe("_scxmleventname=test&Var1=2&a+b=c%26d");
    expect(encodeForm([])).toBe("");
  });

  it("writes a list and a map as predicator's tagged-value text", () => {
    expect(encodeValue([1, float(2)])).toBe("[1,2.0]");
    expect(encodeValue({ copy: "book-17" })).toBe('{"copy":"book-17"}');
  });

  it("writes a lone surrogate as the replacement character", () => {
    expect(encodeForm([["k", "a\ud800b"]])).toBe("k=a%EF%BF%BDb");
  });
});

describe("the send key's field escape, against the reference's", () => {
  // Sabotage: keeping `/` unescaped in `escapeField` turns this red.
  it("escapes everything outside the unreserved set, a space as %20", () => {
    expect(escapeField("session 1/é~.-_")).toBe("session%201%2F%C3%A9~.-_");
  });

  it("decodes a field, leaving + and a malformed escape as written", () => {
    expect(decodeField("a+b%2F")).toBe("a+b/");
    expect(decodeField("a%zz")).toBe("a%zz");
    expect(decodeField("%C3")).toBeNull();
  });
});

describe("the form decoder, against the reference's", () => {
  // Sabotage: dropping every empty pair in `decodeForm`, not only the one
  // after a final &, turns the "a=1&&b=2" and "&" rows red.
  it.each(DECODE_ROWS)("decodes %j as the reference does", (text, pairs) => {
    expect(decodeForm(text)).toEqual(pairs);
  });

  it("refuses escapes that are not UTF-8", () => {
    expect(decodeForm("x=%C3")).toBeNull();
    expect(decodeForm("x=%C0%80")).toBeNull();
    expect(decodeForm("x=%ED%A0%80")).toBeNull();
    expect(decodeForm("x=%F4%90%80%80")).toBeNull();
    expect(decodeForm("x=%80")).toBeNull();
    expect(decodeForm("x=%E2%82")).toBeNull();
    expect(decodeForm("x=%E2%28%A1")).toBeNull();
  });

  it("decodes characters that were never escaped, astral ones included", () => {
    expect(decodeForm("copy=\u{1F4DA}&branch=é")).toEqual([
      ["copy", "\u{1F4DA}"],
      ["branch", "é"],
    ]);
    expect(decodeForm("x=\ud800")).toBeNull();
  });

  it("tells a well-formed text from one holding a lone surrogate", () => {
    expect(wellFormed("\u{1F4DA} ok")).toBe(true);
    expect(wellFormed("a\ud800")).toBe(false);
    expect(wellFormed("a\udc00b")).toBe(false);
    expect(wellFormed("\ud800x")).toBe(false);
  });
});
