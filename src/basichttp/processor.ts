// The Basic HTTP Event I/O Processor (SCXML appendix C.2), outbound.
//
// A send processor a host registers like any other, under the processor's URI
// and its short form `basichttp`. Each send it is handed becomes one POST,
// built here and made by a transport: the default one on the host's global
// fetch, or one the host supplies. The request is made after the call that
// handed the send has returned, and what came of it reaches the chart only
// through the host: a miss is handed to the host's report function, keyed by
// the sending session, and the host reports it to the driver with
// `reportSendFailed` against the state it holds for that session now. The
// driver keeps no state between calls, so nothing here can reach a chart
// without the host.
//
// The reference is `Statifier.Send.BasicHTTP` in statifier-ex at v2.10.0
// (its ADR-0075 and that record's Amendment of 2026-09-30): the wire shape,
// the dedup header, at-least-once delivery, one attempt per send, and the
// `_ioprocessors` entry are the reference's. ADR-0002's Amendment "the Basic
// HTTP processor" records where this differs and why.

import { Undefined, type Value } from "@riddler/predicator";
import type { Cancel, Send, SendDelayed } from "../core/send.js";
import type { Owner } from "../datamodel.js";
import type { FailedSend, ProcessorContext, SendProcessor, SendProcessors } from "../driver.js";
import type { HttpAnswer, HttpRequest, HttpTransport } from "../http-transport.js";
import { encodeForm, encodeValue, escapeField, isMap } from "./encoding.js";
import { fetchTransport } from "./fetch-transport.js";

/** The processor's type URI, SCXML appendix C.2's. */
export const BASIC_HTTP_EVENT_PROCESSOR = "http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor";

const SHORT_TYPE = "basichttp";
const EVENT_NAME_PARAM = "_scxmleventname";
const FORM = "application/x-www-form-urlencoded";
const SEND_KEY_HEADER = "scxml-send-key";

/**
 * A miss the processor hands the host: the sending session's id, the send,
 * with the fields `reportSendFailed` reads, and why. A host passes `send` and
 * `reason` to `reportSendFailed` with the state it holds for `sessionId`.
 */
export interface ReportedSendFailure extends FailedSend {
  readonly sessionId: string;
  readonly reason: string;
}

/** What `basicHttp` takes. */
export interface BasicHttpOptions {
  /**
   * The address the host's own front answers at. A session's location, in
   * its `_ioprocessors` entry, is this address, `/`, and the session's id.
   */
  readonly baseUrl: string;
  /**
   * Takes each miss, after the call that handed the send has returned: a
   * status outside 2xx, a transport's failure, a transport that rejected or
   * threw, a delayed send with no timer to hold it, or a target that is not
   * text. Its answer is not read, and a throw from it is not caught: it
   * rejects the promise the delivery answered, or, for a delayed send, the
   * timer's own.
   */
  readonly report: (failure: ReportedSendFailure) => void;
  /** What makes the requests; the default transport on the global fetch when absent. */
  readonly transport?: HttpTransport;
}

/**
 * Why `basicHttp` refused its options. `missing_base_url`: `baseUrl` is not
 * a non-empty string. `missing_report`: `report` is not a function.
 * `invalid_transport`: `transport` is given and has no `post` function.
 */
export type BasicHttpRefusal = "missing_base_url" | "missing_report" | "invalid_transport";

/**
 * What `basicHttp` answers: the processor, and the send types to register it
 * under, its URI and its short form; or why the options were refused.
 */
export type BasicHttpResult =
  | {
      readonly ok: true;
      readonly processor: SendProcessor;
      readonly sendTypes: SendProcessors;
    }
  | { readonly ok: false; readonly reason: BasicHttpRefusal };

