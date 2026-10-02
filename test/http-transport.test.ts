// A host's own HTTP transport, written against the exported type.
//
// The transport type is the seam a host codes against to run the Basic HTTP
// processor over its own HTTP client (ADR-0002, the Amendment "the HTTP
// transport a host supplies"). These tests are a host's side of it: a
// trivial transport that answers from a table instead of a network, typed
// only through the main entry point, and the answers a transport may and may
// not give.

import { describe, expect, it } from "vitest";
import type { HttpAnswer, HttpRequest, HttpTransport } from "../src/index.js";

// A request as the processor hands one over: a library's loan desk posting
// that a loan came back.
const request: HttpRequest = {
  method: "POST",
  url: "https://library.example/scxml/desk-1",
  headers: [
    ["content-type", "application/x-www-form-urlencoded"],
    ["scxml-send-key", "desk-1/returned/1/1/0/0/onentry.2.0/0"],
  ],
  body: "_scxmleventname=loan.returned&copy=book-17",
};

// A trivial host transport: it records what it was handed and answers the
// status a table gives the URL, or a failure for a URL the table lacks, the
// way an unreachable host answers.
function tableTransport(statuses: Readonly<Record<string, number>>): {
  readonly transport: HttpTransport;
  readonly seen: HttpRequest[];
} {
  const seen: HttpRequest[] = [];
  const transport: HttpTransport = (sent) => {
    seen.push(sent);
    const status = Object.hasOwn(statuses, sent.url) ? statuses[sent.url] : undefined;
    const answer: HttpAnswer =
      status === undefined
        ? { kind: "failure", reason: `no route to ${sent.url}` }
        : { kind: "status", status };
    return Promise.resolve(answer);
  };
  return { transport, seen };
}

// The send key a request carries, read the way a deduplicating receiver
// reads it.
function sendKey(sent: HttpRequest): string | undefined {
  return sent.headers.find(([name]) => name === "scxml-send-key")?.[1];
}

describe("a host transport", () => {
  // Sabotage: answering `{ kind: "status", status: 200 }` for every URL
  // turns the first three tests red.
  it("is handed the request as built and answers the status that came back", async () => {
    const { transport, seen } = tableTransport({ "https://library.example/scxml/desk-1": 204 });

    await expect(transport(request)).resolves.toEqual({ kind: "status", status: 204 });
    expect(seen).toEqual([request]);
    expect(sendKey(seen[0] as HttpRequest)).toBe("desk-1/returned/1/1/0/0/onentry.2.0/0");
  });

  it("answers a status outside 2xx as a status, not as a failure", async () => {
    const { transport } = tableTransport({ "https://library.example/scxml/desk-1": 503 });

    await expect(transport(request)).resolves.toEqual({ kind: "status", status: 503 });
  });

  it("answers a failure as a value when no response comes back, and does not reject", async () => {
    const { transport } = tableTransport({});

    await expect(transport(request)).resolves.toEqual({
      kind: "failure",
      reason: "no route to https://library.example/scxml/desk-1",
    });
  });

  it("refuses, at the type, an answer that is not a status or a failure", () => {
    // @ts-expect-error a bare status code is not an answer
    const bare: HttpTransport = () => Promise.resolve(204);
    // @ts-expect-error an answer names its kind
    const unnamed: HttpTransport = () => Promise.resolve({ status: 204 });
    // @ts-expect-error a failure carries a reason
    const silent: HttpTransport = () => Promise.resolve({ kind: "failure" });
    // @ts-expect-error a request's method is POST
    const put: HttpRequest = { ...request, method: "PUT" };

    expect([bare, unnamed, silent, put]).toHaveLength(4);
  });
});
