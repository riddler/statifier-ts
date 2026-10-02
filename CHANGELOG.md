# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries for unreleased work are not written here directly. Each issue drops a
fragment in [`changelog.d/`](changelog.d/README.md); the fragments are assembled
into a version section at release. See that README for the format and for when a
change warrants an entry at all.

A version section here is written when that release is prepared, which is before
it is published. A section records what its version carries; whether that version
is on the registry is a question for the registry.

## [Unreleased]

Nothing is written under this heading. Unreleased work is the fragments in
`changelog.d/`; a release prep assembles them into a version section below this
one.

## [0.2.0] 2026-10-02

A minor release that writes nested locations. An `<assign>`, a
`<send idlocation>`, an `<invoke idlocation>` and an empty `<finalize>` naming
a nested location over a declared root (`patron.name`, `holds[0]`) now write
it, as the reference does, through the location surface of
`@riddler/predicator` 0.5.0, which this release requires. What a host now
meets: `unsupported_location` is no longer a member of `ExecutionReason`; a
location that does not parse, names no place to write or passes through
something that is not a container answers `error.execution` with an
`evaluator_error` reason whose `error` may now be a `LocationError`; a bare
root spelled as one of the expression language's reserved words is now refused
the same way where it was written; a `<send idlocation>`, an
`<invoke idlocation>` and an empty `<finalize>` write each answer a
`datamodel_change`, whose `owner` may now be the `invoke` member naming an
invocation; and every `datamodel_change` names the path the location resolved
to and the value read there before the write.

### Changed

- A `<send>` or an `<invoke>` that writes its `idlocation`, and an empty `<finalize>` that writes a returned value back, now answer a `datamodel_change` for each write, as the reference does: a send's or an invocation's comes just before its own effect, and a `<send>` refused for its target, its type or its route still answers none, though its write stands.
- A `datamodel_change`'s `owner` may now be `{ kind: "invoke", stateIndex, invokeIndex }`, naming the invocation whose `idlocation` write it reports, and such a change names no `cIndex`; a host that switches on the owner's `kind` adds a case for it. The `Owner` a block's effects carry is unchanged.
- Requires `@riddler/predicator` `^0.5.0`, whose location surface resolves and writes the locations a chart writes to.
- An `<assign>`, a `<send idlocation>` and an `<invoke idlocation>` naming a nested location over a declared root (`patron.name`, `holds[0]`, `holds[i]`) now write it, as the reference does, where they were refused with `unsupported_location`; intermediate maps and lists are created on the way, never a root.
- An empty `<finalize>` writing a returned value back to a nested location over a declared root now writes it, as the reference does, where it was refused with `unsupported_location`.
- A location that does not parse or names no place to write (`[0]`, `renewals + 1`), or whose write passes through something that is not a container, now answers `error.execution` with an `evaluator_error` reason carrying predicator's `ParseError` or `LocationError`, where it answered `unsupported_location`; the location resolves before the root is checked, so such a location reports that refusal before `system_variable` or `unbound_location`.
- A bare root spelled as one of the expression language's reserved words (`next`, `true`, `if`) now answers `error.execution` with an `evaluator_error` reason, as the reference does, where it was written; an unbound one reports that refusal before `unbound_location`. A host that names a `<data>` that way renames it.
- The `evaluator_error` member of `ExecutionReason` may now carry a `LocationError` as its `error`; a host that switches on the error's `type` adds a case for it.
- A `datamodel_change`'s `locationPath` is now the path the location resolved to and its `priorValue` the value read at that path before the write, for an `<assign>`, a `<send idlocation>`, an `<invoke idlocation>` and an empty `<finalize>`.
- A write at an index past a list's end pads the list with the absence (`holds[2]` on `["c-1"]` leaves `["c-1", Undefined, "c-3"]`), as the reference does.

### Removed

- `unsupported_location` is no longer a member of `ExecutionReason`: no write answers it, since every location over a declared root is either written or refused for a reason the location surface names. A host that switches on it removes that case and reads `evaluator_error` instead.

## [0.1.0] 2026-10-01

