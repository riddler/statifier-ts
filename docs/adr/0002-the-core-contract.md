# ADR-0002: The core contract

Status: accepted (2026-10-02; proposed 2026-10-01)

## Context

ADR-0001 fixes what kind of thing this package is: a conformant sibling of the
Elixir reference implementation holding five parts - the pure step function,
its own SCXML front end, the datamodel binding to `@riddler/predicator`, a
small in-memory driver with a virtual clock, and position export and import in
the reference's string-id vocabulary. It hands the contract between those
parts and a host to this record ("This record asserts rules and delegates
every enumeration"). This record states that contract: what the core takes and
answers, the effects it emits, the calls a host makes, the state those calls
carry, how a position leaves and re-enters, and what keeps every answer
deterministic.

The reference reads as follows at tag `v2.9.0` (`f2365bb8`):

- `st-ADR-0003` (`docs/adr/0003-pure-core-with-effects.md`, "Decision") makes
  the core `(state, event) -> {state, [effect]}`, with every effect data
  interpreted outside the core.
- `st-ADR-0005`
  (`docs/adr/0005-full-configuration-and-interned-state-indexes.md`) keeps the
  full configuration as interned integer indexes inside the core, with string
  ids only at the API.
- `lib/statifier/effect.ex` (`Statifier.Effect`, "The vocabulary") is the one
  effect union: `send`, `send_delayed`, `cancel`, `invoke`, `cancel_invoke`,
  `autoforward`, `budget_exhausted`, `done`, `log`, `datamodel_change`,
  `datamodel_init`, and ten trace effects under the `trace` tag. Every effect
  carries the `macrostep`, `microstep` and `round` counters, and names a state,
  a transition or a content node by its index.
- `lib/statifier/position.ex` (`Statifier.Position`, "`export/1` and
  `import/2`: the migration vocabulary") is the string-id position. `export/1`
  refuses a position whose internal queue is not empty
  (`internal_queue_not_empty`) and one that holds a state with no written id
  other than the root (`unnameable_states`). `import/2` refuses with exactly
  two reasons, `unknown_state_ids` (every unknown id, sorted) and
  `malformed_export` (a missing required key or a value of the wrong shape),
  and performs no identity check: the exported `identity` is provenance, read
  by nobody on import. The identity check belongs to `from_binary/2`, the
  binary envelope, which ADR-0001 leaves out of this package.
- The same module's `@required_export_keys` lists the sixteen keys an import
  requires: `configuration`, `entered_states`, `states_to_invoke`,
  `history_values`, `active_invocations`, `invoke_counter`, `send_counter`,
  `timer_counter`, `datamodel`, `running`, `status`, `macrostep`,
  `microstep`, `round`, `trace`, `max_macrostep_rounds`. `export/1` writes
  `identity` beside them. The export carries no pending timer: a delayed send
  waiting on a clock is the driver's, not the position's.
- The export deliberately omits `internal_queue`, `routes`, `invoke_types`,
  `send_types` and `machine`; `import/2` sets the queue empty and the three
  snapshots to nil "for the driver to re-stamp" (`Statifier.Position`'s
  moduledoc, and `st-ADR-0064`,
  `docs/adr/0064-position-blob-drops-the-per-drive-snapshot-fields.md`). The
  interpreter's moduledoc, "Rehydrating a position"
  (`lib/statifier/interpreter.ex`), re-stamps the send types before the first
  drive after a load, and `st-ADR-0069`
  (`docs/adr/0069-host-registered-send-types.md`) makes the registered send
  types per-session deployment state rather than part of the position.
- `Statifier.Interpreter`'s `generate_invoke_id` mints an invocation's id from
  the position's `invoke_counter`, not from a clock or a random source.

This package's code on `main` at `214191a` answers most of the contract
already, and the rest is ruled:

- The core is `src/core/interpreter.ts`: `initialize` starts a chart and
  `handleEvent` takes one external event, each answering the state it leaves
  and its effects in order (`Stepped`, `HandleOutcome`). The effect union it
  emits is `InterpreterEffect`, built from `Effect` in `src/core/content.ts`
  (`Log`, and `Send`, `SendDelayed` and `Cancel` from `src/core/send.ts`),
  `CancelInvoke` in `src/core/exit-entry.ts`, and `BudgetExhausted` and `Done`
  in `src/core/interpreter.ts`.
- `compile` in `src/compiler.ts` answers a `Chart` wrapper,
  `{ identity, machine }`, with the `ChartIdentity` (`contentHash`, `name`,
  `version`) on the wrapper, where the reference stamps the identity onto its
  `Machine`. `src/index.ts` exports the `Machine` type beside it.
- A `<script>` compiles to a placeholder (`SCRIPT_UNSUPPORTED` and
  `scriptPlaceholder` in `src/compiler.ts`) that raises `error.execution` when
  it runs, because the pinned expression language compiles expressions and not
  statement programs.
- Nothing under `src/` reads a clock or a random source: a search of `src/`
  for `Date.now`, `new Date`, `Math.random`, `performance.`, `crypto.`,
  `setTimeout` and `setInterval` finds nothing at `214191a`. The session id is
  `InitializeOptions.sessionId`, which the host supplies.
- The driver is `src/driver.ts`: `start`, `step`, `advance`, `configuration`
  and `isDone`, exported from `src/index.ts` with `compile`. Its `State` is the
  plain JSON state, its first block of fields the reference's export
  vocabulary in camel case; `DriveResult`, `DriveRefused` and `MalformedDetail`
  are its answers and refusals; `DoneStatus` is what `isDone` answers. A shape
  check over the whole state (`src/driver-shape.ts`, internal) runs before
  anything decodes, as the reference's `import/2` runs `check_required_keys`
  and `check_shapes` before it resolves an id.

The driver's six calls were ruled by the operator, 2026-10-01: `compile`,
`start`, `step`, `advance`, `configuration` and `isDone`, with the compiled
chart passed to every call that moves it and the host's send processors passed
on every call. Position was ruled by the operator, 2026-10-01, to follow the
reference: the two import refusals are the reference's, and there is no
identity check on import. Scripts were ruled by the operator, 2026-10-01, to
stay a placeholder that raises `error.execution` until the pinned expression
language compiles statements.

## Decision

**The core is a pure step function.** It takes a state and an event and
answers a new state and a list of effects, in the order they were produced. It
performs no I/O, reads no clock and holds no timer (`st-ADR-0003`; ADR-0001,
"The step function is pure"). A call that cannot proceed answers a refusal with
a reason token and never throws (ADR-0001, "Errors are events inside a chart
and values at the API").

**Indexes inside, string ids at the API.** Inside the core the full
configuration and every set of states are interned integer indexes
(`st-ADR-0005`). An effect names a state, a transition or a content node by its
index, as the reference's effects do. What a host reads of a running chart -
`configuration(state)`, the driver's state and the exported position - names
states by their string ids.

**The effect vocabulary is plain data, spelled as the reference spells it.**
Every effect is a plain object whose `kind` is the reference's tag, and every
effect carries the `macrostep`, `microstep` and `round` counters. The core
emits these effects:

| `kind` | What the host does with it | Type on `main` at `214191a` |
|---|---|---|
| `send` | delivers the event now, by its target and type | `Send` (`src/core/send.ts`) |
| `send_delayed` | schedules the event `delayMs` from now with its own timer | `SendDelayed` (`src/core/send.ts`) |
| `cancel` | drops the pending delayed send its `sendId` names, if any | `Cancel` (`src/core/send.ts`) |
| `cancel_invoke` | stops the live invocation its `invokeId` names | `CancelInvoke` (`src/core/exit-entry.ts`) |
| `log` | records the label and the evaluated value | `Log` (`src/core/content.ts`) |
| `budget_exhausted` | learns a macrostep spent its round budget; the chart still runs | `BudgetExhausted` (`src/core/interpreter.ts`) |
| `done` | learns the chart stopped, with the top-level final's donedata | `Done` (`src/core/interpreter.ts`) |

**Not every reference effect is emitted yet, and the gap is a rule, not an
oversight.** The core does not emit `invoke`, `autoforward`,
`datamodel_init`, `datamodel_change`, or any of the reference's ten trace
effects. A later record, or an Amendment to this one, adds each of them to the
union when the code that emits it lands, spelled as the reference spells it.
Until then a host reads no effect the table above does not list.

**The driver has six calls.** A host compiles a chart once and drives it with
the other five:

- `compile(xml, opts)` answers a `Chart`, or the compile errors.
- `start(chart, opts)` starts the chart: its datamodel bound, its initial
  states entered, run to a stable configuration.
- `step(chart, state, event, opts?)` takes one external event.
- `advance(chart, state, ms, opts?)` moves the virtual clock forward `ms`
  milliseconds and fires every delayed send due by then, earliest first and,
  at one due time, in the order they were scheduled.
- `configuration(state)` answers the active states as string ids.
- `isDone(state)` answers whether the chart has stopped and, when it has, its
  donedata and its final configuration; a state that is not well formed is
  refused as `malformed_state`, as the other calls refuse it.

**The chart is passed with every call that moves it.** The state is plain JSON
and cannot carry the compiled chart or the host's send processors, so `start`,
`step` and `advance` each take the chart. The calls that move the chart answer
`{ ok: true, state, effects }` or `{ ok: false, reason }`. A state made by a
different chart is refused with `chart_mismatch`, judged by the chart's
identity: its content hash, its name and its version. A state that is not well
formed is refused with `malformed_state`, and that refusal carries a `detail`
naming what failed: a field missing or of the wrong type (checked over the
whole state before anything decodes), a state name the chart does not hold, a
value whose text does not decode, or a pending timer that is not a delayed
send. The driver's other refusal reasons are the driver's to enumerate, and
its tests do.

**The host's send processors are passed on every call, never stored.**
`opts.sendTypes` carries a processor for each send type the host registers, on
`start` and on every later call, as the reference re-stamps its registered send
types before each drive rather than keeping them in the position (`st-ADR-0069`;
`Statifier.Interpreter`'s "Rehydrating a position"). The set of registered
types is the same for a session's whole life: a send's type is judged against
the processors passed with each call, so a type passed on one call and not the
next is handed on the first and refused with `error.execution` on the second.
The driver hands a send of a registered type to its processor and reports it
among the call's effects, as it reports every send; it never routes or
schedules it, and keeps no record of it in the state beyond the delayed sends
a processor holds for a later `<cancel>`.

**The state is a plain JSON value.** It holds no class instance, no function,
no `Map` and no `Set`, and a `JSON.stringify` then `JSON.parse` of it answers a
state that steps exactly as the original does. Its first block of fields is the
reference's export vocabulary, below; the rest are the driver's own: the
session id, the virtual clock, the pending timers, the external and internal
queues, the delayed sends processors hold, the halt a spent round budget
sets, and what the driver keeps of a stopped chart.

**The chart identity lives on the `Chart`, not on the `Machine`.** `compile`
answers `{ identity, machine }`, as `main` does at `214191a`. The reference
stamps the identity onto its `Machine` because it reads it there when it writes
and checks a position blob (`to_binary/1`, `from_binary/2`); this package has
no blob, and its identity is read in one place, the driver's `chart_mismatch`
check, which has the `Chart` in hand. No reason forces the move, so the code on
`main` is the answer.

**The `Machine` type is opaque and unstable.** It is exported only because a
`Chart` carries one. A host reads none of its members and codes against none of
them; its shape changes without notice as the compiler grows. The stable
surface is the `Chart`, its `ChartIdentity`, the driver's calls, the state's
export block, the effect union and the exported position.

**A `<script>` raises `error.execution` until scripts can compile.** A script
compiles to a placeholder that raises `error.execution` when it runs, and it
stays one until the pinned expression language compiles statement programs,
ruled by the operator, 2026-10-01.

**The position follows the reference.** `exportPosition(state)` answers the
exported position, or refuses as the reference's `export/1` refuses:
`internal_queue_not_empty` for a position whose internal queue holds an event,
and `unnameable_states` for a position holding a state, other than the root,
with no written id. `importPosition(chart, exported)` answers a state over
`chart`, or refuses with exactly the reference's two reasons:
`unknown_state_ids`, carrying every unknown id, sorted, and `malformed_export`,
for a missing required key or a value of the wrong shape. An extra key is not
refused. There is no identity check on import: the exported `identity` is
provenance, read by nobody, and a host may change, delete or leave stale that
key with the same result. The binary envelope and its identity check are not
ported (ADR-0001, "What is not here"). Both rulings are the operator's,
2026-10-01.

**The exported position carries the reference's keys, spelled in camel case.**
This package spells the reference's fields in camel case throughout, and the
export is no exception:

| Reference key (`@required_export_keys`) | Key here | Value |
|---|---|---|
| `configuration` | `configuration` | the active states' ids, root excluded, sorted |
| `entered_states` | `enteredStates` | every state ever entered, root excluded, sorted |
| `states_to_invoke` | `statesToInvoke` | states whose invocations have not started, sorted |
| `history_values` | `historyValues` | each history state's id to its recorded states' ids, sorted |
| `active_invocations` | `activeInvocations` | a list of `{ state, invokeIndex, invokeId }` |
| `invoke_counter` | `invokeCounter` | integer |
| `send_counter` | `sendCounter` | integer |
| `timer_counter` | `timerCounter` | integer |
| `datamodel` | `datamodel` | every root, the system variables included, each as predicator's tagged-value text |
| `running` | `running` | boolean |
| `status` | `status` | `"running"` or `"done"` |
| `macrostep` | `macrostep` | integer |
| `microstep` | `microstep` | integer |
| `round` | `round` | integer |
| `trace` | `trace` | boolean |
| `max_macrostep_rounds` | `maxMacrostepRounds` | a positive integer or `"infinity"` |

`identity` is written beside them as `{ contentHash, name, version }` and is
not required on import. Two shapes depart from the reference's terms, because
JSON cannot hold them: an `active_invocations` key is a tuple of a state id and
an invoke index, so each entry here is an object carrying both; and a datamodel
value is written as tagged-value text, because plain JSON loses an integral
float, a date, a datetime, a duration and undefined, and that text keeps them.
Pending timers are driver state and are not position fields.

**The position claim is a self-consistency claim.** The proof of export and
import is a round-trip property over the scion corpus: after every step,
export, import into a freshly compiled chart, continue, and the configurations
agree with the ones the unbroken run reached. That is a self-consistency claim
until the reference emits corpus cases that assert the exported position; no
text here claims parity with the reference's export before then (ADR-0001,
"The position claim is self-consistency").

**Determinism.** Given the same chart, the same options and the same calls, the
package answers the same states and the same effects on every engine:

- Nothing under `src/` reads a clock, a random source or `Date.now`. Time
  enters only as the `ms` a host passes to `advance`.
- The session id is minted by the host and handed to `start`.
- An invocation's id is derived from the state, from its invoke counter as the
  reference's `generate_invoke_id` derives it, never from a clock or a random
  source.
- Every set of states the state or the position holds is sorted by its string,
  so the order says nothing about how it was built.

**This record asserts rules and delegates enumeration.** The exact fields of
each effect, the driver's full set of refusal reasons, and the shape a
`malformed_export` carries are enumerated by the code that implements them and
held by that code's tests.

## Typespecs

The shapes a host codes against, abridged to their public members. A field
list marked `...` is the code's, enumerated there.

```ts
// compile
function compile(xml: string, opts?: CompileOptions): CompileResult;
type CompileResult =
  | { ok: true; chart: Chart }
  | { ok: false; errors: readonly CompileError[] };
interface Chart { identity: ChartIdentity; machine: Machine } // Machine: opaque
interface ChartIdentity { contentHash: string; name: string | null; version: string | null }
interface CompileOptions { chartName?: string; chartVersion?: string }

// the driver
function start(chart: Chart, opts: StartOptions): DriveResult;
function step(chart: Chart, state: State, event: HostEvent, opts?: DriveOptions): DriveResult;
function advance(chart: Chart, state: State, ms: number, opts?: DriveOptions): DriveResult;
function configuration(state: State): readonly string[];
function isDone(state: State): DoneStatus;

interface DriveOptions { sendTypes?: Readonly<Record<string, SendProcessor>> }
interface StartOptions extends DriveOptions { sessionId: string; /* ... */ }
interface HostEvent { name: string; data?: Value }
type DriveResult =
  | { ok: true; state: State; effects: readonly InterpreterEffect[] }
  | DriveRefused;
type DriveRefused =
  | { ok: false; reason: "not_running" | "chart_mismatch" | "unencodable_value" | "invalid_duration" }
  | { ok: false; reason: "malformed_state"; detail: MalformedDetail };
type MalformedDetail =
  | { kind: "bad_shape"; field: string }
  | { kind: "unknown_state"; name: string }
  | { kind: "undecodable_value"; field: string }
  | { kind: "not_a_delayed_send"; field: string };
type DoneStatus =
  | { ok: true; done: false }
  | { ok: true; done: true; donedata: Value; configuration: readonly string[] }
  | { ok: false; reason: "malformed_state"; detail: MalformedDetail };

// the effects
type InterpreterEffect = Send | SendDelayed | Cancel | CancelInvoke | Log | BudgetExhausted | Done;
// each: { kind: "send" | "send_delayed" | "cancel" | "cancel_invoke" | "log"
//              | "budget_exhausted" | "done"; macrostep; microstep; round; ... }

// the position
function exportPosition(state: State):
  | { ok: true; position: ExportedPosition }
  | { ok: false; reason: "internal_queue_not_empty" | "unnameable_states"; /* ... */ };
function importPosition(chart: Chart, exported: unknown):
  | { ok: true; state: State }
  | { ok: false; reason: "unknown_state_ids"; /* every unknown id, sorted */ }
  | { ok: false; reason: "malformed_export"; /* ... */ };
```

## Worked example

A library loan, the copy on loan with a renewal allowed while fewer than two
have been taken:

```xml
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" name="loan" initial="on_loan">
  <datamodel><data id="renewals" expr="0"/></datamodel>
  <state id="on_loan">
    <onentry><send event="loan.due" delay="14d" id="due"/></onentry>
    <transition event="loan.renew" cond="renewals &lt; 2" target="on_loan">
      <assign location="renewals" expr="renewals + 1"/>
    </transition>
    <transition event="loan.returned" target="returned"/>
    <transition event="loan.due" target="overdue"/>
  </state>
  <state id="overdue"><transition event="loan.returned" target="returned"/></state>
  <final id="returned"/>
</scxml>
```

The host compiles it with `chartName: "loan"` and `chartVersion: "3"`, calls
`start` with the session id `loan-copy-17`, and then `step` with the event
`loan.renew`. Each call answers one `send_delayed` effect for `loan.due`, due
in 1209600000 milliseconds, which the driver holds as a pending timer. The
exported position after the step is:

```json
{
  "identity": {
    "contentHash": "sha256:19d51572cf92d7bf652b737c9a18862720d2e3a5dc931d559192b19160660b61",
    "name": "loan",
    "version": "3"
  },
  "configuration": ["on_loan"],
  "enteredStates": ["on_loan"],
  "statesToInvoke": [],
  "historyValues": {},
  "activeInvocations": [],
  "invokeCounter": 0,
  "sendCounter": 0,
  "timerCounter": 2,
  "datamodel": {
    "_sessionid": "\"loan-copy-17\"",
    "_name": "\"loan\"",
    "_event": "{\"name\":\"loan.renew\",\"type\":\"external\",\"sendid\":{\"$type\":\"undefined\"},\"origin\":{\"$type\":\"undefined\"},\"origintype\":{\"$type\":\"undefined\"},\"invokeid\":{\"$type\":\"undefined\"},\"data\":{\"$type\":\"undefined\"}}",
    "_ioprocessors": "{\"http://www.w3.org/TR/scxml/#SCXMLEventProcessor\":{\"location\":\"#_scxml_loan-copy-17\"}}",
    "renewals": "1"
  },
  "running": true,
  "status": "running",
  "macrostep": 2,
  "microstep": 1,
  "round": 1,
  "trace": false,
  "maxMacrostepRounds": 10000
}
```

Neither pending timer is in it: both `send_delayed` effects are waiting on the
driver's virtual clock, and the position carries only the `timerCounter` that
stamped them. `sendCounter` is 0 because the author named the send `due`, and an
author-written id does not consume a generated one. The root state is not
listed; `importPosition` re-adds it.

## Consequences

A host codes against one contract: compile once, pass the chart and its
processors with every call, read effects as data, and keep the state as JSON
wherever it likes. The core decides nothing a host can see beyond the
configuration and the effects, so the same chart answers the same way on a
server, in a browser and on a device.

Passing the chart with every call costs the host a reference it would hold
anyway, and buys a state that is plain data: it can be stored, sent and
compared without the compiled chart or any function riding along. A state
handed to the wrong chart fails loudly with `chart_mismatch` rather than
walking a document it was never measured against.

Because the effect union is smaller than the reference's today, a host written
against this record will meet new `kind`s as `invoke`, `autoforward`, the
datamodel effects and the trace effects land. Each arrives in a record or an
Amendment first, and a host that ignores a `kind` it does not know keeps
working.

Following the reference on import means a position can be moved onto a
different revision of a chart on purpose, and that nothing on import stops a
host from loading a position onto the wrong chart: a host that wants that check
compares the exported `identity` itself. Within one revision, the driver's
`chart_mismatch` check is what refuses a stranger.

A chart with a `<script>` compiles and runs, and every script raises
`error.execution` until the expression language can compile statements; a chart
that depends on a script's effect behaves as the reference does when a script
fails, not as it does when one succeeds.

Declaring `Machine` opaque leaves the compiler free to change it. A host that
reaches into it anyway takes on that churn.

The position's proof is the package agreeing with itself. It shows nothing lost
on the way out and back, not that the export matches the reference's; that
needs corpus cases the reference does not emit yet.

## Note: script bodies compile (2026-10-01)

Three passages name a condition rather than a lasting rule: the Context bullet
naming `SCRIPT_UNSUPPORTED` and `scriptPlaceholder`, the Context's sentence
that scripts were ruled to stay a placeholder, and the Decision's paragraph "A
`<script>` raises `error.execution` until scripts can compile". Each holds
until the pinned expression language compiles statement programs. That holds
from `@riddler/predicator` 0.4.0, which exports `compileProgramWithSpans` and
which `package.json` pins at `^0.4.0` on `main` at `a85c0e4`. When that
release was pinned, script bodies were to compile through it, ruled by the
operator, 2026-10-01.

The change that adds this Note does so. `compileScript` in `src/compiler.ts`
compiles every `<script>` body, top-level and in-line, as a statement program,
as the reference's `compile_program/3` in
`lib/statifier/compiler/expressions.ex` at `v2.9.0` does, and
`SCRIPT_UNSUPPORTED` and `scriptPlaceholder` no longer exist. A body that does
not compile is deferred as the reference defers it: it compiles to an
`Invalid` that raises `error.execution` when the script runs, carrying the
reference's message, and the chart still loads. The Consequences paragraph
beginning "A chart with a `<script>` compiles and runs" now holds only for a
script whose body did not compile.

## Amendment: the Machine stays opaque until a release fixes it (2026-10-01)

Status: accepted (2026-10-02; proposed 2026-10-01)

The Decision's paragraphs "The chart identity lives on the `Chart`, not on the
`Machine`" and "The `Machine` type is opaque and unstable" stand as written.
Both were to be kept and declared, the `Chart` wrapper and the `Machine` export
alike, with no export removed, ruled by the operator, 2026-10-01.

This Amendment adds when the second ends. The `Machine` type stays opaque and
unstable until a release of this package fixes its shape, and a release fixes
it only by an Amendment to this record that names the members it promises.
Until then no version promises any member of `Machine` or of the types it
holds, and a change to them is not a breaking change to this contract.

The change that adds this Amendment puts both statements where a host reads
them, in the declarations' doc comments, each citing this record: `Chart` in
`src/compiler.ts` says the identity lives on the wrapper by choice and that its
`machine` is opaque and unstable, and `Machine` in `src/machine.ts` says it is
opaque and unstable and exported only because a `Chart` carries one.

## Amendment: the invoke effects (2026-10-01)

Status: accepted (2026-10-02; proposed 2026-10-01)

The Decision's paragraph beginning "Not every reference effect is emitted
yet" says an Amendment adds each reference effect to the union when the code
that emits it lands. This one adds two, `invoke` and `autoforward`, spelled as
the reference's `Statifier.Effect.Invoke` and `Statifier.Effect.Autoforward`
in `lib/statifier/effect/` at `v2.9.0`, and makes `cancel_invoke` reachable.
The change that adds this Amendment adds the code: the types `Invoke` and
`Autoforward` and the functions `runInvokePass` and `applyInvokePasses` in
`src/core/invoke.ts`.

| `kind` | What the host does with it | Type |
|---|---|---|
| `invoke` | starts the invocation `invokeId` names, of the resolved `type`, from `src` or `content`, with `params`; the core runs none | `Invoke` (`src/core/invoke.ts`) |
| `autoforward` | delivers `event`, unchanged, to the live invocation `invokeId` names | `Autoforward` (`src/core/invoke.ts`) |

Each carries `stateIndex` and the `macrostep`, `microstep` and `round`
counters; an `invoke` also carries `invokeIndex`, its position among its
state's `<invoke>` elements. What starts an invocation, what aborts it and
which invocations are live follow the reference's `Statifier.Interpreter` at
`v2.9.0`:

- `runInvokePass` ports `run_invoke_pass`: once a macrostep is stable, each
  state entered and not left during it starts its invocations, in entry order
  and then document order, and the states to invoke are cleared.
- `runInvokePass` ports `invoke_one` too: the first argument that fails
  (`type`, `src`, a `namelist` entry or `<param>`, `<content>`) or an
  `idlocation` that cannot be written raises `error.execution` with the origin
  `{ kind: "invoke", stateIndex, invokeIndex }` and answers no effect.
- The id is the author's `id`, or `generate_invoke_id`'s: `inv_` and the
  position's `invokeCounter` plus one, after the state's id and a dot. The
  counter is the one the position already carries.
- `applyInvokePasses` ports `apply_invoke_passes`: after `_event` is set and
  before selection, the live invocation whose id equals the event's `invokeid`
  runs its `<finalize>`, and each live invocation that autoforwards answers
  `autoforward`; one that does both runs `<finalize>` first. An empty
  `<finalize>` writes the returned values back as `auto_assign_finalize`
  does; a write that fails raises `error.execution` with the origin
  `{ kind: "finalize", stateIndex, invokeIndex }`.
- An invocation is recorded live only when its type is the built-in SCXML
  type, as `maybe_record_active_invocation` decides for a session that
  declared no invoke types; only a live invocation is finalized, forwarded to
  or cancelled.

What stays with the driver. A `done.invoke.<id>` event and an
`error.communication` about an invocation are raised by the reference's
session and its invoke handlers, not its core, so the core here gives neither
a special case: an event that arrives from an invocation is an ordinary
external event whose `invokeid` decides which `<finalize>` runs. Running the
child, and turning what it answers into events, are the driver's.

Not ported. The reference's caller-declared invoke types (`invoke_types`) and
the refusal of a type outside them have no counterpart here; neither do the
`caller_context` field on `invoke` and `cancel_invoke`, nor the trace and
datamodel effects the passes emit. The Typespecs union gains `Invoke` and
`Autoforward`; the Decision's sentence that the core does not emit `invoke` or
`autoforward` now holds only for the effects this Amendment does not name.

## Amendment: the datamodel effects and the trace effects (2026-10-01)

Status: accepted (2026-10-02; proposed 2026-10-01)

The Decision's paragraph beginning "Not every reference effect is emitted
yet" says an Amendment adds each reference effect to the union when the code
that emits it lands. This one adds the two datamodel effects and nine of the
reference's ten trace effects, spelled as the reference's
`Statifier.Effect.DatamodelChange`, `Statifier.Effect.DatamodelInit` and
`Statifier.Effect.Trace.*` in `lib/statifier/effect/` at `v2.9.0`. Which
effects the union carries was decided by the conductor under the operator's
standing consent, 2026-10-01: the effects the reference's core emits from the
places this change ports, with the reference's names and fields. The change
that adds this Amendment adds the code: the types in `src/core/effects.ts`,
with the gate `traced` there, and the emitting sites named below.

**The datamodel effects are core effects.** They are emitted whether or not
the position traces:

| `kind` | What the host does with it | Emitted by | Reference at `v2.9.0` |
|---|---|---|---|
| `datamodel_init` | learns the datamodel as the chart starts: the host's values, the system variables, and every declared `<data>` id bound to undefined, before any value binds | `initializeDatamodel` (`src/core/datamodel.ts`), first of the effects starting a chart answers | `Statifier.Interpreter.Datamodel.initialize/1` |
| `datamodel_change` | learns one successful write: `locationPath`, `locationSource`, `newValue`, `priorValue`, and the `<assign>` (`cIndex`, `owner`) or the `<data>` (`dIndex`) that made it | `executeAssign` (`src/core/content.ts`); `bindValue` (`src/core/datamodel.ts`), reached from `initializeDatamodel` and, on a state's first entry under late binding, `enterStateData` | `Statifier.Machine.Content.Assign`'s `execute/2`; `Statifier.Interpreter.Datamodel`'s `bind_value` |

A write that is refused, a binding that fails, and a root `<data>` whose id
the host supplied answer no `datamodel_change`, as the reference's do not.

**The trace effects are emitted only while the position traces.** Each has
`kind` `trace`, the reference's tag, and a `trace` field naming which one it
is, spelled as the reference's telemetry spells it (`trace_kind` in
`lib/statifier/telemetry.ex` at `v2.9.0`). A configuration a trace carries
is the full configuration, ancestors included, in document order:

| `trace` | Fields | Emitted by | Reference at `v2.9.0` |
|---|---|---|---|
| `event_dequeued` | `event`, `from` (`external` or `internal`) | `handleEvent` and `internalRound` (`src/core/interpreter.ts`) | `Trace.EventDequeued`, from `handle_event/2` and `internal_round/1` |
| `transitions_selected` | `tIndexes`, `event` (null for an eventless selection) | `runSelected` (`src/core/interpreter.ts`), for every selection, the empty one included | `Trace.TransitionsSelected`, from `run_selected/3` |
| `exit_set` | `indexes` in exit order, `configuration` after the exits | `exitStates` (`src/core/exit-entry.ts`) and `exitInterpreter` (`src/core/interpreter.ts`) | `Trace.ExitSet`, from `ExitEntry.exit_states/2` and `exit_interpreter/1` |
| `content_executed` | `owner`, `cIndexes` of the block's nodes that ran | `executeBlock` (`src/core/content.ts`), an empty block included, and `runGlobalScripts` (`src/core/interpreter.ts`) with no index | `Trace.ContentExecuted`, from `Interpreter.Content.execute_block/3` and `run_global_script/3` |
| `entry_set` | `indexes` in entry order, `configuration` after the entries | `enterStates` (`src/core/exit-entry.ts`) | `Trace.EntrySet`, from `ExitEntry.enter_states/2` |
| `macrostep_stable` | `configuration` | `terminalEffects` (`src/core/interpreter.ts`), for a stable macrostep with the chart running | `Trace.MacrostepStable`, from `terminal_effects/2` |
| `done` | `donedata`, `donedataError`, `configuration` at exit | `exitInterpreter` (`src/core/interpreter.ts`), just before `done` | `Trace.Done`, from `exit_interpreter/1` |
| `invoke_pass` | `stateIndexes` walked, `invokeIds` left live | `runInvokePass` (`src/core/invoke.ts`), every time it runs | `Trace.InvokePass`, from `run_invoke_pass/1` |
| `finalize_autoforward` | `event`, `finalized`, `forwarded` | `applyInvokePasses` (`src/core/invoke.ts`), every time it runs | `Trace.FinalizeAutoforward`, from `apply_invoke_passes/2` |

Each carries the `macrostep`, `microstep` and `round` counters; an exit set
and an entry set are stamped with the counters at the boundary before any
state moves, and a selection's trace with the microstep it ran in, before the
microstep it starts, as the reference's interpreter moduledoc states. The
effects come in the reference's order relative to every other effect,
`invoke` and `autoforward` among them: an exit set or an entry set before the
moves it names, a block's trace after the block's own effects, a pass's trace
after the pass's effects, and a stable macrostep's trace after the invoke
pass that ends it.

**The trace flag.** Whether a position traces is its `trace` field, which the
exported position already carries. `start` sets it false. A drive reads it
from the state it is given and writes it back, as the reference's position
carries it from `import/2` onward, so a host turns tracing on by setting the
flag in the state it passes; no call option sets it yet.

Not ported. The reference's tenth trace, `conds_evaluated`, is emitted by its
transition selection, which this change does not touch. The reference's
`datamodel_change` for a `<send idlocation>` write, an `<invoke idlocation>`
write and an empty `<finalize>`'s writes is not emitted either: each is
answered by a site outside the ones named above. The Typespecs union gains
`DatamodelInit`, `DatamodelChange` and `Trace`; the Decision's sentence that
the core does not emit `datamodel_init`, `datamodel_change` or the trace
effects now holds only for the effects this Amendment does not name.

## Amendment: the driver runs an in-process SCXML child (2026-10-01)

Status: accepted (2026-10-02; proposed 2026-10-01)

The invoke effects Amendment above leaves running a child, and turning what it
answers into events, to the driver. This one decides how the driver does it:
the invoke types it runs and the shape of a child session. The invoke surface
matches the reference at `v2.9.0`: the SCXML type runs in process from in-line
content or a content expression, `src` is never dereferenced, and any other
type raises what the reference raises, ruled by the operator, 2026-10-01. The
change that adds this Amendment adds the code: `invoke`, `launch`,
`cancelInvocation`, `deliverToChild` and `takeMail` in `src/driver.ts`, and
`compileInvokeContent` in `src/compiler.ts`.

The invoke types the driver runs, per type:

| Invoke type | What the driver does | Reference at `v2.9.0` |
|---|---|---|
| none, `scxml`, or `http://www.w3.org/TR/scxml/` with or without its trailing slash, with content that compiles | records the id live and starts the content as a child session | `Statifier.Invoke.Handler.Scxml.start/2`, `Statifier.Invoke.Source.resolve/2` |
| the same types, with no content, a content that is not markup, or markup that does not compile | records the id live with no child and raises `error.communication` with the origin `{ kind: "invoke", stateIndex, invokeIndex }` | `Statifier.Session`'s `{:start_child, _, _}` instruction and its `invoke_error/4` |
| any other type | records nothing and raises `error.execution` with the same origin | `plan_invoke/3` in `Statifier.Session.Effects`, for a session that declared no invoke types |

The driver runs no other type, and a host registers none: the reference's
invoke handlers and declared invoke types (`Statifier.Invoke.Handler`,
`Statifier.Invoke.Types`) are not ported.

The child session:

- Its chart is the content markup compiled with the root's namespace rule
  relaxed, so a root that declares no namespace compiles as SCXML and one
  that declares another is still refused, as the reference's ADR-0042
  decides (`compileInvokeContent` in `src/compiler.ts`). `src` is never
  fetched.
- Its session id is the parent's, a dot and the invoke id. The reference
  mints a fresh id; this driver mints nothing, so the same calls answer the
  same states.
- Its datamodel is seeded with the params a root `<data>` of the child names,
  and no other, as `Statifier.Session.Invocations.seed_datamodel/2` seeds it
  (`seed` in `src/driver.ts`).
- It runs with no registered send type, and its effects are not among a
  call's effects, which are the host's session's own.
- It runs on the parent's virtual clock. Its timers fire with the parent's
  in `advance`, earliest first and, at one due time, in the order they were
  scheduled anywhere in the tree (`nextDue` in `src/driver.ts`). No timer, no
  thread and no I/O runs it: being started, an event sent to it and an
  autoforwarded event each run it to a stable configuration at once
  (`deliverToChild`).
- The routes the driver declares to the core name the session's parent when
  it has one and every live invocation's id (`routesOf` in `src/driver.ts`).
  They are declared where the reference's session stamps them (`stamp/1` and
  `init_routes/2` in `Statifier.Session`): when the session starts, when an
  input reaches it from outside - the host's event, a child's message taken
  from the mailbox, an event delivered to a child, a fired timer - and
  before a delivery onto the internal queue. An event the chart queued for
  itself is taken under the routes already declared, as the reference's
  `handle_continue(:drain, _)` takes it, so a send there judges an
  invocation by that earlier declaration. No other session is declared: the
  reference's routes also name every session its registry holds, and this
  driver runs no registry.

What passes between a parent and a child:

- A send to `#_parent` from a child delivers the event, stamped with the
  invoke id, to its parent; a send to `#_<invokeid>` naming a live invocation
  delivers it to the child; an autoforwarded event is delivered unchanged, as
  `deliver/5` and the `{:forward, _, _}` instruction in `Statifier.Session`
  deliver them. An invocation with no child takes nothing.
- What a child sends its parent waits in the parent's mailbox and is taken
  once the parent's own external queue is empty, one entry at a time, as the
  reference's session takes a message only after its own inbox drains
  (`takeMail` in `src/driver.ts`). An entry whose invocation is no longer live
  is discarded there, as `handle_continue(:drain, _)` in `Statifier.Session`
  discards it.
- A child that stops on its own first tells its parent it completed, ahead of
  everything its final batch sends (`announce_completion/3` in
  `Statifier.Session`), then returns `done.invoke.<id>` carrying its donedata,
  the invoke id and the parent's own address as its origin, as
  `Statifier.Invoke.Answer.done/4` builds it. Taking the done event retires
  the invocation.
- A `cancel_invoke` retires the invocation and stops its child with its
  active states' `<onexit>` handlers run, as `Statifier.Interpreter.cancel/1`
  does (`cancelInvocation` in `src/driver.ts`). A child that already said it
  completed is left for its done event, as `Statifier.Session.Invocations`'
  `completed?/2` leaves it.

The state. The Decision's paragraph "The state is a plain JSON value" names
the driver's own fields; three more join them. `invokedAs` is the invoke id a
child session runs as, null for the host's session; `invocations` lists the
live invocations in the order they started, each with the content markup its
child was compiled from and the child's own state nested in it, the same
shape as the host's; `mailbox` holds what the children sent and the session
has not taken. A state with a running child goes through JSON and steps as
the original does, and a child's field that fails to decode is named by its
path into the whole state. A position carries none of them: the reference's
resumed session rebuilds its invocation table empty, so an imported state has
no child, and a send to an invocation its position names live is refused as
unreachable.

## Amendment: the HTTP transport a host supplies (2026-10-01)

Status: accepted (2026-10-02; proposed 2026-10-01)

This package is to ship the Basic HTTP Event I/O Processor (SCXML appendix
C.2) as a built-in send processor, with a default transport, and to let a host
supply its own HTTP in place of that default, ruled by the operator,
2026-10-01. The transport is the seam between the two: the processor and a
host both code against it, so this Amendment records it ahead of the
processor, and the change that adds it adds only the types. The processor, its
default transport and the entry point they live on are not on `main` yet, and
nothing here states their code.

The reference's seam is the model: `Statifier.Send.BasicHTTP.Transport` and
its one callback, `post/3`, in `lib/statifier/send/basic_http/transport.ex`
at `v2.10.0`, decided by the reference's ADR-0075 decision 6, with the
request it is handed built by that record's decision 4 and its Amendment of
2026-09-30, and a miss routed by its decision 8, point d. The reference's
callback takes the URL, the headers and the body, makes one attempt, and
answers `{:ok, status}` for any HTTP status or `{:error, reason}` when no
response came back.

**What a transport receives.** One request, as the processor built it
(`HttpRequest` in `src/http-transport.ts`):

| Field | What it holds | Reference at `v2.10.0` |
|---|---|---|
| `method` | always `"POST"` | ADR-0075 decision 4: "the method is POST" |
| `url` | the send's target; when the body is the send's content and the send names an event, the target with `_scxmleventname` in its query string | ADR-0075 decision 4; `with_query/2` in `lib/statifier/send/basic_http.ex` |
| `headers` | name and value pairs in order, every name in lower case, `content-type` and `scxml-send-key` always among them | `post/3`'s documentation ("lower-case names, `content-type` among them"); `post/2` in `lib/statifier/send/basic_http.ex` |
| `body` | already encoded: an `application/x-www-form-urlencoded` form body, or the send's content as `text/plain` | ADR-0075 decision 4 |

The `scxml-send-key` header carries the send's deduplication key, spelled as
the reference's ADR-0075 Amendment of 2026-09-30 spells it: eight fields
joined by `/`, the same value each time the same send is performed. Delivery
is at least once, and a receiver that takes a request only when it has not
taken one with the same key takes each send once. The transport sends the
header as it is handed; it neither reads nor deduplicates on it.

The form body is encoded by the processor, by hand, and never through
`URLSearchParams`, `TextEncoder` or `Buffer`, ruled by the operator,
2026-10-01; the transport is handed a string and sends it unchanged.

**What a transport answers.** A promise that settles to one of two values
(`HttpAnswer` in `src/http-transport.ts`), and never rejects:

| Answer | When | Reference at `v2.10.0` |
|---|---|---|
| `{ kind: "status", status }` | a response came back, with any status from 100 to 599; a status outside 2xx is answered here, not as a failure | `{:ok, status}` from `post/3` |
| `{ kind: "failure", reason }` | no response came back: refused, unreachable or timed out; `reason` is the host's own words | `{:error, reason}` from `post/3` |

A failure is a value, as every failure this package answers is. A transport
makes one attempt: retrying is not its job, as the reference's
`Statifier.Send.BasicHTTP.Transport` documentation says. It bounds the
request's time itself and answers a failure when the bound passes; the
reference's default adapter does the same (ADR-0075's Consequences: "The
default adapter bounds each request with a timeout"). A transport that
rejects or throws anyway has broken this contract; the processor that calls
it reads either as a failure answer, so a host's mistake does not escape the
seam as an exception.

**How a failure reaches the chart.** The processor reads a `failure`, and a
`status` outside 2xx, as a missed delivery. It makes no second attempt and
is to report the miss through a failed-send report on the driver, which is to
raise `error.communication` (SCXML appendix C.1) for the sending chart. The
driver has no such report on `main` yet, and ADR-0003's failed-send row says
so; a later Amendment to this record will state it. The reference's
counterpart is `Statifier.Session.failed_send/3`,
reached from `post_now/2` in `lib/statifier/send/basic_http.ex` at `v2.10.0`
(ADR-0075 decision 8, point d). A status in 2xx is a delivery, and nothing
reaches the chart.

**The default transport is one implementation of it.** The default transport
reads the host's global fetch function when a send is made, not when the
package loads, and refuses by name when there is none; it lives with the
processor on an entry point of its own, so the main entry point reaches no
host global, ruled by the operator, 2026-10-01. A host that supplies a
transport supplies a value of the same `HttpTransport` type, and the processor
cannot tell the two apart.

**Where the types live.** The main entry point exports `HttpTransport`,
`HttpRequest`, `HttpAnswer`, `HttpStatus` and `HttpFailure` as types only:
they compile to nothing, so exporting them from the main entry point reaches
no host global, and a host can write its transport before the processor's own
entry point exists. `test/export-surface.test.ts` pins them by name, and
`test/http-transport.test.ts` is a trivial host transport written against
them.

Typespecs:

```ts
export interface HttpRequest {
  readonly method: "POST";
  readonly url: string;
  readonly headers: readonly (readonly [name: string, value: string])[];
  readonly body: string;
}

export interface HttpStatus {
  readonly kind: "status";
  readonly status: number;
}

export interface HttpFailure {
  readonly kind: "failure";
  readonly reason: string;
}

export type HttpAnswer = HttpStatus | HttpFailure;

export type HttpTransport = (request: HttpRequest) => Promise<HttpAnswer>;
```

Worked example. A host transport over a client of its own, here a table that
answers instead of a network, as a library's loan desk might test with:

```ts
import type { HttpAnswer, HttpTransport } from "@riddler/statifier";

const statuses: Record<string, number> = { "https://library.example/scxml/desk-1": 204 };

const transport: HttpTransport = (request) => {
  const status = statuses[request.url];
  const answer: HttpAnswer =
    status === undefined
      ? { kind: "failure", reason: `no route to ${request.url}` }
      : { kind: "status", status };
  return Promise.resolve(answer);
};
```

Handed a POST to `https://library.example/scxml/desk-1` it answers
`{ kind: "status", status: 204 }`, and the send is delivered; handed one to
any other URL it answers a failure, and the sending chart takes
`error.communication`.

## Note: the sorted sets, the refusal reasons and a stopped position (2026-10-01)

This Note decides nothing new. It names three passages above that read
inexactly against the code on `main` at `c00d227` and the reference at tag
`v2.10.0` (`c8894ae`), and says what holds.

**The sorted sets are this package's own choice.** The Determinism bullet
"Every set of states the state or the position holds is sorted by its
string", and each "sorted" in the exported position's table, state a rule the
reference does not have. The reference's `export/1` (`Statifier.Position` in
`lib/statifier/position.ex`, through its `translate_index_set/2`) answers
`configuration`, `entered_states`, `states_to_invoke` and each
`history_values` entry as a `MapSet`, which has no order. A JSON array has
one, so this package chooses it: the driver writes every list of states
sorted by its string (`names` in `src/driver.ts`, at `c00d227`), and
`exportPosition` in `src/position.ts` copies those lists. The order is not
a port of the reference's, and `importPosition` reads a list of states in
any order (`indexes` in `src/driver.ts`).

