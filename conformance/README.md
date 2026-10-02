# conformance/

How this package holds itself to the reference's conformance corpus. The
corpus is the spec: a case this package answers differently from the corpus
is this package's bug. The record that decides everything here is
[ADR-0003](../docs/adr/0003-the-conformance-apparatus.md).

| Path | What it is | Written by |
|---|---|---|
| `statifier/` | the reference's `conformance/` directory at the tag the provenance record names, byte for byte: its corpus, manifest, schemas, authored cases, licences, exclusions, its own `README.md` and `RATCHET.md`, and its own `registry.json` (the reference's claim, never this package's) | `pnpm corpus:refresh`, never by hand |
| `statifier.vendored.json` | the provenance record: the upstream repository, the tag, the commit the tag resolves to, and the corpus hash recomputed from the copy, as one line of JSON | `pnpm corpus:refresh` |
| `registry.json` | this package's registry: the corpus cases it claims to pass, against the pinned corpus | `pnpm ratchet`, never by hand |
| `README.md` | this file | hand, reviewed like code |

## What is vendored, and from where

The copy is statifier-ex's `conformance/` at the tag in
`statifier.vendored.json`, taken by the sequence under "Vendoring the corpus"
in the reference's [`RATCHET.md`](statifier/RATCHET.md) with `DEST` set to
`conformance/statifier`. What every file in it is, and who writes it upstream,
is the reference's [`README.md`](statifier/README.md); the contract this
package's registry is written against is that `RATCHET.md`. Both are read in
the copy, at the tag, never at the reference's `main`. The licences travel
with the copy, in `statifier/LICENSES/`.

The corpus has three suites: `scion` and `w3c`, carried from upstream test
suites, and `statifier`, the cases the reference authors itself. The manifest
in the copy gives each suite's file and case count, and the corpus hash every
claim is pinned to.

## The commands

```bash
pnpm corpus:refresh --tag <tag> --from <a statifier-ex clone>   # move the copy to a tag
pnpm corpus:refresh --tag <tag> --from <a statifier-ex clone> --check   # compare, write nothing
pnpm corpus:check     # the four hashes agree (a gate stage)
pnpm conformance      # run the corpus, write reports/<suite>.json, print what is not yet claimed
pnpm ratchet          # record in registry.json the cases the last run passed
pnpm registry         # the registry check (a gate stage)
pnpm position         # the position round-trip property over the scion suite (a gate stage)
```

**Refresh.** Moving the copy to another tag is a change of its own, reviewed
like code: the refresh refuses while the copy or its record has uncommitted
changes, re-runs the recipe, requires the copy to hash to its manifest's hash,
and rewrites the provenance record. Without `--from` it clones the reference
from its public URL, as the recipe does. Nothing else ever fetches from the
reference or updates the copy. A new tag changes the corpus hash, and the
registry check then fails on the pin until a run re-verifies every entry and
the ratchet re-pins the registry.

**Check.** `corpus:check` recomputes the corpus hash from the copy - SHA-256
over the bytes of the suite files concatenated in suite order, scion, w3c,
statifier - and requires it to equal the vendored manifest's, the provenance
record's, this registry's and the vendored reference registry's. A mismatch
fails naming the field, and is never repaired by rewriting a hash.

**What the gate holds, and what it does not.** The gate holds the three
suite files, `corpus/scion.json`, `corpus/w3c.json` and
`corpus/statifier.json`, byte for byte: the corpus hash is taken over their
bytes, so `corpus:check` fails on any edit to them. Of the rest of the copy
it holds only parts. `corpus:check` reads the `corpus_hash` field of the
vendored manifest and of the vendored reference registry, and holds the
manifest's list of suites to the suite files it names, each present with the
case count the manifest gives. The test stage holds the provenance record,
beside the copy, to the exact line the recipe writes at the tag; requires the
reference's `README.md`, `RATCHET.md`, `exclusions.json`, licences, schemas
and `cases/` directory to exist; and reads the reference registry's entries
to count the cases this package does not yet claim, so an edit to an entry
fails the gate only when it changes what those tests count. Nothing in the
gate compares any other byte of the copy with the tag: an edit to an
authored case under `cases/`, to the manifest outside the fields above, to a
schema, a licence, `exclusions.json`, the reference's `README.md` or
`RATCHET.md`, or to a reference registry entry that leaves those counts as
they were, passes the gate.