// What setting and clearing a timer takes, read from the global object when
// a delayed send is held.
interface Timers {
  readonly setTimeout: (run: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

function timers(): Timers | null {
  const host = globalThis as unknown as {
    readonly setTimeout?: unknown;
    readonly clearTimeout?: unknown;
  };
  if (typeof host.setTimeout !== "function" || typeof host.clearTimeout !== "function") return null;
  return host as Timers;
}

/**
 * The Basic HTTP processor, one value that serves every session it is
 * registered for. Register `sendTypes`, which names it under both of its type
 * strings, so a chart may name either and `_ioprocessors` carries an entry
 * under each, both with the session's location.
 *
 * A send is handled by the shape of its data, as the reference's processor
 * handles it. A map is a form body, with the event name as the
 * `_scxmleventname` parameter ahead of the map's names in code point order.
 * No data is a form body of the event name alone. Any other value is the
 * body, as `text/plain`, with the event name in the target's query string.
 * Every request carries the send's deduplication key in the `scxml-send-key`
 * header, the same value each time the same send is handed, so a receiver
 * that deduplicates on it takes each send once.
 *
 * A send with no target fails within the call that handed it, as SCXML
 * appendix C.2.2 requires, and makes no request. Every other send is taken:
 * its delivery answers a promise, which the driver does not wait for, that
 * settles once the request has been made and any miss reported. A delayed
 * send is held on the global timer until its delay passes, and a `<cancel>`
 * of its send id drops it.
 */
export function basicHttp(options: BasicHttpOptions): BasicHttpResult {
  if (typeof options?.baseUrl !== "string" || options.baseUrl === "") {
    return { ok: false, reason: "missing_base_url" };
  }
  if (typeof options.report !== "function") return { ok: false, reason: "missing_report" };
  if (options.transport !== undefined && typeof options.transport?.post !== "function") {
    return { ok: false, reason: "invalid_transport" };
  }
  const { baseUrl, report } = options;
  const transport = options.transport ?? fetchTransport();
  // The delayed sends held, by session and then by send id.
  const held = new Map<string, Map<string, unknown[]>>();

  const miss = (sessionId: string, send: Send | SendDelayed, reason: string): void => {
    report({
      sessionId,
      send: { sendId: send.sendId, cIndex: send.cIndex, owner: send.owner },
      reason,
    });
  };

  const post = async (sessionId: string, send: Send | SendDelayed): Promise<void> => {
    const request = requestFor(sessionId, send);
    if (request === null) {
      miss(sessionId, send, "invalid_target");
      return;
    }
    let answer: HttpAnswer;
    try {
      answer = await transport.post(request);
    } catch (error) {
      answer = { kind: "failure", reason: `transport_threw: ${String(error)}` };
    }
    if (answer.kind === "failure") {
      miss(sessionId, send, answer.reason);
    } else if (!(answer.status >= 200 && answer.status <= 299)) {
      miss(sessionId, send, `http_status ${answer.status}`);
    }
  };

  const hold = (sessionId: string, send: SendDelayed): Promise<void> | undefined => {
    const clock = timers();
    if (clock === null) {
      return Promise.resolve().then(() => miss(sessionId, send, "timer_unavailable"));
    }
    const sends = held.get(sessionId) ?? new Map<string, unknown[]>();
    held.set(sessionId, sends);
    const handle = clock.setTimeout(() => {
      const remaining = (sends.get(send.sendId) ?? []).filter((h) => h !== handle);
      if (remaining.length === 0) sends.delete(send.sendId);
      else sends.set(send.sendId, remaining);
      void post(sessionId, send);
    }, send.delayMs);
    sends.set(send.sendId, [...(sends.get(send.sendId) ?? []), handle]);
    return undefined;
  };

  const processor: SendProcessor = {
    deliver: (send, _event, context) => {
      if (send.target === null) return { kind: "failure", reason: "no_target" };
      if (send.kind === "send_delayed") return hold(context.sessionId, send);
      return Promise.resolve().then(() => post(context.sessionId, send));
    },
    cancel: (cancel: Cancel, context: ProcessorContext) => {
      if (typeof cancel.sendId !== "string") return;
      const sends = held.get(context.sessionId);
      const handles = sends?.get(cancel.sendId);
      if (sends === undefined || handles === undefined) return;
      sends.delete(cancel.sendId);
      const clock = timers();
      for (const handle of handles) clock?.clearTimeout(handle);
    },
    ioprocessorsEntry: (_type, context) => ({ location: `${baseUrl}/${context.sessionId}` }),
  };

  return {
    ok: true,
    processor,
    sendTypes: Object.fromEntries([
      [BASIC_HTTP_EVENT_PROCESSOR, processor],
      [SHORT_TYPE, processor],
    ]),
  };
}

/**
 * The request one send becomes, or null when its target is not text. The
 * reference's private `post/2`.
 */
export function requestFor(sessionId: string, send: Send | SendDelayed): HttpRequest | null {
  if (typeof send.target !== "string") return null;
  const named: [string, string][] =
    send.event === null ? [] : [[EVENT_NAME_PARAM, encodeValue(send.event)]];
  const data: Value = send.data;
  let url = send.target;
  let contentType = FORM;
  let body: string;
  if (isMap(data)) {
    const names = Object.keys(data).sort(byCodePoint);
    body = encodeForm([
      ...named,
      ...names.map((name): [string, string] => [name, encodeValue(data[name] as Value)]),
    ]);
  } else if (data === Undefined) {
    body = encodeForm(named);
  } else {
    url = withQuery(send.target, named);
    contentType = "text/plain";
    body = encodeValue(data);
  }
  return {
    method: "POST",
    url,
    headers: [
      ["content-type", contentType],
      [SEND_KEY_HEADER, sendKey(sessionId, send)],
    ],
    body,
  };
}

/**
 * A send's deduplication key, as the `scxml-send-key` header carries it: the
 * session's id and the send id escaped, the macrostep, microstep, round and
 * content index in decimal, the owner, and the ordinal (empty when the send
 * has none), joined by `/`. The reference's private `send_key/2`.
 */
export function sendKey(sessionId: string, send: Send | SendDelayed): string {
  return [
    escapeField(sessionId),
    escapeField(send.sendId),
    String(send.macrostep),
    String(send.microstep),
    String(send.round),
    String(send.cIndex),
    ownerText(send.owner),
    send.ordinal === null ? "" : String(send.ordinal),
  ].join("/");
}

// The owner as the reference spells it: `onentry.S.B`, `onexit.S.B`,
// `finalize.S.B` with the state's index and the block's, or `transition.T`.
function ownerText(owner: Owner): string {
  switch (owner.kind) {
    case "onentry":
    case "onexit":
      return `${owner.kind}.${owner.stateIndex}.${owner.ordinal}`;
    case "finalize":
      return `finalize.${owner.stateIndex}.${owner.invokeIndex}`;
    case "transition":
      return `transition.${owner.tIndex}`;
  }
}

function withQuery(url: string, pairs: readonly (readonly [string, string])[]): string {
  if (pairs.length === 0) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${encodeForm(pairs)}`;
}

// Code point order, the order the reference's runtime lists a small map's
// string keys in: UTF-8 byte order is code point order.
function byCodePoint(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const difference = (left[i]?.codePointAt(0) ?? 0) - (right[i]?.codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}
