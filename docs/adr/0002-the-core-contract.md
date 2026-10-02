# ADR-0002: The core contract

Status: proposed (2026-10-01)

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

Status: proposed

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

Status: proposed

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

Status: proposed

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

Status: proposed

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

Status: proposed

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

Status: proposed

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

Status: proposed

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