The whole copy is held by `corpus:refresh --check`. It re-runs the recipe
from the tag into a temporary directory, compares every file there and in
the copy, and the provenance record, byte for byte, names each difference,
and exits 1 on any. It reads the reference, from the clone `--from` names or
from its public URL, and nothing in the build, the tests or the gate reads
the reference (ADR-0003 decision 4), so it runs only when someone runs it,
by the command above. A change that touches the copy is the time to run it,
beside the review of its diff.

**Run.** `pnpm conformance` runs every suite, or the ones named with
`--suite`, and writes one report per suite under `reports/`, which git
ignores. Every case is a `pass` or a `fail` with a reason; there is no third
value and no case is left out. The runner drives each scion and w3c case
through the interpreter, compares the active leaf set after the start and
after each event as the reference's harness does, and moves a virtual clock
by the two knobs ADR-0003 fixes (a settle window of 100 ms before each event,
a deadline of 4000 ms after it). The reference's runner routes a case of any
suite by whether it carries a `host` object (`run_case/1` in
`lib/mix/statifier/corpus/runner.ex` at `v2.10.0`). A case with none goes
through one function (`test_scxml/4` in `lib/statifier/testing/case.ex`),
and the runner drives every such scion and w3c case through one drive: a w3c
case carries no step and expects its chart to rest in the `pass` state once
it has run as far as it can. A case with one, which at `v2.10.0` includes a
w3c case naming an Event I/O Processor, goes through the reference's
host-case harness, and the runner drives it through its host-case drive,
below. A w3c case that needs
`<invoke>` is driven with its child run in process by the driver, on the
same virtual clock, as the reference's harness drives it through a session.
The reference's rule for a feature a harness does not run - fail the case
before it starts, so that the feature never passes as a test it did not run
(ADR-0003 decision 6) - stays in the runner, and names no feature now.

A w3c case may carry a `host` object whose one key, `event_io_processors`,
names the Event I/O Processors the host runs, by URI (the copy's
`RATCHET.md`, "The host object"). The reference's runner registers each under
its URI and its short form and delivers every send to it through a loopback
front it starts for the case (`with_event_io_processors/2` in
`lib/mix/statifier/corpus/host_case.ex` at `v2.10.0`), an HTTP server on a
local port (`Mix.Statifier.BasicHTTPFront` in
`lib/mix/statifier/basic_http_front.ex`). Its host-case harness runs no
feature check. The runner here routes such a case to the host-case drive,
with no feature check either, and registers the package's own Basic HTTP
processor (`basicHttp` from `@riddler/statifier/basichttp`, the one member
of the closed set, `EVENT_IO_PROCESSORS` in `test/conformance/loopback.ts`)
under its URI and its short form `basichttp`. Its transport is an in-memory
loopback front (`loopbackFront` in the same file), the reference's front
without the socket: a request to the front's base URL, `/`, and the case's
session id is decoded by the package's own `decodeRequest` and its event
stepped into the session, answering 204; a path that names no live session
answers 404, a method other than POST 405, a request that forms no event
400; and it does not deduplicate, as the reference's front does not. A claim
of such a case rests on that loopback: it proves the processor's and the
core's event I/O logic, not a network round trip (ADR-0003's Amendment "the
Basic HTTP cases are driven through a loopback front"). A case naming a
processor outside the closed set fails before it is driven, with the reason
that it names an Event I/O Processor this runner does not register, followed
by the processor's URI; the copy's `RATCHET.md` says an implementation that
does not run a processor the case names leaves the case unclaimed.

