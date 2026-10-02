// The loopback front: the in-memory half of a Basic HTTP round trip, which
// the conformance runner delivers the built-in processor's requests through.
//
// The reference's runner starts a loopback front for every case whose host
// object names an Event I/O Processor (`with_event_io_processors/2` in
// `lib/mix/statifier/corpus/host_case.ex` at v2.10.0): an HTTP server on a
// free local port (`Mix.Statifier.BasicHTTPFront` in
// `lib/mix/statifier/basic_http_front.ex`), whose base URL the processor is
// registered with. A request to that base URL, `/`, and a session's id is
// decoded by the processor's own decoder and the event it carries enqueued on
// that session as an external event. Its status rule is the decoder's: 204
// once the event is enqueued, 405 for a method other than POST, 400 for a
// request that forms no event, and 404 for a path that names no live session.
// The front does not deduplicate on the `scxml-send-key` header.
//
// This front is that one in memory: a transport, the object the built-in
// processor takes as `transport`, whose `post` reads the request's URL
// against the front's base URL, decodes the request with `decodeRequest`
// from the package's Basic HTTP entry point, and holds the event for the
// session the path names until the runner takes it and hands it to the
// driver's `step`. No socket is opened and nothing leaves the process, so a
// case it delivers proves the processor's and the core's event I/O logic,
// not a network round trip. The 405 answer carries no `Allow` header,
// because a transport's answer is a status alone (`HttpAnswer` in
// `src/http-transport.ts`). The front answers for the case's own session, the
// one the runner starts; a session an invoked child runs is not one it
// resolves, and no vendored case addresses one.
//
// The registration beside the front is the reference's
// `with_event_io_processors/2`: the closed set of processors a case may name,
// each registered with the front's base URL under every type its constructor
// names it under. A delayed send to the processor is held on the host's own
// timer, which the runner's virtual clock does not move; no vendored case
// makes one.
//
// Like the runner, this reaches nothing outside the language.

import type { CorpusCase } from "../../scripts/lib/corpus-rules.d.mts";
import {
  BASIC_HTTP_EVENT_PROCESSOR,
  type BasicHttpOptions,
  type BasicHttpResult,
  basicHttp,
  decodeRequest,
  type InboundRequest,
  type ReportedSendFailure,
} from "../../src/basichttp/index.js";
import type { HostEvent, SendProcessor, SendProcessors } from "../../src/driver.js";
import type { HttpAnswer, HttpRequest, HttpTransport } from "../../src/http-transport.js";

/**
 * The base URL the loopback answers at: the reference front's path prefix,
 * `/basichttp`, on a host name that resolves nowhere, so nothing could reach
 * a network even were the URL handed to one.
 */
export const LOOPBACK_BASE_URL = "http://loopback.invalid/basichttp";

/** One event the front took, and the session it was addressed to. */
export interface Delivered {
  readonly sessionId: string;
  readonly event: HostEvent;
}

/** A loopback front: the base URL it answers at, and the transport the processor posts through. */
export interface Loopback {
  readonly baseUrl: string;
  readonly transport: HttpTransport;
}

function header(request: HttpRequest, name: string): string | null {
  const found = request.headers.find(([key]) => key.toLowerCase() === name);
  return found === undefined ? null : found[1];
}

/** The status the front answers one request with, holding its event when it answers 204. */
function answer(
  baseUrl: string,
  live: (sessionId: string) => boolean,
  request: HttpRequest,
  enqueue: (delivered: Delivered) => void,
): number {
  const prefix = `${baseUrl}/`;
  if (!request.url.startsWith(prefix)) return 404;
  const rest = request.url.slice(prefix.length);
  const mark = rest.indexOf("?");
  const sessionId = mark < 0 ? rest : rest.slice(0, mark);
  const query = mark < 0 ? null : rest.slice(mark + 1);
  if (!live(sessionId)) return 404;
  const inbound: InboundRequest = {
    method: request.method,
    contentType: header(request, "content-type"),
    body: request.body,
    query,
    sendKey: header(request, "scxml-send-key"),
  };
  const decoded = decodeRequest(inbound);
  if (!decoded.ok) return decoded.reason === "method_not_allowed" ? 405 : 400;
  enqueue({ sessionId, event: decoded.event });
  return 204;
}

/**
 * A loopback front at `baseUrl` that answers for each session `live` says is
 * running and hands each event it takes to `enqueue`, as the reference's
 * front enqueues it on the session. Every request is answered on the job
 * queue, never synchronously, as a request over a network is.
 */
export function loopbackFront(
  live: (sessionId: string) => boolean,
  enqueue: (delivered: Delivered) => void,
  baseUrl: string = LOOPBACK_BASE_URL,
): Loopback {
  const transport: HttpTransport = {
    post: (request) =>
      Promise.resolve().then(
        (): HttpAnswer => ({ kind: "status", status: answer(baseUrl, live, request, enqueue) }),
      ),
  };
  return { baseUrl, transport };
}

