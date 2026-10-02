// The Basic HTTP processor's text encodings, written by hand.
//
// A form body, a query string and the `scxml-send-key` header's two escaped
// fields are percent-encoded here, byte by byte over each character's UTF-8
// form, and decoded here the same way. Nothing reaches a platform encoder: no
// URL parameter object, no text encoder and no Node buffer, because the engine
// React Native uses offers none of them reliably, and a hand encoder answers
// the same bytes on every engine.
//
// The reference is `Statifier.Send.BasicHTTP` in statifier-ex at v2.10.0: its
// private `form/1` (`URI.encode_query(pairs, :www_form)`), `escape/1`
// (`URI.encode/2` keeping RFC 3986's unreserved set), `encode/1` (a parameter
// value written as text), and the `URI.query_decoder/2` and `URI.decode/1`
// calls its `decode/1` makes.

import { isFloat, typeName, Undefined, type Value } from "@riddler/predicator";
import { encodeTagged } from "@riddler/predicator/tagged";

// RFC 3986's unreserved set, the characters neither encoding escapes.
function unreserved(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2d ||
    code === 0x2e ||
    code === 0x5f ||
    code === 0x7e
  );
}

const HEX = "0123456789ABCDEF";

// One character's UTF-8 bytes. A lone surrogate has no UTF-8 form; it is
// written as the replacement character, as a platform encoder writes it.
function utf8(code: number): number[] {
  const point = code >= 0xd800 && code <= 0xdfff ? 0xfffd : code;
  if (point < 0x80) return [point];
  if (point < 0x800) return [0xc0 | (point >> 6), 0x80 | (point & 0x3f)];
  if (point < 0x10000) {
    return [0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f)];
  }
  return [
    0xf0 | (point >> 18),
    0x80 | ((point >> 12) & 0x3f),
    0x80 | ((point >> 6) & 0x3f),
    0x80 | (point & 0x3f),
  ];
}

function percentEncode(text: string, spaceAsPlus: boolean): string {
  let out = "";
  for (const character of text) {
    const code = character.codePointAt(0) as number;
    if (unreserved(code)) {
      out += character;
    } else if (spaceAsPlus && code === 0x20) {
      out += "+";
    } else {
      for (const byte of utf8(code)) out += `%${HEX[byte >> 4]}${HEX[byte & 0x0f]}`;
    }
  }
  return out;
}

/**
 * Name and value pairs as an `application/x-www-form-urlencoded` body, in the
 * order given: each name and value percent-encoded over its UTF-8 bytes, a
 * space written `+`, and every character outside the unreserved set escaped.
 * The reference's `URI.encode_query(pairs, :www_form)`.
 */
export function encodeForm(pairs: readonly (readonly [string, string])[]): string {
  return pairs
    .map(([name, value]) => `${percentEncode(name, true)}=${percentEncode(value, true)}`)
    .join("&");
}

/**
 * A `scxml-send-key` field: every character outside the unreserved set
 * escaped over its UTF-8 bytes, a space as `%20`, so the field carries no `/`.
 * The reference's `URI.encode(value, &URI.char_unreserved?/1)`.
 */
export function escapeField(text: string): string {
  return percentEncode(text, false);
}

/**
 * A parameter value written as text, by the reference's `encode/1` rungs: a
 * string as it is, null as `null`, undefined as the empty string, an integer
 * in decimal, a float as the reference's runtime writes one, a boolean as its
 * literal. A list, a map, a date, a datetime and a duration have no rung
 * there - the reference writes them in its own language's inspect form and
 * leaves their encoding undecided - and are written here as predicator's
 * tagged-value text.
 */
export function encodeValue(value: Value): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (value === Undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (isFloat(value)) return floatText(value.valueOf());
  if (typeof value === "number") {
    return Number.isInteger(value) && Math.abs(value) < 1e21 ? String(value) : floatText(value);
  }
  const tagged = encodeTagged(value);
  return tagged.ok ? tagged.text : "";
}

/**
 * A float as the reference's runtime writes it: the shortest digits that read
 * back as the same number, in decimal or in scientific notation, whichever is
 * shorter, decimal on a tie. Either form keeps one digit after the point at
 * least: `2.0`, `1.0e15`, `1.0e-7`, `0.0001`.
 */
