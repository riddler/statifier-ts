# conformance/

A language-neutral conformance corpus for SCXML state charts, emitted by
statifier-ex so that another implementation of the same engine can make a
claim against the same cases
([ADR-0070](../docs/adr/0070-statifier-emits-a-language-neutral-conformance-corpus.md)).

| Path | What it is | Written by |
|---|---|---|
| `README.md` | this file | hand, reviewed like code |
| `RATCHET.md` | the contract a registry is written against: the claims, the pin, the rules a check enforces, and the vendoring recipe for a sibling implementation | hand, reviewed like code |
| `schema/` | JSON Schemas (draft 2020-12) for every file below: `case.json` (one case), `corpus.json` (one corpus file), `manifest.json`, `registry.json`, `exclusions.json` | hand, reviewed like code |
| `cases/` | the `statifier` suite's cases, which this repository authors: per case, an SCXML document and a JSON file holding its description, its expected configurations and its `host` object. `library/` holds the library-world cases the section below describes, `accepts/` the case that checks a chart's declared events against it, and `diff/` the cases that diff two charts, each with a third file, `<name>.to.scxml`, holding the second chart; `send/` and `system_variables/` hold the earlier authored fixtures | hand, reviewed like code |
| `corpus/` | one file per suite that has cases, holding that suite's cases: `scion.json` and `w3c.json` for the upstream suites, and `statifier.json` for the cases this repository authors itself (ADR-0070 decision 5) once it authors one | the emitter |
| `manifest.json` | the corpus hash, the corpus files and the upstream suites (a claim pins a corpus by its hash and the statifier-ex tag it was vendored from, not by a version in the file) | the emitter |
| `registry.json` | the cases statifier-ex passes, derived from `test/passing_tests.json` | the emitter |
| `exclusions.json` | the upstream documents left out of the corpus, each with its reason | the emitter |
| `LICENSES/` | the licence texts the upstream cases are redistributed under: the W3C 3-clause BSD License with the W3C test suite's copyright notice, and the Apache License 2.0 SCION ships | copied from the upstream licences, reviewed like code |

The corpus, the manifest, the registry and the exclusions are generated and
never edited by hand: a change to one is a change to the emitter or to its
input, regenerated. The same rule holds for the generated test modules under
`test/scion_tests/` and `test/scxml_tests/`, which `mise run corpus:emit`
writes from `corpus/`. Only the files the table marks as written by hand are
edited directly. `test/passing_tests.json` stays the ratchet file
([ADR-0006](../docs/adr/0006-reuse-conformance-corpus-and-regression-ratchet.md)).

`mix statifier.corpus` is the emitter: it reads the upstream suites that
`mise run corpus:fetch` and `mise run corpus:transform` put in the gitignored
`tools/corpus/scratch/` and the authored cases under `cases/`, runs every
case through statifier, and writes the generated files.
`mix statifier.corpus --check` writes nothing and needs no
upstream tree: it re-runs every committed case and fails when a generated
file differs from what the emitter would write from the committed inputs, or
when there is nothing to check. Its module documentation
(`Mix.Statifier.Corpus.Emitter`) states the rules; three are worth knowing
before reading the files:

- `corpus_hash` in `manifest.json` is `sha256:` and the hex SHA-256 of the
  corpus files' bytes concatenated in suite order (`scion`, `w3c`,
  `statifier`), skipping a suite with no file.
- A suite with no cases has no corpus file and no manifest entry.
- An exclusion keyed by a SCION directory stays one entry naming the
  directory; it is not expanded into the upstream cases under it.

This directory is not part of the Hex package: a sibling implementation
vendors it from a statifier-ex tag, byte for byte, with `LICENSES/` and every
case's `upstream` field, and writes its own registry against it. The recipe
and the registry contract are [`RATCHET.md`](RATCHET.md).

## The library world

The cases under `conformance/cases/library/` share one small domain, so that
a reader who has read it once can read any of them. This section is where
that domain is defined: a sibling implementation, and every other package in
the family that wants the same vocabulary, takes these values from here
rather than re-deriving them from a case.

The nouns are patron, copy (of a title), loan, hold and branch.

The ids are strings, and these are all of them:

- patron `p-1`, whose standing is good
- patron `p-2`, who is blocked
- copy `c-1`, a copy of title `t-1`
- branch `b-1`

The durations are written in days and carried in the cases as milliseconds,
so both forms appear here and a reader can check one against the other:

| What | Days | Milliseconds |
|---|---|---|
| the loan period | 21d | 1814400000 |
| the due-soon reminder, from checkout | 18d | 1555200000 |
| the lost-item timer, after due | 28d | 2419200000 |
| the pickup window | 7d | 604800000 |

`max_renewals` is 2.