**The driver's refusal reasons are enumerated here.** The Decision's sentence
"The driver's other refusal reasons are the driver's to enumerate, and its
tests do", and the paragraph "This record asserts rules and delegates
enumeration" where it names "the driver's full set of refusal reasons", no
longer describe this record: its Typespecs list in full the reasons a call
that moves a chart refuses with, in `DriveRefused`. They are `not_running`,
`chart_mismatch`, `unencodable_value`, `invalid_duration` and
`malformed_state`, the same five the `DriveRefusal` type in `src/driver.ts`
names at `c00d227`. The tests hold the code to them.

**A stopped position carries an empty configuration.** The Decision's line
"`isDone(state)` answers whether the chart has stopped and, when it has, its
donedata and its final configuration" holds for a chart driven to its stop:
`isDone` answers the donedata and the configuration the `done` effect
carried (`DoneRecord` and `stopped` in `src/driver.ts`, at `c00d227`). It
does not hold for a state imported from a stopped position. The reference's
`exit_interpreter/1` (`lib/statifier/interpreter.ex` at `v2.10.0`) removes
each state from the configuration as it exits it and carries the
configuration at exit only in its `done` effect, and its position has no
field for either the donedata or that configuration: what says a chart has
stopped is `running` and `status`. `exitInterpreter` in
`src/core/interpreter.ts` does the same, so a stopped position's
`configuration` is empty here as there, and `importPosition` rebuilds the
stopped state from it: `isDone` on an imported stopped state answers an empty
configuration and undefined for the donedata.

