// The delay parser: the expression language's exported duration parser, the
// leading-dot rewrite and the conversion to milliseconds in front of it.
//
// The fixture table is the reference expression language's own: every
// assertion of the `describe "parse/1"` block in predicator-ex at tag v9.4.2
// (d8067df), `test/predicator/duration_test.exs`, one row per assertion, in
// file order, each row named for the test it came from: 25 tests, 47 assertion
// lines, 52 rows. The difference is the round-trip test, whose one assertion
// runs over six durations and so is six rows; each row carries the text
// `Duration.to_string/1` writes for its duration, since there is no such
// writer here.

import {
  Duration,
  type DurationParts,
  durationToMilliseconds,
  evaluate,
  parseDuration,
} from "@riddler/predicator";
import { describe, expect, it } from "vitest";
import { delayToMs, normalizeLeadingDot } from "../src/duration.js";

/** One assertion of the reference table: a text and the parts it parses to, or null for a refusal. */
type Row = readonly [test: string, text: string, parts: DurationParts | null];

const EIGHT = "parses each of the eight units alone";
const DISAMBIGUATES = "disambiguates mo from m and ms from m";
const ACCUMULATES = "accumulates on a repeated unit";
const ROUND_TRIP = "round-trips through to_string/1, including the 0s case";
const EVERY_UNIT = "accepts a fractional component on every unit";

const TABLE: readonly Row[] = [
  [EIGHT, "1y", { years: 1 }],
  [EIGHT, "1mo", { months: 1 }],
  [EIGHT, "1w", { weeks: 1 }],
  [EIGHT, "1d", { days: 1 }],
  [EIGHT, "1h", { hours: 1 }],
  [EIGHT, "1m", { minutes: 1 }],
  [EIGHT, "1s", { seconds: 1 }],
  [EIGHT, "1ms", { milliseconds: 1 }],
  ["parses a multi-unit string", "3d8h30m", { days: 3, hours: 8, minutes: 30 }],
  [DISAMBIGUATES, "1mo", { months: 1 }],
  [DISAMBIGUATES, "1m", { minutes: 1 }],
  [DISAMBIGUATES, "1ms", { milliseconds: 1 }],
  [DISAMBIGUATES, "2mo3m4ms", { months: 2, minutes: 3, milliseconds: 4 }],
  [ACCUMULATES, "1d2d", { days: 3 }],
  [ACCUMULATES, "1h1h1h", { hours: 3 }],
  [ROUND_TRIP, "0s", {}],
  [ROUND_TRIP, "0s", { seconds: 0 }],
  [ROUND_TRIP, "3d8h30m", { days: 3, hours: 8, minutes: 30 }],
  [ROUND_TRIP, "2w", { weeks: 2 }],
  [
    ROUND_TRIP,
    "1y2mo3w4d5h6m7s",
    { years: 1, months: 2, weeks: 3, days: 4, hours: 5, minutes: 6, seconds: 7 },
  ],
  [ROUND_TRIP, "500ms", { milliseconds: 500 }],
  ["rejects the empty string", "", null],
  ["rejects a negative value", "-1d", null],
  ["accepts a fractional value and expands it to whole units", "1.5d", { days: 1, hours: 12 }],
  [EVERY_UNIT, "1.5s", { seconds: 1, milliseconds: 500 }],
  [EVERY_UNIT, "0.5s", { milliseconds: 500 }],
  [EVERY_UNIT, "0.25s", { milliseconds: 250 }],
  [EVERY_UNIT, "0.1s", { milliseconds: 100 }],
  [EVERY_UNIT, "1.0s", { seconds: 1 }],
  [EVERY_UNIT, "0.0s", { seconds: 0 }],
  [EVERY_UNIT, "1.5m", { minutes: 1, seconds: 30 }],
  [EVERY_UNIT, "1.5h", { hours: 1, minutes: 30 }],
  [EVERY_UNIT, "0.5w", { days: 3, hours: 12 }],
  [EVERY_UNIT, "0.5mo", { days: 15 }],
  [EVERY_UNIT, "1.5y", { years: 1, days: 182, hours: 12 }],
  [EVERY_UNIT, "1.0ms", { milliseconds: 1 }],
  [
    "accumulates a mixed fractional and integer literal, unlike the compiled literal grammar",
    "1.5s200ms",
    { seconds: 1, milliseconds: 700 },
  ],
  ["rejects an unknown unit", "1x", null],
  ["rejects trailing junk", "1dabc", null],
  ["rejects leading whitespace", " 1d", null],
  ["rejects embedded whitespace", "1d 2h", null],
  ["rejects a sub-millisecond remainder", "0.5ms", null],
  ["rejects an inexact fraction", "1.0005s", null],
  ["rejects a leading-dot fraction", ".5s", null],
  ["rejects a trailing-dot fraction", "1.s", null],
  ["rejects a bare unit", "s", null],
  ["rejects a double dot", "1..5s", null],
  ["rejects a fraction with no unit", "1.5", null],
  ["rejects a bare number with no unit", "42", null],
  ["rejects trailing whitespace", "1d ", null],
  ["rejects a trailing newline", "1d\n", null],
  ["rejects a leading newline", "\n1d", null],
];

