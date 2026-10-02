// The default HTTP transport: one request through the host's global fetch.
//
// The fetch function is looked up on the global object each time a request is
// made, never when the package loads, so importing this entry point reaches
// no host global, and a host that has none is refused by name when a send is
// made rather than when it imports the package. The types below are this
// file's own and as small as the call needs: the package compiles with no DOM
// library and no runtime's type declarations.
//
// The reference is `Statifier.Send.BasicHTTP.Transport.Httpc` in statifier-ex
// at v2.10.0: one attempt, any status answered as a status, no response
// answered as a failure, each request bounded by a five-second timeout.

import type { HttpAnswer, HttpRequest, HttpTransport } from "../http-transport.js";

/** What `fetchTransport` takes. */
export interface FetchTransportOptions {
  /**
   * How long a request may take before it is abandoned and answered as a
   * failure, in milliseconds; 5000 when absent, the reference's bound. The
   * bound needs the global abort controller and timer functions, and a
   * request made where either is missing is not bounded.
   */
  readonly timeoutMs?: number;
}

// The least of the fetch call this file makes.
type Fetch = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: (readonly [string, string])[];
    readonly body: string;
    readonly signal?: unknown;
  },
) => Promise<{ readonly status: number }>;

interface Abort {
  readonly signal: unknown;
  abort(): void;
}

// The globals this file may read, each looked up when a request is made.
interface HostGlobals {
  readonly fetch?: unknown;
  readonly AbortController?: unknown;
  readonly setTimeout?: unknown;
  readonly clearTimeout?: unknown;
}

function hostGlobals(): HostGlobals {
  return globalThis as unknown as HostGlobals;
}

/**
 * The default transport: each request made once through the global fetch
 * function, found when the request is made. A response answers its status,
 * whatever it is. No fetch function answers the failure `fetch_unavailable`,
 * and no request is made; a fetch that rejects, or a request abandoned at the
 * time bound, answers a failure carrying what was thrown, as text.
 */
export function fetchTransport(options: FetchTransportOptions = {}): HttpTransport {
  const timeoutMs = options.timeoutMs ?? 5000;
  return {
    post: async (request: HttpRequest): Promise<HttpAnswer> => {
      const host = hostGlobals();
      if (typeof host.fetch !== "function") return { kind: "failure", reason: "fetch_unavailable" };
      const fetch = host.fetch as Fetch;
      const bound = boundOf(host, timeoutMs);
      try {
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers.map(([name, value]): [string, string] => [name, value]),
          body: request.body,
          ...(bound === null ? {} : { signal: bound.signal }),
        });
        return { kind: "status", status: response.status };
      } catch (error) {
        return { kind: "failure", reason: String(error) };
      } finally {
        bound?.clear();
      }
    },
  };
}

// A time bound on one request: an abort signal and the timer that fires it,
// or null when the host lacks what a bound needs.
function boundOf(
  host: HostGlobals,
  timeoutMs: number,
): { readonly signal: unknown; readonly clear: () => void } | null {
  if (
    typeof host.AbortController !== "function" ||
    typeof host.setTimeout !== "function" ||
    typeof host.clearTimeout !== "function"
  ) {
    return null;
  }
  const controller = new (host.AbortController as new () => Abort)();
  const setTimer = host.setTimeout as (run: () => void, ms: number) => unknown;
  const clearTimer = host.clearTimeout as (handle: unknown) => void;
  const handle = setTimer(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimer(handle) };
}