The change that adds this Note says so in the doc comments of `isDone` in
`src/driver.ts` and of `importPosition` in `src/position.ts`, and adds the
datetime to the values the header comment of `src/driver.ts` says plain JSON
loses, as the paragraph on the exported position's shapes above already
names it.

## Amendment: a host reports a send it could not deliver (2026-10-01)

Status: accepted (2026-10-02; proposed 2026-10-01)

The HTTP transport Amendment above says a failed delivery is to reach the
chart "through a failed-send report on the driver", and that "a later
Amendment to this record will state it". This is that Amendment. A driver
call through which a host reports a registered send as failed, raising
`error.communication` carrying the send's id, a processor's failed delivery
mapped onto the same path, and the statifier corpus case
`send/registered_send_failed` claimed, were ruled by the operator,
2026-10-01. The change that adds this Amendment adds the code:
`reportSendFailed`, `failSend`, `isSendOrigin`, `holding` and `answer` in
`src/driver.ts`, the reporting host in `test/conformance/statifier.ts`, and
the registry entry, written by `pnpm ratchet` from the run that observed the
pass.

The reference's counterpart is `Statifier.Session.failed_send/3` in
`lib/statifier/session.ex` at `v2.10.0`, whose documentation shows the write
a host driving the pure core makes in its place:
`Statifier.Interpreter.deliver_internal/5` with `:platform`,
`"error.communication"`, the origin `{:content, send.c_index, send.owner}`
and `sendid: send.send_id` (`lib/statifier/interpreter.ex` at `v2.10.0`). The
reference's ADR-0069 decision 5 is the rule both cite.