export function floatText(n: number): string {
  if (n === 0) return Object.is(n, -0) ? "-0.0" : "0.0";
  const sign = n < 0 ? "-" : "";
  const [mantissa = "", exponentText = "0"] = Math.abs(n).toExponential().split("e");
  const digits = mantissa.replace(".", "");
  const exponent = Number(exponentText);
  const scientific = `${digits[0]}.${digits.length > 1 ? digits.slice(1) : "0"}e${exponent}`;
  let decimal: string;
  if (exponent < 0) {
    decimal = `0.${"0".repeat(-exponent - 1)}${digits}`;
  } else if (digits.length <= exponent + 1) {
    decimal = `${digits}${"0".repeat(exponent + 1 - digits.length)}.0`;
  } else {
    decimal = `${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`;
  }
  return sign + (scientific.length < decimal.length ? scientific : decimal);
}

function hexValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x37;
  if (code >= 0x61 && code <= 0x66) return code - 0x57;
  return -1;
}

// Text whose escapes are decoded to bytes and the bytes read as UTF-8, or
// null when they are not UTF-8. An escape that is not `%` and two hex digits
// stays as it is written, as the reference's decoders leave it.
function percentDecode(text: string, plusAsSpace: boolean): string | null {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0x25 && i + 2 < text.length) {
      const high = hexValue(text.charCodeAt(i + 1));
      const low = hexValue(text.charCodeAt(i + 2));
      if (high >= 0 && low >= 0) {
        bytes.push(high * 16 + low);
        i += 2;
        continue;
      }
    }
    if (plusAsSpace && code === 0x2b) {
      bytes.push(0x20);
      continue;
    }
    const point = text.codePointAt(i) as number;
    if (point > 0xffff) i += 1;
    if (point >= 0xd800 && point <= 0xdfff) return null;
    bytes.push(...utf8(point));
  }
  return fromUtf8(bytes);
}

// UTF-8 bytes as a string, or null when they are not well-formed UTF-8: an
// overlong form, a surrogate, a point past U+10FFFF, or a truncated sequence.
function fromUtf8(bytes: readonly number[]): string | null {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const lead = bytes[i] as number;
    let length: number;
    let point: number;
    let least: number;
    if (lead < 0x80) {
      length = 1;
      point = lead;
      least = 0;
    } else if (lead >= 0xc2 && lead <= 0xdf) {
      length = 2;
      point = lead & 0x1f;
      least = 0x80;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      length = 3;
      point = lead & 0x0f;
      least = 0x800;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      length = 4;
      point = lead & 0x07;
      least = 0x10000;
    } else {
      return null;
    }
    if (i + length > bytes.length) return null;
    for (let k = 1; k < length; k += 1) {
      const next = bytes[i + k] as number;
      if ((next & 0xc0) !== 0x80) return null;
      point = (point << 6) | (next & 0x3f);
    }
    if (point < least || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return null;
    out += String.fromCodePoint(point);
    i += length;
  }
  return out;
}

/**
 * A form body or a query string as its name and value pairs, in order, or
 * null when an escape decodes to bytes that are not UTF-8. Pairs are split
 * at `&` and a pair at its first `=`; a pair with no `=` has the empty value;
 * an empty pair is kept as two empty strings, except the one after a final
 * `&`. The reference's `URI.query_decoder(text, :www_form)`.
 */
export function decodeForm(text: string): (readonly [string, string])[] | null {
  const parts = text.split("&");
  if (parts[parts.length - 1] === "") parts.pop();
  const pairs: (readonly [string, string])[] = [];
  for (const part of parts) {
    const at = part.indexOf("=");
    const name = percentDecode(at < 0 ? part : part.slice(0, at), true);
    const value = percentDecode(at < 0 ? "" : part.slice(at + 1), true);
    if (name === null || value === null) return null;
    pairs.push([name, value]);
  }
  return pairs;
}

/**
 * A field escaped as `escapeField` escapes one, decoded, or null when its
 * escapes are not UTF-8. A `+` stays a `+`. The reference's `URI.decode/1`.
 */
export function decodeField(text: string): string | null {
  return percentDecode(text, false);
}

/** Whether text holds a lone surrogate, which no UTF-8 body can carry. */
export function wellFormed(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Whether a value is a map, the shape the processor form-encodes. */
export function isMap(value: Value): value is { readonly [key: string]: Value } {
  return typeName(value) === "map";
}
