// The loopback front and the registration wired to it: the front's status
// rule, which is the reference front's; an answer made on the job queue, never
// synchronously; the wire's settle, which waits on the deliveries themselves;
// and a miss the processor reports coming back in the order it arrived.
//
// The requests are the library's: a patron's hold placed at a branch.

import { Undefined } from "@riddler/predicator";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compiler.js";
import { type SendProcessors, start } from "../../src/driver.js";
import type { HttpRequest } from "../../src/http-transport.js";
import {
  type Delivered,
  LOOPBACK_BASE_URL,
  loopbackFront,
  wireEventIoProcessors,
} from "./loopback.js";

const BASIC_HTTP = "http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor";
const SESSION = "branch/main";
const KEY = "branch%2Fmain/send_1/1/1/1/0/onentry.1.0/";

function request(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    method: "POST",
    url: `${LOOPBACK_BASE_URL}/${SESSION}`,
    headers: [
      ["content-type", "application/x-www-form-urlencoded"],
      ["scxml-send-key", KEY],
    ],
    body: "_scxmleventname=hold.placed&copy=7",
    ...overrides,
  };
}

function front() {
  const taken: Delivered[] = [];
  const loopback = loopbackFront(
    (sessionId) => sessionId === SESSION,
    (delivered) => taken.push(delivered),
  );
  return { loopback, taken };
}

describe("the loopback front", () => {
  // Sabotage: answering 204 without handing the event on turns this red on the
  // taken list. It was run and reverted.
  it("answers 204 for a request to a live session's location and hands on the event it decodes", async () => {
    const { loopback, taken } = front();
    expect(await loopback.transport.post(request())).toEqual({ kind: "status", status: 204 });
    expect(taken).toEqual([
      {
        sessionId: SESSION,
        event: { name: "hold.placed", origintype: BASIC_HTTP, data: { copy: 7 } },
      },
    ]);
  });

  it("reads the query string after the session's id, as the decoder's", async () => {
    const { loopback, taken } = front();
    const text = request({
      url: `${LOOPBACK_BASE_URL}/${SESSION}?_scxmleventname=hold.placed`,
      headers: [["content-type", "text/plain"]],
      body: "a note for the patron",
    });
    expect(await loopback.transport.post(text)).toEqual({ kind: "status", status: 204 });
    expect(taken).toEqual([
      {
        sessionId: SESSION,
        event: { name: "hold.placed", origintype: BASIC_HTTP, data: "a note for the patron" },
      },
    ]);
  });

  // Sabotage: answering every path as the live session turns this red on the
  // first two answers. It was run and reverted.
  it("answers 404 for a path that names no live session, and hands nothing on", async () => {
    const { loopback, taken } = front();
    const answers = await Promise.all(
      [
        `${LOOPBACK_BASE_URL}/branch/east`,
        `http://elsewhere.invalid/basichttp/${SESSION}`,
        LOOPBACK_BASE_URL,
      ].map((url) => loopback.transport.post(request({ url }))),
    );
    expect(answers).toEqual([
      { kind: "status", status: 404 },
      { kind: "status", status: 404 },
      { kind: "status", status: 404 },
    ]);
    expect(taken).toEqual([]);
  });

  it("answers 405 for a method other than POST and 400 for a request that forms no event", async () => {
    const { loopback, taken } = front();
    const put = { ...request(), method: "PUT" } as unknown as HttpRequest;
    expect(await loopback.transport.post(put)).toEqual({ kind: "status", status: 405 });
    const malformed = request({ headers: [["scxml-send-key", "not/eight/fields"]] });
    expect(await loopback.transport.post(malformed)).toEqual({ kind: "status", status: 400 });
    expect(taken).toEqual([]);
  });

  it("does not deduplicate: the same send key twice is two events, as the reference's front takes it", async () => {
    const { loopback, taken } = front();
    await loopback.transport.post(request());
    await loopback.transport.post(request());
    expect(taken).toHaveLength(2);
  });

  // Sabotage: answering within the call, before the promise is handed back,
  // turns this red. It was run and reverted.
  it("answers on the job queue, never within the call", async () => {
    const { loopback, taken } = front();
    const answer = loopback.transport.post(request());
    expect(taken).toEqual([]);
    await answer;
    expect(taken).toHaveLength(1);
  });
});

// A branch that tells a session, through the Basic HTTP processor, that a
// hold was placed: at its own location, or at one no live session answers.
function branch(target: string): string {
  return `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="open" datamodel="predicator">
  <state id="open">
    <onentry>
      <send event="hold.placed" type="basichttp" targetexpr="${target}"/>
    </onentry>
  </state>
</scxml>`;
}

function started(source: string, wire: { readonly sendTypes: SendProcessors }) {
  const compiled = compile(source);
  if (!compiled.ok) throw new Error("the branch does not compile");
  const run = start(compiled.chart, { sessionId: SESSION, sendTypes: wire.sendTypes });
  if (!run.ok) throw new Error(`start was refused: ${run.reason}`);
  return run.state;
}

describe("the wire", () => {
  it("refuses a URI the registration does not hold", () => {
    expect(wireEventIoProcessors(["urn:parcel:courier"], () => true)).toEqual({
      ok: false,
      reason: "names an Event I/O Processor this runner does not register: urn:parcel:courier",
    });
  });

  // Sabotage: keeping no delivery's promise, so `settle` answers at once,
  // turns this red: nothing has arrived when it is read. It was run and
  // reverted.
  it("settles once every delivery handed so far has been answered, and holds what came back", async () => {
    const wired = wireEventIoProcessors([BASIC_HTTP], (sessionId) => sessionId === SESSION);
    if (!wired.ok) throw new Error(wired.reason);
    started(branch("_ioprocessors['basichttp']['location']"), wired.wire);
    expect(wired.wire.take()).toEqual([]);
    await wired.wire.settle();
    expect(wired.wire.take()).toEqual([
      {
        kind: "event",
        delivered: {
          sessionId: SESSION,
          event: { name: "hold.placed", origintype: BASIC_HTTP, data: Undefined },
        },
      },
    ]);
    expect(wired.wire.take()).toEqual([]);
  });

  it("holds a miss the processor reports, with the send it names", async () => {
    const wired = wireEventIoProcessors([BASIC_HTTP], (sessionId) => sessionId === SESSION);
    if (!wired.ok) throw new Error(wired.reason);
    started(branch(`'${LOOPBACK_BASE_URL}/branch/east'`), wired.wire);
    await wired.wire.settle();
    expect(wired.wire.take()).toMatchObject([
      { kind: "missed", failure: { sessionId: SESSION, reason: "http_status 404" } },
    ]);
  });
});