**The call.** `reportSendFailed(chart, state, failure, opts?)` takes the
chart, a state, the failed send and the call's options, and answers what
`step` answers. The failed send is `{ send, reason? }`:

| Field | What the driver reads | Reference at `v2.10.0` |
|---|---|---|
| `send.sendId` | the event's `sendid`, whether or not the author named the send | `sendid: send.send_id` in the `{:failed_send, _, _}` clause of `handle_cast/2` in `Statifier.Session` |
| `send.cIndex`, `send.owner` | the event's origin, `{ kind: "content", cIndex, owner }`: the `<send>` that made it | `{:content, send.c_index, send.owner}` in the same clause |
| `reason` | nothing: the chart is not handed it | `failed_send/3` takes a `failure` keyword list, and its cast does not pass it on |

A handed `Send` or `SendDelayed` carries all three send fields, so a host may
pass the send as its processor was handed it; it may as well keep only those
three, which are plain JSON, and pass them later. The driver keeps no record
of the sends it handed: the Decision's paragraph on the host's send processors
already says the state keeps none "beyond the delayed sends a processor holds
for a later `<cancel>`", and the reference's session keeps none either, taking
the send itself in `failed_send/3`. So the driver reads what the host passes
and does not check it against a send it handed.

**When the event is raised.** Within the call that carries the report, as the
reference raises it within the cast that carries it. `error.communication`
joins the internal queue, the routes are declared first as before any
delivery onto the internal queue, and the chart runs to a stable
configuration; the effects that run leaves are acted on, and the session then
takes what its external queue and its mailbox hold, as `step` takes them. The
reference's clause runs `deliver_internal/6`, then `drain_deferred/1`, then
continues to `:drain`. The event is a `platform` event named
`error.communication`, with undefined data, as `deliver_internal/5`'s
`raise_platform/4` writes it.

**The refusals.** Each is a value, never a throw:

| Refusal | When | Reference at `v2.10.0` |
|---|---|---|
| `not_running` | the chart has stopped | `deliver_internal/5` answers `{:error, :not_running}` for a stopped machine state; a session halted `:done` or `:cancelled` ignores the cast. The dead letter is the host's, as `failed_send/3`'s documentation says |
| `not_a_send` | `send` has no string `sendId`, no whole non-negative `cIndex`, or no `owner` of one of the four owner kinds | none: the reference's `failed_send/3` guards on the struct type |
| `chart_mismatch`, `malformed_state`, `unencodable_value` | as for every call that moves a chart | as the Decision says |

The Note above, on the refusal reasons, lists the five reasons a call that
moves a chart refuses with; `not_a_send` is a sixth, answered by
`reportSendFailed` alone, and the `DriveRefused` below names it.

A chart whose macrostep spent its round budget is still running, so a report
reaches it, as the reference's ordinary clause takes a `:budget_exhausted`
sender; its external events still wait.

