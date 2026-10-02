// The Basic HTTP processor's inbound half: one HTTP request to the event it
// carries (SCXML appendix C.2.1).
//
// On a device the processor sends and nothing listens, so this is for a host
// that runs a server: its front resolves the request's location to a
// session, decodes the request here, and passes the event to `step` with the
// state it holds for that session. The decoder is pure and remembers
// nothing; deduplicating on the `scxml-send-key` header is the front's.
//
// The reference is `Statifier.Send.BasicHTTP.decode/1` in statifier-ex at
// v2.10.0 (its ADR-0075 decision 5 and the Amendment of 2026-09-30).

import { paramsData, textData } from "../core/send.js";
import type { HostEvent } from "../driver.js";
import { decodeField, decodeForm, wellFormed } from "./encoding.js";

const EVENT_NAME_PARAM = "_scxmleventname";
const FORM = "application/x-www-form-urlencoded";

/**
 * One request as a front hands it over: its method, its content type (null
 * when it carries none), its body as text, its query string without the `?`
 * (null when the URL has none), and the value of its `scxml-send-key` header
 * (null or absent when it carries none).
 */
export interface InboundRequest {
  readonly method: string;
  readonly contentType: string | null;
  readonly body: string;
  readonly query: string | null;
  readonly sendKey?: string | null;
}

/**
 * Why a request forms no event. `method_not_allowed`: the method is not POST;
 * a front answers 405 with `Allow: POST`. `not_utf8`: the query string or the
 * body does not decode to text. `malformed_send_key`: the `scxml-send-key`
 * value is not eight fields joined by `/` whose second decodes to text. A
 * front answers either of the last two 400.
 */
export type DecodeRefused =
  | { readonly ok: false; readonly reason: "method_not_allowed"; readonly method: string }
  | { readonly ok: false; readonly reason: "not_utf8"; readonly part: "query" | "body" }
  | { readonly ok: false; readonly reason: "malformed_send_key"; readonly value: string };

/** What `decodeRequest` answers: the event, or why there is none. */
export type DecodeResult = { readonly ok: true; readonly event: HostEvent } | DecodeRefused;

/**
 * The event one request carries.
 *
 * The method must be POST, in any case. The event's name is the first
 * `_scxmleventname` found, the query string before a form body, else `HTTP.`
 * and the method in upper case. A form body's other parameters, with the
 * query string's, are the event's data, a map whose values are each read as
 * a `<content>` body's text is read - a predicator literal, else the text -
 * so `2` is the number 2; the last of a repeated name wins, and no
 * parameters is no data. A body of any other content type is the data, read
 * the same way, and the query string then gives the name only. The
 * `scxml-send-key` value is checked and sets nothing on the event.
 *
 * A front answers 204 once it has queued the event, and a front that has
 * already queued a request carrying the same `scxml-send-key` answers 204
 * again and queues nothing.
 */
export function decodeRequest(request: InboundRequest): DecodeResult {
  const { method } = request;
  if (method.toUpperCase() !== "POST") return { ok: false, reason: "method_not_allowed", method };
  const query = request.query === null ? [] : decodeForm(request.query);
  if (query === null) return { ok: false, reason: "not_utf8", part: "query" };
  let bodyPairs: (readonly [string, string])[] = [];
  let text: string | null = null;
  if (isForm(request.contentType)) {
    const decoded = decodeForm(request.body);
    if (decoded === null) return { ok: false, reason: "not_utf8", part: "body" };
    bodyPairs = decoded;
  } else if (wellFormed(request.body)) {
    text = request.body;
  } else {
    return { ok: false, reason: "not_utf8", part: "body" };
  }
  const sendKey = request.sendKey ?? null;
  if (sendKey !== null && !validSendKey(sendKey)) {
    return { ok: false, reason: "malformed_send_key", value: sendKey };
  }
  const pairs = [...query, ...bodyPairs];
  const named = pairs.find(([name]) => name === EVENT_NAME_PARAM);
  const params = pairs.filter(([name]) => name !== EVENT_NAME_PARAM);
  const name = named === undefined ? `HTTP.${method.toUpperCase()}` : named[1];
  const data =
    text === null
      ? paramsData(params.map(([key, value]) => [key, textData(value)] as const))
      : textData(text);
  return { ok: true, event: { name, data } };
}

function isForm(contentType: string | null): boolean {
  return contentType?.toLowerCase().startsWith(FORM) ?? false;
}

function validSendKey(value: string): boolean {
  const fields = value.split("/");
  return fields.length === 8 && decodeField(fields[1] as string) !== null;
}
