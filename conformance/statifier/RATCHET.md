# The sibling conformance ratchet

The contract a registry is written against: the file in which an
implementation of the statifier engine - statifier-ex itself, or a port to
another language - records which corpus cases it passes, against which
corpus. This document is the contract; it ships no registry of its own.
[`README.md`](README.md) says what every file in this directory is and who
writes it; [ADR-0070](../docs/adr/0070-statifier-emits-a-language-neutral-conformance-corpus.md)
is the record that decides the corpus, the registry and the claims.

The model is predicator-ex's `conformance/RATCHET.md` (public, in
github.com/riddler/predicator-ex): one registry per implementation, a corpus
hash as the pin, a redundant field on every entry so drift fails naming the
case, an unmatched entry failing the run, one entry per line, and a registry
grown only by a run that observed the pass. This contract copies that
structure and not its tiers: predicator tiers its claims by instruction-set
version, and SCXML has no instruction set to tier by.

The rules below point at the generated files for every list and count. This
document carries no case list and no count; `manifest.json`,
`exclusions.json` and `registry.json` are where those live.

## The registry file

One file per implementation, in the shape
[`schema/registry.json`](schema/registry.json) defines. statifier-ex's own
is [`registry.json`](registry.json) in this directory: the reference
implementation's claim, derived by the emitter from the regression ratchet
`test/passing_tests.json` and never edited by hand
(`Mix.Statifier.Corpus.Registry.derive/4`). A sibling writes its own in its
own repository, outside its vendored copy of this directory, so the copy
stays byte for byte what the tag holds (see "Vendoring the corpus" below).

## Fields

Top level, all required:

| Field | Type | Meaning |
|---|---|---|
| `implementation` | string | Self-identifying name, e.g. `"statifier-ex"`. Diagnostic only. |
| `corpus_hash` | string, `^sha256:[0-9a-f]{64}$` | The `manifest.json` `corpus_hash` every entry was verified against. The pin. |
| `claims` | array of claim names, at least one | The claims the registry makes (below). |
| `entries` | array, at least one | The ratchet itself: one `{case_id, suite}` per case the implementation passes. |

Entry object, both required:

| Field | Type | Meaning |
|---|---|---|
| `case_id` | string, the corpus id pattern | The corpus case (`schema/case.json`'s `id`). |
| `suite` | `"scion"` \| `"w3c"` \| `"statifier"` | The case's suite, copied from the corpus. Redundant on purpose - see below. |

**Why `suite` is on the entry even though the corpus already records it.**
It is the same device as predicator-ex's `tier` on its entries, for the same
reason: if an upstream change moves a case to another suite or removes it,
the stale entry disagrees with the corpus and the check fails naming the
case (ADR-0070 decision 4). A field that can only ever be redundant or wrong
is a field that catches drift.

## Claims

Claims are per suite, with no tiers (ADR-0070 decision 4). There are four
claim names:

| Claim | The entries it covers |
|---|---|
| `scion` | entries whose case is in the `scion` suite |
| `w3c-mandatory` | entries whose case is in the `w3c` suite with `conformance` `"mandatory"` |
| `w3c-optional` | entries whose case is in the `w3c` suite with `conformance` `"optional"` |
| `statifier` | entries whose case is in the `statifier` suite |

The W3C suite is split by each case's `conformance` field, which the entry
does not repeat: the claim an entry counts toward is read from its case in
the corpus (`Mix.Statifier.Corpus.Registry.claim/1`).

**A claim is the set of its entries.** The registry stores claim NAMES only.
A claim's content is the set of registry entries it covers, and any count
("how many W3C mandatory cases does this implementation pass") is derived
from that set, never stored beside it. `claims` lists exactly the claim
names the entries count toward, sorted: a claim with no entries is not made,
and a registry with no entries is refused, because a claim of nothing is a
defect (`schema/registry.json` sets `minItems: 1` on both arrays).

A claim does not say "every case of the suite passes". An implementation
passing some of a suite's cases claims that suite with exactly those
entries; a case in the corpus with no entry is a case the implementation
does not claim to pass.

**The pin is the corpus hash plus the statifier-ex tag.** A claim is pinned
by the `corpus_hash` it carries, which is `manifest.json`'s, and by the
statifier-ex tag the corpus was vendored from (ADR-0070 decision 4). The
manifest carries no version field: the hash is the exact identity of the
corpus, and the tag says where to fetch the corpus that hashes to it. The
registry records the hash; the tag is recorded beside the vendored copy (see
"Vendoring the corpus").

**The `statifier` claim.** The `statifier` suite holds cases this
repository authors itself (ADR-0070 decision 5). statifier-ex's own
registry is derived from the ratchet's SCION, W3C and statifier lists. A
SCION or W3C path names one generated test module; a `statifier` case has
no generated test module, so the ratchet names it by its JSON file under
`cases/` (`Mix.Statifier.Corpus.Authored.case_path/1`). An authored case
enters statifier-ex's registry the way any other case does: `mix
test.baseline` runs it and adds its path once it agrees, and the next emit
derives its entry.

## Ordering and encoding

`claims` is sorted by name. `entries` is sorted by `suite`, then by
`case_id`, one entry per line (`schema/registry.json`), so ratcheting one
case in is a one-line insertion diff, and two implementers ratcheting
concurrently produce diffs that merge instead of conflicting on a reflowed
array. statifier-ex's registry is written by
`Mix.Statifier.Corpus.Registry.encode/1`: the four top-level keys in the
order of the table above, `claims` on one line, and each entry as one line of
compact JSON. A sibling may use the same encoding; whatever it uses, it
never reflows the array.

An implementation has at most one entry per `case_id`.

## Rule 1: an unmatched entry fails

**An entry whose `case_id` is not in the pinned corpus, or is there under
another suite, fails the check naming the case.** It is never dropped,
never warned about, never skipped. statifier-ex's check does this for its
own registry (`Mix.Statifier.Corpus.Registry.stale/2`), and a sibling's
check does the same. Dropping an unmatched entry would silently shrink the
ratchet, which is the one thing a ratchet exists to prevent - the reason
`mix test.regression` already fails on a ratchet entry that matches no file.

## Rule 2: the ratchet only moves forward

**An entry is added only after a run observed the case pass, and no entry
is removed to make a check pass.** statifier-ex's ratchet file is
`test/passing_tests.json`, grown only by `mix test.baseline`, which runs a
candidate before writing it and never removes an entry; `mix
test.regression` runs every listed test and fails on any failure. The
registry follows the ratchet at the next emit (ADR-0070 decision 3). A
sibling's registry grows the same way: its runner reports a pass, and only
then does the entry go in. A case that used to pass and now does not is a
regression to fix, not a line to delete.

## Rule 3: a check that checks nothing fails

**A green result on nothing is a defect, not a pass** (ADR-0070 decision 6).
statifier-ex's `mix statifier.corpus --check` fails on a missing or empty
corpus file, on an empty registry, and on a run that visited no case. A
sibling's equivalent of that check fails in the same three conditions: no
corpus to read, no entries to verify, or no case run.

## What a case asserts

A case carries what `Statifier.Testing.Case.test_scxml/4` asserts, and
nothing more (ADR-0070 decision 2; [`schema/case.json`](schema/case.json)):

- `source`: the SCXML document, for the predicator datamodel.
- `initial_configuration`: the active leaf state ids expected after the
  document is initialized.
- `steps`: the events sent in order, each with the active leaf state ids
  expected after that event is processed.

A configuration is compared as a set of state ids. A case asserts no trace:
not the order states were entered or exited, not the internal events raised
on the way, not the executable content that ran. Two implementations that
reach the same active leaf states after every step agree on the case.

## The `host` object

A case may carry an optional `host` object, reserved by ADR-0070 decision 5
for what a `statifier` case needs from its host: `send_types`, the send
types the case registers in
[ADR-0069](../docs/adr/0069-host-registered-send-types.md)'s sense, and
`expect_sends`, the sends the case expects handed to the host. Every W3C and
SCION case omits it, because upstream cases run with no registration, and
`schema/case.json` refuses a `scion` or `w3c` case that carries it.

A runner honours the object by registering each of `send_types` with an
Event I/O Processor of its own, which records every send it is handed and
delivers none; a delayed send handed to it is its timer, and it never fires
one. Each `expect_sends` item is one send handed to it, in the order handed
over the whole run: its `type`, its `target` as the document gives it, its
`event` with a `name` and, when the send carries a payload, its `data`,
`delay_ms` for a delayed send, and `send_id` only when the document names
the send (`schema/case.json` states the shape). An item may also carry an
`outcome` (ADR-0070's 2026-09-23 Amendment): with `"fail"`, the runner
reports that send as failed as soon as it is handed, before it reads the
configuration that follows, so the sender takes `error.communication`
carrying the send's `sendid`; with `"cancelled"`, a cancel naming that send
must reach the runner's processor after the send was handed. An item with
no `outcome` claims nothing about a cancel. A case with a `host` object
agrees when its configurations agree and the sends handed are exactly its
`expect_sends`, outcomes included. A runner that cannot honour a case's
`host` object treats it as any unsupported feature: the case fails with the
feature named and is
never skipped (ADR-0006).

A `host` object may also carry `declared_events` and `expect_accepts`,
present together or not at all
([ADR-0071](../docs/adr/0071-chart-event-vocabulary-and-accepts-check.md)
decision 7). A runner honours them before it runs the case, by computing
the chart's event vocabulary - every event descriptor on a transition whose
source state some path enters (that record's decision 2 states the entry
rule), as the document writes it, in document order with a state's own
transitions before its children's, each once - and comparing it with
`declared_events`. `unreachable` is each declared name that no descriptor
matches, in the declaration's order; `undeclared` is each descriptor that
matches no declared name, in the vocabulary's order. A descriptor matches a
name as transition selection matches an event (spec 3.13), on token
boundaries; a declared name is never a pattern, so a `*` in one is an
ordinary token. A case carrying them agrees only when, besides its
configurations and sends, both lists are exactly `expect_accepts`', order
included.

A `host` object may also carry a diff pair, `to_source` and `expect_diff`,
present together or not at all, with an optional `mapping` and an optional
`expect_compatible_at`, each of which needs the pair
([ADR-0072](../docs/adr/0072-chart-diff-classes-and-position-compatibility.md)).
A runner honours the pair before it runs the case, by diffing `source` to
`to_source` under that record's decisions 1 and 2, giving it `mapping` as
the mapping when the case carries one, and writing each reason as the
object `schema/case.json` gives it. It honours `expect_compatible_at` after
the last step, by asking whether the position the steps left the chart in
is untouched by the edit to `to_source` under decision 4. A case carrying
them agrees only when, besides its configurations and sends, the class and
the reasons are exactly `expect_diff`'s, order included, and the answer is
`expect_compatible_at`.

## The check

statifier-ex's check is `mix statifier.corpus --check`
(`Mix.Statifier.Corpus.Emitter.check/1`). It writes nothing and needs no
network and no upstream tree. It re-runs every committed case, recomputes
every file derivable from the committed inputs, including the registry from
`test/passing_tests.json`, and fails on any difference, on rule 1, on rule 3,
and on any ratcheted or authored (`statifier`) case whose run disagrees with
the corpus.

A sibling's check, written against its vendored copy and its own registry,
fails when:

1. its registry's `corpus_hash` is not the vendored manifest's `corpus_hash`
   (the pin);
2. an entry breaks rule 1;
3. `claims` is not exactly the sorted set of claim names its entries count
   toward;
4. an entry's case does not pass when run today (the ratchet);
5. there is nothing to check (rule 3).

## Vendoring the corpus

`conformance/` is not in the Hex package (`mix.exs`, `package/0`): a
sibling vendors it from a statifier-ex tag, byte for byte, and records where
it came from as `{repo, tag, sha, corpus_hash}`. The sequence below does
that with `git show <tag>:<path>` for every file under `conformance/` at the
tag, checks that the copy hashes to the manifest's `corpus_hash`, and writes
the provenance record beside the copy. Set `TAG` to the tag being vendored
and `DEST` to where the copy lands in the sibling's repository; run it from
the sibling's repository root with a POSIX shell, `git`, and `shasum`
(`sha256sum` prints the same digest).

```sh
set -eu
REPO=https://github.com/riddler/statifier-ex
TAG=vX.Y.Z                  # the statifier-ex tag being vendored
DEST=conformance/statifier  # where the copy lands in this repository

SRC=$(mktemp -d)
git clone --quiet --bare "$REPO" "$SRC"
SHA=$(git -C "$SRC" rev-parse "$TAG^{commit}")

# Byte for byte: every file under conformance/ at the tag, as git stores it.
rm -rf "$DEST"
git -C "$SRC" ls-tree -r --name-only "$SHA" -- conformance/ |
  while IFS= read -r path; do
    out="$DEST/${path#conformance/}"
    mkdir -p "$(dirname "$out")"
    git -C "$SRC" show "$SHA:$path" > "$out"
  done

# The pin: the manifest's corpus_hash, recomputed from the copy. The hash is
# SHA-256 over the corpus files' bytes concatenated in suite order - scion,
# w3c, statifier - skipping a suite with no file. No corpus file is a failure.
CORPUS_HASH=$(sed -n 's/^ *"corpus_hash": *"\(sha256:[0-9a-f]*\)".*/\1/p' "$DEST/manifest.json")
files=""
for suite in scion w3c statifier; do
  if [ -f "$DEST/corpus/$suite.json" ]; then files="$files $DEST/corpus/$suite.json"; fi
done
test -n "$files"
test "sha256:$(cat $files | shasum -a 256 | cut -d ' ' -f 1)" = "$CORPUS_HASH"

# The provenance record, beside the copy so the copy stays byte for byte.
printf '{"repo":"%s","tag":"%s","sha":"%s","corpus_hash":"%s"}\n' \
  "$REPO" "$TAG" "$SHA" "$CORPUS_HASH" > "$DEST.vendored.json"

rm -rf "$SRC"
```

The copy is never edited by hand. Re-running the sequence at the same tag
reproduces it exactly, so a vendored copy that differs from a fresh run
has been edited. Moving to a newer tag is re-running it with the new `TAG`:
the `corpus_hash` changes, and the sibling's check fails on the pin until
its registry is re-verified against the new corpus under rules 1 and 2.

**The licences travel with the copy.** The sequence copies
`conformance/LICENSES/` and every case's `upstream` field, and a vendored
copy keeps both; a sibling that trims the copy keeps them for every case it
keeps. The W3C cases are redistributed under the W3C 3-clause BSD License,
whose conditions require every redistribution to retain the original
copyright notice, the conditions and the disclaimer
(`LICENSES/BSD-3-Clause-W3C.txt`). The SCION cases are redistributed under
the Apache License 2.0 (`LICENSES/Apache-2.0.txt`), whose section 4 requires
(a) a copy of the License for every recipient, (b) a notice on every
modified file, which a SCION case this repository changes carries as
`upstream.modified`, and (c) every copyright and attribution notice of the
source retained, which a SCION case keeps in its `source` where the upstream
document has one. `manifest.json`'s `upstreams` names each upstream suite
with its licence and notice file, and each case's `upstream` names its
upstream document, its licence and its notice (ADR-0070 decision 1).