The first release: the SCXML interpreter core and its in-memory driver.
`compile` turns a chart's text into a compiled chart, and `start`, `step`,
`advance`, `configuration` and `isDone` run it on a virtual clock and answer
each call's configuration and effects as plain data; persistence, a real clock,
delivering what a chart sends and rendering stay the host's. The package claims
every conformance case the reference's registry lists at its `v2.10.0` tag:
every case of the scion and statifier suites, 152 of the w3c suite's 154
mandatory cases and 13 of its 14 optional ones, the three w3c cases left being
ones the reference does not list either. The Basic HTTP Event I/O Processor
ships on its own entry point, `@riddler/statifier/basichttp`, and the cases that
name it are claimed through an in-memory loopback that opens no socket, so they
prove its event I/O logic, not a network round trip. The corpus has also been
run on the standalone Hermes VM and agreed with Node row for row; that is
evidence about the engine family React Native uses, not a run on the engine
build an application ships.

### Added

- `checkAccepts(chart, declaredEvents)` compares the event names a host declares a chart accepts with the events the chart reacts to, and answers `{ unreachable, undeclared }` (the exported `AcceptsCheck`): each declared name no transition of a state the chart can enter listens for, in the declaration's order, and each event descriptor such a transition listens for that matches no declared name, a state's own transitions before its children's. Matching is transition selection's own, so `loan.*`, `loan.`, `loan` and `*` each match a declared `loan.renew`; a `*` in a declared name is an ordinary token, never a pattern. `null` declares nothing and answers two empty lists, and an empty list declares that the chart accepts nothing.
- The statifier corpus case `accepts/loan_declares_an_unreachable_event` is claimed: a consumer relying on the `statifier` claim now also has the chart's accepts check answering the reference's two lists, order included.
- A chart started with registered send types finds an entry for each one in `_ioprocessors`, beside the SCXML Event I/O Processor's entry, written when the chart starts and kept for its whole life.
- The entry point exports by name every type in this package that a compile error reaches, as types only: `ParseError`, `ParseErrorReason`, `Location`, `LoweringError`, `LoweringErrorOf`, `ValidationError`, `ValidationErrorOf`, `ValidationNoDetail`, `DefaultTransitionOwner`, `StateKind`, `CompilerError` and `ExpressionOwner`, so a host can name the member of `CompileError` it narrows to.
- The entry point exports by name the types the public event and effect types reference or extend: `Cause`, `Origin`, `Owner`, `EventType`, `ExecutionReason`, `BudgetExhausted`, `InvokeEffect`, `ExitEntryEffect`, `Effect`, `Log`, `CancelInvoke`, `BindingEffect`, `SendFields` and `TraceCounters`.
- `inheritSendTypes` on `start` and every later call hands an in-process child the processors in `sendTypes`, down the whole invoke tree: a child's send of a registered type reaches its processor with the child's own session id, and its `_ioprocessors` holds the type's entry. Off by default, as the reference's `inherit_send_types` is; pass the same value for a session's whole life, as `sendTypes` is passed.
- `inheritObservers` on `start` and every later call reports every effect an in-process child's run answers among the call's effects as a `child` effect (the exported `ChildEffect`) carrying the child's session id and the effect, and starts a child with its parent's `trace` flag. Off by default, as the reference's `inherit_observers` is; a call's effects are now typed `DriveEffect`, the core's effects or a `ChildEffect`.
- The driver runs an `<invoke>` of the SCXML type in process: it compiles the content markup (a root that declares no namespace is read as SCXML), starts it as a child session on the parent's virtual clock with its datamodel seeded from the params its root `<data>` names, and returns `done.invoke.<id>` with the child's donedata when the child stops; leaving the invoking state stops the child.
- The driver state carries each live invocation with its child's own state nested in it (`invokedAs`, `invocations` and `mailbox`), so a state with a running child goes through JSON and steps as the original does; a position does not carry the child.
- Every w3c case that needs `<invoke>` is now claimed.
- `start`, `step`, `advance`, `configuration` and `isDone` run a compiled chart in memory: the external queue, delayed sends as pending timers on a virtual clock that `advance` moves, a send of a registered type handed to the host's processor, and a state that is a plain JSON value.
- A built-in Basic HTTP Event I/O Processor on its own entry point, `@riddler/statifier/basichttp`: `basicHttp` answers the processor and the send types to register it under (its URI and `basichttp`), each send becomes one POST with a hand-encoded form body or a text body and the `scxml-send-key` deduplication header, delivery is at least once, and a miss is handed to the host's `report` function with the sending session's id for the host to pass to `reportSendFailed`.
- `fetchTransport`, the processor's default transport, looks up the global fetch function when a request is made and answers the failure `fetch_unavailable` when there is none, so importing either entry point reaches no host global.
- `decodeRequest` turns an inbound POST to a session's location into the event a host's server front passes to `step`, refusing a method other than POST, text that is not UTF-8 and a malformed `scxml-send-key` as values.
- A send processor may supply its session's `_ioprocessors` entry through an optional `ioprocessorsEntry`, and its `deliver` and `cancel` are handed the sending session's id as a `ProcessorContext`.
- A host's HTTP transport (`HttpTransport`) is an object with one `post` method, so a later member can be added without changing its shape.
- A state's `<invoke>` elements start when the macrostep that entered it is stable: each one answers an `invoke` effect carrying its id, type, source, params and content, and the host runs the invocation; the core runs none itself.
- An external event runs the `<finalize>` of the live invocation its `invokeid` names before any transition is selected, and answers an `autoforward` effect carrying the event unchanged for each live invocation that forwards.
- The HTTP transport types (`HttpTransport`, `HttpRequest`, `HttpAnswer`, `HttpStatus`, `HttpFailure`) are exported, so a host can write the transport that makes the Basic HTTP processor's POST requests over its own HTTP client: it is handed the method, URL, headers (with the `scxml-send-key` deduplication header) and encoded body, and answers the status that came back or a failure as a value.
- `reportSendFailed(chart, state, { send, reason? }, opts?)` reports a send a host's processor was handed and could not deliver: the chart takes `error.communication` carrying the send's id as `_event.sendid` and runs to a stable configuration within the call; a stopped chart refuses it with `not_running`, and a send without its `sendId`, `cIndex` and `owner` with `not_a_send`.
- A processor's `deliver` may answer `{ kind: "failure", reason }` (the exported `DeliveryFailure`), and the send then fails the same way within the call that handed it; any other answer is a send the processor took, and a processor that throws still throws out of the call.
- The statifier corpus case `send/registered_send_failed` is claimed: a consumer relying on the `statifier` claim now also has a registered send that the host reports failed reaching the sender as `error.communication`.
- Starting a chart answers a `datamodel_init` effect first, carrying the datamodel before any `<data>` value binds, then a `datamodel_change` effect for each `<data>` that binds; an `<assign>` whose write lands answers a `datamodel_change` with the path, the new and the prior value, and the node that wrote it, unless it ran inside an `<if>` or a `<foreach>` that then failed.
- A state whose `trace` flag is set answers `trace` effects naming each step the interpreter takes, its `trace` field one of `event_dequeued`, `transitions_selected`, `exit_set`, `content_executed`, `entry_set`, `macrostep_stable`, `done`, `invoke_pass` and `finalize_autoforward`; `start` leaves the flag false, and a drive now reads it from the state it is given and writes it back.
- `compile(source, options)` turns SCXML text into a Chart - the compiled Machine and the chart's identity, a SHA-256 of the source's UTF-8 bytes beside an optional name and version - or answers every error from the first stage that refused it.
- An expression that does not compile where the chart loads is a compile error naming the element, the attribute and where it was written.
- `exportPosition` writes a running chart's state as a plain JSON position in the reference's string-id vocabulary, and `importPosition` rebuilds a state over a compiled chart from one, refusing a malformed export or one naming states the chart does not hold; pending timers and the driver's other fields do not travel.

