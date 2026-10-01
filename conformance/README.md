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

**Run.** `pnpm conformance` runs every suite, or the ones named with
`--suite`, and writes one report per suite under `reports/`, which git
ignores. Every case is a `pass` or a `fail` with a reason; there is no third
value and no case is left out. The runner drives each scion case through the
interpreter, compares the active leaf set after the start and after each
event as the reference's harness does, and moves a virtual clock by the two
knobs ADR-0003 fixes (a settle window of 100 ms before each event, a
deadline of 4000 ms after it); a case that needs a feature this package does
not run fails naming the feature. A case of the w3c or statifier suite fails
with the reason that its suite is not driven yet.

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

## What is not yet claimed

The reference's own registry, inside the copy, lists the cases the reference
passes. The difference between it and this package's registry is what this
package does not yet claim, and `pnpm conformance` prints it after every run,
for the suites it ran. This package's registry claims scion entries only, so
that list is the three scion cases a `<script>` body decides and every w3c
and statifier case of the reference's registry.