**A processor's failed delivery takes the same path.** A processor's
`deliver` may answer a `DeliveryFailure`, `{ kind: "failure", reason }`, for
a send it could not deliver. The driver calls its processors only once the
call's state is written, as the Decision says; once they have run, each send
whose `deliver` answered a failure is raised as a failed send, in the order
the sends were handed, the state is written again, and the processor calls
that run made are run the same way, before the call answers. Any other answer,
nothing included, is a send the processor took; `deliver` is typed to answer
`unknown`, so a processor written as an expression stays one. This path is
this package's own, ruled by the operator, 2026-10-01: the reference's
processor never reports a miss from `deliver/3` (the "When the host cannot
deliver" section of `Statifier.Send.Processor`'s moduledoc at `v2.10.0`). A
`deliver` that throws throws out of the call that handed the send, unchanged,
as host code that throws while this package calls it always does; the driver
does not read a throw as a failure.

One consequence of raising a failure after the state is first written: a
run that a failure starts may leave a value the state cannot write, and the
call is then refused with `unencodable_value` after the processors of the
first pass were called. A host that retries that call hands those sends again.

**The Decision's call list.** "The driver has six calls" now holds with
`reportSendFailed` beside them: it is a call that moves the chart, and takes
the chart as `start`, `step` and `advance` do.

**The corpus case.** The reference's harness reports a handed send whose
expected item says `"outcome": "fail"` through `failed_send/3` as soon as it
reads the processor's message, before it reads the configuration again
(`perform_outcome/4` and `pump/3` in `lib/mix/statifier/corpus/host_case.ex`
at `v2.10.0`), and writes `"outcome": "fail"` on that item. The runner here
reports it through `reportSendFailed` once the call that handed it returns,
before the configuration is read, and marks the item the same way; a report
refused with `not_running` is dropped, as the reference's session ignores
one. `statifier/send/registered_send_failed` passes for the reason the
reference's passes: the report raises `error.communication` carrying the
author's id `notice`, so the transition whose condition reads
`_event.sendid == 'notice'` is taken. With the item's outcome removed the
runner reports nothing and the chart rests in `notifying`, so the pass rests
on the report.

Typespecs:

```ts
function reportSendFailed(
  chart: Chart,
  state: State,
  failure: FailedSend,
  opts?: DriveOptions,
): DriveResult;

interface FailedSend {
  readonly send: Pick<SendFields, "sendId" | "cIndex" | "owner">;
  readonly reason?: string;
}

interface DeliveryFailure {
  readonly kind: "failure";
  readonly reason: string;
}

interface SendProcessor {
  readonly deliver: (send: Send | SendDelayed, event: Event) => unknown; // a DeliveryFailure fails the send
  readonly cancel?: (cancel: Cancel) => void;
}

type DriveRefused =
  | {
      ok: false;
      reason: "not_running" | "chart_mismatch" | "unencodable_value" | "invalid_duration" | "not_a_send";
    }
  | { ok: false; reason: "malformed_state"; detail: MalformedDetail };
```

Worked example. A hold notice to a patron, sent through a text-message type
the host registers:

```ts
const queued: (Send | SendDelayed)[] = [];
const sendTypes = { sms: { deliver: (send: Send | SendDelayed) => { queued.push(send); } } };
// ... the chart enters `notifying`, whose <onentry> sends id="notice" of type sms
const failed = reportSendFailed(chart, notified.state, { send: queued[0], reason: "unreachable" }, { sendTypes });
```

The chart takes `error.communication` with `_event.sendid` `"notice"` and
`_event.type` `"platform"`, and a transition that reads
`_event.sendid == 'notice'` is taken within the call. The README's registered
send types section runs the same example to its configuration.

## Amendment: the accepts check (2026-10-01)

Status: accepted (2026-10-02; proposed 2026-10-01)

A host that declares which events a chart accepts - the events it will send,
or the names a publish promises a receiver - has no way, from the Decision, to
learn that the chart can never react to one of them, or that the chart reacts
to a name the declaration leaves out. The reference answers both with
`Statifier.Chart.check_accepts/2` (`lib/statifier/chart.ex` at `v2.10.0`),
over the chart's event vocabulary, `Statifier.Chart.events/1` in the same
file. Porting it as a public `checkAccepts(chart, declaredEvents)` answering
`{ unreachable, undeclared }` with the reference's semantics, and claiming the
statifier corpus case that carries it, were ruled by the operator,
2026-10-01. The change that adds this Amendment adds the code: `checkAccepts`
and `vocabulary` in `src/accepts.ts`, exported from `src/index.ts` with its
answer's type, and `compareAccepts` in `test/conformance/statifier.ts`, with
the registry entry written by `pnpm ratchet` from the run that observed the
pass.

**What it answers.** `checkAccepts(chart, declaredEvents)` takes a compiled
chart and the declared names, and answers two lists:

| List | What it holds | Reference at `v2.10.0` |
|---|---|---|
| `unreachable` | each declared name no descriptor in the vocabulary matches, in the declaration's order and without duplicates | the `unreachable:` comprehension of `check_accepts/2` over `Enum.uniq(declared)` |
| `undeclared` | each descriptor in the vocabulary that matches no declared name, in the vocabulary's order | the `undeclared:` comprehension of `check_accepts/2` |

A descriptor matches a declared name under transition selection's matching,
on token boundaries: `nameMatch` and `tokenize` in `src/core/selection.ts`,
the port of `Statifier.Interpreter.NameMatch`. A declared `loan.renew` is
matched by `loan.renew`, `loan.*`, `loan.`, `loan` and `*`, and not by
`loan.renewal` or `loan.renew.late`. A declared entry is a name, never a
pattern: a `*` in it is an ordinary token. An empty list answers no
unreachable name and the whole vocabulary as undeclared; `null`, no
declaration, answers two empty lists, as the reference answers `nil`. The
check reports and refuses nothing: which list a host refuses a publish on, if
either, is the host's decision, as the `check_accepts/2` documentation says.

**The vocabulary.** The descriptors on the transitions of every state that can
be active, history pseudo-states left out, each as the document writes it, in
transition index order (a state's own transitions before its children's, as
the compiler numbers them), a descriptor equal as a string to one already
listed dropped: the reference's `events/1`. "Can be active" is the static
entry rule of `events/1`'s documentation, ported as `enteredStates` in
`src/accepts.ts` from the reference's private `entered_states/1`: the root
entered by its default; a state entered by its default enters its `initial`
states, every region of a parallel state, or a history's default
transition's targets; a state entered as a target is entered by its default
with each of its proper ancestors, and a parallel ancestor's regions that hold
no target are entered by their defaults; every transition of an entered state
enters its targets. No `cond` and no `event` is read, so the rule over-counts
and never under-counts.

**The vocabulary is not exported.** The reference's `events/1` is public;
here the check is the one question asked of the vocabulary, and it already
answers it: `checkAccepts(chart, []).undeclared` is the whole vocabulary, and
`checkAccepts(chart, [n]).unreachable` is empty exactly when some reachable
descriptor matches `n`, the membership answer the reference's documentation
gives. A second public name answering the same list would add surface the
first release then keeps.

**Where it differs from the reference, and why.**

| Here | Reference at `v2.10.0` | Why |
|---|---|---|
| takes a `Chart` and reads only its `machine` | takes a `%Statifier.Machine{}` | a host here holds a `Chart`, the identity lives on that wrapper (the Decision), and the check reads neither the identity nor the source, as the reference's reads neither |
| `null` for no declaration | `nil` | an absent value is `null` here where the reference has `nil` (the header of `src/machine.ts`) |

**It is not a driver call.** It takes no state and moves nothing, so "The
driver has six calls" holds unchanged, as `compile` beside them takes no state
either.

**The corpus case.** The reference's harness calls `check_accepts/2` on the
compiled chart with the case's `declared_events` before it starts the case,
and the case agrees only when both lists are exactly `expect_accepts`', order
included; either key without the other is a disagreement (`accepts/2` in
`lib/mix/statifier/corpus/host_case.ex` at `v2.10.0`). `compareAccepts` in
`test/conformance/statifier.ts` makes the same comparison at the same point,
and `statifier/accepts/loan_declares_an_unreachable_event` passes for the
reason the reference's passes: the declared `loan.archived` is on no
transition of the loan chart, so it is unreachable, and the five descriptors
the declaration leaves out come back in the vocabulary's order. With the
expected `undeclared` reversed, or with the declaration widened to every name
the chart listens for, the case fails on the check, so the pass rests on it.

Typespecs:

```ts
function checkAccepts(chart: Chart, declaredEvents: readonly string[] | null): AcceptsCheck;

interface AcceptsCheck {
  readonly unreachable: readonly string[];
  readonly undeclared: readonly string[];
}
```

Worked example. A loan chart whose `active` state listens for `copy.returned`
and `copy.disputed`, with `on_loan` inside it listening for `loan.renew`,
`loan.due_soon` and `loan.due`, `overdue` for `loan.lost` and
`held_for_review` for `dispute.resolved` (the corpus's
`library/loan_dispute_returns_to_history.scxml`):

```ts
const declared = ["loan.renew", "copy.returned", "loan.archived"];
checkAccepts(chart, declared);
// {
//   unreachable: ["loan.archived"],
//   undeclared: ["copy.disputed", "loan.due_soon", "loan.due", "loan.lost", "dispute.resolved"],
// }
```

`loan.archived` is on no transition, so a host that sends it reaches nothing;
`copy.disputed` and the four after it are names the chart reacts to that the
declaration does not state, `active`'s own descriptor first because a state's
own transitions are numbered before its children's.

## Amendment: the Basic HTTP processor (2026-10-01)

Status: accepted (2026-10-02; proposed 2026-10-01)

The HTTP transport Amendment above records the seam ahead of the processor.
This Amendment records the processor. A built-in Basic HTTP Event I/O
Processor (SCXML appendix C.2) with the reference's wire shape - the form
body, the `scxml-send-key` deduplication header, at-least-once delivery and
the `_ioprocessors` entries - was ruled by the operator, 2026-10-01, and so
were the four constraints for the JavaScript engine React Native uses: the
default transport reads the global fetch function lazily, when a send is
made, refuses by name when it is absent, and lives on an entry point of its
own, so the main entry point keeps its rule of reaching no host global; the
form body is encoded by hand, never through `URLSearchParams`, `TextEncoder`
or `Buffer`; the engine proof drives the Basic HTTP cases through the
conformance runner's loopback by way of the transport seam, and says it
proves the processor's logic on that engine, not a network round trip on a
device; and on a device the processor sends only, while an inbound decode
helper serves a host that runs a server.

The change that adds this Amendment adds the code: `basicHttp`, `requestFor`
and `sendKey` in `src/basichttp/processor.ts`, `fetchTransport` in
`src/basichttp/fetch-transport.ts`, `decodeRequest` in
`src/basichttp/decode.ts`, the hand encoder and decoder in
`src/basichttp/encoding.ts`, the entry point `src/basichttp/index.ts` named
`./basichttp` in `package.json`'s exports map and in `tsup.config.ts`'s entry
list, `ProcessorContext`, `entriesOf` and `holding` in `src/driver.ts`, and
`systemVariables` in `src/datamodel.ts`. The corpus cases that name the
processor are not claimed here: the loopback that drives them, and the claims,
are a later change's.

The reference is `Statifier.Send.BasicHTTP` in
`lib/statifier/send/basic_http.ex`, its transport behaviour in
`lib/statifier/send/basic_http/transport.ex` and its default adapter in
`lib/statifier/send/basic_http/transport/httpc.ex`, all at `v2.10.0`
(`c8894ae`), under the reference's ADR-0075 and that record's Amendment of
2026-09-30, both at proposed at that tag.

**The wire shape, decision by decision.** Each row is a decision of the
reference's ADR-0075 at `v2.10.0` and what this package does with it:

| Reference decision | What this package does | Where |
|---|---|---|
| 2: two type strings, the processor URI and `basichttp` | the same: `basicHttp` answers `sendTypes` naming the one processor under both | `basicHttp` in `src/basichttp/processor.ts` |
| 3: an entry under each registered string, both with `"location"` = base URL, `/`, `_sessionid`, through an optional `ioprocessors_entry/2` | the same entry, through an optional `ioprocessorsEntry` on a send processor (decision (d) below) | `ioprocessorsEntry` in `basicHttp`; `entriesOf` in `src/driver.ts` |
| 4: `event` as `_scxmleventname`, each `namelist` entry and `<param>` a form parameter, POST, a form body by default | the same; a map's names follow the event name in code point order, the order the reference's runtime lists a small map's string keys in | `requestFor` in `src/basichttp/processor.ts` |
| 4: a `<content>` body as `text/plain`, the event name in the target's query string | the same, joined with `&` when the target already has a query string, as the reference's `with_query/2` joins it | `requestFor` |
| 4: data's shape decides - a map is form-encoded, no data sends `_scxmleventname` alone, any other value is the body | the same | `requestFor` |
| 4: no target plans C.2.2's `error.communication` in `deliver/3`, carrying the send id, and makes no request | `deliver` answers a `DeliveryFailure`, which the driver raises as a failed send carrying the send id (decision (c) below) | `basicHttp` |
| 4: a value written as text - a string as it is, nil as `null`, undefined as the empty string, a number or a boolean as its literal | the same, a float spelled as the reference's runtime spells one through `float_to_binary/2` with `short`: the shortest digits that read back, in scientific notation at a magnitude of 2^53 or more, and below that in decimal or scientific, whichever is shorter, decimal on a tie; pinned by a table of the reference's own outputs, which samples the 2^53 boundary and magnitudes up to 1e18 | `encodeValue` and `floatText` in `src/basichttp/encoding.ts`; `test/basichttp-encoding.test.ts` |
| 4: the form body is `URI.encode_query(pairs, :www_form)` | encoded by hand to the same bytes: UTF-8, the unreserved set kept, a space as `+` | `encodeForm` in `src/basichttp/encoding.ts` |
| 5: a pure decoder; the first `_scxmleventname`, query before body, else `HTTP.` and the method; other form values through the text rung; `405` for a method that is not POST, `400` for any other error | `decodeRequest` answers the event a front passes to `step`, or a refusal value the front maps to the same status | `decodeRequest` in `src/basichttp/decode.ts` |
| 6: a transport behaviour with one callback and a default on the runtime's own HTTP client, bounded by a timeout | `HttpTransport`, now an object with one `post` (decision (a) below), and `fetchTransport` on the global fetch, bounded at five seconds where the host has an abort controller and timers | `fetchTransport` in `src/basichttp/fetch-transport.ts` |
| 8, point d: one attempt; an error or a status outside 2xx reported through `failed_send/3` | one attempt; the miss handed to the host's `report` with the sending session's id, for `reportSendFailed` (decision (c) below) | `basicHttp` |
| Amendment 2026-09-30: `scxml-send-key`, eight fields joined by `/`, the session scope and the send id escaped outside the unreserved set, the owner as `onentry.S.B`, `onexit.S.B`, `finalize.S.B` or `transition.T`, an absent field empty | the same, the session scope being the session's id | `sendKey` in `src/basichttp/processor.ts` |
| Amendment 2026-09-30: at-least-once, the receiver deduplicates; the decoder checks the header and sets no event field from it | the same; a value that is not eight fields whose second decodes to text is refused `malformed_send_key` | `sendKey`; `decodeRequest` |

**Decision (a): the transport is an object with a `post` method.** The seam
the HTTP transport Amendment above records was a bare function type. It is
now `interface HttpTransport { readonly post: (request: HttpRequest) =>
Promise<HttpAnswer> }`, and the typespec line in that Amendment,
`export type HttpTransport = (request: HttpRequest) => Promise<HttpAnswer>;`,
is read as amended by this one. The basis: the reference's seam is a
behaviour with one callback, `post/3`, which a module implements, and an
object with one method is the closer shape; and an object can gain a member
later, such as an abort or a close, by addition, which a function type
cannot. The package is unpublished, so no host has coded against the
function shape.

**Decision (b): a transport that throws or rejects is a miss.** The
processor reads a `post` that throws, or whose promise rejects, as a failure
whose reason is `transport_threw: ` and what was thrown, as text, and hands it
to `report` like any other miss. The HTTP transport Amendment above already
says the processor reads either as a failure answer; this records the basis
as a declared divergence from the reference, whose `post_now/2` has no rescue,
so a raising adapter propagates out of `perform/2`. Two rules of this package
bear on it. Errors are values. And host code that throws while this package
calls it propagates unchanged - which governs a call the host made and is
still waiting on. The request is made after the call that handed the send
has returned (decision (c)), so no host call is on the stack when the
transport throws: propagating it would leave a rejected promise that nothing
awaits. Reporting it as a miss is the one way it reaches the host and the
chart.

**Decision (c): a miss after the handing call reaches the chart through the
host.** The driver keeps no state between calls, so a processor whose
transport answers after the handing call has returned cannot reach the
chart's current state itself. `basicHttp` therefore takes a `report`
function, and hands it each miss as a `ReportedSendFailure`: the sending
session's id, the send's `sendId`, `cIndex` and `owner`, and a reason. The
host keys its states by that session id and calls `reportSendFailed` with the
state it holds for the session now; the failed-send Amendment above says what
that call raises. A reason is the transport's own words for a failure,
`http_status` and the status for a status outside 2xx, `transport_threw:` and
what was thrown, `invalid_target` for a target that is not text, and
`timer_unavailable` for a delayed send with no timer to hold it.

The request is made on a later turn of the engine's job queue than the call
that handed the send, and its miss is never answered from `deliver`. So a
chart that sends again on every `error.communication` makes one request per
report the host passes back, and its loop runs through the host, one call at a
time; it never loops inside one driver call. The one failure `deliver` answers
within the handing call is a send with no target, which SCXML appendix C.2.2
requires on the sender's internal queue and the reference raises from the
`deliver/3` plan itself; a chart that answers that failure by sending again
with no target loops within the call, as the same chart would in the
reference's session. A delivery is a `Promise` that `deliver` answers and the
driver does not wait for; a host that calls `deliver` itself may await it to
know the request was made and any miss reported. `report`'s answer is not
read, and a throw from it is not caught.

**Decision (d): a processor supplies its own `_ioprocessors` entry.** A send
processor gains an optional member, `ioprocessorsEntry(type, context)`, the
analogue of the reference's optional `ioprocessors_entry/2`: when a session
starts, the driver asks each registered type's processor that has one for its
entry, with the type string and a `ProcessorContext` carrying the session's
id, and `systemVariables` writes it under that type in place of the empty
entry a processor without the member still gets. The entries are written once,
at the start, and a resumed state reads the ones it started with, as before.
`basicHttp`'s processor answers `{ location: baseUrl + "/" + sessionId }`
under both its strings. The same context is handed to `deliver` as a third
argument and to `cancel` as a second, as the reference's plan context carries
`session_id` to `deliver/3` and `cancel/2`: the processor needs the session's
id for the deduplication key's first field, for the report, and to keep two
sessions' delayed sends apart. A processor written with fewer parameters is
still a processor. The entry hook is asked while the starting state is
built, so a start the driver then refuses may already have asked it; it is
not held until the state is written, as `deliver` and `cancel` are.

**Further divergences from the reference, each declared.**

| Case | Reference at `v2.10.0` | This package | Basis |
|---|---|---|---|
| A delayed send | a timer process `perform/2` starts; at fire time it posts only while the session is running | held on the global timer under the session's id and the send id; a `<cancel>` clears it; at fire time it posts | the processor cannot see whether a session is running; a report for a stopped chart is refused `not_running` by `reportSendFailed`, so the dead letter is the host's, as the reference's documentation leaves it |
| No global timer | not a case on that runtime | the delayed send is reported `timer_unavailable` | a host global absent is answered as a value, as the default transport answers a missing fetch |
| A target that is not text | a raise, in the plan or in the adapter | reported `invalid_target`, and no request is made | errors are values |
| A list, a map, a date, a datetime or a duration as a parameter value | written in the reference's language's inspect form; its ADR-0075 decision 9 leaves the encoding undecided | written as predicator's tagged-value text | the text this package already writes every value in; the reference's form is not a text another runtime reads |
| A lone surrogate in a value | not representable in the reference's strings | written as the replacement character | what a platform encoder writes |
| An inbound event's `origintype` | the processor URI | not carried: `step` takes a host event's name and data only | `HostEvent` has no field for it; carrying it is a change to `step` this change does not make |
| An inbound decode error | an error tuple | a refusal value with the same reason token: `method_not_allowed`, `not_utf8`, `malformed_send_key` | errors are values |

**A consequence for the corpus.** The driver calls a processor once the
call's state is written, after the run has taken its external queue, and
raises a failure `deliver` answered only then (the failed-send Amendment
above). In the reference the `error.communication` a send with no target
plans joins the internal queue within the step that sent it. A chart that
sends itself an event and then a Basic HTTP send with no target, in one
block, therefore takes the event first here and the `error.communication`
first there; the W3C case that asserts the reference's order is not
claimable through this processor until the driver raises such a failure
within the run. That is the driver's to change, and a later change's.

Typespecs:

```ts
// @riddler/statifier
export interface ProcessorContext {
  readonly sessionId: string;
}

export interface SendProcessor {
  readonly deliver: (send: Send | SendDelayed, event: Event, context: ProcessorContext) => unknown;
  readonly cancel?: (cancel: Cancel, context: ProcessorContext) => void;
  readonly ioprocessorsEntry?: (
    type: string,
    context: ProcessorContext,
  ) => Readonly<Record<string, Value>>;
}

export interface HttpTransport {
  readonly post: (request: HttpRequest) => Promise<HttpAnswer>;
}

// @riddler/statifier/basichttp
export const BASIC_HTTP_EVENT_PROCESSOR: "http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor";

export interface BasicHttpOptions {
  readonly baseUrl: string;
  readonly report: (failure: ReportedSendFailure) => void;
  readonly transport?: HttpTransport;
}

export interface ReportedSendFailure extends FailedSend {
  readonly sessionId: string;
  readonly reason: string;
}

export type BasicHttpRefusal = "missing_base_url" | "missing_report" | "invalid_transport";

export type BasicHttpResult =
  | { readonly ok: true; readonly processor: SendProcessor; readonly sendTypes: SendProcessors }
  | { readonly ok: false; readonly reason: BasicHttpRefusal };

export function basicHttp(options: BasicHttpOptions): BasicHttpResult;

export interface FetchTransportOptions {
  readonly timeoutMs?: number;
}

export function fetchTransport(options?: FetchTransportOptions): HttpTransport;

export interface InboundRequest {
  readonly method: string;
  readonly contentType: string | null;
  readonly body: string;
  readonly query: string | null;
  readonly sendKey?: string | null;
}

export type DecodeRefused =
  | { readonly ok: false; readonly reason: "method_not_allowed"; readonly method: string }
  | { readonly ok: false; readonly reason: "not_utf8"; readonly part: "query" | "body" }
  | { readonly ok: false; readonly reason: "malformed_send_key"; readonly value: string };

export type DecodeResult = { readonly ok: true; readonly event: HostEvent } | DecodeRefused;

export function decodeRequest(request: InboundRequest): DecodeResult;
```

Worked example. A branch posts a patron's hold notice to the loan desk, and a
desk that answers 503 sends the chart to `notice_failed`:

```ts
import { reportSendFailed, start, step, type State } from "@riddler/statifier";
import { basicHttp } from "@riddler/statifier/basichttp";

const states = new Map<string, State>();
const http = basicHttp({
  baseUrl: "https://library.example/scxml",
  report: (failure) => {
    const state = states.get(failure.sessionId);
    if (state === undefined) return;
    const moved = reportSendFailed(chart, state, failure, { sendTypes });
    if (moved.ok) states.set(failure.sessionId, moved.state);
  },
});
if (!http.ok) throw new Error(http.reason);
const sendTypes = http.sendTypes;
// ... start "branch-7"; on `copy.available` the chart's <onentry> sends
// id="notice" event="hold.ready" type="basichttp" to the desk with the
// params copy="book-17", patron="ada" and renewals=2
```

The desk is handed one POST with the body
`_scxmleventname=hold.ready&copy=book-17&patron=ada&renewals=2` and the header
`scxml-send-key: branch-7/notice/2/1/0/2/onentry.2.0/1`, and the chart's
`_ioprocessors['basichttp'].location` reads
`https://library.example/scxml/branch-7`. When the desk answers 503, `report`
is handed `{ sessionId: "branch-7", send: { sendId: "notice", ... }, reason:
"http_status 503" }`, and the `reportSendFailed` it makes moves the chart to
`notice_failed`. `test/basichttp.test.ts` drives the same chart.

## Amendment: a failure `deliver` answers is raised within the run that handed the send (2026-10-01)

Status: accepted (2026-10-02; proposed 2026-10-01)

The failed-send Amendment above raises a failure a processor's `deliver`
answers only once the processors have been called, after the run that handed
the send has taken its external queue. The Basic HTTP processor Amendment
above records what that costs: a send with no target fails after the events
the same run sent the session itself, where the reference raises it ahead of
them, and the W3C case that asserts the reference's order is not claimable
through the processor "until the driver raises such a failure within the
run". This Amendment records that change. The change that adds it changes
`handOff`, `holding`, `held` and `failSend` in `src/driver.ts`, adds `drive`,
`madeUntilFailure` and `sendFailure` there in place of `answer`, adds
`recordedDraws`, `systemInstant` and `systemRandom` there and `Draws`,
`withDraws` and `drawOptions` in `src/datamodel.ts`, passes the pinned draws
from `evaluate` and `runProgram` in `src/datamodel.ts`, `textData` in
`src/core/send.ts` and `inlineValue` in `src/compiler.ts`, and adds the
tests in `test/driver-failed-send.test.ts` and `test/basichttp.test.ts`.

**When the failure is raised.** A failure `deliver` answers is raised at the
send's place in the run that handed it: `error.communication` joins the
internal queue when the send is handed, its origin the send's content and its
`sendid` the send's id whether or not the author named it, and the chart runs
to a stable configuration there, as for a send the driver cannot route; the
effects that leaves are acted on after the rest of the batch the send came
in, and the run then takes its external queue. An event the same block sent
the session itself is therefore taken after the failure, not before it. The
event is the one `reportSendFailed` raises; only its timing changes.

The reference at `v2.10.0` (`c8894ae`): the Basic HTTP processor's
`deliver/3` (`lib/statifier/send/basic_http.ex`) plans a send with no target
as `{:raise, :platform, "error.communication", {:content, send.c_index,
send.owner}, sendid: send.send_id}`; `Statifier.Session.Effects.plan/2`
(`lib/statifier/session/effects.ex`) calls `deliver/3` while it plans the
batch; `perform_batch/3` in `lib/statifier/session.ex` performs the planned
instructions in order, and `perform_instruction/3`'s `{:raise, ...}` clause
reaches `deliver_internal/6` there, which runs
`Statifier.Interpreter.deliver_internal/5` at that instruction's place and
queues the effects it answers for `drain_deferred/1`. A send to the session
itself is planned as `{:enqueue_event, event}`, which `perform_instruction/3`
puts on the session's inbox, taken only once the step is done.

**A refused call still hands a processor nothing.** The Decision's rule that
the processors are called only once the call's state is written stands. To
raise a failure where the send was handed while keeping it, the driver makes
the call's run, writes its state and makes the calls the run held, in order;
when one answers a failure it makes no later one, since the run that held
them is not the call's run, and makes the run again from the call's own
arguments. A call an earlier run already made is answered from what it
answered then and not made again, the failure is raised at its send, and the
calls held past it are made the same way. Besides the call's arguments and
the processors' answers, a run reads the clock and the random source through
the expressions it evaluates: `Date.now()`, a relative date, and
`Math.random()`. The driver call pins both for all its runs: the first run to
reach a draw takes it from predicator's own clock or random source, and every
run made again reads the same draws in the same order, passed to predicator as
its `now` and `random` options. So the run is the same up to the failure each
time, and each send the call's final run hands is handed to its processor
once, carrying what it was handed with; a `cancel` is told once the same way.
Two separate driver calls read the clock and draw afresh, as before. A processor's
`ioprocessorsEntry` is asked once per type and session within a call, however
often its run is made. A call whose runs meet n failures makes its run n + 1
times.

The one exception is the failed-send Amendment's own consequence, unchanged
in kind: a run made again after a failure may leave a value the state cannot
write, and the call is then refused with `unencodable_value` after the
processor calls made before that failure. A host that retries that call hands
those sends again.

**The failed-send Amendment's ordering sentence.** Its sentence that "once
they have run, each send whose `deliver` answered a failure is raised as a
failed send, in the order the sends were handed, the state is written again,
and the processor calls that run made are run the same way" is read as
amended by this one: each failure is raised at its send's place in the run.
Its statement that "the reference's processor never reports a miss from
`deliver/3`" holds for a miss a processor learns while performing; a failure
known when the send is planned, which the reference's `deliver/3` plans as a
`{:raise, ...}` instruction, is the counterpart of a `DeliveryFailure` here.

**A chart that sends again on every failure.** A chart that answers a
failure `deliver` answers by sending again to a processor that fails it again
still does not return from the call: each failure makes the run again, one
send further, without end. This change does not bound it, and the round
budget does not: `deliverInternal` in `src/driver.ts` starts the budget afresh
for each raised event, as `Statifier.Interpreter.deliver_internal/5` does
through `main_event_loop/1` (`lib/statifier/interpreter.ex` at `v2.10.0`), so
no budget spans the raises in either implementation. In the reference the
same chart keeps its session in `drain_deferred/1`, one raise after another;
that reading is of the code, not of a run. Whether to bound the loop, and how
the refusal would read, stays open.

**The Basic HTTP processor Amendment's loop sentence.** Its sentence that a
chart answering the no-target failure by sending again with no target "loops
within the call, as the same chart would in the reference's session" is read
as amended by this one: the loop is within the call, one run of it per
failure as the paragraph above says, and the reference's session loops within
the step that sent it, in `drain_deferred/1`; neither applies a round budget
across the raises.

**The corpus.** `w3c/test577`, driven through `basicHttp` with a transport
that records requests and makes none, now rests in `pass`: the processor's
no-target failure is taken before `event1`, which the same block sent the
session itself, and no request is made, which is the reason the reference's
harness passes it (`with_event_io_processors/2` in
`lib/mix/statifier/corpus/host_case.ex` at `v2.10.0` registers the processor
over a loopback front). Before this change the chart took `event1` first and
rested in `fail`. The case is not claimed here: the runner registers no
processor, and the loopback that drives the Basic HTTP cases, and their
claims, are a later change's.

## Note: what the Machine's stability reaches, and what else holds on `main` (2026-10-01)

This Note decides nothing new. It names passages above that read inexactly
against the code on `main` at `251d4c6` and the reference at tag `v2.10.0`
(`c8894ae`), and says what holds.

**The stability sentence does not reach an exported type.** The
Machine-stability Amendment's sentence "no version promises any member of
`Machine` or of the types it holds" reaches, read literally, two types the
main entry point exports in their own right: `Location` (`src/xml/parser.ts`),
the span every `CompileError` variant carries as its `location`, and
`StateKind` (`src/document/scxml.ts`), which `ValidationError` variants carry.
Both are reached by what `compile` answers, and `compile` is one of the
driver's calls the Decision's stable surface names;
`test/export-surface.test.ts` names both among the types a compile error
reaches. The sentence is read as
reaching only the types `Machine` holds that `src/index.ts` does not export
by name - its compiled states, transitions, data, blocks, content nodes and
expressions, in `src/machine.ts` and the modules it imports. What this
contract promises of `Location` and `StateKind`, it promises through the
compile errors, and that Amendment does not withdraw it. `AttributeLocations`,
which `Machine` also holds, is not exported from the main entry point at
`251d4c6`, so the sentence reaches it as written.

**Two decisions that Amendment adds stay open for its acceptance.** It
decides that a release fixes `Machine`'s shape only by an Amendment to this
record that names the members it promises, and that a change to `Machine` is
not a breaking change to this contract. Both agree with the Decision's
paragraph "The `Machine` type is opaque and unstable" and with the
Consequences' sentence "Declaring `Machine` opaque leaves the compiler free to
change it", and each says more than "opaque and unstable". This Note does not
confirm them: they are recorded as decisions to be read when that Amendment
is accepted.

**A send the declared routes refuse is the core's.** The invoke effects
Amendment's paragraph "What stays with the driver." says an
`error.communication` about an invocation is raised by the reference's
session and its invoke handlers, not its core. That holds other than for a
send the declared routes refuse: an immediate send of the SCXML type whose
target is an invocation the declared routes do not name stops its block and
raises `error.communication` in the core here (`unreachableReason` and
`executeSend` in `src/core/send.ts`), as the reference's core raises it
(`reject_reason/4` and `unreachable?/3` in `Statifier.Machine.Content.Send`,
`lib/statifier/machine/content/send.ex`). The child-session Amendment's
routes bullet says where the routes are declared.

**The passes' trace effects are emitted.** The invoke effects Amendment's
words "nor the trace and datamodel effects the passes emit" hold now for the
datamodel effects only. The datamodel and trace effects Amendment emits
`invoke_pass` from `runInvokePass` and `finalize_autoforward` from
`applyInvokePasses` (`src/core/invoke.ts`); the `datamodel_change` the
reference answers for an `<invoke idlocation>` write and for an empty
`<finalize>`'s writes is still not emitted, as that Amendment's "Not ported"
paragraph says.

**A failed `<if>` or `<foreach>` answers none of its nodes' effects.** The
datamodel and trace effects Amendment's sentence "A write that is refused, a
binding that fails, and a root `<data>` whose id the host supplied answer no
`datamodel_change`" leaves out one more: an `<assign>` that lands inside an
`<if>` partition or a `<foreach>` body that then fails answers no
`datamodel_change`, though its write is kept. The record does not state the
rule behind it: a composite that fails drops every effect its nodes answered
before the failure - a `log`, a `send`, a `send_delayed`, a `cancel` and a
`datamodel_change` alike - and keeps what they wrote to the datamodel and the
send state (`discardOnFailure` in `src/core/content.ts`). The reference's
composites answer the same: a failing partition or body answers its error
with the context but none of the effects it gathered (`run_partition/2` in
`Statifier.Machine.Content.If`, `lib/statifier/machine/content/if.ex`, and
`run_loop/3` and `run_content/2` in `Statifier.Machine.Content.Foreach`,
`lib/statifier/machine/content/foreach.ex`).

**The id that stays live with no child.** The child-session Amendment's
invoke-type table, second row, cites `Statifier.Session`'s `{:start_child, _,
_}` instruction and its `invoke_error/4` for an id recorded live with no
child. Those raise the `error.communication` and write no table entry, as
their own comments say. The entry that keeps the id live is written earlier,
by the `perform_instruction({:notify, {:invoke, _}}, _, _)` clause in
`lib/statifier/session.ex`, for a type the session's invoke types register;
that clause is the anchor for the row's "records the id live".

**The routes are also declared when a state is decoded.** The child-session
Amendment's routes bullet lists where the driver declares a session's routes.
`decodeState` in `src/driver.ts` also declares them, for the host's session
and every child, as it decodes the state a call is handed. That declaration
is the one the session's own state already gives, and a call that drives the
session declares it again at the points the bullet lists before an input
from outside is taken (`stamp` in `step`, `advance`, `deliverInternal`,
`deliverToChild` and `takeMail`), so on a reading of the code it changes no
behaviour. The change that adds this Note names it in the header comment of
`src/driver.ts`, and corrects the comment on `SendState`'s `routes` in
`src/core/send.ts`, which said the routes are stamped before each drive:
they are declared at the points the header lists, and an event the chart
queued for itself is taken under the routes already declared.

**When a processor is called.** The failed-send Amendment says the driver
calls its processors only once the call's state is written "as the Decision
says", and the in-run-failure Amendment speaks of "The Decision's rule"; the
Decision's paragraph "The host's send processors are passed on every call,
never stored" does not say when. What holds, as the in-run-failure Amendment
states it: a processor's `deliver` and `cancel` are called only once the
call's run has ended and its state has encoded, in the order the run made the
calls, so a call its first run leaves refused hands a processor nothing, and
the one refusal that can follow a processor call is the one that Amendment
names, a run made again after a failure that leaves a value the state cannot
write; a failure a `deliver` answers is raised within the run, at the send's
place, by making the run again from the call's own arguments with the call's
pinned clock and random draws, and a call made in an earlier run is answered
from what it answered then, not made again (`drive` and `madeUntilFailure` in
`src/driver.ts`). A processor's `ioprocessorsEntry` is the one member asked
before the state is written, as the Basic HTTP processor Amendment's decision
(d) says.

## Note: the validation error type names (2026-10-01)

This Note records a naming decision for two types the main entry point
exports; it changes no behaviour. Read against `main` at `248c5b6`.

**The validator's two generic type names are renamed before the first
release fixes them** (ruled by the operator, 2026-10-01). At `248c5b6`,
`src/validator.ts` declares `ErrorOf`, the type of one validation refusal,
and `Empty`, the detail of a validation reason that carries none, and
`src/index.ts` exports both, as types only, among the types a compile error
reaches. The change that adds this Note renames them:

| Was | Is | What it is |
|---|---|---|
| `ErrorOf<R, D>` | `ValidationErrorOf<R, D>` | one validation refusal: reason `R`, message, location and detail `D` |
| `Empty` | `ValidationNoDetail` | the detail of a validation reason that carries none beyond its location |

The reason: neither old name says which stage it belongs to. The lowering
stage already names its own refusal `LoweringErrorOf` (`src/lowering.ts`),
so `ValidationErrorOf` is that name's sibling, and `ValidationNoDetail`
carries the same stage prefix and says what the type holds. Both are public
names once a version is published, so a later rename would break a host
that names them; the package has published no version, so this one breaks
none. `ValidationError` itself, the union a host narrows, is unchanged.

**The four roots are pinned with the compile error types.**
`CompileErrorTypes` in `test/export-surface.test.ts` now also names
`CompileResult`, `CompileOptions`, `Chart` and `ChartIdentity` through the
entry point, so dropping one of those exports fails the typecheck as
dropping a compile error type does.

**The two `ParseError` names stay.** This package's `ParseError`
(`src/xml/parser.ts`) is the XML parser's refusal; `@riddler/predicator`
exports a `ParseError` of its own, the expression parser's, which a
`CompilerError` carries as its `error`. Neither is renamed. A host that
imports both renames one at the import, as `src/compiler.ts` does
(`ParseError as ExpressionParseError`); the TSDoc on `ParseError` and the
README say so.

## Amendment: a child inherits the host's send types and observers when a call asks (2026-10-01)

Status: accepted (2026-10-02; proposed 2026-10-01)

The child-session Amendment above says a child session "runs with no
registered send type, and its effects are not among a call's effects, which
are the host's session's own." This Amendment keeps that as the default and
supersedes it, add-only, for a call that opts in: inheritance is opt-in on
the invoking session and off by default, as the reference's session options
are, ruled by the operator, 2026-10-01. The change that adds this Amendment
adds the options `inheritSendTypes` and `inheritObservers` to `DriveOptions`,
the types `ChildEffect` and `DriveEffect`, and `inheritanceOf` and
`inheritedBy` in `src/driver.ts`; changes `launch`, `invoke`, `perform`,
`open`, `decodeInvocation` and `decodeState` there; exports both types from
`src/index.ts`; and adds the tests in `test/driver-child-inherits.test.ts`.

The reference at `v2.10.0` (`c8894ae`), `lib/statifier/session.ex`:
`start_session/4` starts an invocation's child with the options
`inherited_observer_opts/1` and `inherited_send_type_opts/1` answer. Each
answers none while the session's flag is false, the default the session's
state struct gives `inherit_observers` and `inherit_send_types`. With
`inherit_send_types` true, the child is started with the session's
`send_types` map and the flag; with `inherit_observers` true, with the
session's `trace`, its subscribers as they stand, and the flag. The flag
passes on, so one opt-in at the root reaches the whole invoke tree.
`start_link/2`'s documentation of `:inherit_observers` says each inherited
subscriber receives the child's messages under the child's own session id.

The options, per option:

| Option | Absent or false | True | Reference at `v2.10.0` |
|---|---|---|---|
| `inheritSendTypes` | a child registers no send type: a send of a type the host registers raises `error.execution` in it, and its `_ioprocessors` holds no entry for that type | every session of the tree is started, and decoded from the state a call is handed, with the call's processors: its `_ioprocessors` holds their entries, asked with its own session id, and a send of a registered type is handed to its processor with the child's session id in the `ProcessorContext` | `inherited_send_type_opts/1`, `:inherit_send_types` |
| `inheritObservers` | a child's effects are not among the call's effects, and a child starts with its trace flag clear | every effect a child's run answers is among the call's effects, in the order the run made it, as a `ChildEffect` naming the child's session id; a grandchild's is reported under its own session id, never nested; a child starts with its parent's trace flag | `inherited_observer_opts/1`, `:inherit_observers` |

**Where a host sets them.** On `DriveOptions`, so `start`, whose options
extend it, and every later call take them beside `sendTypes`. The reference
fixes each flag at start in session state that outlives the call. Here a
session's state is plain data the host holds, and the registered processors
are passed with every call and never stored (the Decision's paragraph "The
host's send processors are passed on every call, never stored"), so the
option that says where those processors reach is passed with them, under the
same rule: the same value for a session's whole life, since a child's
`_ioprocessors` is written as it starts. Two options rather than one, as the
reference has two: a host may have a child's sends delivered without
watching its effects, or watch a child without handing it processors.

**The tag.** A child's session id stays the parent's, a dot and the invoke
id, as the child-session Amendment decides, so the same calls answer the
same effects; it is the id a `ChildEffect` carries and the one a processor's
context names. A `ChildEffect` is the driver's: the core's effect union is
unchanged, and the effect it wraps is the one the child's run answered. The
reference delivers a child's messages to its observers as they happen; here
a call answers a child's effects within the call that produced them, as it
answers the host session's.

**What a child's handed send keeps.** A child's processor calls are held on
the call's one ledger with the host session's and made only once the call's
state is written, in the order the run made them, and a failure a `deliver`
answers for a child's send is raised in that child at the send's place within
the run (`holding`, `handOff` and `drive` in `src/driver.ts`), as the failed
send and in-run failure Amendments above decide for the host's session.

Not ported. The reference's `inherit_invoke_handlers` has no counterpart: the
child-session Amendment ports no invoke handler. Its subscribers are a
snapshot taken as the child starts; here the call that sets
`inheritObservers` is the one that reports, whenever the child started.

Typespecs:

```ts
interface DriveOptions {
  readonly sendTypes?: SendProcessors;
  readonly inheritSendTypes?: boolean; // false when absent
  readonly inheritObservers?: boolean; // false when absent
}

