# ADR-0003: The conformance apparatus

Status: proposed (2026-09-30)

## Context

This package is a conformant sibling of the Statifier engine, and the
reference's conformance corpus is what "conformant" means (`CLAUDE.md`, "What
this project is", read at `2fb67c9`). Without an apparatus that makes the claim
checkable, "conformant" is a word in a README. This record decides how this
repository holds itself to the corpus: where the copy lives and how it gets
there, what pins it, what a run reports, how a case the package passes is
recorded, and what the gate checks.

The reference already specifies most of this, and specifies it as a contract
for siblings. Every cite below into statifier-ex is read at tag `v2.9.0`
(`f2365bb8`). Its `conformance/README.md` says what every file in that
directory is and who writes it. Its `conformance/RATCHET.md` is the contract a
sibling's registry is written against: the fields, the per-suite claims, the
three rules, the sibling's check under "The check", and the recipe under
"Vendoring the corpus". Its `conformance/schema/` holds the machine-readable
half: `case.json`, `corpus.json`, `manifest.json`, `registry.json` and
`exclusions.json`. Behind them stand the reference's records ADR-0006 (the
corpus and the regression ratchet; a case with an unsupported feature fails
with the feature named and never skips, under its "Decision") and ADR-0070
(the language-neutral corpus, the registry and the claims). Neither ships a
runner for another language; the runner is this repository's.

There are three places a conformance claim usually rots, and each decision
below answers one. The copy: a vendored corpus that drifts, or that a build
refreshes silently, is no longer evidence, because nobody can say which corpus
a green run was green against. The report: a runner that can emit a third
outcome beside pass and fail will emit it, and a skip reads as a pass in every
summary a person looks at. The record of what passes: a file a person can edit
will be edited to turn a red build green, and a ratchet that can shrink is not
a ratchet.

The reference's corpus is driven by its test harness,
`Statifier.Testing.Case.test_scxml/4` (`lib/statifier/testing/case.ex`). Two
of its behaviours matter here. It compares the active leaf set after each
step, not the whole configuration. And a case whose chart needs timers drives
through a live session under two wall-clock knobs,
`@default_settle_window_ms` (100) and `@default_configuration_deadline_ms`
(4000), whose comments there say why each number is what it is. This package
is an interpreter core with no clock of its own, so its runner needs the same
two knobs in a form that does not read a clock.

Which statifier-ex tag the copy is taken at is not decided here. It is
recorded in the provenance record the recipe writes, and the change that
vendors the corpus names it.

The apparatus ships as vendored data, scripts under `scripts/` and tests
under `test/`, not as package exports, so this record states no public
signature. It does fix the shape of two JSON documents, the provenance record
and this package's registry, and the worked example below shows both.

## Decision

**1. The corpus is vendored, byte for byte, by the reference's own recipe.**
The copy is made by the sequence under "Vendoring the corpus" in the
reference's `conformance/RATCHET.md`, with `DEST` set to
`conformance/statifier`: every file under the reference's `conformance/` at a
statifier-ex tag named in the provenance record, written through `git show`
as git stores it, with no edit of any kind. The copy includes the reference's
own `README.md`, `RATCHET.md`, `schema/`, `cases/`, `corpus/`,
`manifest.json`, `exclusions.json`, `LICENSES/` and the reference's own
`registry.json`, none of which is edited here. A tag is what is recorded,
never a branch. The licences travel with the copy, as that section requires.

