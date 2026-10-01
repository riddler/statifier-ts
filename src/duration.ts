// The one place this package turns an SCXML delay into milliseconds.
//
// A delay reaches the interpreter in one of two shapes: the text of a
// `<send delay>` attribute (or a `delayexpr` that evaluated to a string), or a
// duration value a `delayexpr` computed. Parsing is delegated whole to the
// expression language's own duration parser, `parseDuration` from
// `@riddler/predicator`, as the reference engine delegates it to its
// expression language's parser (`Statifier.Duration.to_ms/1` in statifier-ex
// at v2.9.0). One duration vocabulary across the family: a duration means the
// same thing in a delay as in any expression a chart evaluates.
//
// The units are that parser's eight - `y`, `mo`, `w`, `d`, `h`, `m`, `s` and
// `ms` - a superset of the five the SCXML schema's delay pattern names, and
// they are taken as they are, as the reference takes them. Anything else is
// refused.
//
// One thing here is this package's own, and it is the reference's too:
//
// - The leading-dot rewrite. The schema's pattern admits a bare leading dot
//   (`.5s`) and the expression language's parser refuses it, so a leading `.`
//   becomes `0.` before the parse (`Statifier.Duration.normalize_leading_dot/1`
//   at v2.9.0). It is the only rewrite; every other character reaches the
//   parser untouched.
//
// The conversion to milliseconds is the expression language's too: the parser
// answers a duration's parts, and `durationToMilliseconds` sums them by the
// weights the reference's expression language converts by (`Predicator
// .Duration.to_milliseconds/1`): a month is thirty days and a year three
// hundred and sixty five. The reference's sum is exact at any size; here a
// total past the largest safe integer (some 285,000 years of milliseconds) is
// not, and no delay the corpus uses comes near it.

import { Duration, durationToMilliseconds, parseDuration } from "@riddler/predicator";

/** A delay in whole milliseconds, or the refusal of one that is not a delay. */
export type DelayResult =
  | { readonly ok: true; readonly ms: number }
  | { readonly ok: false; readonly reason: "invalid_delay"; readonly value: string };

/**
 * Rewrites a leading `.` to `0.`, so `.5s` reads as `0.5s`. Text with no
 * leading dot comes back unchanged.
 */
export function normalizeLeadingDot(text: string): string {
  return text.startsWith(".") ? `0${text}` : text;
}

/**
 * Resolves a delay to whole milliseconds.
 *
 * A string is parsed after the leading-dot rewrite; a duration value is
 * converted as it is. A string the parser refuses - an unknown unit, a sign,
 * whitespace, a fraction that is not a whole number of milliseconds, the empty
 * string - answers `invalid_delay` carrying the text as it was given.
 */
export function delayToMs(value: string | Duration): DelayResult {
  if (value instanceof Duration) {
    return { ok: true, ms: durationToMilliseconds(value) };
  }
  const parsed = parseDuration(normalizeLeadingDot(value));
  if (!parsed.ok) {
    return { ok: false, reason: "invalid_delay", value };
  }
  return { ok: true, ms: durationToMilliseconds(parsed.value) };
}