The reference's runner routes a statifier case by whether it carries a `host`
object (`run_case/1` in `lib/mix/statifier/corpus/runner.ex` at `v2.9.0`).
A case with none is driven as a scion case is. A case with one is driven as
the reference's host-case harness drives it (`Mix.Statifier.Corpus.HostCase`
in `lib/mix/statifier/corpus/host_case.ex`): the runner registers each of the
case's `send_types` with one processor of its own, passed to the driver
through `sendTypes`, which records every send it is handed and delivers none,
and never fires a delayed one; a step's event carries the step's `data` when
it gives one. Each handed send is written as an `expect_sends` item - `type`,
`target`, `event` with its `name` and its `data` when it carries one,
`delay_ms` when delayed, `send_id` when the author named it - and once every
configuration agrees, the items handed over the whole run, in order, must be
exactly the case's `expect_sends`. A cancel that reaches the processor marks
`"outcome": "cancelled"` on the delayed sends it names whose item asks for it,
so an item marked cancelled that no cancel reached disagrees (ADR-0003's
Amendment of 2026-10-01). A handed send whose expected item, at the same
position, says `"outcome": "fail"` is reported failed through the driver's
`reportSendFailed` once the call that handed it returns, before the
configuration is read, and its item is marked so, as the reference's harness
reports it through `Statifier.Session.failed_send/3` (`perform_outcome/4` in
`host_case.ex` at `v2.10.0`). A case whose host carries a diff pair - `to_source`
and `expect_diff`, with an optional `mapping` and `expect_compatible_at` - is
driven the same way and agrees on its configurations and its sends, as the
reference's runner drives it: that runner compares none of the four keys, and
the reference compares them only in its own test suite
(`test/corpus/diff_cases_test.exs` at `v2.10.0`), through its chart diff and
its position predicate, which this package does not port (ADR-0003's Note of
2026-10-01). A case whose host carries `declared_events` and `expect_accepts`
has its chart's accepts check compared before it is driven, as the
reference's harness compares it (`accepts/2` in `host_case.ex` at `v2.10.0`):
the two lists `checkAccepts` answers must be exactly the expected ones, order
included, and either key without the other fails the case.

**Ratchet.** `pnpm ratchet` reads only the reports the last run wrote. It
refuses, writing nothing, when a report is of another corpus or is not a run
of a whole suite, and when an entry already recorded did not pass in that
run. Otherwise it writes the union of the recorded entries and the passes,
with exactly the claims they count toward, one entry per line. A run that
passed nothing new writes nothing. There is no command that adds a case by id.

**Registry check.** `pnpm registry` runs the five checks under "The check" in
the reference's `RATCHET.md` - the pin, rule 1, the claims, every entry passing
when run today, and something to check - and fails on a file the ratchet would
not have written. Before the first entry the registry carries the pin, no
claims and no entries, and the check says that no claim is made.

## The position round trip

`pnpm position` holds `exportPosition` and `importPosition` to a round-trip
property over the scion suite, and `pnpm conformance` prints the same counts
after a run of that suite. For each case it drives the chart as the scion
runner does and takes a point after the start and after every step. At each
point it exports the position, writes it to JSON text and reads it back,
compiles the case's source again into a fresh chart, imports the position
into it, and drives the remaining steps on the imported state the same way.
At the point and after every later step the imported state must hold what
the unbroken drive holds: every field a position carries, the configuration
first, and whether the chart has stopped. A carried point that disagrees
fails the stage, named with its case, its step and the field.

A point the export cannot carry is counted with its reason, not compared:
the export's own refusals (`internal_queue_not_empty`, `unnameable_states`),
and the driver state a position does not hold - a pending timer
(`pending_timers`), an external event not yet taken, a delayed send a
processor holds, a spent round budget. ADR-0002 says why pending timers are
driver state and not position fields. Two of those reasons are expected, a
pending timer and the export's `internal_queue_not_empty`; a point not carried
for any other reason fails the stage, so a new one is read before it lands.
A run where no point agrees fails it too, since the property then compared
nothing.

A chart already stopped at the point is compared by the configuration the
state holds, whether it is running, its status and whether `isDone` answers
stopped, and not by the configuration it stopped in: that one travels in the
done effect, never in the position, so the imported state answers the
position's own configuration there.

**This is a self-consistency claim.** It shows the package agreeing with
itself, nothing lost on the way out and back; it does not show that the
export matches the reference's, and nothing here claims parity with the
reference's export. That needs corpus cases that assert the exported position
after a step, which the reference does not emit yet.

## The engine proof