interface ChildEffect {
  readonly kind: "child";
  readonly sessionId: string; // the child's: the parent's, a dot and the invoke id
  readonly effect: InterpreterEffect;
}

type DriveEffect = InterpreterEffect | ChildEffect;

type DriveResult =
  | { ok: true; state: State; effects: readonly DriveEffect[] }
  | DriveRefused;
```

Worked example. A depot invokes a courier whose `<onentry>` logs `'loaded'`
and scans the parcel through the host's `parcel:scan` type:

```ts
const handed: [string, string][] = [];
const scanner: SendProcessor = {
  deliver: (_send, event, context) => { handed.push([event.name, context.sessionId]); },
};
const started = start(depot, {
  sessionId: "depot-1",
  sendTypes: { "parcel:scan": scanner },
  inheritSendTypes: true,
  inheritObservers: true,
});
```

`handed` is `[["parcel.loaded", "depot-1.courier"]]`, and the call's effects
include `{ kind: "child", sessionId: "depot-1.courier", effect }` for the
courier's `datamodel_init`, its `log` and its `send`, after the depot's own
`invoke`. Without the two options the scan raises `error.execution` in the
courier and none of its effects is among the call's effects.

## Note: the acceptance of this record and its Amendments (2026-10-02)

This Note records that this record and its ten Amendments moved from proposed
to accepted together. The conductor moved them under the flip standard of the
campaign consent the operator adopted, 2026-10-01. It decides nothing, so it
carries no Status line, and it removes no line. With it, no entry in this
record reads proposed. The dated Notes above carry no Status line and do not
move.

**They shipped in `@riddler/statifier` 0.1.0.** That version is on npm, the
package's first, built from the commit tagged `v0.1.0` (`8a2e210`), and every
Amendment's own change is in the tag. Every claim about this package was
re-checked at `8a2e210` and re-located by anchor; every claim about the
reference was read at the statifier-ex tag it names, `v2.9.0` (`f2365bb8`) or
`v2.10.0` (`c8894ae`). A claim stated "at" an earlier commit of this package
was read at that commit.

**The Decision.** `compile` and `Chart`, `ChartIdentity` and `CompileOptions`
in `src/compiler.ts`; `start`, `step`, `advance`, `configuration`, `isDone`,
`DriveResult`, `DriveRefused`, `MalformedDetail` and `DoneStatus` in
`src/driver.ts`; and `exportPosition` and `importPosition` with their refusals
in `src/position.ts` have the shapes the Typespecs give, as the Amendments
below extend them. `sameIdentity` in `src/driver.ts` judges `chart_mismatch`
on the content hash, the name and the version. The worked example, compiled
from its source as printed without a trailing newline, answers the content
hash and the exported position the record prints, run at `8a2e210`, and each
call answers the one `send_delayed` it describes. `generateInvokeId` in
`src/core/invoke.ts` mints `inv_` and the counter plus one after the state's
id and a dot. `test/position.test.ts` holds the export's required keys, the
import's two refusals, an extra key ignored and the identity unread.

**The Amendments.** The Machine one: the doc comments of `Chart` in
`src/compiler.ts` and of `Machine` in `src/machine.ts` say what it says they
say; with its acceptance, its two decisions that the stability Note of
2026-10-01 left "to be read when that Amendment is accepted" are accepted with
it. The invoke effects: `Invoke`, `Autoforward`, `runInvokePass` and
`applyInvokePasses` in `src/core/invoke.ts`. The datamodel and trace effects:
`traced` and the types in `src/core/effects.ts`, and each emitting site its
tables name. The in-process child: `invoke`, `launch`, `cancelInvocation`,
`deliverToChild`, `takeMail`, `seed`, `nextDue` and `routesOf` in
`src/driver.ts`, and `compileInvokeContent` in `src/compiler.ts`. The HTTP
transport: the five types in `src/http-transport.ts`, exported from
`src/index.ts` as types only and pinned by `test/export-surface.test.ts`. The
failed send: `reportSendFailed` and `FailedSend` in `src/driver.ts`, the
refusal `not_a_send` in `DriveRefusal`, the README's example, and
`statifier/send/registered_send_failed` in `conformance/registry.json`. The
accepts check: `checkAccepts` and `vocabulary` in `src/accepts.ts`; its worked
example, run at `8a2e210` over the vendored
`library/loan_dispute_returns_to_history.scxml`, answers the two lists it
prints, `null` answers two empty lists, and
`statifier/accepts/loan_declares_an_unreachable_event` is in the registry. The
Basic HTTP processor: `basicHttp`, `requestFor` and `sendKey` in
`src/basichttp/processor.ts`, `fetchTransport` (five seconds when no bound is
given) in `src/basichttp/fetch-transport.ts`, `decodeRequest` and its three
refusals in `src/basichttp/decode.ts`, the encoders in
`src/basichttp/encoding.ts`, and `./basichttp` in `package.json`'s exports and
in `tsup.config.ts`'s entries; `test/basichttp.test.ts` pins its worked
example's body, `scxml-send-key` header, location and `http_status 503`
report. The failure within the run: `drive`, `madeUntilFailure`,
`recordedDraws`, `systemInstant` and `systemRandom` in `src/driver.ts`, and
`Draws`, `withDraws` and `drawOptions` in `src/datamodel.ts`; `w3c/test577` is
in the registry. The inheritance: `inheritSendTypes` and `inheritObservers` on
`DriveOptions`, `ChildEffect` and `DriveEffect` in `src/driver.ts`, both types
exported from `src/index.ts`; its worked example, run at `8a2e210`, hands
`["parcel.loaded", "depot-1.courier"]` and reports the courier's
`datamodel_init`, `log` and `send` after the depot's `invoke`.

**Sentences later records name.** These read differently on `main` at
`8a2e210`, and each is named by a later dated entry above:

- The effect table, the sentence "Until then a host reads no effect the table
  above does not list" and the Typespecs' `InterpreterEffect`: the invoke
  effects and the datamodel and trace effects Amendments add to the union, and
  the inheritance Amendment adds `ChildEffect` to what a call answers.
- "The driver has six calls" and the `DriveRefused` reasons: the failed-send
  Amendment adds `reportSendFailed` and `not_a_send`, and the Note on the
  refusal reasons enumerates them.
- The Determinism bullet "Nothing under `src/` reads a clock, a random source
  or `Date.now`. Time enters only as the `ms` a host passes to `advance`", and
  the paragraph's opening sentence for a chart whose expressions read the clock
  or the random source: the in-run failure Amendment records that a run reads
  both through the expressions it evaluates, from predicator, pinned for one
  driver call's runs and drawn afresh by two separate calls; the Basic HTTP
  processor Amendment records that its entry point holds a delayed send on the
  host's global timer and bounds a request by one.
- The HTTP transport Amendment's function type, in its Typespecs and its
  worked example: the Basic HTTP processor Amendment's decision (a) makes the
  transport an object with one `post`, which `HttpTransport` in
  `src/http-transport.ts` is. Its sentences that the processor and the
  failed-send report are not on `main` yet are met by the Basic HTTP
  processor and failed-send Amendments.
- The failed-send Amendment's ordering sentence and the Basic HTTP processor
  Amendment's loop sentence and corpus paragraph: the in-run failure
  Amendment reads both as amended, and ADR-0003's Amendment on the Basic HTTP
  cases claims them.
- The child-session Amendment's sentence that a child runs with no registered
  send type and that its effects are not among a call's: the inheritance
  Amendment keeps it as the default for a call that does not opt in.
- The Context bullet and Decision paragraph on `SCRIPT_UNSUPPORTED`: the Note
  "script bodies compile" names them; `compileScript` in `src/compiler.ts`
  compiles every script body.
- The sorted sets, the refusal enumeration and a stopped position's
  configuration: the Note of that name; and what `Machine`'s stability
  reaches, the routes, the passes' trace effects, a failed composite and when
  a processor is called: the stability Note.

## Amendment: the idlocation and empty finalize writes answer a datamodel_change (2026-10-02)

Status: accepted (2026-10-02; proposed 2026-10-02)

The datamodel and trace effects Amendment left three writes out of
`datamodel_change`: in its paragraph beginning "Not ported", the reference's
`datamodel_change` "for a `<send idlocation>` write, an `<invoke idlocation>`
write and an empty `<finalize>`'s writes is not emitted either". This
Amendment emits all three, as the reference does at `v2.10.0` (`c8894ae`).
The change that adds this Amendment adds the code: `executeSend` in
`src/core/send.ts`, `invokeOne` and `autoAssignFinalize` in
`src/core/invoke.ts`, and the `owner` field of `DatamodelChange` in
`src/core/effects.ts`.

**What each write answers.** Each answers one `datamodel_change` with the
reference's fields, in the order `Statifier.Effect.DatamodelChange` declares
them (`lib/statifier/effect/datamodel_change.ex` at `v2.10.0`):
`locationPath`, `locationSource`, `newValue`, `priorValue`, `dIndex`,
`cIndex`, `owner`, then the counters. `locationSource` is the location as the
author wrote it, `newValue` the value written, `priorValue` the value that
stood at the location before the write, and `dIndex` is null:

| Write | `cIndex` | `owner` | Where it comes | Emitted by | Reference at `v2.10.0` |
|---|---|---|---|---|---|
| a `<send>`'s `idlocation` | the `<send>`'s | the block the `<send>` ran in | just before the `send` or `send_delayed` | `executeSend` (`src/core/send.ts`) | `datamodel_change_effects/4` in `Statifier.Machine.Content.Send`, from `dispatch_or_reject/8` |
| an `<invoke>`'s `idlocation` | null | `{ kind: "invoke", stateIndex, invokeIndex }` | just before the `invoke` | `invokeOne` (`src/core/invoke.ts`) | `datamodel_change_effects/5` in `Statifier.Interpreter`, from `invoke_one/6` |
| an empty `<finalize>`'s write of one returned value | null | `{ kind: "finalize", stateIndex, invokeIndex }` | one per write that lands, in the order written | `autoAssignFinalize` (`src/core/invoke.ts`) | `write_finalize_target/6` in `Statifier.Interpreter`, from `auto_assign_finalize/5` |

Each carries the counters as they stand at the write. A write that is
refused answers none, as an `<assign>`'s does: an `<invoke>` whose
`idlocation` cannot be written answers neither the change nor the `invoke`,
and an empty `<finalize>`'s write that fails raises its `error.execution`
and answers no change, the other writes standing.

**A refused send answers none.** A `<send>` whose target, type or route is
refused after its `idlocation` was written keeps the write and the minted id
and answers no effect at all, the change included, as the reference's
`dispatch_or_reject/8` answers its error form with no effect. The datamodel
then holds a value no `datamodel_change` reported.

**The invoke owner.** An `<invoke>`'s `idlocation` write is made by no block,
so its owner is a new member, `{ kind: "invoke", stateIndex, invokeIndex }`,
spelled as `Origin` already spells the invocation an event is about. That the
change names the invocation as its owner was decided under the night rule by
the conductor, 2026-10-02. The member widens the owner of `DatamodelChange`
alone; `Owner`, which every block's effects carry, is unchanged. The
reference widens its owner at the same place: `owner/0` in
`Statifier.Effect.DatamodelChange` is `Machine.Content.owner/0` with the
`{:invoke, state_index, invoke_index}` case added, and its typedoc names
`Trace.ContentExecuted`'s owner as the precedent, which `ContentOwner` in
`src/core/effects.ts` follows here.

```ts
export interface DatamodelChange {
  readonly kind: "datamodel_change";
  readonly locationPath: readonly (string | number)[];
  readonly locationSource: string;
  readonly newValue: Value;
  readonly priorValue: Value;
  readonly dIndex: number | null;
  readonly cIndex: number | null;
  readonly owner:
    | Owner
    | { readonly kind: "invoke"; readonly stateIndex: number; readonly invokeIndex: number }
    | null;
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
}
```

**What this meets.** The datamodel and trace effects Amendment's "Not ported"
sentence on the three writes holds no longer, and its table's
`datamodel_change` row gains the three emitting sites above. The invoke
effects Amendment's words "nor the trace and datamodel effects the passes
emit" and the stability Note's sentence that the `datamodel_change` for an
`<invoke idlocation>` write and an empty `<finalize>`'s writes "is still not
emitted" are met by this Amendment.

**What a host sees.** These are changed answers of a published version: a
chart whose `<send>` or `<invoke>` writes an `idlocation`, or whose empty
`<finalize>` writes a value back, answers one more effect per write than it
did, and a host that switches on a change's owner meets the new member. The
changelog fragment names both changes.

## Amendment: a write resolves its location through the expression language (2026-10-02)

Status: accepted (2026-10-02; proposed 2026-10-02)

Until this Amendment a write accepted a bare root alone: `writeLocation` in
`src/datamodel.ts` (at `6249302`) matched the root by pattern, refused a root
beginning with an underscore, then a root the datamodel did not hold, then
anything longer than the root as `unsupported_location`, whose own
documentation said "The reference writes a nested path; this port does not
yet." `@riddler/predicator` 0.5.0 publishes the location surface
(`pts-ADR-0005`, `contextLocation` and `contextPut` in `src/location.ts` at
`v0.5.0`, `bb94ebf`), and this Amendment writes every location as the
reference's `Statifier.Interpreter.Datamodel.write_location/4` does at
`v2.10.0` (`000b9d8`). The change that adds this Amendment adds the code:
`writeLocation` and `ExecutionReason` in `src/datamodel.ts`, the four write
sites below, and the dependency at `^0.5.0`.

**The reference's function, quoted** (`lib/statifier/interpreter/datamodel.ex`
at `v2.10.0`):

```elixir
with {:ok, path} <- resolve_location(path_source, datamodel_context),
     :ok <- check_system_variable(path),
     :ok <- check_root(machine_state, path_source, path),
     prior_value = read_path(machine_state.datamodel, path),
     {:ok, new_datamodel} <- write(machine_state, path_source, path, value) do