The day unit is what the library cases write: a document says
`delay="21d"`, and the case's `delay_ms` carries the same span as a number.
The engine accepts `d` because `Statifier.Duration` delegates
`Predicator.Duration.parse/1` whole rather than re-restricting parsing to
the SCXML schema's five units, so `y`, `mo`, `w`, `d`, `h`, `m`, `s` and
`ms` all parse (`lib/statifier/duration.ex`, under "The unit set is a
superset, delegated as-is").

Two send types are registered, and only two:

- `library:timer` is every timer in the world. It belongs to the host: the
  engine schedules nothing for it and never fires it, the host's processor
  records it and delivers nothing, and the case injects the fired event as
  a step. Its target is the name of the chart the timer returns to, which
  is always the chart that sent it: the loan cases write `target="loan"`.
- `library:route` is a cross-execution send. Its target is the name of the
  receiving chart.

Every library case whose chart sends registers both send types,
`library:timer` then `library:route`, even a case that sends only one of
them; a case whose chart sends nothing (the patron chart) carries no `host`
object and registers nothing.

Three charts divide the world:

- `loan`, one execution per loan
- `patron`, one execution per patron, with three parallel regions: `standing`, `fines` and `desk`
- `hold_queue`, one execution per copy

The events are `loan.renew`,
`loan.due_soon`, `loan.due`, `loan.lost`, `copy.returned`, `copy.disputed`,
`dispute.resolved`, `patron.blocked`, `patron.reinstated`, `fine.assessed`,
`fine.paid`, `loan.requested`, `hold.placed`, `copy.available`,
`pickup.expired` and `copy.collected` - sixteen, counted off that list.

The case under `conformance/cases/accepts/` is in this world too, and it
proves the publish-time refusal of a declaration that promises an event
name the chart never listens for. Its `host` object carries
`declared_events` and `expect_accepts` (ADR-0071 decision 7): before the
case runs, the runner calls `Statifier.Chart.check_accepts/2` with the
declaration and compares both lists it answers, order included. The loan
chart declared to accept `loan.renew`, `copy.returned` and `loan.archived`
answers `loan.archived` as unreachable, because no transition in the chart
listens for it. The running engine refuses nothing there - an event no
transition matches changes no configuration - so this answer is what a
host's publish step refuses on. The case's schema is this directory's
`schema/case.json`; this suite shares no schema with the router's corpus or
with a reference host's cases.

The cases under `conformance/cases/diff/` are in this world too, and they
prove the two questions a host asks before it moves an execution from one
chart to an edited one; nothing in them moves anything. Each pairs a
`hold_queue` or a `loan` chart with an edit of it: the host object carries
the edited chart as `to_source` and `expect_diff`, the class and reasons
`Statifier.Chart.diff/3` answers (ADR-0072 decisions 1 and 2), with the
`mapping` it is given where a case gives one. The emitter runs these cases
as it runs any host case; the class and the reasons, order included, are
compared by this repository's test suite
(`test/corpus/diff_cases_test.exs`), because nothing in `lib/` calls either
function (ADR-0072 decision 6). Four `hold_queue` pairs are one per class:
the same bytes (identical), an added `<data>` key (compatible), and `awaiting_pickup`
renamed to `ready_for_pickup` with a mapping (mapped) and without one
(breaking). A case may also carry `expect_compatible_at`, what
`Statifier.Position.compatible_at?/3` answers (ADR-0072 decision 4) at the
position its steps leave the chart in: `Statifier.Position.export/1` holds
atoms, sets and tuples, so the case states no position, and every such
hold case's steps put `p-1`'s hold in `awaiting_pickup` with its pickup timer
handed to the host. The predicate answers true when only `idle` is edited (a
breaking pair harmless at this position), false when a transition of
`awaiting_pickup` itself gains content (a compatible pair with no reasons),
false when the edit is a transition of `open`, a compound state one case
wraps around `idle` and `awaiting_pickup` and so an ancestor of the active
state, and false for the rename with or without a mapping.
`schema/case.json` gives each reason as an object: `reason`, then the
members that reason carries.

Three more pairs take the loan while it waits for its copy to come back: a
`loan` chart whose execution starts in `awaiting_return` with its due-date
timer handed to the host, and whose `check_in` state routes the returned
copy after the wait. Each edit gives `check_in` a damaged outcome (a new
`damaged` key, a new `in_repair` final state and the transition to it),
and each is one class: with `awaiting_return` kept by id the pair is
compatible and the predicate answers true; with it renamed to
`awaiting_check_in` and a mapping given the pair is mapped and the
predicate answers false, since it takes no mapping; with it kept by id but
gathered with `overdue` under a new compound state the pair is breaking
and the predicate answers false.

The authored cases that came before the library world keep their own
domain: the four under `cases/send/` and the one under
`cases/system_variables/` are fixtures for the behaviour they pin, not
teaching examples, and nothing here rewrites them into this vocabulary.

## What a send's outcome claims

A case's `host` object lists in `expect_sends` the sends the case expects
handed to the host's processor, in the order handed over the whole run;
[`RATCHET.md`](RATCHET.md) states the item shape. An item may also carry an
`outcome` (ADR-0070's 2026-09-23 Amendment), and `schema/case.json` allows
exactly two values:

- `"fail"`: the runner reports the send as failed as soon as it is handed,
  before it reads the configuration that follows, so the sender takes
  `error.communication` carrying the send's `sendid`, and the case's
  configurations say what the chart made of it.
  `cases/send/registered_send_failed` is such a case.
- `"cancelled"`: a `<cancel>` naming the send must reach the processor
  after the send was handed. Only a delayed send can be cancelled, because
  a cancel reaches a processor only for a delayed send it was handed.
  `cases/send/registered_delayed_cancel` is such a case: with the cancel
  taken out of its document, no cancel reaches the processor and the case
  disagrees.

An item with no `outcome` claims nothing about the send beyond its being
handed: the host records it and does nothing else with it, and a cancel
naming it is not compared. A case agrees only when the sends handed are
exactly its `expect_sends`, outcomes included.
