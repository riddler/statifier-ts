# How to use the Basic HTTP processor

This guide shows you how to post a chart's sends to another service over HTTP
with the Basic HTTP processor, take a missed delivery back into the chart, and
turn an inbound request into an event.

You start with `@riddler/statifier` installed, a global `fetch` on your host,
and a library loan chart that posts an overdue notice to the branch desk when
a copy lent for fourteen days is not returned. Your host keeps the latest
state of each execution under its session id. A line ending in `// =>` shows
the value that expression answers.

```ts
import { advance, compile, configuration, isDone, reportSendFailed, type State, start, step } from "@riddler/statifier";
import { basicHttp, decodeRequest } from "@riddler/statifier/basichttp";

const loanSource = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="on_loan">
  <state id="on_loan">
    <onentry><send id="due" event="loan.due" delay="14d"/></onentry>
    <transition event="loan.due" target="overdue"/>
    <transition event="loan.returned" target="returned"/>
  </state>
  <state id="overdue">
    <onentry>
      <send id="notice" event="loan.overdue" type="basichttp" target="https://library.example/desk-1">
        <param name="copy" expr="'copy-17'"/>
        <param name="replyTo" expr="_ioprocessors['basichttp'].location"/>
      </send>
    </onentry>
    <transition event="error.communication" target="notice_failed"/>
    <transition event="loan.returned" target="returned"/>
  </state>
  <state id="notice_failed"><transition event="loan.returned" target="returned"/></state>
  <final id="returned"><donedata><param name="copy" expr="'copy-17'"/></donedata></final>
</scxml>`;

const compiled = compile(loanSource, { chartName: "loan", chartVersion: "1" });
if (!compiled.ok) throw new Error("the loan chart does not compile");
const loan = compiled.chart;
const held = new Map<string, State>();
```

## Steps

1. Make the processor with the address your server answers at and a report function that passes each miss to `reportSendFailed` with the state you hold for its session.

   ```ts
   const http = basicHttp({
     baseUrl: "https://library.example/scxml",
     report: (miss) => {
       const state = held.get(miss.sessionId);
       if (state === undefined) return;
       const failed = reportSendFailed(loan, state, miss, { sendTypes });
       if (failed.ok) held.set(miss.sessionId, failed.state);
     },
   });
   if (!http.ok) throw new Error(http.reason);
   const sendTypes = http.sendTypes;
   Object.keys(sendTypes); // => ["http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor", "basichttp"]
   ```

2. Start the execution with the processor's send types, and keep the state it answers.

   ```ts
   const lent = start(loan, { sessionId: "loan-copy-17", sendTypes });
   if (!lent.ok) throw new Error(lent.reason);
   held.set("loan-copy-17", lent.state);
   configuration(lent.state); // => ["on_loan"]
   ```

3. Pass the same send types on every later call, and keep each state before your code awaits anything.

   ```ts
   const lapsed = advance(loan, lent.state, 14 * 24 * 60 * 60 * 1000, { sendTypes });
   if (!lapsed.ok) throw new Error(lapsed.reason);
   held.set("loan-copy-17", lapsed.state);
   const notice = lapsed.effects.find((effect) => effect.kind === "send");
   notice?.data; // => { copy: "copy-17", replyTo: "https://library.example/scxml/loan-copy-17" }
   ```

4. If the desk does not take the notice, read the state you hold once the report has come back.

   ```ts
   // After the request has missed and the report function has run:
   configuration(held.get("loan-copy-17") as State); // => ["notice_failed"]
   ```

5. If your host runs a server, decode a POST that arrives at the session's address and step the execution with the event it carries.

   ```ts
   const decoded = decodeRequest({
     method: "POST",
     contentType: "application/x-www-form-urlencoded",
     body: "_scxmleventname=loan.returned",
     query: null,
   });
   if (!decoded.ok) throw new Error(decoded.reason);
   const returned = step(loan, held.get("loan-copy-17") as State, decoded.event, { sendTypes });
   if (!returned.ok) throw new Error(returned.reason);
   isDone(returned.state); // => { ok: true, done: true, donedata: { copy: "copy-17" }, configuration: ["returned"] }
   ```

If your host has no global `fetch`, or you want your own HTTP client, pass
`basicHttp` a `transport`: an object whose `post` method makes the request once
and answers the status that came back, or a failure.

## See also

- [The Basic HTTP processor](https://github.com/riddler/statifier-ts/blob/main/README.md#the-basic-http-processor): what the processor posts, the deduplication header, and what it hands to `report`.
- [The effects](https://github.com/riddler/statifier-ts/blob/main/README.md#the-effects): every effect a call answers, the `send` effect among them.