`node scripts/hermes-conformance.mjs --tools <dir>` (or with the tool
directory in `STATIFIER_HERMES_TOOLS`) bundles the runner with the vendored
corpus, runs every suite on a standalone Hermes VM and on Node, and compares
the two reports case by case: the outcome and the reason of every case, and
any case one side reports and the other does not. It excludes no case, and it
exits non-zero on any difference. It is not a gate stage; the script's header
says what fills the tool directory.

**The result, 2026-10-01.** Run at commit `15980e9` on `main`, with the corpus
at `v2.10.0`, on the VM's release 0.12.0, bytecode version 89:

| Suite | Rows on Node | Rows on the VM | Differences |
|---|---|---|---|
| `scion` | 119 | 119 | 0 |
| `w3c` | 168 | 168 | 0 |
| `statifier` | 31 | 31 | 0 |

Every suite agreed row for row. The rows agree on fails as well as passes:
the three w3c cases the run fails on Node (under "What is not yet claimed"
below) fail on the VM with the same reason.

**What it covers.** The standalone VM is an older release than the engine
current React Native ships. It refuses the `class` keyword, so its bundle is
put through a class transform, and it refuses an `async` function, so its
bundle targets ES2016 and the bundler lowers each `async` function to a
generator; the Node bundle is built from the same entry and corpus without
those two passes. So the result is a proof against that VM: evidence about
the engine family and about this package's use of the language, not a run on
the engine build an application ships. The Basic HTTP cases are driven on the
VM through the same in-memory loopback front as on Node (under "Run" above),
so they prove the processor's and the core's event I/O logic on the engine,
not a network round trip on a device.

## What is not yet claimed

The reference's own registry, inside the copy, lists the cases the reference
passes. The difference between it and this package's registry is what this
package does not yet claim, and `pnpm conformance` prints it after every run,
for the suites it ran, each case with the features it needs, its
`required_features` in the corpus's own words, and the reason the run failed
it. It then prints the cases of the suites it ran that the reference's
registry does not list either, each with the reason the run failed it: the
gap list is read off the reference's registry, so without this second list
those cases would go unnamed. Where the run's reason says only where a case
failed and the cause has been found by reading the case, a line in either list
ends with that cause (`KNOWN_CAUSES` in `test/conformance/reports.ts`), and a
test observes each cause again, so one that stops holding fails the gate. No
case carries such a cause today.

This package's registry claims every scion case and the w3c and statifier
cases a run observed to pass; the claims `w3c-mandatory`, `w3c-optional` and
`statifier` are exactly those entries, and a w3c or statifier case with no
entry is one this package does not claim to pass. What the run fails in the
w3c suite falls in two groups, and neither holds a case the reference claims:

- `w3c/test201`, which names the Basic HTTP Event I/O Processor and which the
  reference's registry does not list, because it expects a send delivered
  from outside the session to arrive ahead of a send the same step appends to
  the session's own external queue, which no delivery over HTTP does (the
  copy's `RATCHET.md`, "The host object"); it is driven through the loopback
  front (under "Run" above) and fails here on the configuration it rests in,
  for that cause;
- `w3c/test330` and `w3c/test552`, which the reference's registry does not
  list, and which fail here on the configuration the chart rests in.

The cases whose `host.event_io_processors` names the Basic HTTP Event I/O
Processor and which the reference claims - `w3c/test509`, `w3c/test510`,
`w3c/test518`, `w3c/test519`, `w3c/test520`, `w3c/test522`, `w3c/test531`,
`w3c/test532`, `w3c/test534`, `w3c/test567` and `w3c/test577` - are claimed:
the run drives each through the loopback front, and the claim rests on that
front, not on a network round trip.

The run fails no case in the statifier suite.
`statifier/accepts/loan_declares_an_unreachable_event`, the accepts case, is
claimed: the run compares the chart's accepts check before it drives the case
and passes it on that check, its configurations and its sends.
`statifier/send/registered_send_failed`, the case that asks the host to
report a send failed, is claimed: the run reports the send through the
driver's `reportSendFailed` and passes it on its configurations and its sends.

The ten cases under `statifier/diff/`, the diff cases, are claimed: the run
drives each as the reference's runner does and passes it on its
configurations and its sends.