```

**What a write does, in that order.**

1. The location's source resolves to a path through `contextLocation`. The
   datamodel's roots are handed over only when the trimmed source carries a
   bracket, the one place a location reads its context (a bracket key such as
   `holds[i]`); any other source resolves against the empty context to the
   same path. A source that does not parse answers predicator's
   `ParseError`, and one that names no place to write (`[0]`,
   `renewals + 1`, a bracket key bound to no string or integer) its
   `LocationError`.
2. A resolved root beginning with an underscore is refused as
   `system_variable`.
3. A resolved root the datamodel does not hold is refused as
   `unbound_location`. A write never declares a root.
4. The value at the full path is read from the datamodel as it stands before
   the write: a string key against a map, an integer index against a list,
   and the absence on any miss or any step through anything else.
5. The value is written at the path with `contextPut` over the root alone,
   and the root is bound. A missing, null or absent slot on the way becomes a
   list before an index and a map before a key, a list is padded with the
   absence out to an index past its end, and a write through a scalar, a
   string key against a list or a negative index answers the
   `LocationError`.

A refusal at step 1 or step 5 reaches `error.execution` as `evaluator_error`,
whose `error` widens to `PredicatorError | ParseError | LocationError`, with
the location's source as `source`; `unsupported_location` leaves
`ExecutionReason`, since no write answers it.

**The four write sites.** Each answers its `datamodel_change` with the
resolved path as `locationPath` and the value step 4 read as `priorValue`:

| Write | Site | Reference at `v2.10.0` |
|---|---|---|
| an `<assign>` | `executeAssign` (`src/core/content.ts`) | `Statifier.Machine.Content.Assign`'s `execute/2` |
| a `<send>`'s `idlocation` | `executeSend` (`src/core/send.ts`) | `Statifier.Machine.Content.Send`, from `dispatch_or_reject/8` |
| an `<invoke>`'s `idlocation` | `invokeOne` (`src/core/invoke.ts`) | `invoke_one/6` in `Statifier.Interpreter` |
| an empty `<finalize>`'s write of one returned value | `autoAssignFinalize` (`src/core/invoke.ts`) | `write_finalize_target/6` in `Statifier.Interpreter`, from `auto_assign_finalize/5` |

**A root spelled as a reserved word.** Because the location resolves first,
a bare root spelled as one of the expression language's reserved words
(`next`, `and`, `if`, `true` and the rest of predicator's reserved list) is
refused for its spelling, a `ParseError` or a `not_assignable`
`LocationError`, whether or not the datamodel binds it, and an unbound one
reports that refusal before `unbound_location`, as the reference does. A name
the language does not reserve, such as `today`, is written as before. This
change of answer and the empty `<finalize>`'s nested write were ruled by the
operator, 2026-10-02.

**Where this package differs, and why.** Two forks the location surface
already declares (`pts-ADR-0005`) reach a chart unchanged: an integer
segment against a map writes the key the integer's decimal spelling names,
where the reference writes an integer key, and a refusal's message is
predicator's own. Step 4 reads an integer segment against a map as a step
through something else, as the reference's `read_path/2` does, so the prior
value there is the absence on both sides even when the decimal key was
present. A path of the root alone binds the value without passing it through
`contextPut`, which answers the same root (its leaf is always overwritten)
and leaves a bare-root write's value as the chart's own.

**What a host sees.** These are changed answers of a published version, and
the changelog fragment names each: a nested location over a declared root is
written where it was refused; a location refusal is `evaluator_error` where it
was `unsupported_location`; a reserved-word root is refused where it was
written; `ExecutionReason` loses `unsupported_location` and its
`evaluator_error` may carry a `LocationError`; and a `datamodel_change` names
the resolved path and the value read there. The vendored corpus's claims are
unchanged: its cases that write a dotted location over an undeclared root
still answer `unbound_location`.

## Note: the nested-locations Amendment's tag commits, its send write and what a host sees (2026-10-02)

This Note decides nothing new. It names three passages of the Amendment "a
write resolves its location through the expression language" that read
inexactly against the reference at tag `v2.10.0` and against this package's
changelog section for 0.2.0, and says what holds. It carries no Status line,
it removes no line, and that Amendment's Status line does not move.

**The two tags are cited by their tag objects.** The Amendment's opening cites
`@riddler/predicator`'s `v0.5.0` as `bb94ebf` and the reference's `v2.10.0` as
`000b9d8`. Both tags are annotated, and those are the hashes of the tag
objects. The commits the tags name are `36c23a5` (predicator-ts `v0.5.0`) and
`c8894ae` (statifier-ex `v2.10.0`), the commit this record cites everywhere
else it names the reference's tag. The Amendment's claims about the two tags
are read at those commits.

**The send's write happens in its `execute/2`.** The Amendment's table of the
four write sites names the reference's site for a `<send>`'s `idlocation` as
`Statifier.Machine.Content.Send`, "from `dispatch_or_reject/8`". At `v2.10.0`
(`c8894ae`), in `lib/statifier/machine/content/send.ex`, the write happens in
the `execute/2` of that module's `Statifier.ExecutableContent`
implementation, through its `maybe_write_idlocation/4`, which calls
`Statifier.Interpreter.Datamodel.write_location/4`. `dispatch_or_reject/8`
writes nothing: it receives the write `execute/2` answers and builds the
send's effects from it. The row's reference site reads as that `execute/2`,
through `maybe_write_idlocation/4`. The Amendment "the idlocation and empty
finalize writes answer a datamodel_change" names `datamodel_change_effects/4`,
from `dispatch_or_reject/8`, as where the send's `datamodel_change` is built;
that holds at `c8894ae`, and this Note does not reach it.

**What a host sees omits two answers.** The Amendment's closing list of the
changed answers says the changelog fragment names each, and it leaves out two
that the 0.2.0 section of `CHANGELOG.md` names under Changed:

- an empty `<finalize>` writing a returned value back to a nested location
  over a declared root now writes it, as the reference does, where it was
  refused with `unsupported_location`;
- a write at an index past a list's end pads the list with the absence
  (`holds[2]` on `["c-1"]` leaves `["c-1", Undefined, "c-3"]`), as the
  reference does; step 5 of "What a write does" above describes it.

Both are changed answers of a published version, and the list reads with
them.

## Note: the acceptance of the two Amendments of 2026-10-02 (2026-10-02)

This Note records that the Amendments "the idlocation and empty finalize
writes answer a datamodel_change" and "a write resolves its location through
the expression language" moved from proposed to accepted together. The
conductor moved them under the flip standard of the campaign consent adopted
under the operator's pre-consent, 2026-10-01. It decides nothing, so it
carries no Status line, and it removes no line. With it, no entry in this
record reads proposed, as the acceptance Note of 2026-10-02 above said of the
record before the two Amendments were added.

**They shipped in `@riddler/statifier` 0.2.0.** That version is on npm, built
from the commit tagged `v0.2.0` (`b091164`), and both Amendments' own changes
are in the tag: `6249302` and `5560a8c`. No file under `src/`, `test/`,
`conformance/` or `package.json` changed between `b091164` and the commit
this Note was written on; only this record did, by the Note of 2026-10-02
above. Every claim about this package was re-checked at `b091164` and
re-located by anchor; every claim about the reference was read at
statifier-ex `v2.10.0` (`c8894ae`), and every claim about
`@riddler/predicator` at its `v0.5.0` (`36c23a5`), the version
`package.json` requires as `^0.5.0` and the one installed.

**The idlocation and empty finalize writes.** `DatamodelChange` in
`src/core/effects.ts` has the fields and the widened `owner` the Amendment
prints, and `Owner` in `src/datamodel.ts` is unchanged. `executeSend` in
`src/core/send.ts` answers the change with the `<send>`'s `cIndex` and its
block's owner just before the `send` or `send_delayed`, and a send refused
for its target, its type or its route answers no effect, keeping the write
and the minted id. `invokeOne` in `src/core/invoke.ts` answers the change
with the `invoke` owner just before the `invoke`, and neither when the write
is refused; `autoAssignFinalize` there answers one change per write that
lands, with the `finalize` owner, and raises `error.execution` for one that
fails, the others standing. In the reference, the field order of
`Statifier.Effect.DatamodelChange`, its `owner/0` and its typedoc,
`datamodel_change_effects/4` and `dispatch_or_reject/8` in
`Statifier.Machine.Content.Send`, and `datamodel_change_effects/5`,
`invoke_one/6`, `write_finalize_target/6` and `auto_assign_finalize/5` in
`Statifier.Interpreter` read as the Amendment says. The three sentences it
meets are where it says they are, and the 0.2.0 section of `CHANGELOG.md`
names both changes under Changed.

**The nested locations.** `writeLocation` at `6249302` reads as the
Amendment's opening says. At `b091164`, `writeLocation` in `src/datamodel.ts`
resolves through `contextLocation`, handing over the roots only for a source
with a bracket, then refuses `system_variable`, then `unbound_location`, reads
the prior value at the full path, binds a root-alone path directly and writes
any longer one with `contextPut` over the root alone; `evaluator_error` in
`ExecutionReason` carries `PredicatorError | ParseError | LocationError`, and
no file under `src/` names `unsupported_location`. `executeAssign` in
`src/core/content.ts` and the three sites above answer the resolved path and
the prior value. Each refusal and each write the five steps, the reserved
word paragraph and the forks paragraph describe was run through
`writeLocation` at `b091164` and answers as written: `[0]`, `renewals + 1`
and a bracket key bound to `true` answer a `LocationError`, a write through a
scalar, a string key against a list and a negative index answer one too,
`holds[2]` on `["c-1"]` leaves `["c-1", Undefined, "c-3"]`, `next`, `and`
and `if` answer a `ParseError` and `true` a `not_assignable` `LocationError`
bound or unbound, `today` is written, and `patron[1]` writes the key `"1"`
with the absence as its prior value. `write_location/4` in
`lib/statifier/interpreter/datamodel.ex` at `v2.10.0` is quoted as the
Amendment quotes it, and its `read_path/2` answers the absence for an integer
segment against a map. `contextLocation` and `contextPut` are in
`src/location.ts` at predicator-ts `v0.5.0`, and its ADR-0005 declares the
two forks the Amendment names. The vendored corpus is unchanged by the
Amendment's change, and its cases that write `foo.bar.baz` over an
undeclared root still answer as the gate's registry stage claims.

**Sentences later records name.** These read differently on `main` at
`b091164`, and each is named by a later dated entry above:

- The nested-locations Amendment's citation of the two tags as `bb94ebf` and
  `000b9d8`, its reference site for a `<send>`'s `idlocation` write, and its
  closing list of what a host sees: the Note of 2026-10-02 above names all
  three and says what holds, and each holds as that Note says at `b091164`
  and at `c8894ae`. That Note's sentence "that Amendment's Status line does
  not move" described the Note alone; this acceptance moves it.

## Note: the Determinism paragraph for a chart that reads the clock or draws (2026-10-04)

This Note decides nothing new. It restates the Decision's Determinism
paragraph as it holds on `main` at `a69a307` for a chart whose expressions
read the clock or the random source, and reads the paragraph's first bullet
beside the draws a driver call pins. It carries no Status line and removes no
line. The Note "the acceptance of this record and its Amendments" (2026-10-02)
above already lists that bullet and the paragraph's opening sentence among the
sentences later records name, and cites the in-run failure Amendment and the
Basic HTTP processor Amendment for them; this Note does not repeat that, and
says what the paragraph reads as.

**The paragraph, restated.** For a chart whose expressions read neither the
clock (`Date.now()` or a relative date) nor the random source
(`Math.random()`), the opening sentence holds as written: the same chart, the
same options and the same calls answer the same states and the same effects on
every engine. For a chart whose expressions read either, a driver call answers
the same states and effects given, beside those, the same clock readings and
the same random draws in the same order. A driver call takes each reading or
draw once, the first time a run of that call reaches it, and every run of the
call made again reads the same ones (`drive` and `recordedDraws` in
`src/driver.ts`). Two separate driver calls read and draw afresh, and no
member of `DriveOptions` or `StartOptions` in `src/driver.ts` supplies a
reading or a draw, so a host that repeats a call over such a chart may be
answered differently. The Consequences sentence "the same chart answers the
same way on a server, in a browser and on a device" is read with the same
scope. This Note reads no other bullet of the paragraph.

**The first bullet, beside the pinned draws.** The readings and draws come
from `@riddler/predicator`, not from this package: `systemInstant` and
`systemRandom` in `src/driver.ts` ask predicator to evaluate `Date.now()` and
`Math.random()` with nothing pinned, so it answers from its own clock and
random source, and `withDraws` and `drawOptions` in `src/datamodel.ts` hand
the recorded ones to every evaluation a run of the call makes, as predicator's
`now` and `random` options. So the bullet holds of this package's own code,
read narrowly: a search of `src/` at `a69a307` for `Date.now`, `new Date`,
`Math.random`, `performance.` and `crypto.` finds `Date.now()` and
`Math.random()` only as the source text those two functions hand predicator,
in their error messages and in the doc comment on `Draws`, and nothing else.
It does not hold of what a driver call reads: a call over a chart whose
expressions read the clock or the random source reads both, through
predicator, once per reading or draw, pinned for that call's runs. The
bullet's second sentence holds for the driver's own delayed sends, which
`advance` fires as the virtual clock moves by the `ms` a host passes it; the
Basic HTTP entry point's held delayed send is the exception that acceptance
Note names.

## Note: one driver call is bounded by the round budget (2026-10-04)

The Amendment "a failure `deliver` answers is raised within the run that
handed the send" left one case open, in its paragraph "A chart that sends
again on every failure": a chart that answers each failure by sending again
to a processor that fails it again never returns from the driver call, and
"whether to bound the loop, and how the refusal would read, stays open". The
same holds on `main` at `d89ad60` for a chart that sends itself an event on
every event it takes: `drain` in `src/driver.ts` takes the external queue,
then the mailbox, until both are empty, with no count. The call is bounded,
ruled by the operator, 2026-10-03: the bound reuses the round budget the
driver already applies, `maxMacrostepRounds`, with no new option and no new
budget value, and the call returns with a value, never a throw. What the
bound counts was ruled by the operator, 2026-10-04: the failures a call
raises and the events an undelayed send queued, never an event a timer
fires. That the value is the existing spent-budget halt rather than a
refusal was decided by the conductor under a standing consent, 2026-10-03.
No member is added to `DriveRefusal` or to any other public type, so this is
a Note rather than an Amendment. The change that adds this Note changes
`drain`, `handOff`, `performOne`, `route`, `fire`, `sendFailure` and
`deliverInternal` in `src/driver.ts`; gives the driver's internal `Live`
the per-call fields `taken`, `counted`, `spent` and `raised`, which
`launch` and `decodeState` set; adds `spends`, `halt`, `within`,
`budgetExhausted`, `enqueueSelf`, `spentFailure`, `failureOrigin` and
`internalEvent` there; rewords the documentation of `State.halted` and
`StartOptions.maxMacrostepRounds`; and adds the tests in
`test/driver-bounded-call.test.ts`.

**What is counted.** Each session of the call counts, within that call and
against its own `maxMacrostepRounds`, two things:

| Counted | Where | Past the budget |
|---|---|---|
| each failure a processor's `deliver` answered that the session raises | `handOff` | the failure's `error.communication` joins the internal queue and the chart is not run over it (`spentFailure`) |
| each event the session takes that an undelayed send queued in this call: one it sent itself, or one a child sent it through `#_parent` | `route` marks it; `spends` counts it as `drain` takes it | the event stays where it is queued |