### Changed

- An empty namespace declaration (`xmlns=""` or `xmlns:p=""`) binds the empty string instead of undeclaring, so an SCXML element under one is refused as `foreign_element`, as the reference does.
- A registered send type's processor is called once the call's state is written, in the order the run made the calls, so a call refused as `unencodable_value` (a host event's data or a starting datamodel value that tagged-value text cannot carry, among others) calls no processor's `deliver` or `cancel`, and a host that retries it hands nothing twice.
- A send to `#_parent` from an invoked child, and a send to `#_<invokeid>` naming a live invocation, now deliver as external events instead of answering `error.communication`; an event a child sent and its parent had not taken is discarded once the invocation is cancelled.
- An `<invoke>` of a type other than SCXML raises `error.execution`, and one whose content is absent or does not compile raises `error.communication`, keeping its id live with no child.
- The one runtime dependency, `@riddler/predicator`, is required at `^0.4.1`, whose equality answers two maps or lists holding the same absent members equal, so the `_event` value of an event that lacks its optional fields now compares equal to itself and to a copy of it in a chart's conditions, as it does in the reference.
- The w3c case `test329` is claimed: a consumer relying on the `w3c-mandatory` claim now also has a copy of a system variable, `_event` included, comparing equal to the variable after an attempt to assign it fails.
- An `<invoke>` whose type, source, params or content fails to evaluate, or whose `idlocation` cannot be written, raises `error.execution` naming that invocation and starts nothing; a live invocation answers a `cancel_invoke` effect when its state exits.
- The effects a call answers now include the `invoke` and `autoforward` kinds (the exported `Invoke` and `Autoforward` types), and a `cancel_invoke` (the exported `CancelInvoke`) is now reachable once an invocation is live, so a host matching every effect `kind` exhaustively meets `invoke` as each invocation starts, `autoforward` when an external event reaches an invocation that forwards, and `cancel_invoke` when an invoking state exits, and, once it passes `inheritObservers`, the `child` kind that option adds; the driver acts on all three itself, so such a host adds a case that records or ignores each, and a host that ignores a `kind` it does not know needs no change.
- An immediate send to a session, a parent or an invocation the driver cannot reach is refused where it runs: the rest of its block does not run, `error.communication` carrying the send id joins the internal queue ahead of anything the block would have raised after it, and no `send` effect is reported for it. The w3c suite's `w3c/test496` is now claimed; a delayed send to such a target still answers `error.communication` when its timer fires.
- A `done` effect from a chart that stopped without exiting a top-level final, as a cancelled chart does, carries `null` donedata, as the reference's nil, so a host can tell it apart from a top-level final that declares no donedata, which still carries undefined.
- The `send_rejected` execution reason carries `errorKind` (`execution` or `communication`), rendered as `error_kind` in an error event's data, so a send refused inside an `<if>` or a `<foreach>` keeps which error it would have raised, as the reference's rejection does.
- An `<if>` or a `<foreach>` that fails no longer answers the effects of the nodes it ran before the failure: their logs, sends and datamodel changes are dropped, as the reference drops them, while what they wrote to the datamodel is kept.
- The effects a call answers now include `datamodel_init` and `datamodel_change`, so a host matching every effect `kind` exhaustively meets two new kinds on every start and on an `<assign>` whose write lands, and a third, `trace`, once it sets the trace flag; a host that ignores a `kind` it does not know needs no change.
- A failure a processor's `deliver` answers is raised at the send's place in the run that handed it, ahead of the events that run has yet to take from its external queue, as the reference raises it; before, it was raised only after that run had taken them, so a send with no target through the Basic HTTP processor was taken after an event the same block sent the session itself. Each send is still handed to its processor once, and only once the call's state is written: within one driver call, every expression that reads the clock (`Date.now()`, a relative date) or draws `Math.random()` reads the same value each time the call's run is made.
- A `<script>` body, top-level or in-line, compiles as a statement program and runs, where every script raised `error.execution` when it ran; a body that does not compile still loads and raises `error.execution` when it runs, naming why.
- The scion claim now covers every case of the scion suite, the three cases a `<script>` body decides included; a consumer relying on the claim should expect charts whose scripts write the datamodel to behave as the corpus says.

### Fixed

- A document type declaration that holds an unpaired quote anywhere in its internal subset, inside a comment or a processing instruction included, or elsewhere in the declaration, parses instead of being refused as `unterminated_doctype` where the reference accepts it, unless a `>` that ends a comment, a processing instruction or a markup declaration inside it comes after a `]` that has closed every `[` before it; a document refused after such a declaration now reports what follows the declaration.
- A lone surrogate in text, an attribute value or a CDATA section is refused as `invalid_character`, as its character reference already was.
- An `&` whose would-be reference runs past a quote is refused as `malformed_reference` instead of `unknown_entity`.
- A `<param>` under a `<send>` with neither `expr` nor `location` is refused by `validate` and `compile` with `param_no_value`, where `compile` threw.
- A driver state whose child's `invokedAs` is not its invocation's `invokeId`, whose host session's `invokedAs` is not null, or that carries two invocation records with one `invokeId` is refused as `malformed_state` with a `bad_shape` detail naming the field (`invocations[0].state.invokedAs`, `invokedAs`, `invocations[1].invokeId`), where it decoded into a child that could not reach its parent or silently dropped one of the two records.
