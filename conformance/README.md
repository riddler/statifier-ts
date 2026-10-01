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
a deadline of 4000 ms after it). The reference's harness drives the two
suites through one function (`test_scxml/4` in
`lib/statifier/testing/case.ex` at `v2.9.0`), and the runner drives them
through one drive: a w3c case carries no step and expects its chart to rest
in the `pass` state once it has run as far as it can. A w3c case that needs
`<invoke>`, which this package does not run yet, fails before it is driven,
naming the feature, `invoke_elements` in the reference's feature names: the
reference's harness runs `<invoke>`, and its rule for a feature a harness
does not run is to fail the case before it starts, so that the feature never
passes as a test it did not run (ADR-0003 decision 6).
A case of the statifier suite fails with the reason that its suite is not
driven yet.

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
driver state and not position fields.

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

## What is not yet claimed

The reference's own registry, inside the copy, lists the cases the reference
passes. The difference between it and this package's registry is what this
package does not yet claim, and `pnpm conformance` prints it after every run,
for the suites it ran, each case with the features it needs, its
`required_features` in the corpus's own words, and the reason the run failed
it. It then prints the cases of the suites it ran that the reference's
registry does not list either, each with the reason the run failed it: the
gap list is read off the reference's registry, so without this second list
those cases would go unnamed.

This package's registry claims every scion case and the w3c cases a run
observed to pass; the claims `w3c-mandatory` and `w3c-optional` are exactly
those entries, and a w3c case with no entry is one this package does not
claim to pass. What the run fails in the w3c suite falls in three groups:

- the cases that need `<invoke>`, each failing before it is driven with
  `invoke_elements` named;
- `w3c/test329` and `w3c/test496`, which the reference claims and which fail
  here on the configuration the chart rests in;
- `w3c/test330` and `w3c/test552`, which the reference's registry does not
  list, and which fail here on the configuration the chart rests in.

A case that needs `<invoke>` fails even when its chart would reach the
expected configuration with no invocation run, as `w3c/test187` would on its
timeout guard: a pass there would claim a feature this package does not run.

The statifier suite is not driven yet, so every statifier case of the
reference's registry is on the list.