/**
 * The rows the leading-dot rewrite answers differently from the exported
 * parser, with what the delay parser answers for each. There is one.
 */
const REWRITTEN: Readonly<Record<string, number>> = { ".5s": 500 };

describe("the reference's duration table", () => {
  it("carries every assertion of the reference's parse/1 block", () => {
    expect(TABLE).toHaveLength(52);
    expect(new Set(TABLE.map(([test]) => test)).size).toBe(25);
  });

  describe("against the exported parser", () => {
    it.each(TABLE)("%s: %j", (_test, text, parts) => {
      const result = parseDuration(text);
      if (parts === null) {
        expect(result).toStrictEqual({ ok: false, reason: "invalid_duration_format" });
      } else {
        expect(result).toStrictEqual({ ok: true, value: new Duration(parts) });
      }
    });
  });

  describe("through the delay parser", () => {
    // Sabotage: dropping the leading-dot rewrite turns the ".5s" row red;
    // prefixing "0" to every text turns the "s" row red.
    it.each(TABLE)("%s: %j", (_test, text, parts) => {
      const rewritten = REWRITTEN[text];
      if (rewritten !== undefined) {
        expect(delayToMs(text)).toStrictEqual({ ok: true, ms: rewritten });
      } else if (parts === null) {
        expect(delayToMs(text)).toStrictEqual({ ok: false, reason: "invalid_delay", value: text });
      } else {
        expect(delayToMs(text)).toStrictEqual({
          ok: true,
          ms: durationToMilliseconds(new Duration(parts)),
        });
      }
    });
  });
});

describe("a duration value as a delay", () => {
  // The weights are the reference's (`Predicator.Duration.to_milliseconds/1`
  // in predicator-ex at v9.4.2): the conversion is the dependency's, and these
  // rows pin it to the reference's numbers.
  // Sabotage: a wrong weight for any one unit in the conversion, or a unit
  // left out of the sum, turns its row red.
  it.each([
    [{ milliseconds: 1 }, 1],
    [{ seconds: 1 }, 1_000],
    [{ minutes: 1 }, 60_000],
    [{ hours: 1 }, 3_600_000],
    [{ days: 1 }, 86_400_000],
    [{ weeks: 1 }, 604_800_000],
    [{ months: 1 }, 2_592_000_000],
    [{ years: 1 }, 31_536_000_000],
  ] as const)("weighs %j as %i ms, as the reference converts it", (parts, ms) => {
    expect(delayToMs(new Duration(parts))).toStrictEqual({ ok: true, ms });
  });

  // Sabotage: converting a duration value by anything but its whole sum
  // (years left out, say) turns this red.
  it("sums every part", () => {
    expect(
      delayToMs(
        new Duration({
          years: 1,
          months: 1,
          weeks: 1,
          days: 1,
          hours: 1,
          minutes: 1,
          seconds: 1,
          milliseconds: 1,
        }),
      ),
    ).toStrictEqual({
      ok: true,
      ms:
        31_536_000_000 + 2_592_000_000 + 604_800_000 + 86_400_000 + 3_600_000 + 60_000 + 1_000 + 1,
    });
  });
});

