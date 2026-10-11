// A list or a map written by the Basic HTTP processor, pinned against the
// reference.
//
// Every row of JSON_ROWS was printed by `test/basichttp-json.reference.exs`,
// run against a scratch export of statifier-ex at v2.13.0 on the reference's
// pinned Elixir (1.18.3 on OTP 27): the value went through the reference's
// public `deliver/3` once as a form parameter and once as a `<content>` body.
// A row is the reference's value, as its runtime prints it; the value as this
// package holds it; the text the reference wrote for it as a parameter; and
// whether the value is a list, which the reference also sends whole as a
// `text/plain` body of that same text.
//
// The rows of TAGGED_ROWS are not the reference's: a list or a map holding a
// date, a datetime or a duration, or a value with no JSON form here, is
// written as predicator's tagged-value text, the text this package wrote for
// every list and map before; the reference writes its own language's inspect
// form for those, which is not ported.

import { Duration, float, PDate, PDateTime, Undefined, type Value } from "@riddler/predicator";
import { describe, expect, it } from "vitest";
import { encodeForm, encodeValue } from "../src/basichttp/encoding.js";
import { requestFor } from "../src/basichttp/processor.js";
import type { Send } from "../src/core/send.js";

// [the reference's value, as its runtime prints it; this package's value; the
// parameter text the reference wrote; whether the value is a list]
const JSON_ROWS: readonly (readonly [string, Value, string, boolean])[] = [
  ["[]", [], "[]", true],
  ["%{}", {}, "{}", false],
  ["[1, 2]", [1, 2], "[1,2]", true],
  [
    '["Dune", 2, 1.5, true, nil, [], %{}]',
    ["Dune", 2, float(1.5), true, null, [], {}],
    '["Dune",2,1.5,true,null,[],{}]',
    true,
  ],
  ['[:undefined, "Dune"]', [Undefined, "Dune"], '[null,"Dune"]', true],
  ['%{"due" => :undefined}', { due: Undefined }, '{"due":null}', false],
  [
    '%{"loan" => %{"copies" => 2, "title" => "Dune"}}',
    { loan: { title: "Dune", copies: 2 } },
    '{"loan":{"copies":2,"title":"Dune"}}',
    false,
  ],
  [
    '[%{"holds" => ["Dune", "Emma"], "patron" => "p-7"}]',
    [{ patron: "p-7", holds: ["Dune", "Emma"] }],
    '[{"holds":["Dune","Emma"],"patron":"p-7"}]',
    true,
  ],
  ["[[[]], [%{}]]", [[[]], [{}]], "[[[]],[{}]]", true],
  [
    '%{"" => 7, "10" => 5, "2" => 6, "B" => 3, "a" => 2, "b" => 1, "\u00e9" => 4}',
    { b: 1, a: 2, B: 3, "\u00e9": 4, "10": 5, "2": 6, "": 7 },
    '{"":7,"10":5,"2":6,"B":3,"a":2,"b":1,"\u00e9":4}',
    false,
  ],
  [
    '%{"z" => 3, "\ufffd" => 1, "\u{1F4DA}" => 2}',
    { "\ufffd": 1, "\u{1F4DA}": 2, z: 3 },
    '{"z":3,"\ufffd":1,"\u{1F4DA}":2}',
    false,
  ],
  [
    "[2.0, 0.1, -0.5, -0.0, 1.0e20, 1000000000000000.0, 1.0e-7, 0.0001, 9007199254740992.0]",
    [
      float(2),
      float(0.1),
      float(-0.5),
      float(-0),
      float(1e20),
      float(1e15),
      float(1e-7),
      float(0.0001),
      float(9007199254740992),
    ],
    "[2.0,0.1,-0.5,-0.0,1.0e20,1.0e15,1.0e-7,0.0001,9.007199254740992e15]",
    true,
  ],
  [
    "[0, -7, 123456789, 9007199254740991]",
    [0, -7, 123456789, 9007199254740991],
    "[0,-7,123456789,9007199254740991]",
    true,
  ],
  [
    '["quote \\" and backslash \\\\ and slash /"]',
    ['quote " and backslash \\ and slash /'],
    '["quote \\" and backslash \\\\ and slash /"]',
    true,
  ],
  [
    '["line\\nbreak", "tab\\there", "return\\rhere", "back\\bspace", "form\\ffeed"]',
    ["line\nbreak", "tab\there", "return\rhere", "back\bspace", "form\ffeed"],
    '["line\\nbreak","tab\\there","return\\rhere","back\\bspace","form\\ffeed"]',
    true,
  ],
  [
    '[<<0>>, <<1>>, <<31>>, "\\d"]',
    ["\u0000", "\u0001", "\u001f", "\u007f"],
    '["\\u0000","\\u0001","\\u001F","\u007f"]',
    true,
  ],
  [
    '["caf\u00e9", "\u{1F4DA}", "\\u2028\\u2029", "<b>&amp;</b>"]',
    ["caf\u00e9", "\u{1F4DA}", "\u2028\u2029", "<b>&amp;</b>"],
    '["caf\u00e9","\u{1F4DA}","\u2028\u2029","<b>&amp;</b>"]',
    true,
  ],
  [
    '%{"a\\"b" => "c\\\\d", "line\\nkey" => "v"}',
    { 'a"b': "c\\d", "line\nkey": "v" },
    '{"a\\"b":"c\\\\d","line\\nkey":"v"}',
    false,
  ],
  ["[true, false, nil]", [true, false, null], "[true,false,null]", true],
];

