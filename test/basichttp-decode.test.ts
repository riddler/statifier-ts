// The Basic HTTP processor's inbound decoder, as a host's server front uses
// it: a request posted to a branch's location becomes the event the front
// passes to `step`.

import { float, Undefined } from "@riddler/predicator";
import { describe, expect, it } from "vitest";
import {
  BASIC_HTTP_EVENT_PROCESSOR,
  decodeRequest,
  type InboundRequest,
} from "../src/basichttp/index.js";
import { compile } from "../src/compiler.js";
import { type DriveEffect, type DriveResult, type HostEvent, start, step } from "../src/driver.js";

const FORM = "application/x-www-form-urlencoded";

const URI = BASIC_HTTP_EVENT_PROCESSOR;

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
      event: { name: "hold.ready", origintype: URI, data: { copy: "book-17", renewals: 2 } },
    });
  });

  // Sabotage: reading the body's name ahead of the query string's turns
  // this red.
  it("takes the first name, the query string's before the body's", () => {
    const decoded = decodeRequest({ ...posted, query: "_scxmleventname=loan.renewed&branch=7" });
    expect(decoded).toEqual({
      ok: true,
      event: {
        name: "loan.renewed",
        origintype: URI,
        data: { branch: 7, copy: "book-17", renewals: 2 },
      },
    });
  });

  it("is named HTTP and its method when it carries no name, with no data when it has none", () => {
    expect(decodeRequest({ ...posted, method: "post", body: "" })).toEqual({
      ok: true,
      event: { name: "HTTP.POST", origintype: URI, data: Undefined },
    });
  });

  it("keeps the last of a repeated parameter, and reads a decimal as a float", () => {
    const decoded = decodeRequest({ ...posted, body: "fine=0.5&fine=1.5&patron=ada+lovelace" });
    expect(decoded).toEqual({
      ok: true,
      event: {
        name: "HTTP.POST",
        origintype: URI,
        data: { fine: float(1.5), patron: "ada lovelace" },
      },
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
    expect(decoded).toEqual({
      ok: true,
      event: { name: "hold.ready", origintype: URI, data: "the copy is in" },
    });
    expect(decodeRequest({ ...posted, contentType: null, body: "[1, 2]" })).toEqual({
      ok: true,
      event: { name: "HTTP.POST", origintype: URI, data: [1, 2] },
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

describe("a decoded event as the chart reads it", () => {
  const SCXML = 'xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="predicator"';
  const compiled = compile(`<scxml ${SCXML} initial="awaiting_copy" name="hold">
    <state id="awaiting_copy">
      <transition event="hold.ready" target="notified">
        <log label="origintype" expr="_event.origintype"/>
        <log label="copy" expr="_event.data.copy"/>
      </transition>
    </state>
    <final id="notified"/>
  </scxml>`);
  if (!compiled.ok) throw new Error(`fixture does not compile: ${JSON.stringify(compiled.errors)}`);
  const chart = compiled.chart;

  function logged(result: DriveResult): Record<string, unknown> {
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return Object.fromEntries(
      result.effects.flatMap((effect: DriveEffect) =>
        effect.kind === "log" ? [[effect.label ?? "", effect.value]] : [],
      ),
    );
  }

  function stepped(event: HostEvent): Record<string, unknown> {
    const started = start(chart, { sessionId: "branch-7" });
    if (!started.ok) throw new Error(`refused: ${started.reason}`);
    return logged(step(chart, started.state, event));
  }

  // Sabotage: dropping the origintype `decodeRequest` sets, or the one
  // `step` queues, turns this red.
  it("reads _event.origintype as the processor URI, as the reference's decoder sets it", () => {
    const decoded = decodeRequest(posted);
    if (!decoded.ok) throw new Error(`refused: ${decoded.reason}`);
    expect(stepped(decoded.event)).toEqual({ origintype: URI, copy: "book-17" });
  });

  // Sabotage: queuing a default origintype for a host event that names none
  // turns this red.
  it("reads _event.origintype as undefined for a host event that names none", () => {
    expect(stepped({ name: "hold.ready", data: { copy: "book-17" } })).toEqual({
      origintype: Undefined,
      copy: "book-17",
    });
  });
});