describe("normalizeLeadingDot", () => {
  // Sabotage: prefixing "0" to every text turns the unchanged rows red.
  it.each([
    [".5s", "0.5s"],
    [".25s", "0.25s"],
    ["0.5s", "0.5s"],
    ["1.5s", "1.5s"],
    ["1s", "1s"],
    ["", ""],
  ])("rewrites %j to %j", (text, rewritten) => {
    expect(normalizeLeadingDot(text)).toBe(rewritten);
  });

  // Sabotage: rewriting every dot rather than a leading one turns this red.
  it("rewrites only the leading dot, so a malformed text stays malformed", () => {
    expect(normalizeLeadingDot("..5s")).toBe("0..5s");
    expect(delayToMs("..5s")).toStrictEqual({ ok: false, reason: "invalid_delay", value: "..5s" });
  });
});

describe("the delays the corpus uses", () => {
  // Every distinct `delay` attribute value in the reference's conformance
  // sources at v2.9.0, with the milliseconds each resolves to. The case files
  // that record a send's `delay_ms` carry the same numbers for the day spans.
  const DELAYS: readonly (readonly [string, number])[] = [
    ["1ms", 1],
    ["2ms", 2],
    ["10ms", 10],
    ["1s", 1_000],
    ["2s", 2_000],
    ["3s", 3_000],
    ["5s", 5_000],
    ["20s", 20_000],
    ["7d", 604_800_000],
    ["18d", 1_555_200_000],
    ["21d", 1_814_400_000],
    ["28d", 2_419_200_000],
  ];

  // Sabotage: weighing a second as 100 ms turns every seconds row red.
  it.each(DELAYS)("delay=%j is %i ms", (text, ms) => {
    expect(delayToMs(text)).toStrictEqual({ ok: true, ms });
  });

  // Every distinct `delayexpr` in the same sources: quoted string literals,
  // and one variable the chart assigns `'1s'` before the send. Each is
  // evaluated by the expression language and its value handed to the parser,
  // as a `delayexpr` result reaches it.
  const DELAYEXPRS: readonly (readonly [string, number])[] = [
    ["'1s'", 1_000],
    ["'2s'", 2_000],
    ["'1.5s'", 1_500],
    ["'.5s'", 500],
    ["'10ms'", 10],
    ["Var1", 1_000],
  ];

  // Sabotage: dropping the leading-dot rewrite turns the "'.5s'" row red.
  it.each(DELAYEXPRS)("delayexpr=%j is %i ms", (expr, ms) => {
    const evaluated = evaluate(expr, { Var1: "1s" });
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;
    expect(typeof evaluated.value).toBe("string");
    expect(delayToMs(evaluated.value as string)).toStrictEqual({ ok: true, ms });
  });
});

describe("delayToMs", () => {
  // Sabotage: converting only a duration value's seconds turns this red.
  it("converts a duration value a delayexpr computed as it is", () => {
    const evaluated = evaluate("2s");
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;
    expect(evaluated.value).toBeInstanceOf(Duration);
    expect(delayToMs(evaluated.value as Duration)).toStrictEqual({ ok: true, ms: 2_000 });
    expect(delayToMs(new Duration({ seconds: 1, milliseconds: 500 }))).toStrictEqual({
      ok: true,
      ms: 1_500,
    });
  });

  // Sabotage: answering zero milliseconds for a refused text turns these red.
  it.each(["1us", "1ns", "1min", "1sec", "1yr", "1q", "1M", "1S"])(
    "refuses a ninth unit, %j",
    (text) => {
      expect(delayToMs(text)).toStrictEqual({ ok: false, reason: "invalid_delay", value: text });
    },
  );

  // Sabotage: carrying the rewritten text rather than the given one turns
  // this red.
  it("carries the text as it was given on a refusal", () => {
    expect(delayToMs(".5x")).toStrictEqual({ ok: false, reason: "invalid_delay", value: ".5x" });
  });
});
