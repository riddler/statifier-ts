// The default transport, on the host's global fetch. Each test puts a fetch
// of its own on the global object, or takes it away, so the transport is
// held to the host it finds when a request is made, not when it was built.

import { afterEach, describe, expect, it, vi } from "vitest";
import { basicHttp, fetchTransport } from "../src/basichttp/index.js";
import type { HttpRequest } from "../src/http-transport.js";

const request: HttpRequest = {
  method: "POST",
  url: "https://library.example/desk-1",
  headers: [
    ["content-type", "application/x-www-form-urlencoded"],
    ["scxml-send-key", "branch-7/notice/2/1/0/2/onentry.2.0/1"],
  ],
  body: "_scxmleventname=hold.ready&copy=book-17",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the default transport", () => {
  // Sabotage: reading the global fetch when the transport is built, rather
  // than when a request is made, turns this red.
  it("finds fetch when a request is made, and refuses by name without it", async () => {
    vi.stubGlobal("fetch", undefined);
    const transport = fetchTransport();
    await expect(transport.post(request)).resolves.toEqual({
      kind: "failure",
      reason: "fetch_unavailable",
    });

    const fetch = vi.fn(async () => ({ status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await expect(transport.post(request)).resolves.toEqual({ kind: "status", status: 204 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(url).toBe(request.url);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual(request.headers);
    expect(init.body).toBe(request.body);
    expect(init.signal).toBeDefined();
  });

  it("answers any status as a status", async () => {
    vi.stubGlobal("fetch", async () => ({ status: 503 }));
    await expect(fetchTransport().post(request)).resolves.toEqual({ kind: "status", status: 503 });
  });

  // Sabotage: letting a fetch rejection escape `post` turns this red.
  it("answers a fetch that rejects or throws as a failure, never a rejection", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network down");
    });
    await expect(fetchTransport().post(request)).resolves.toEqual({
      kind: "failure",
      reason: "TypeError: network down",
    });
  });

  // Sabotage: never firing the abort in the time bound turns this red.
  it("abandons a request at its time bound and answers a failure", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const answered = fetchTransport({ timeoutMs: 50 }).post(request);
    await vi.advanceTimersByTimeAsync(49);
    expect(await Promise.race([answered, Promise.resolve("pending")])).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(await Promise.race([answered, Promise.resolve("pending")])).toEqual({
      kind: "failure",
      reason: "Error: aborted",
    });
  });

  it("makes an unbounded request where the host has no abort controller", async () => {
    vi.stubGlobal("AbortController", undefined);
    const fetch = vi.fn(async () => ({ status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchTransport().post(request)).resolves.toEqual({ kind: "status", status: 200 });
    const [, init] = fetch.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(init.signal).toBeUndefined();
  });

  it("is the processor's transport when the host supplies none", async () => {
    const fetch = vi.fn(async () => ({ status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const http = basicHttp({ baseUrl: "https://library.example/scxml", report: () => {} });
    expect(http.ok).toBe(true);
    if (!http.ok) return;
    const send = {
      kind: "send",
      event: "hold.ready",
      target: "https://library.example/desk-1",
      type: "basichttp",
      data: { copy: "book-17" },
      sendId: "notice",
      idFromAuthor: true,
      cIndex: 2,
      owner: { kind: "onentry", stateIndex: 2, ordinal: 0 },
      macrostep: 2,
      microstep: 1,
      round: 0,
      ordinal: 1,
    } as const;
    const delivered = http.processor.deliver(
      send,
      { name: "", type: "external", data: null },
      {
        sessionId: "branch-7",
      },
    );
    await delivered;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
