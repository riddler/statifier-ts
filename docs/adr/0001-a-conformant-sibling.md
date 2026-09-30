# ADR-0001: A conformant sibling of the Elixir engine, not a second reference implementation

Status: proposed (2026-09-30)

## Context

Statifier already has a reference implementation. It is written in Elixir and
lives in statifier-ex, and its own records fix what kind of engine it is. Read
at tag `v2.9.0` (`f2365bb8`): `st-ADR-0002`
(`docs/adr/0002-literal-w3c-appendix-d-port.md`) ports the SCXML algorithm of
the W3C recommendation's Appendix D function for function, keeping the
specification's names, and allows an adaptation the pure core requires only
where it deviates mechanically, never semantically; `st-ADR-0003`
(`docs/adr/0003-pure-core-with-effects.md`) makes the core a pure function from
a state and an event to a new state and a list of effects, with every effect
interpreted outside the core; `st-ADR-0004`
(`docs/adr/0004-predicator-as-the-datamodel.md`) makes predicator the datamodel
and embeds no ECMAScript engine. Its design principles
(`docs/architecture.md`, "Design principles", principle 3, "Errors are
events") say that an evaluation failure raises `error.execution` on the
internal queue and that the interpreter, not the leaf, decides what an error
means.

The same reference publishes the means to check a sibling against it.
`st-ADR-0006` (`docs/adr/0006-reuse-conformance-corpus-and-regression-ratchet.md`)
keeps a regression registry of the cases the reference passes, with the
tasks that ratchet it, and `st-ADR-0070`
(`docs/adr/0070-statifier-emits-a-language-neutral-conformance-corpus.md`)
emits the conformance corpus under `conformance/` in a language-neutral form -
chart sources, the events driven through them and the configurations expected
after each step - so that another implementation can make a claim against the
same cases. Its `conformance/README.md` says a sibling vendors that directory
from a statifier-ex tag, byte for byte, and writes its own registry against
it; `conformance/RATCHET.md` holds the recipe and the registry contract.

This package has one question to settle before any code is written: what kind
of thing it is. The predicator family settled the same question for its own
TypeScript sibling in `pts-ADR-0001` (predicator-ts,
`docs/adr/0001-a-conformant-sibling.md`, read at `bd1bb1f`): a conformant
sibling, whose correctness is defined outside itself and whose every
disagreement with the reference's corpus is its own bug, rather than a second
reference implementation free to decide semantics locally. That record's
reasoning carries over unchanged. A second reference implementation drifts one
reasonable-looking local fix at a time; a sibling's conformance can be tested
case by case, mechanically, and a reference's cannot.

What differs here is the reach and the size of the engine. A statechart
interpreter is larger than an expression evaluator, and the reference carries
much that is not the interpreter: durable persistence, a session process,
telemetry, replay, publish-time checks. This package is wanted where the
reference cannot run - in a browser, in a worker and in a React Native app -
and there it needs only the part that answers "given this chart, this
configuration and this event, what is the next configuration and what should
the host do". So this record also fixes what the package leaves out.

Six choices this record carries were ruled by the operator, 2026-09-29: the
repository is statifier-ts, the package is `@riddler/statifier` and the
tracker's prefix is `sts`; the package is the interpreter core only; it has one
runtime dependency; it is engine-neutral; the run of its corpus on the
JavaScript engine React Native uses comes later than this record and is not a
condition of it; and the question of bindings on the client is deferred, with
a trigger and a home named. The Decision states each as a rule.

## Decision

**This package is a conformant sibling of the Elixir reference implementation,
and it is not a reference implementation itself.** Its correctness is defined
by artifacts it does not own: the reference, read at a named tag, and the
reference's conformance corpus.

**The reference leads.** Where this package and the reference disagree about a
behavior, the reference is the contract, read at a named tag and never at its
`main`. A behavior this package cannot derive from the reference or from a
corpus case is raised in statifier-ex before it is written here.

**The corpus is the spec.** Where this package and the conformance corpus
disagree, the corpus is right and this package has the bug. Where the corpus
and the reference disagree, that is raised in statifier-ex, and the fix arrives
here as a corpus regenerated upstream and vendored again, never as a patch
here.

**The corpus is vendored, never edited.** The corpus is copied from a
statifier-ex tag byte for byte by the reference's own recipe
(`conformance/RATCHET.md`) and recorded with the tag and commit it was taken
at. No case is edited, added, removed or re-expected in this repository.

**The claim is the registry.** This package claims conformance for exactly the
cases its own registry lists. The registry is written only from a run that
observed the pass, and an entry is never removed from it.

**One package, the interpreter core only.** This repository ships a single
package, `@riddler/statifier`, and the package holds five parts: the pure step
function; its own SCXML front end, from the XML text to a compiled chart; the
datamodel binding to `@riddler/predicator`; a small in-memory driver with a
virtual clock; and position export and import in the reference's string-id
vocabulary (`Statifier.Position.export/1` and `Statifier.Position.import/2`
at `v2.9.0`).

**The step function is pure.** It takes a state and an event and returns a new
state and a list of effects as plain data, and it performs no I/O, reads no
clock and holds no timer; a host interprets every effect.

**Appendix D is ported literally.** Each function of the interpreter ports its
Appendix D counterpart argument for argument and result for result and carries
that counterpart's name in the pseudocode's own spelling, which is the name the
reference transliterates. An adaptation the pure core requires deviates
mechanically, never semantically, and is documented where it is made.

**The datamodel is predicator.** No ECMAScript engine is embedded, and nothing a
chart carries is evaluated as JavaScript.

**One runtime dependency.** `dependencies` in `package.json` names
`@riddler/predicator` and no other package. A further runtime dependency is a
decision recorded in this directory before it is taken, naming the package,
what it does that this package cannot, and its own dependency tree.
Development dependencies are not covered by this rule.

**The package is engine-neutral by rule.** It runs unchanged on a server
runtime, in a browser, in a worker and on a React Native JavaScript engine.
Under `src/` there is no DOM reference, no `node:*` import or other Node
built-in, no `eval` and no `new Function`, and no `Intl`. Test code and
`scripts/` are outside this rule.

**The engine-neutrality run comes later.** Running the corpus on the
JavaScript engine React Native uses is later work and not a condition of this
record, and no text in this repository claims such a run before one has
happened and its result is recorded.

**Errors are events inside a chart and values at the API.** An evaluation
failure while a chart runs becomes `error.execution` on the internal queue,
never a thrown exception and never a default value. A function of this
package's API that can fail returns a result carrying a stable reason token.

**The reference is the durable authority; this package is a second executor.**
The Elixir side is the durable authority for an execution. A host that steps
one execution both on a server with the reference and on a client with this
package compares the configuration the client reports against its own and
never accepts the client's word in place of it.

**The position claim is self-consistency.** Until the reference's corpus
carries cases that assert an exported position, the claim this package makes
for position export and import is that a position exported and imported into a
fresh compiled chart continues to the same configurations. No text in this
repository claims parity with the reference's export until then.

**What is not here.** None of the following is in this package, and a reader
does not look for them:

- durable persistence, and the reference's binary position envelope
  (`Statifier.Position.to_binary/1` and `from_binary/2`, `st-ADR-0052` and
  `st-ADR-0064`);
- chart diff and the position compatibility predicate (`st-ADR-0072`);
- publish-time checks (`st-ADR-0073`);
- replay and recording (`st-ADR-0034`);
- telemetry (`st-ADR-0040`);
- the session process and its supervisor (`st-ADR-0027`);
- the validator's warning tier (`st-ADR-0033`) and expression-level source
  spans in diagnostics (`st-ADR-0014`): the validator here reports the errors
  that gate compilation and nothing else;
- invoke source resolution: nothing is fetched (`st-ADR-0024`, `st-ADR-0038`);
- the HTTP event I/O processor;
- the debugger;
- blocks, and the datamodel package;
- timers and storage on a device;
- renderers, and anything React.

**The core carries no router.** No binding of an incoming message to a chart
and an event, and no address table, is part of the core. If a consumer running
this package on a client needs them, they live in a separate package or a
subpath of this one, decided in a record of their own at that time.

**This record asserts rules and delegates every enumeration.** The core
contract - the state, the effect vocabulary, the driver's calls and the
position vocabulary - belongs to ADR-0002. How the corpus is vendored, run and
ratcheted belongs to ADR-0003. A rule stated here binds both.

## Consequences

A behavior that neither the reference nor a corpus case answers is a question
raised upstream, not a gap filled here with a plausible local answer. That is a
slower path, deliberately: the cost of the question is bounded, and the cost of
a silent divergence between two engines that share a chart is not.

A red conformance run is fixed in one of two ways only: a change under `src/`,
or a change in statifier-ex re-vendored here. Because the vendored corpus
records the tag and commit it came from, the diff shows which of the two
happened.

This package will sometimes be behind the reference. Its claim is its registry
against a named tag, and a host reads that claim rather than assuming parity.

The literal port makes review mechanical at a cost in idiom. A reviewer reads
a function beside its Appendix D pseudocode and beside the reference's function
of the same name, and the TypeScript will read less like typical TypeScript
where the pseudocode's shape wins.

Leaving so much out means a host that needs durability, delivery of sends,
timers on a real clock, telemetry or a router builds or takes them elsewhere.
The package stays small enough to embed on a device, and the reference stays
the one place those concerns are decided.

Engine neutrality costs convenience: formatting for a human and any
locale-aware comparison are the host's job. A feature that needs one of the
forbidden constructs is a host concern or a new record, never an exception
argued locally.

Because a client-side execution is a second executor and not the authority, a
host can run a chart on a device for responsiveness without trusting the
device: the server's configuration decides.

This record fixes what kind of thing the package is rather than what it
contains, so it is expected to outlive most records after it. A later record
that needs to take a second runtime dependency, carry something on the list
above, or reach for a forbidden construct supersedes or amends this one, here.

## Note: what this package is not: a router (2026-09-30)

A router takes messages from outside - from a queue, a webhook or another
execution - matches each against a set of bindings, finds or starts the
execution the message is addressed to, and delivers it as an event. In the
family that job belongs to statifier_router, an Elixir package in front of the
durable executions. This package drives one execution in memory and has no
place to keep bindings or an address table, and the Decision's sentence under
"The core carries no router" keeps both out of it.

The question of whether a consumer on a client needs bindings of its own is
open, and it was deferred, ruled by the operator, 2026-09-29, with a trigger
and a home. The trigger is a consumer that runs this package on a client and
needs messages routed to more than one execution there. The home is a separate
package or a subpath of this one, with a record of its own. Until the trigger
fires, nothing here anticipates it.
