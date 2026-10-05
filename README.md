# @riddler/statifier

A conformant TypeScript sibling of the Statifier statechart engine, which
runs SCXML statecharts. Give it a chart and an event - a library loan
renewed, a copy returned - and it answers the chart's next configuration and
what the host should do about it, as plain data. The reference
implementation is [statifier-ex](https://github.com/riddler/statifier-ex),
written in Elixir.

## Why this package

A chart is authored once and should decide the same way wherever it runs,
but an interpreter that runs only on a server leaves a browser or a React
Native app two poor choices: a network round trip for every event, or a
second implementation whose answers drift from the first. This package is
the same algorithm as the reference, held case by case to the reference's
conformance corpus, with no I/O, no clock and no storage of its own, so a
host runs a chart in process wherever its code runs, and on every corpus
case this package claims it answers as the reference does. The state it answers is plain JSON that a host stores and
sends as it likes; persistence, a real clock, delivering what a chart sends,
and rendering stay the host's.

## Install

Install it from the npm registry:

```bash
pnpm add @riddler/statifier@^0.3.0
```

The package has **one runtime dependency**,
[`@riddler/predicator`](https://github.com/riddler/predicator-ts), pinned at
`^0.5.0`, which evaluates the conditions, expressions and script bodies a
chart carries, as it does for the reference. `dependencies` in
`package.json` names it and no other package.

## Basic usage

A host compiles a chart once and drives it with five more calls. The chart
below is a library loan: the copy goes out for fourteen days, may be renewed
twice, falls overdue when the loan runs out, and stops when it comes back,
answering how many renewals it took. Every TypeScript example on this page
is run by the test suite (`test/readme.test.ts`), and a line ending in
`// =>` is an assertion that the value on its left equals the value on its
right; every shell command is checked against the scripts `package.json`
declares rather than run.

```ts
import { advance, compile, configuration, isDone, start, step } from "@riddler/statifier";

const loanSource = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="on_loan">
  <datamodel><data id="renewals" expr="0"/></datamodel>
  <state id="on_loan">
    <onentry><send id="due" event="loan.due" delay="14d"/></onentry>
    <onexit><cancel sendid="due"/></onexit>
    <transition event="loan.renew" cond="renewals &lt; 2" target="on_loan">
      <assign location="renewals" expr="renewals + 1"/>
    </transition>
    <transition event="loan.due" target="overdue"/>
    <transition event="loan.returned" target="returned"/>
  </state>
  <state id="overdue"><transition event="loan.returned" target="returned"/></state>
  <final id="returned"><donedata><param name="renewals" expr="renewals"/></donedata></final>
</scxml>`;

const compiled = compile(loanSource, { chartName: "loan", chartVersion: "3" });
if (!compiled.ok) throw new Error("the loan chart does not compile");
const loan = compiled.chart;

// The host mints the session id; each call answers a state and its effects.
const lent = start(loan, { sessionId: "loan-copy-17" });
if (!lent.ok) throw new Error(lent.reason);
lent.effects.map((effect) => effect.kind); // => ["datamodel_init", "datamodel_change", "send_delayed"]
const renewed = step(loan, lent.state, { name: "loan.renew" });
if (!renewed.ok) throw new Error(renewed.reason);

// advance moves the virtual clock and fires every delayed send due by then.
const lapsed = advance(loan, renewed.state, 14 * 24 * 60 * 60 * 1000);
if (!lapsed.ok) throw new Error(lapsed.reason);
configuration(lapsed.state); // => ["overdue"]

const returned = step(loan, lapsed.state, { name: "loan.returned" });
if (!returned.ok) throw new Error(returned.reason);
isDone(returned.state); // => { ok: true, done: true, donedata: { renewals: 1 }, configuration: ["returned"] }
```

## Documentation

- Learn
  - [Basic usage](#basic-usage): a library loan lent, renewed, overdue and returned, with every call that moves a chart.
- Do
  - [Drive an execution with the six calls](https://github.com/riddler/statifier-ts/blob/main/docs/guides/drive-an-execution.md): compile a chart, start it, step and advance it, and read where it stands until it stops.
  - [Hand a send to your own processor](#the-effects): register a send type, and report a send that failed after it was handed.
  - [Export and import a position](https://github.com/riddler/statifier-ts/blob/main/docs/guides/export-and-import-a-position.md): carry where an execution stands into a new compile of its chart, and continue it there.
  - [Send events over HTTP](#the-basic-http-processor): the Basic HTTP processor on its own entry point.
- Look up
  - [The six calls](#the-six-calls): what each call takes, what it answers, and every refusal.
  - [The state](#the-state): the fields of the plain JSON state a call answers.
  - [The effects](#the-effects): every effect kind and what the host does with it.
  - [Position export and import](#position-export-and-import): what the export and the import answer, and every refusal.
  - The API reference: `pnpm run docs` builds it from the source's doc comments into `docs/api/`.
  - [The changelog](CHANGELOG.md): what changed in each version.
- Understand
  - [Conformance](#conformance): what conformant means here, the claim this version makes and the gap it leaves.
  - [Engines](#engines): what is checked of engine neutrality, and what a run on React Native's engine has shown.
  - [The conformance apparatus](https://github.com/riddler/statifier-ts/blob/main/conformance/README.md): how the corpus copy, the check, the runner and the ratchet work.
  - [The decision records](https://github.com/riddler/statifier-ts/tree/main/docs/adr): why the contract is shaped the way it is.

## Compatibility

`engines.node` in `package.json` is `>=20`, and that is the floor a
consumer's runtime has to clear. It is not the toolchain: what builds and
gates this repository is the one node and the one pnpm `mise.toml` pins.

Nothing under `src/` assumes a host environment, so the same build runs on a
server runtime, in a browser and on React Native's JavaScript engine;
[Engines](#engines) says what is checked of that and what a run on that
engine has shown. The package ships ES module and CommonJS builds with their
type declarations, and the Basic HTTP processor on an entry point of its own,
`@riddler/statifier/basichttp`. Each version is held to the reference's
conformance corpus at the tag [Conformance](#conformance) names.

## Reference, in full

The sections below are the package's reference: every call, the state, the
effects, position export and import, the Basic HTTP processor, conformance
and the engines it runs on.

## The six calls

The basic usage above compiles a chart once and drives it with the other
calls; each one is listed here.

| Call | What it does |
|---|---|
| `compile(xml, opts)` | answers `{ ok: true, chart }` or `{ ok: false, errors }`; the optional `opts` may name the chart (`chartName`) and its version (`chartVersion`) |
| `start(chart, opts)` | starts the chart; `opts.sessionId` is required, and `opts` may also carry initial datamodel values (`datamodel`) and the rounds one macrostep may spend (`maxMacrostepRounds`) |
| `step(chart, state, event, opts?)` | takes one external event, `{ name, data? }` |
| `advance(chart, state, ms, opts?)` | moves the virtual clock forward `ms` milliseconds and fires every delayed send due by then, earliest first |
| `configuration(state)` | the active states as string ids |
| `isDone(state)` | whether the chart has stopped and, when it has, its donedata and its final configuration; a state that is not well formed is refused with `malformed_state` |

The calls that move a chart - `start`, `step` and `advance` - answer
`{ ok: true, state, effects }` or `{ ok: false, reason }`: a refusal is a
value, never a throw. The chart is passed with every one of them, because the state is
plain data and cannot carry it. A state made by a different chart is refused
with `chart_mismatch`, a state that is not well formed with
`malformed_state` and a `detail` saying what failed, and an event sent to a
stopped chart with `not_running`; `advance` given a negative or non-finite
time refuses with `invalid_duration`, and a value that cannot be written as
tagged-value text with `unencodable_value`:

```ts
import { compile, start, step } from "@riddler/statifier";

const desk = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0"
    name="desk" initial="open"><state id="open"/></scxml>`;
const branchDesk = compile(desk, { chartName: "desk", chartVersion: "1" });
const otherDesk = compile(desk, { chartName: "desk", chartVersion: "2" });
if (!branchDesk.ok || !otherDesk.ok) throw new Error("the desk chart does not compile");
const opened = start(branchDesk.chart, { sessionId: "desk-1" });
if (!opened.ok) throw new Error(opened.reason);
step(otherDesk.chart, opened.state, { name: "close" }); // => { ok: false, reason: "chart_mismatch" }

compile("<scxml>").ok; // => false
```

A compile error is one of four stage errors - `ParseError`, the XML parser's
refusal; `LoweringError`; `ValidationError`; and `CompilerError`, an
expression that did not compile - and the entry point exports each, with the
types they reach in this package, so a host can name the one it narrows to. A
`CompilerError` carries the expression parser's refusal as its `error`, and
`@riddler/predicator` exports that type as `ParseError` too. A host that
imports both packages' `ParseError` renames one at the import, for example
`import type { ParseError as ExpressionParseError } from "@riddler/predicator"`.

Beside the six calls, `version()` answers the version of the build a host is
running, as `package.json` carries it.

## The state

The state is a plain JSON value: no class instance, no function, no `Map` and
no `Set`. A host stores it, sends it, or compares it as it likes, and a state
that went through `JSON.stringify` and `JSON.parse` steps exactly as the
original does. A patron registration shows it, with an event carrying data
and a final state answering donedata:

```ts
import { compile, configuration, isDone, start, step } from "@riddler/statifier";

const registrationSource = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0"
    name="registration" initial="details">
  <datamodel><data id="patron" expr="null"/></datamodel>
  <state id="details">
    <transition event="details.submitted" target="confirming">
      <assign location="patron" expr="_event.data"/>
    </transition>
  </state>
  <state id="confirming">
    <transition event="email.confirmed" target="registered"/>
    <transition event="back" target="details"/>
  </state>
  <final id="registered">
    <donedata><param name="branch" expr="patron.branch"/></donedata>
  </final>
</scxml>`;

const registrationChart = compile(registrationSource);
if (!registrationChart.ok) throw new Error("the registration chart does not compile");
const registration = registrationChart.chart;

const registering = start(registration, { sessionId: "patron-ada" });
if (!registering.ok) throw new Error(registering.reason);
const submitted = step(registration, registering.state, {
  name: "details.submitted",
  data: { name: "Ada", branch: "Riverside" },
});
if (!submitted.ok) throw new Error(submitted.reason);
configuration(submitted.state); // => ["confirming"]

// Through JSON text and back, the state steps as the original does.
const stored = JSON.parse(JSON.stringify(submitted.state));
const confirmed = step(registration, stored, { name: "email.confirmed" });
if (!confirmed.ok) throw new Error(confirmed.reason);
isDone(confirmed.state); // => { ok: true, done: true, donedata: { branch: "Riverside" }, configuration: ["registered"] }
```

The state's first block of fields is the reference's position vocabulary in
camel case (`configuration`, `enteredStates`, `historyValues`, `datamodel`,
`running`, `status` and the rest); every datamodel value in it is written as
`@riddler/predicator`'s tagged-value text, so a date, a duration or an
integral float survives JSON. The fields after that block are the driver's
own: the session id, the virtual clock, the pending timers, the event
queues, the delayed sends a host processor holds, what it keeps of a
stopped chart, and each live invocation with its child's own state nested
in it. The exported `State` type names every field.
[ADR-0002](https://github.com/riddler/statifier-ts/blob/main/docs/adr/0002-the-core-contract.md) is the
record of the whole contract, with its typespecs.

Nothing in the package reads a clock or a random source: time enters only as
the `ms` a host passes to `advance`, the session id is the host's, and every
set of states the state holds is sorted, so the same chart and the same calls
answer the same states and effects on every engine.

## The effects

Every effect the core emits is plain data whose `kind` is the reference's tag,
and every one carries the `macrostep`, `microstep` and `round` counters. The
core emits these:

| `kind` | What the host does with it |
|---|---|
| `send` | delivers the event now, by its target and type |
| `send_delayed` | learns of an event due later: the driver holds it as a pending timer until `advance` reaches it, or hands it to the host's processor when its type is registered |
| `cancel` | drops the pending delayed send its `sendId` names, if any |
| `invoke` | learns of every invocation the core starts, whatever its type: the driver runs an SCXML child itself, and raises `error.execution` for a type it does not run |
| `autoforward` | learns an event was forwarded: the driver delivers it to the child itself |
| `cancel_invoke` | learns the live invocation its `invokeId` names stopped: the driver stops the child itself |
| `log` | records the label and the evaluated value |
| `datamodel_init` | learns the datamodel as the chart starts, before any `<data>` value binds |
| `datamodel_change` | learns one datamodel write: the path, the new and the prior value, and what made it - an `<assign>`, a `<data>`, a `<send>` or an `<invoke>` writing its `idlocation`, or an empty `<finalize>` writing a returned value back |
| `budget_exhausted` | learns a macrostep spent its round budget; the chart still runs |
| `done` | learns the chart stopped, with the top-level final's donedata |
| `trace` | follows the interpreter step by step; emitted only while the state's `trace` flag is set, which `start` leaves false |

A trace effect's `trace` field says which one it is: `event_dequeued`,
`transitions_selected`, `exit_set`, `content_executed`, `entry_set`,
`macrostep_stable`, `done`, `invoke_pass` or `finalize_autoforward`. The
reference's `conds_evaluated` trace is not emitted yet; a host that ignores a
trace it does not know keeps working when it arrives.

A `datamodel_change` for an `idlocation` write comes just before the `send`,
`send_delayed` or `invoke` effect it belongs to. A `<send>` refused for its
target, its type or its route answers no effect at all, though its
`idlocation` write stands, as the reference's does.

One more effect is the driver's own, not the core's: a call answers it only
when it passes `opts.inheritObservers`, so a host that never passes the option
never sees it. Its `kind` is not one of the reference's tags, and it carries
no counters of its own; the effect it wraps carries the child's.

| `kind` | What the host does with it |
|---|---|
| `child` | learns an effect an invoked child's run answered: `sessionId` names the child, which is its parent's session id, a dot and the invoke id, and `effect` is the child's effect as its run answered it; a grandchild's comes under its own session id, never nested |

An `<invoke>` of the SCXML type runs in process: the driver compiles its
`<content>` markup (an in-line `<scxml>` that declares no namespace is read
as SCXML) and starts it as a child session on the parent's virtual clock,
its datamodel seeded from the params its root `<data>` names. The child and
the parent reach each other through `#_parent` and `#_<invokeid>`, the
parent's `autoforward` reaches the child, the child's completion returns
`done.invoke.<invokeid>` with its donedata, and leaving the invoking state
cancels the child. `src` is never fetched, so an `<invoke>` with no content
raises `error.communication`, and so does content that does not compile; an
invoke type other than SCXML raises `error.execution`. What a child inherits
is the host's choice, passed with every call and off by default, as the
reference's session options are. With `opts.inheritSendTypes`, every child
reaches the processors in `opts.sendTypes`, each send handed with the
child's own session id, the parent's, a dot and the invoke id. With
`opts.inheritObservers`, every effect a child's run answers is among the
call's effects as `{ kind: "child", sessionId, effect }`, and a child starts
with its parent's `trace` flag. Without them a child registers no send type
and its own effects are not among a call's effects.

A send whose type the host registers is handed to the host's processor. The
processors are passed in `opts.sendTypes` on `start` and on every later call,
never stored in the state, and the set must stay the same for a session's
whole life:

```ts
import { compile, type SendProcessor, start, step } from "@riddler/statifier";

const welcomeSource = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0"
    name="welcome" initial="pending">
  <state id="pending">
    <transition event="patron.registered" target="welcomed">
      <send type="mail" event="welcome.card" target="patron:ada"/>
    </transition>
  </state>
  <state id="welcomed"/>
</scxml>`;

const welcomeChart = compile(welcomeSource);
if (!welcomeChart.ok) throw new Error("the welcome chart does not compile");

const mailed: string[] = [];
const mail: SendProcessor = { deliver: (_send, event) => mailed.push(event.name) };
const sendTypes = { mail };

const pending = start(welcomeChart.chart, { sessionId: "welcome-ada", sendTypes });
if (!pending.ok) throw new Error(pending.reason);
const welcomed = step(welcomeChart.chart, pending.state, { name: "patron.registered" }, { sendTypes });
if (!welcomed.ok) throw new Error(welcomed.reason);
mailed; // => ["welcome.card"]
welcomed.effects.map((effect) => effect.kind); // => ["send"]
```

A send the host's processor could not deliver goes back to the chart as
`error.communication`, carrying the send's id as `_event.sendid` whether or
not the author named it. A processor that knows at once answers
`{ kind: "failure", reason }` from `deliver`, and the send fails within the
call that handed it. A host that learns later calls
`reportSendFailed(chart, state, { send, reason? }, opts?)` with the send it
was handed, or with only its `sendId`, `cIndex` and `owner`, and the chart
runs to a stable configuration within that call. A report to a stopped chart
is refused with `not_running`, and a send without those three fields with
`not_a_send`; a processor that throws throws out of the call that handed the
send:

```ts
import {
  compile,
  configuration,
  reportSendFailed,
  type Send,
  type SendDelayed,
  type SendProcessor,
  start,
  step,
} from "@riddler/statifier";

const holdSource = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0"
    name="hold" initial="waiting">
  <state id="waiting">
    <transition event="copy.available" target="notifying"/>
  </state>
  <state id="notifying">
    <onentry><send id="notice" type="sms" event="hold.ready" target="patron:ada"/></onentry>
    <transition event="error.communication" cond="_event.sendid == 'notice'" target="calling"/>
  </state>
  <state id="calling"/>
</scxml>`;

const holdChart = compile(holdSource);
if (!holdChart.ok) throw new Error("the hold chart does not compile");

const queued: (Send | SendDelayed)[] = [];
const sms: SendProcessor = {
  deliver: (send) => {
    queued.push(send);
  },
};
const holdTypes = { sms };

const waiting = start(holdChart.chart, { sessionId: "hold-ada", sendTypes: holdTypes });
if (!waiting.ok) throw new Error(waiting.reason);
const notified = step(holdChart.chart, waiting.state, { name: "copy.available" }, { sendTypes: holdTypes });
if (!notified.ok) throw new Error(notified.reason);
configuration(notified.state); // => ["notifying"]

// Later, the text-message gateway answers that the number is unreachable.
const [notice] = queued;
if (notice === undefined) throw new Error("no notice was handed");
const failed = reportSendFailed(
  holdChart.chart,
  notified.state,
  { send: notice, reason: "unreachable" },
  { sendTypes: holdTypes },
);
if (!failed.ok) throw new Error(failed.reason);
configuration(failed.state); // => ["calling"]
```

## Position export and import

`exportPosition(state)` writes where a running chart stands in the
reference's string-id vocabulary, and `importPosition(chart, exported)` reads
it back into a state over a freshly compiled chart. The export refuses as the
reference's does: `internal_queue_not_empty` and `unnameable_states`. The
import refuses with exactly the reference's two reasons, `unknown_state_ids`
(every unknown id, sorted) and `malformed_export`, and checks no identity:
the exported `identity` is provenance, and a host that wants that check
compares it itself.

```ts
import { compile, configuration, exportPosition, importPosition, start, step } from "@riddler/statifier";

const loanText = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0"
    name="loan" initial="on_loan">
  <datamodel><data id="renewals" expr="0"/></datamodel>
  <state id="on_loan">
    <onentry><send id="due" event="loan.due" delay="14d"/></onentry>
    <transition event="loan.renew" cond="renewals &lt; 2" target="on_loan">
      <assign location="renewals" expr="renewals + 1"/>
    </transition>
    <transition event="loan.returned" target="returned"/>
  </state>
  <final id="returned"/>
</scxml>`;

function chartOf(source: string) {
  const result = compile(source, { chartName: "loan", chartVersion: "3" });
  if (!result.ok) throw new Error("the loan chart does not compile");
  return result.chart;
}

const before = chartOf(loanText);
const out = start(before, { sessionId: "loan-copy-18" });
if (!out.ok) throw new Error(out.reason);
const once = step(before, out.state, { name: "loan.renew" });
if (!once.ok) throw new Error(once.reason);

const exported = exportPosition(once.state);
if (!exported.ok) throw new Error(exported.reason);
exported.position.configuration; // => ["on_loan"]
exported.position.datamodel.renewals; // => "1"

// Into a fresh chart, through JSON text.
const after = chartOf(loanText);
const imported = importPosition(after, JSON.parse(JSON.stringify(exported.position)));
if (!imported.ok) throw new Error(imported.reason);
configuration(imported.state); // => ["on_loan"]
imported.state.timers; // => []
const back = step(after, imported.state, { name: "loan.returned" });
if (!back.ok) throw new Error(back.reason);
configuration(back.state); // => []

const stranger = importPosition(after, { ...exported.position, configuration: ["lost"] });
stranger; // => { ok: false, reason: "unknown_state_ids", ids: ["lost"] }
```

A stopped chart has left every state, so its configuration is empty; the
configuration it stopped in is what `isDone` and the `done` effect answer.
A position carries no pending timer: a delayed send waiting on the clock is
driver state, so the imported state above holds none, and a host that moves a
position with a timer pending reschedules it itself. The binary envelope the
reference wraps a position in is not part of this package.

**The proof of export and import is a self-consistency claim.** `pnpm
position`, a gate stage, drives every scion case of the corpus and, after the
start and after every step, exports the position, writes it to JSON text and
reads it back, imports it into a freshly compiled chart, and continues: every
carried point must agree with the unbroken drive at that point and after
every later step. A point the export cannot carry, such as one with a timer
pending, is counted with its reason rather than compared, and the stage
prints those counts. This shows the package agreeing with itself, nothing
lost on the way out and back. It does not show that the export matches the
reference's. That is shown case by case where the corpus states it: from tag
`v2.11.0` the statifier suite carries cases that state the exported position
after a step, and the runner compares this package's export with each one
(under Conformance below). Parity with the reference's export is claimed for
those cases and no further.

## The Basic HTTP processor

The Basic HTTP Event I/O Processor of SCXML appendix C.2 ships on an entry
point of its own, `@riddler/statifier/basichttp`, so a host that does not
import it reaches nothing it reads. `basicHttp` takes the base address the
host's own front answers at, a `report` function, and optionally a transport,
and answers the processor with the send types to register it under: its URI
and its short form `basichttp`. A session's `_ioprocessors` then carries the
same location under both, the base address, `/`, and the session's id.

Each send the processor is handed becomes one POST, made after the call that
handed it returns: a form body built by hand, or the send's content as text,
carrying the send's deduplication key in the `scxml-send-key` header. Delivery
is at least once; a receiver that takes a request only when it has not taken
one with the same key takes each send once. A send with no target fails within
the call that handed it, as appendix C.2.2 requires. Any other miss - a status
outside 2xx, no response, a transport that throws - is handed to `report` with
the sending session's id, and the host passes it to `reportSendFailed` with the
state it holds for that session, so the chart takes `error.communication`.

The default transport, `fetchTransport`, looks up the global fetch function
when a request is made, not when the package loads, and answers the failure
`fetch_unavailable` when there is none. A host supplies its own HTTP as an
object with a `post` method of the `HttpTransport` type. On a device the
processor only sends; `decodeRequest` is for a host that runs a server, and
turns an inbound POST into the event its front passes to `step`.

## Conformance

The conformance corpus is the reference's, and it is the spec: a case this
package answers differently from the corpus is this package's bug. The corpus
is copied byte for byte from the reference at tag `v2.11.0`, recorded in the
provenance file `conformance/statifier.vendored.json`, and never edited by
hand. Its registry, `conformance/registry.json`, lists the cases this package
claims to pass - written only by a run that observed the pass, and never
narrowed.

**The claim:** this package makes four claims, with 318 entries in its
registry: `scion` with 119 entries out of the suite's 119 cases, `statifier`
with 34 entries out of the suite's 34 cases, `w3c-mandatory` with 152 entries
out of the w3c suite's 154 mandatory cases, and `w3c-optional` with 13 entries
out of its 14 optional cases. A claim is exactly its entries: a case with no
entry is one this package does not claim to pass.

**The gap:** it claims every case the reference's own registry lists, and
does not yet claim the 3 w3c cases the reference's registry does not list
either. `pnpm conformance` runs
the corpus, writes one report per suite under `reports/`, and prints both
lists, every unclaimed case with the reason the run failed it, and each case
the reference claims with the features it needs in the corpus's own words. The
runner drives the scion, w3c and statifier suites through the interpreter. A
w3c case that needs `<invoke>` is driven with its child run in process. A w3c
case that names an Event I/O Processor in its host object (the Basic HTTP
processor is the one such cases name) is driven as the reference's host-case
harness drives it: the package's own Basic HTTP processor is registered under
its URI and its short form, and its requests come back into the session
through an in-memory loopback front that opens no socket. So a claim of such
a case rests on that loopback: it proves the processor's and the core's event
I/O logic, not a network round trip. A statifier case that
carries a host object registers its send types with the driver, and agrees
only when the sends handed to them are exactly the ones it expects. A diff
case is driven the same way, on its configurations and its sends, because
the reference's runner compares none of its diff keys; the reference compares
them in its own test suite, through a chart diff this package does not port.
A case that asks the host to report a send failed is driven with that send
reported through `reportSendFailed`, as the reference's harness reports it.
A case that declares the events its chart accepts has the chart checked
against that declaration by `checkAccepts` before it is driven, as the
reference's harness checks it, and agrees only when both lists the check
answers are the ones it expects. A statifier case whose step states the
exported position the chart holds after it is driven the same way, with or
without a host object, as the reference's runner drives it: once that step's
configuration agrees, the package's `exportPosition` is rendered as the
reference renders its own export, and the case agrees only when the rendering
is exactly the position the step states.

```bash
pnpm conformance      # run the corpus and print the gap list
pnpm registry         # the registry check, a gate stage
pnpm position         # the position round-trip property, a gate stage
```

[`conformance/README.md`](https://github.com/riddler/statifier-ts/blob/main/conformance/README.md) says how the copy, the
check, the runner, the ratchet and the position property work.

## Engines

The package assumes no host environment. It imports no Node built-in and
touches no DOM, reads nothing locale-sensitive and calls neither `eval` nor
`Function`, so nothing under `src/` reaches for anything a server runtime, a
browser or React Native's JavaScript engine does not offer. The neutrality
lint, a gate stage, checks `src/` for those constructs and passes.

That is a check on the text. A check on a run - the conformance corpus driven
through this package on the JavaScript engine React Native uses, and diffed
against a run on the server runtime - is what `scripts/hermes-conformance.mjs`
does. The engine proof was last run on 2026-10-04, at commit `6af16f3` on
`main`, the head of a release with every change but its release prep (the
version bump, the changelog promotion and the install pin), over the corpus
at `v2.11.0`, with `@riddler/predicator` 0.5.0 installed, on the standalone
Hermes VM, release 0.12.0, bytecode version 89:
every suite agreed row for row with the same run on Node, with zero
differences - scion 119 rows, w3c 168 and statifier 34, every case of the
vendored corpus, none left out. These are the values that run recorded in
`conformance/engine-proof.json`, which the script writes when run with
`--record`, and a test compares this paragraph with that record, so they are
a dated record of one run, held to what the run wrote. Its earlier runs, on
2026-10-01 at commit `15980e9` and on 2026-10-02 at commit `5560a8c`, with
the corpus at `v2.10.0`, and earlier on 2026-10-04, with the change that
moved the corpus to `v2.11.0` applied to commit `df87224` and then at commit
`3589315`, also found zero differences. It runs again at the head of each
release.

What the proof covers is narrower than "React Native". The standalone VM is
an older release than the engine current React Native ships, so the bundle it
runs has its classes lowered and targets ES2016, which lowers each `async`
function to a generator; it is evidence about the engine family and about this
package's use of the language, not a run on the engine build an application
ships. The Basic HTTP cases run on the VM through the same in-memory loopback
front as on Node: they prove the processor's logic on the engine, not a
network round trip on a device. The script's header and
[`conformance/README.md`](https://github.com/riddler/statifier-ts/blob/main/conformance/README.md)
say more.

## Development

```bash
mise install                        # the node and pnpm mise.toml pins
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm run gate          # the full quality gate
```

## License

MIT - see [LICENSE](LICENSE).