// --- The registration -------------------------------------------------------

/** What makes one Event I/O Processor: the built-in Basic HTTP processor's constructor. */
export type EventIoProcessor = (options: BasicHttpOptions) => BasicHttpResult;

/** The Event I/O Processors a runner can register, by the URI a case names. */
export type EventIoProcessors = ReadonlyMap<string, EventIoProcessor>;

/**
 * The closed item set of `host.event_io_processors`, as the reference keys
 * it (`@event_io_processors` in `host_case.ex` at v2.10.0): its one member,
 * the Basic HTTP Event I/O Processor, made by the package's own `basicHttp`,
 * which names it under its URI and its short form `basichttp`.
 */
export const EVENT_IO_PROCESSORS: EventIoProcessors = new Map([
  [BASIC_HTTP_EVENT_PROCESSOR, basicHttp],
]);

/**
 * The head of the reason a case fails with when it names an Event I/O
 * Processor the registration does not hold; the processors follow it.
 */
export const PROCESSOR_NOT_REGISTERED =
  "names an Event I/O Processor this runner does not register";

/**
 * The URIs a case's `host.event_io_processors` names, or null when the value
 * is not a list of strings. A case with no host object, or a host object
 * without the key, names none.
 */
function named(testCase: CorpusCase): string[] | null {
  const value = testCase.host?.event_io_processors;
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((uri) => typeof uri === "string")) return null;
  return value as string[];
}

/**
 * The processors a case's `host.event_io_processors` names that `registered`
 * (the closed set unless a caller names another) does not hold, in corpus
 * order. A value that is not a list of URIs is named whole, as it came, so a
 * malformed key fails its case rather than being read as naming nothing.
 */
export function processorsNotRegistered(
  testCase: CorpusCase,
  registered: EventIoProcessors = EVENT_IO_PROCESSORS,
): string[] {
  const uris = named(testCase);
  if (uris === null) return [JSON.stringify(testCase.host?.event_io_processors)];
  return uris.filter((uri) => !registered.has(uri));
}

/** One thing the wire holds for the runner: an event the front took, or a miss the processor reported. */
export type Arrival =
  | { readonly kind: "event"; readonly delivered: Delivered }
  | { readonly kind: "missed"; readonly failure: ReportedSendFailure };

/**
 * The Event I/O Processors registered for one case, wired to one loopback
 * front: the send types to hand the driver, and what came back.
 */
export interface Wire {
  /** Every processor the case names, under each type its constructor names it under. */
  readonly sendTypes: SendProcessors;
  /**
   * Waits for every delivery handed to a processor so far, and every one
   * handed while it waits, to settle: the request made, the front's answer
   * read and any miss reported. It waits on the deliveries' own promises,
   * never on a timer.
   */
  settle(): Promise<void>;
  /** What arrived since the last call, in the order it arrived. */
  take(): Arrival[];
}

/**
 * Registers every processor `uris` names, each made by its constructor in
 * `registered` with the front's base URL, the front's transport and a report
 * function that holds the miss for the runner, as `with_event_io_processors/2`
 * registers each with the front it starts. A processor's `deliver` is
 * wrapped only to keep the promise it answers, so `settle` can wait on it;
 * what it answers is handed back to the driver unchanged. Answers the reason
 * a case fails with when a URI is not in `registered` or a constructor
 * refuses.
 */
export function wireEventIoProcessors(
  uris: readonly string[],
  live: (sessionId: string) => boolean,
  registered: EventIoProcessors = EVENT_IO_PROCESSORS,
): { readonly ok: true; readonly wire: Wire } | { readonly ok: false; readonly reason: string } {
  let arrived: Arrival[] = [];
  const pending: Promise<unknown>[] = [];
  const front = loopbackFront(live, (delivered) => arrived.push({ kind: "event", delivered }));
  const sendTypes: Record<string, SendProcessor> = {};
  for (const uri of uris) {
    const make = registered.get(uri);
    if (make === undefined) return { ok: false, reason: `${PROCESSOR_NOT_REGISTERED}: ${uri}` };
    const made = make({
      baseUrl: front.baseUrl,
      transport: front.transport,
      report: (failure) => {
        arrived.push({ kind: "missed", failure });
      },
    });
    if (!made.ok) return { ok: false, reason: `${uri} refused its registration: ${made.reason}` };
    for (const [type, processor] of Object.entries(made.sendTypes)) {
      sendTypes[type] = {
        ...processor,
        deliver: (send, event, context) => {
          const answered = processor.deliver(send, event, context);
          if (answered instanceof Promise) pending.push(answered);
          return answered;
        },
      };
    }
  }
  return {
    ok: true,
    wire: {
      sendTypes,
      async settle() {
        while (pending.length > 0) await Promise.all(pending.splice(0));
      },
      take() {
        const out = arrived;
        arrived = [];
        return out;
      },
    },
  };
}
