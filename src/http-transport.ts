// The HTTP transport: the seam between the Basic HTTP Event I/O Processor
// and whatever makes the request.
//
// A transport takes one request - the method, the URL, the headers and the
// body the processor built - and makes it once, answering the status that
// came back, or a failure when none did. A host supplies one to run the
// processor over its own HTTP client; the default transport is one
// implementation of the same type. This file holds the types only: nothing
// here makes a request, so the main entry point can export them without
// reaching any host global.
//
// The reference is `Statifier.Send.BasicHTTP.Transport` and its `post/3`
// callback in statifier-ex at v2.10.0, under its ADR-0075 decision 6 and the
// Amendment of 2026-09-30 that adds the `scxml-send-key` header. ADR-0002's
// Amendment "the HTTP transport a host supplies" records this contract.

/**
 * One request a transport makes.
 *
 * Built by the processor, never by the transport: the transport sends it as
 * it is handed and changes nothing in it.
 */
export interface HttpRequest {
  /** Always `"POST"`: the processor sends every message as a POST. */
  readonly method: "POST";
  /**
   * The send's target. When the body is a send's content and the send names
   * an event, the event name travels here as the `_scxmleventname` query
   * parameter.
   */
  readonly url: string;
  /**
   * Name and value pairs, in order, every name in lower case. `content-type`
   * and `scxml-send-key` are always among them; the second carries the send's
   * deduplication key, the same value each time the same send is performed,
   * so a receiver that deduplicates on it takes each send once.
   */
  readonly headers: readonly (readonly [name: string, value: string])[];
  /**
   * The body, already encoded: a form body
   * (`application/x-www-form-urlencoded`) built by the processor, or the
   * send's content as text.
   */
  readonly body: string;
}

/** A response came back: its status, whatever it is. */
export interface HttpStatus {
  readonly kind: "status";
  /**
   * The HTTP status code, an integer from 100 to 599. A status outside 2xx
   * is answered here, not as a failure; the processor reads it as a missed
   * delivery.
   */
  readonly status: number;
}

/** No response came back: the request was refused, unreachable or timed out. */
export interface HttpFailure {
  readonly kind: "failure";
  /** Why, in the host's words; the processor passes it on as the miss's reason. */
  readonly reason: string;
}

/** What a transport answers for one request. */
export type HttpAnswer = HttpStatus | HttpFailure;

/**
 * Makes one request once and answers what came of it.
 *
 * The promise settles to an answer and never rejects: a failure is a value.
 * A transport makes one attempt, retrying is not its job, and it bounds the
 * request's time itself, answering a failure when the bound passes.
 */
export type HttpTransport = (request: HttpRequest) => Promise<HttpAnswer>;
