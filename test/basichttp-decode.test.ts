// The Basic HTTP processor's inbound decoder, as a host's server front uses
// it: a request posted to a branch's location becomes the event the front
// passes to `step`.

import { float, Undefined } from "@riddler/predicator";
import { describe, expect, it } from "vitest";
import { decodeRequest, type InboundRequest } from "../src/basichttp/index.js";

const FORM = "application/x-www-form-urlencoded";

const posted: InboundRequest = {
  method: "POST",
  contentType: FORM,
  body: "_scxmleventname=hold.ready&copy=book-17&renewals=2",
  query: null,
};

describe("an inbound request", () => {
  // Sabotage: reading each value as the plain text, not through the text
  // rung, turns the `renewals` value red.
  it("becomes the event its _scxmleventname names, its other parameters the data", () => {
    expect(decodeRequest(posted)).toEqual({
      ok: true,
      event: { name: "hold.ready", data: { copy: "book-17", renewals: 2 } },
    });
  });

  // Sabotage: reading the body's name ahead of the query string's turns
  // this red.
  it("takes the first name, the query string's before the body's", () => {
    const decoded = decodeRequest({ ...posted, query: "_scxmleventname=loan.renewed&branch=7" });
    expect(decoded).toEqual({
      ok: true,
      event: { name: "loan.renewed", data: { branch: 7, copy: "book-17", renewals: 2 } },
    });
  });

  it("is named HTTP and its method when it carries no name, with no data when it has none", () => {
    expect(decodeRequest({ ...posted, method: "post", body: "" })).toEqual({
      ok: true,
      event: { name: "HTTP.POST", data: Undefined },
    });
  });

  it("keeps the last of a repeated parameter, and reads a decimal as a float", () => {
    const decoded = decodeRequest({ ...posted, body: "fine=0.5&fine=1.5&patron=ada+lovelace" });
    expect(decoded).toEqual({
      ok: true,
      event: { name: "HTTP.POST", data: { fine: float(1.5), patron: "ada lovelace" } },
    });
  });

  // Sabotage: form-decoding every body whatever its content type turns this
  // red.
  it("reads a body of another content type as text, the query string giving the name only", () => {
    const decoded = decodeRequest({
      method: "POST",
      contentType: "text/plain",
      body: "  the copy   is in  ",
      query: "_scxmleventname=hold.ready&branch=7",
    });
    expect(decoded).toEqual({ ok: true, event: { name: "hold.ready", data: "the copy is in" } });
    expect(decodeRequest({ ...posted, contentType: null, body: "[1, 2]" })).toEqual({
      ok: true,
      event: { name: "HTTP.POST", data: [1, 2] },
    });
  });

  it("matches the form content type in any case and with parameters", () => {
    const decoded = decodeRequest({
      ...posted,
      contentType: `${FORM.toUpperCase()}; charset=utf-8`,
    });
    expect(decoded.ok && decoded.event.name).toBe("hold.ready");
  });
});

describe("a request that forms no event", () => {
  // Sabotage: accepting every method turns this red.
  it("is refused when its method is not POST", () => {
    expect(decodeRequest({ ...posted, method: "GET" })).toEqual({
      ok: false,
      reason: "method_not_allowed",
      method: "GET",
    });
  });

  it("is refused when its query string or its body does not decode to text", () => {
    expect(decodeRequest({ ...posted, query: "x=%C3" })).toEqual({
      ok: false,
      reason: "not_utf8",
      part: "query",
    });
    expect(decodeRequest({ ...posted, body: "x=%FF" })).toEqual({
      ok: false,
      reason: "not_utf8",
      part: "body",
    });
    expect(decodeRequest({ ...posted, contentType: "text/plain", body: "a\ud800" })).toEqual({
      ok: false,
      reason: "not_utf8",
      part: "body",
    });
  });

  // Sabotage: accepting any `scxml-send-key` value turns this red.
  it("is refused when its scxml-send-key is not the header's eight fields", () => {
    expect(decodeRequest({ ...posted, sendKey: "branch-7/notice/2" })).toEqual({
      ok: false,
      reason: "malformed_send_key",
      value: "branch-7/notice/2",
    });
    expect(decodeRequest({ ...posted, sendKey: "b/%C3/1/1/0/0/onentry.2.0/" })).toEqual({
      ok: false,
      reason: "malformed_send_key",
      value: "b/%C3/1/1/0/0/onentry.2.0/",
    });
  });

  it("is not changed by a well-formed scxml-send-key, which sets nothing on the event", () => {
    expect(decodeRequest({ ...posted, sendKey: "branch-7/notice/2/1/0/2/onentry.2.0/1" })).toEqual(
      decodeRequest(posted),
    );
    expect(decodeRequest({ ...posted, sendKey: null })).toEqual(decodeRequest(posted));
  });
});