Nothing else is counted: not the host's own event, not an event a fired
timer's send queues (`fire`), not an event queued before the call, not a
child's done event, not an event a parent sends its child, and not a
failure a host reports through `reportSendFailed`. A catch-up through
`advance` answers as it did before this change however many timers fire,
unless what the fired events run sends the session undelayed events, which
are counted. A budget of `"infinity"` bounds neither count, and a
call under it over such a chart still does not return.

**The halt.** Either way the session halts as a macrostep that spends its
rounds halts it: the state's `halted` reads `"budget_exhausted"` and the
call answers the `budget_exhausted` effect once (`BudgetExhausted` in
`src/core/interpreter.ts`), carrying its configuration, its
budget, its internal queue as `pendingInternalEvents` (an unrun failure
among them) and its counters, built by `budgetExhausted`. The call answers
`ok: true`. A session this call halted runs its chart no further in the
call: `deliverInternal` puts any event raised onto its internal queue
afterwards there unrun, a later failure or an internal send in the same
batch included, and `drain` takes nothing more. The effects the session's
last run already answered are still acted on, so a send among them is
handed to its processor, once. A session halted this way stays halted, as
one halted by a spent macrostep does: later external events wait and
pending timers still fire.

**What a host sees change.** Against `main` at `d89ad60`, under a budget
`n`: a call whose sessions raise more than `n` failures their processors
answered, or take more than `n` events their undelayed sends queued, halts
with `budget_exhausted` where it ran on. That is the only changed answer; a
call that reaches neither count answers as before, a catch-up of fired
timers included.

**What the bound does not reach.** An event a session sends to
`#_internal` runs the chart through `deliverInternal` with a round budget of
its own, so a chart that sends itself an internal event on every one it
takes still runs on within the call unless a halt has already stopped it.
The bound counts no such event.

**The cost.** A call over a chart that sends again on every failure makes
its run once for each failure it meets plus once, as the Amendment says, so
its cost grows with the square of the budget, and under the default budget
of 10000 it returns only slowly.

**The Amendment's sentences.** Its sentence that "each send the call's final
run hands is handed to its processor once" holds for a bounded call: the
call reaches its final run, the one that queues the failure past the budget,
and each send that run hands, before or after the halt, is handed once. Its
paragraph "A chart that sends again on every failure" is read as amended by
this Note: the call is bounded. Its reading of the reference stands: at
statifier-ex `v2.11.0` (`bbc4c0e`), as at `v2.10.0` (`c8894ae`),
`drain_deferred/1` in `lib/statifier/session.ex` applies no budget across
the raises, and `handle_continue/2`'s `:drain` clause there takes one inbox
entry per turn of the session's message loop, with no count. A host's
`send_event/2` there casts, so no call a host makes waits on either loop.
The bound is this package's, since every call here takes what its chart
queues itself before it returns.

## Note: an inbound event's origintype, and a held send of a stopped session (2026-10-04)

The Basic HTTP processor Amendment's table "Further divergences from the
reference, each declared" has two rows this Note answers. Both answers were
decided by the conductor under a standing consent, 2026-10-03: carry
`origintype` as the reference does, and add no host call for the held sends.

**An inbound event's `origintype`.** The row "An inbound event's
`origintype`" reads, on `main` at `f2195ad`, that it is "not carried: `step`
takes a host event's name and data only". The reference's decoder sets the
processor's URI: `decode/1` in `lib/statifier/send/basic_http.ex` at
statifier-ex `v2.11.0` (`bbc4c0e`), as at `v2.10.0` (`c8894ae`). The change
that adds this Note carries it:

- `HostEvent` in `src/driver.ts` gains one optional member, `origintype?:
  string`, so the Typespecs line `interface HostEvent { name: string; data?:
  Value }` reads with it;
- `step` in `src/driver.ts` queues it on the external event when it is a
  string, and the chart reads it as `_event.origintype`;
- `decodeRequest` in `src/basichttp/decode.ts` sets it to
  `BASIC_HTTP_EVENT_PROCESSOR`.

A host event that names no `origintype`, or names one that is not a string,
reads `_event.origintype` as undefined, as every host event did before. The
changed answer is the decoded event's: it carries the field, and a chart that
reads `_event.origintype` on it reads the processor's URI where it read
undefined. No refusal is added. ADR-0003's loopback Amendment says under
"Limits" that "The event `decodeRequest` answers carries no `origintype`";
that sentence is superseded by the same change, and no vendored case the
loopback drives reads the field, so no claim in `conformance/registry.json`
moves.

**A delayed send held for a stopped session.** The row "A delayed send"
stands: the processor holds a delayed send on the global timer and posts it
when the timer fires, where the reference posts only while the session is
running, and the dead letter is the host's. A send held for a session that
has stopped since is posted when its timer fires; a miss reaches the host's
`report`, and `reportSendFailed` refuses a report against the stopped state
with `not_running`. What comes of that post is the host's dead letter. No
host call clears a stopped session's held timers: the driver has none, and
`basicHttp` answers only the processor and its send types. The processor's
`cancel` drops one held send, by its send id, when a `<cancel>` names it.
