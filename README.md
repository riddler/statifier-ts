# @riddler/statifier

A conformant TypeScript sibling of the Statifier statechart engine.

Statifier runs SCXML statecharts. A chart is a document of states,
transitions, timers and the data they read - a library loan that comes due
and may be renewed, a patron registering at a branch - and an interpreter
takes the chart's current configuration and an event and answers the next
configuration together with what the host should do about it.

The reference implementation is
[statifier-ex](https://github.com/riddler/statifier-ex), written in Elixir.
This package is the interpreter core in TypeScript: the same algorithm, held
to the same conformance corpus, so that a chart authored once runs the same
way on a server, in a browser, or in a React Native app. What is shown of that
today is under Conformance and Engines below. It takes a chart and an
event and answers a configuration and a list of effects as plain data;
persistence, a real clock, delivering what a chart sends, and rendering are
the host's.

Every TypeScript example on this page is run by the test suite
(`test/readme.test.ts`), and a line ending in `// =>` is an assertion that
the value on its left equals the value on its right. Every shell command is
checked against the scripts `package.json` declares rather than run.

## Install

Nothing is published yet. When the first version is, the install will be:

```bash
pnpm add @riddler/statifier@^0.1.0
```

The package has **one runtime dependency**,
[`@riddler/predicator`](https://github.com/riddler/predicator-ts), pinned at
`^0.4.0`, which evaluates the conditions, expressions and script bodies a
chart carries, as it does for the reference. `dependencies` in
`package.json` names it and no other package.

`engines.node` in `package.json` is `>=20`, and that is the floor a
consumer's runtime has to clear. It is not the toolchain: what builds and
gates this repository is the one node and the one pnpm `mise.toml` pins.

## The six calls

A host compiles a chart once and drives it with five more calls. The chart
used below is a library loan: the copy goes out for fourteen days, may be
renewed twice, falls overdue when the loan runs out, and stops when it comes
back, answering how many renewals it took.

```ts
import {
  advance,
  compile,
  configuration,
  isDone,
  start,
  step,
} from "@riddler/statifier";

const loanSource = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0"
    name="loan" initial="on_loan">
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
  <state id="overdue">
    <transition event="loan.returned" target="returned"/>
  </state>
  <final id="returned">
    <donedata><param name="renewals" expr="renewals"/></donedata>
  </final>
</scxml>`;

// compile(xml, opts) answers a Chart, or every compile error.
const compiled = compile(loanSource, { chartName: "loan", chartVersion: "3" });
if (!compiled.ok) throw new Error("the loan chart does not compile");
const loan = compiled.chart;
loan.identity.name; // => "loan"
loan.identity.version; // => "3"

// start(chart, opts) binds the datamodel, enters the initial states and runs
// to a stable configuration. The host mints the session id.
const started = start(loan, { sessionId: "loan-copy-17" });
if (!started.ok) throw new Error(started.reason);
configuration(started.state); // => ["on_loan"]
started.effects.map((effect) => effect.kind); // => ["send_delayed"]

// step(chart, state, event, opts?) takes one external event.
const renewed = step(loan, started.state, { name: "loan.renew" });
if (!renewed.ok) throw new Error(renewed.reason);
renewed.effects.map((effect) => effect.kind); // => ["cancel", "send_delayed"]

// advance(chart, state, ms, opts?) moves the virtual clock and fires every
// delayed send due by then.
const fourteenDays = 14 * 24 * 60 * 60 * 1000;
const lapsed = advance(loan, renewed.state, fourteenDays);
if (!lapsed.ok) throw new Error(lapsed.reason);
configuration(lapsed.state); // => ["overdue"]

// isDone(state) answers whether the chart has stopped.
isDone(lapsed.state); // => { ok: true, done: false }
const returned = step(loan, lapsed.state, { name: "loan.returned" });
if (!returned.ok) throw new Error(returned.reason);
isDone(returned.state); // => { ok: true, done: true, donedata: { renewals: 1 }, configuration: ["returned"] }
```

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

const wizard = start(registration, { sessionId: "patron-ada" });
if (!wizard.ok) throw new Error(wizard.reason);
const submitted = step(registration, wizard.state, {
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
queues, the delayed sends a host processor holds, and what it keeps of a
stopped chart. The exported `State` type names every field.
[ADR-0002](docs/adr/0002-the-core-contract.md) is the
record of the whole contract, with its typespecs.

Nothing in the package reads a clock or a random source: time enters only as
the `ms` a host passes to `advance`, the session id is the host's, and every
set of states the state holds is sorted, so the same chart and the same calls
answer the same states and effects on every engine.

## The effects

Every effect is plain data whose `kind` is the reference's tag, and every one
carries the `macrostep`, `microstep` and `round` counters. The core emits
these:

| `kind` | What the host does with it |
|---|---|
| `send` | delivers the event now, by its target and type |
| `send_delayed` | learns of an event due later: the driver holds it as a pending timer until `advance` reaches it, or hands it to the host's processor when its type is registered |
| `cancel` | drops the pending delayed send its `sendId` names, if any |
| `cancel_invoke` | stops the live invocation its `invokeId` names |
| `log` | records the label and the evaluated value |
| `budget_exhausted` | learns a macrostep spent its round budget; the chart still runs |
| `done` | learns the chart stopped, with the top-level final's donedata |

The reference's `invoke`, `autoforward`, `datamodel_init`,
`datamodel_change` and trace effects are not emitted yet; a host that ignores
a `kind` it does not know keeps working as they arrive.

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
reference's, and nothing here claims parity with it: that needs corpus cases
that assert the exported position after a step, which the reference does not
emit yet.

## Conformance

The conformance corpus is the reference's, and it is the spec: a case this
package answers differently from the corpus is this package's bug. The corpus
is copied byte for byte from the reference at tag `v2.9.0`, recorded in the
provenance file `conformance/statifier.vendored.json`, and never edited by
hand. Its registry, `conformance/registry.json`, lists the cases this package
claims to pass - written only by a run that observed the pass, and never
narrowed.

**The claim:** this package makes three claims, with 241 entries in its
registry: `scion` with 119 entries out of the suite's 119 cases,
`w3c-mandatory` with 120 entries out of the w3c suite's 154 mandatory cases,
and `w3c-optional` with 2 entries out of its 2 optional cases. A claim is
exactly its entries: a case with no entry is one this package does not claim
to pass.

**The gap:** it does not yet claim the 32 w3c cases and the 28 statifier cases
the reference's own registry lists that this package's does not, nor the 2 w3c
cases the reference's registry does not list either. `pnpm conformance` runs
the corpus, writes one report per suite under `reports/`, and prints both
lists, every unclaimed case with the reason the run failed it, and each case
the reference claims with the features it needs in the corpus's own words. The
runner drives the scion and w3c suites through the interpreter. A w3c case
that needs `<invoke>`, which this package does not run yet, fails before it
is driven, naming the feature, `invoke_elements`, as the reference's harness
fails a case needing a feature it does not run; every case of the statifier
suite fails with the reason that its suite is not driven yet.

```bash
pnpm conformance      # run the corpus and print the gap list
pnpm registry         # the registry check, a gate stage
pnpm position         # the position round-trip property, a gate stage
```

[`conformance/README.md`](conformance/README.md) says how the copy, the
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
is for, and the engine proof is not yet run: no claim here rests on it.

## Development

```bash
mise install                        # the node and pnpm mise.toml pins
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm run gate          # the full quality gate
```

## License

MIT - see [LICENSE](LICENSE).