const SEND: Send = {
  kind: "send",
  event: "hold.ready",
  target: "https://library.example/desk-1",
  type: "basichttp",
  data: Undefined,
  sendId: "send_3",
  idFromAuthor: false,
  cIndex: 1,
  owner: { kind: "transition", tIndex: 4 },
  macrostep: 3,
  microstep: 2,
  round: 0,
  ordinal: null,
};

const LOAN_DUE = new PDate(2026, 10, 16);

// [what the value holds; this package's value; the tagged-value text written]
const TAGGED_ROWS: readonly (readonly [string, Value, string])[] = [
  ["a date", [LOAN_DUE], '[{"$type":"date","value":"2026-10-16"}]'],
  [
    "a datetime",
    { due: new PDateTime(1_790_000_000, 0), copy: "book-17" },
    '{"due":{"$type":"datetime","value":"2026-09-21T14:13:20Z"},"copy":"book-17"}',
  ],
  [
    "a duration",
    ["Dune", new Duration({ days: 2 })],
    '["Dune",{"$type":"duration","value":{"days":2,"hours":0,"minutes":0,"months":0,"seconds":0,"weeks":0,"years":0}}]',
  ],
  [
    "a date nested beside an undefined",
    { loan: { due: LOAN_DUE, grace: Undefined } },
    '{"loan":{"due":{"$type":"date","value":"2026-10-16"},"grace":{"$type":"undefined"}}}',
  ],
  ["a string holding a lone surrogate", ["a\ud800"], '["a\\ud800"]'],
];

describe("a list or a map, against the reference's JSON text", () => {
  // Sabotage: writing undefined inside as `{"$type":"undefined"}` in
  // `jsonText`, listing a map's keys in insertion order, or writing a control
  // character's escape in lower-case hex turns rows red.
  it.each(JSON_ROWS)("writes the reference's %s as it does", (_ref, value, text) => {
    expect(encodeValue(value)).toBe(text);
    expect(encodeForm([["v", encodeValue(value)]])).toBe(encodeForm([["v", text]]));
  });

  // Sabotage: writing a list body as its members joined by commas in
  // `requestFor`'s text arm turns these rows red.
  it.each(JSON_ROWS.filter((row) => row[3]))(
    "sends the reference's %s as a text/plain body of the same text",
    (_ref, value, text) => {
      const request = requestFor("b", { ...SEND, data: value });
      expect(request?.headers[0]).toEqual(["content-type", "text/plain"]);
      expect(request?.body).toBe(text);
    },
  );
});

describe("a map holding the key the tagged-value text reserves", () => {
  // Sabotage: refusing a `$type` key in `jsonText` writes the empty string,
  // the answer the tagged-value text gave, and turns this red.
  it("writes it as JSON text, as the reference does", () => {
    expect(encodeValue({ $type: "hold" })).toBe('{"$type":"hold"}');
  });
});

describe("an integer negative zero inside a list", () => {
  // Sabotage: writing an integer with `String` alone in `jsonText` writes
  // `[0]` and turns this red.
  it("is written -0, as the tagged-value text wrote it", () => {
    expect(encodeValue([-0])).toBe("[-0]");
  });
});

describe("a list or a map with no JSON form here", () => {
  // Sabotage: giving a date, a datetime or a duration a JSON form in
  // `jsonText`, or a lone surrogate one, turns rows red.
  it.each(TAGGED_ROWS)("keeps the tagged-value text for one holding %s", (_what, value, text) => {
    expect(encodeValue(value)).toBe(text);
  });

  // Sabotage: admitting every finite plain number in `jsonText`, not only an
  // integer in the safe range, writes the last two lists and turns this red.
  it("writes nothing for a value the tagged-value text refuses as well", () => {
    const cyclic: Value[] = ["Dune"];
    cyclic.push(cyclic);
    expect(encodeValue(cyclic)).toBe("");
    expect(encodeValue([Number.NaN])).toBe("");
    expect(encodeValue([2 ** 60])).toBe("");
    expect(encodeValue([1.5])).toBe("");
    expect(encodeValue({ copy: new Date(0) as unknown as Value })).toBe("");
    expect(encodeValue({ copy: undefined as unknown as Value })).toBe("");
  });

  // Sabotage: dropping the depth limit in `jsonText` writes the deep list
  // whole, and dropping the place budget writes the shared one (more than a
  // million places); each turns this red.
  it("writes nothing for a value past the depth limit or the place budget", () => {
    let deep: Value = [];
    for (let i = 0; i < 300; i += 1) deep = [deep];
    expect(encodeValue(deep)).toBe("");
    let shared: Value = [];
    for (let i = 0; i < 21; i += 1) shared = [shared, shared];
    expect(encodeValue(shared)).toBe("");
  });

  // Sabotage: dropping the well-formed check on a key in `jsonText` writes the
  // lone surrogate raw, and turns this red.
  it("keeps the tagged-value text for a map whose key holds a lone surrogate", () => {
    expect(encodeValue({ "a\udc00": 1 })).toBe('{"a\\udc00":1}');
  });
});

describe("a map's member that is a list or a map, as a form parameter", () => {
  // Sabotage: writing a list or a map member as the empty string in
  // `requestFor`'s form arm turns this red.
  it("posts the member as JSON text, percent-encoded", () => {
    const request = requestFor("b", {
      ...SEND,
      data: { holds: [Undefined, "Dune"], loan: { title: "Dune", copies: 2 } },
    });
    expect(request?.body).toBe(
      "_scxmleventname=hold.ready&holds=%5Bnull%2C%22Dune%22%5D" +
        "&loan=%7B%22copies%22%3A2%2C%22title%22%3A%22Dune%22%7D",
    );
  });
});
