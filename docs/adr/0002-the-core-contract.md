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