**2. The provenance record is the recipe's, beside the copy.** It is
`conformance/statifier.vendored.json` (the recipe's `"$DEST.vendored.json"`),
one line of JSON carrying exactly `repo`, `tag`, `sha` and `corpus_hash`: the
upstream repository, the tag the copy was taken at, the commit that tag
resolves to, and the manifest's `corpus_hash` as recomputed from the copy. It
lives beside the copy rather than inside it so the copy stays byte for byte
what the tag holds.

**3. This package's registry lives outside the copy**, at
`conformance/registry.json`, in the shape the reference's
`conformance/schema/registry.json` defines (decision 12 names the one
state before a first entry that the schema does not admit), with
`implementation` set to `"statifier-ts"`. The reference's registry inside the copy is the reference's
claim and is never this package's.

**4. A refresh is a reviewed change, never a silent update.** Moving the copy
to another tag is a change of its own that runs the refresh script, which
wraps the recipe; its diff is reviewed like code and rewrites the provenance
record in the same change. No build step, test or gate stage fetches from
statifier-ex, and nothing updates the copy as a side effect of anything else.

**5. The four hashes agree, or the gate fails.** The corpus check recomputes
the `sha256:` digest of the corpus files' bytes concatenated in suite order -
`scion`, `w3c`, `statifier`, skipping a suite with no file - exactly as the
recipe does, and requires it to equal each of four fields: the vendored
manifest's `corpus_hash`, the provenance record's `corpus_hash`, this
package's registry's `corpus_hash`, and the vendored reference registry's
`corpus_hash`. A mismatch fails naming the field that disagrees, and is never
repaired by rewriting a hash. A disagreement in the fourth field is a stale or
edited reference copy, and is a finding like the other three. The check runs
in the full gate and in continuous integration on every change, not only on a
change under `conformance/`.

**6. The runner takes the corpus as data and reports every case pass or fail,
with no third value.** A case result is `pass` or `fail`, and a `fail`
carries a reason. A case the package cannot yet run fails with a reason that
names what is missing, using the reference's feature names
(`Statifier.Testing.FeatureDetector`, `lib/statifier/testing/feature_detector.ex`)
where one applies. The runner emits no skip, no pending and no
not-applicable, and never shortens the case set it was given to avoid a
failure, which is the reference's ADR-0006 rule carried unchanged.

**7. A step agrees on the active leaf set, as the reference's harness
compares it.** After initialization and after each step the runner compares
the set of active leaf state ids with the case's expectation, as a set, and
nothing more: no entry or exit order, no internal event, no executable content
(`conformance/RATCHET.md`, "What a case asserts"). It also fails a step at
which an active leaf has no id, since the expectation cannot name it
(`assert_every_leaf_named/2` in `case.ex`); and a step that terminates the
chart is compared on the configuration the chart held at exit, as the
harness's `observed_state_chart/2` restores it.

**8. The runner reproduces the reference's two clock knobs in virtual time.**
The runner owns a virtual clock and fires the chart's pending timers against
it; it never reads a real clock and never sleeps.

- *The settle window, 100 virtual ms.* Before each event is sent, when a timer
  is pending, the runner advances the virtual clock by up to 100 ms, firing
  every timer that falls due within that window, and no further. This drains
  the corpus's load-bearing short delays before the next event and never lets
  a guard send fire (`@default_settle_window_ms` and `settle_short_timers/2` in
  `case.ex`).
- *The configuration deadline, 4000 virtual ms.* After initialization and
  after each event, the runner fires due timers in due-time order until the
  active leaf set equals the expectation, or the chart has terminated, or no
  event is queued and no timer is pending, or 4000 virtual ms have passed since the event; then it
  compares (`@default_configuration_deadline_ms` and `poll_until_settled/4` in
  `case.ex`).

When no timer is pending, neither knob changes anything, so one driving path
reproduces both of the reference's: its synchronous path, which has no timing,
and its session path, which has these two knobs. The reference's poll
interval and its two-poll debounce answer races between processes on a real
clock, and a virtual clock has no such race, so neither is carried.

**9. Reports are build artifacts, never committed.** The runner's reports are
written under `reports/`, which `.gitignore` ignores at `2fb67c9`, and are
regenerated by running the runner. Nothing reads a report from the
repository, and no check trusts a report it did not just produce.

**10. Claims are per suite, and a claim is the exact set of its entries.**
The claim names are the reference's four - `scion`, `w3c-mandatory`,
`w3c-optional`, `statifier` - and an entry counts toward the claim its case's
suite (and, for `w3c`, its case's `conformance`) names
(`conformance/RATCHET.md`, "Claims"). `claims` lists exactly the sorted set of
claim names the entries count toward. A claim does not say that every case of
the suite passes: a partial claim is legal, and it is exactly its entries.
Any count is derived from the entries, never stored beside them.

**11. The registry is written only by the ratchet, from an observed run, and
only grows.** The ratchet script's only input is a report from a run. It adds
the entries whose result is `pass` to those already recorded, writes
`corpus_hash` from the vendored manifest, and writes the file in the
reference's encoding (`conformance/RATCHET.md`, "Ordering and encoding"):
the four top-level keys in order, `claims` on one line, one entry per line,
entries sorted by suite then `case_id`. It refuses to write when an existing
entry did not pass in that run, naming each such case, and it never removes
an entry to get past one (rule 2). There is no command that adds a case by
id, and the file is never edited by hand.

**12. The gate runs the reference's five sibling checks.** The registry test
runs, in the full gate and in continuous integration, the five checks listed
under "The check" in the reference's `conformance/RATCHET.md`, each a hard
failure naming what it caught:

1. the pin: the registry's `corpus_hash` is the vendored manifest's;
2. rule 1: every entry's `case_id` is in the pinned corpus, under the suite
   the entry names;
3. the claims: `claims` is exactly the sorted set of claim names the entries
   count toward;
4. the ratchet: every entry's case passes when run today;
5. rule 3: there is something to check - a corpus to read and a case run.

Until the ratchet writes a first entry, this package claims nothing. Its
registry then carries the pin, `claims` empty and `entries` empty, and the
registry test states that no claim is made rather than reporting a checked
claim; the runner still runs, and reports, every case of the suites it runs.
From the first entry on, the reference schema's `minItems: 1` on `claims` and
`entries` binds, and a registry with no entries is refused, as rule 3 refuses
it. This is the one place the apparatus reads a reference rule as scoped: rule
3 is read as binding a claim, and a registry that makes none is not reported
as a pass of anything.

**13. The position round-trip is a property of the runner, beside the claim,
and is a self-consistency claim.** The runner checks, beside the cases it
claims, that exporting the position at a step, importing it into a chart
compiled afresh from the same source, and continuing leaves every later step
agreeing with the run that was not interrupted. The property is reported with
the run and apart from the registry: it is not a claim name, it adds no entry,
and a claim never depends on it. It is a self-consistency claim - this package
agreeing with itself across its own export and import - until the reference
emits corpus cases that assert the exported position; no text here claims
parity with the reference's `Statifier.Position.export/1`. The position
vocabulary itself belongs to the core contract record (drafted beside this
one, bead sts-sx5).

**14. Where this record and the reference's `conformance/README.md` or
`conformance/RATCHET.md` disagree, those documents win**, and the divergence
is a defect here, raised in statifier-ex rather than settled here for good.
Restating their rules is not amending them. Decision 12's scoping of rule 3
is the one reading this record takes, and it is named there.

## Worked example

The provenance record the recipe writes, one line (the values in angle
brackets stand for what the change that vendors the corpus writes):

```json
{"repo":"https://github.com/riddler/statifier-ex","tag":"<the statifier-ex tag>","sha":"<the commit the tag resolves to>","corpus_hash":"sha256:<64 hex digits>"}
```

This package's registry before its first entry, making no claim:

```json
{
  "implementation": "statifier-ts",
  "corpus_hash": "sha256:<the vendored manifest's 64 hex digits>",
  "claims": [],
  "entries": []
}
```

The same registry after the ratchet writes a first passing `scion` case, in
the reference's encoding (`scion/basic/basic0` is a case id from the reference's
`conformance/registry.json` at `v2.9.0`):

```json
{
  "implementation": "statifier-ts",
  "corpus_hash": "sha256:<the vendored manifest's 64 hex digits>",
  "claims": ["scion"],
  "entries": [
    {"case_id":"scion/basic/basic0","suite":"scion"}
  ]
}
```

## Consequences

A conformance claim here is reproducible by a stranger: the provenance record
names bytes by tag, commit and hash, the registry names the cases, and the
runner regenerates the evidence. The cost is that moving the corpus is never
incidental: a new tag is a reviewed change that may turn the registry's checks
red, and turning them green is a fix in `src/`, not an edit to the record of
what passes.

The four-hash check catches an edit to the copy, a provenance record written
by hand, a registry pinned to another corpus, and a reference registry out of
step with its own manifest, at the next gate rather than at the next release.

Never-skip makes early states look worse than a skip-based harness would:
before the core lands, every case fails, each naming its gap. That is the
intended reading, and the per-suite claim keeps it affordable, since a partial
claim is honest and exact.

Because the registry only grows, a case that passes today constrains every
later change. A refactor that loses a case lands by fixing the code or by
raising the disagreement with the corpus in statifier-ex, never by dropping
the entry.

The virtual clock makes the timed cases deterministic and fast, and takes the
reference's numbers as they are. A chart whose load-bearing delay is longer
than the corpus's would need a knob changed; the corpus has none, and a change
to either number is a change to this record.

The round-trip property proves only that this package's export and import
agree with each other. It says nothing about agreement with the reference's
export, and nothing here may read it as saying so, until the reference's
corpus asserts positions.

## Amendment: the sends a host case expects (2026-10-01)

Status: proposed

Decision 7 says a step agrees on the active leaf set "and nothing more". That
stands for a case with no `host` object. This Amendment adds one comparison
for a case of the statifier suite that carries one, because the reference's
runner compares it there: `run_case/1` in
`lib/mix/statifier/corpus/runner.ex` at `v2.9.0` hands such a case to
`Mix.Statifier.Corpus.HostCase.run/2` in
`lib/mix/statifier/corpus/host_case.ex` at `v2.9.0`, whose moduledoc says the
case agrees when its configurations agree and "the sends handed to the
processor over the whole run, in order, are exactly its `expect_sends`".

What the runner does for such a case, each as the reference's harness does it:

- It registers each type in the case's `send_types` with one processor of its
  own, handed to the driver's `start`, `step` and `advance` through their
  `sendTypes` option. The processor records every send it is handed and
  delivers none; a delayed send handed to it is never fired
  (`HostCase.Processor` at `v2.9.0`).
- It drives the case as decisions 7 and 8 drive any other, and a step's event
  carries the step's `data` as its payload when the step gives one
  (`event/1` in `host_case.ex` at `v2.9.0`).
- It writes each handed send as an `expect_sends` item: `type`, `target`,
  `event` with its `name` and, when the send carries a payload, its `data`;
  `delay_ms` for a delayed send; `send_id` only when the author named the
  send (`item/2` in `host_case.ex` at `v2.9.0`). A payload that is undefined,
  null or an empty map is left out, as `item/2` leaves it out.
- A cancel that reaches the processor marks `"outcome": "cancelled"` on each
  delayed send handed before it under the cancel's send id whose expected
  item asks for it (`cancel_named/2` in `host_case.ex` at `v2.9.0`).
- Once every configuration agrees, the items handed over the whole run, in
  order, must be exactly the case's `expect_sends`; a difference fails the
  case naming both lists (`handed/2` in `host_case.ex` at `v2.9.0`).

Three things the reference's harness does are not run here, and each fails
its case with a reason under decision 6, never patched around:

| Host keys | What the reference does with them | Here |
|---|---|---|
| an `expect_sends` item with `"outcome": "fail"` | reports the send failed through `Statifier.Session.failed_send/3`, so the sender takes `error.communication` (`perform_outcome/4` in `host_case.ex` at `v2.9.0`) | fails the case: `SendProcessor.deliver` in `src/driver.ts` (read at `b4565d8`) answers nothing and the driver offers no call that reports a failed send |
| `declared_events`, `expect_accepts` | compares `Statifier.Chart.check_accepts/2`'s answer before it starts the case (`accepts/2` in `host_case.ex` at `v2.9.0`) | fails the case before it is driven: this package does not port the accepts check |
| `to_source`, `mapping`, `expect_diff`, `expect_compatible_at` | compares them in its test suite through its chart diff and its position predicate, as the moduledoc of `host_case.ex` at `v2.9.0` says; its runner compares none of them | fails the case before it is driven: this package does not port the chart diff or the position predicate |

The failed-send row adds no driver surface: decided by the conductor under the
operator's standing consent, 2026-10-01. The accepts and diff rows leave
those cases unclaimed with their reason in the gap list: ruled by the
operator, 2026-10-01; a later claim of them is additive.

The change that adds this Amendment adds the code: `runHostCase` and
`runStatifierCase` in `test/conformance/statifier.ts`, and the statifier
branch of `runCorpusCase` in `test/conformance/runner.ts`.

## Note: the diff cases are driven (2026-10-01)

The diff row of the Amendment above, "the sends a host case expects", says a
case whose host carries `to_source`, `mapping`, `expect_diff` or
`expect_compatible_at` fails "before it is driven: this package does not port
the chart diff or the position predicate". That row read the four keys as a
feature the harness does not run. The reference's runner does not read them
that way: its moduledoc says it "compares none of them: it runs such a case
like any other host case" (`Mix.Statifier.Corpus.HostCase` in
`lib/mix/statifier/corpus/host_case.ex` at `v2.10.0`), the reference compares
the four keys only in its own test suite (`test/corpus/diff_cases_test.exs` at
`v2.10.0`), and its registry, in the vendored copy at `v2.10.0`, claims every
case under `statifier/diff/`. The Amendment left these cases unclaimed and said
a later claim of them is additive; claiming them as the reference's runner
does was ruled by the operator, 2026-10-01.

The change that adds this Note does so. `notPorted` in
`test/conformance/statifier.ts` no longer names the four keys, so a diff case
is driven as any other host case and agrees on its configurations, under
decision 7, and on its sends, under the Amendment above. The ten cases under
`statifier/diff/` pass that drive and `conformance/registry.json` claims them,
written by `pnpm ratchet` from the run that observed it. Nothing here compares
the four keys: this package still does not port the reference's chart diff or
its position predicate, so the claim says the cases' configurations and sends
agree with the reference's and says nothing about a diff. The Amendment's
other two rows stand.
