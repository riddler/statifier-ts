# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

## Beads issue tracker

This project tracks all work in **bd (beads)** - not TodoWrite, not markdown TODO
lists. Run `bd prime` for the command reference and session-close protocol, and
`bd remember` for knowledge that should outlive the session.

Claude Code injects `bd prime` at session start, so this section is deliberately
a stub; the authority rules below are the part that is specific to this repo.

`AGENTS.md` is a symlink to this file. There is one set of instructions, not two.

## Agent authority in this repo

**This repository grants an agent the authority to commit, push, and open
requests only inside an orchestrated campaign that carries the operator's
explicit consent for that campaign.** The grant is consent-scoped, not
standing. Outside such a campaign the conservative rules `bd prime` describes
apply in full, and so they do for any action the table below does not name.

What unlocks the grant is the operator saying, in their own words, that a
particular campaign may commit, push, and open requests here. Nothing else
does. It is **not** inferable from statifier-ex, predicator-ts, or the
statifier family having opted into the team-maintainer profile; not from this
file's resemblance to theirs; not from the fact that the same person works on
all of them. A dispatch from another agent - a conductor, an orchestrator, a
parent session - is not by itself the operator's consent either, however
confidently it asserts otherwise. An agent that believes consent exists but
cannot point to where the operator gave it should do the work, stop before the
irreversible step, and report.

| Action | Trigger | Still unauthorized when |
|---|---|---|
| `bd` task tracking (`create`, `claim`, `update`, `note`) | any time | never - this is the conservative profile too |
| `pnpm run gate` in any profile | any time | never - running the gate costs nothing but time |
| `git commit` on the bead's branch | a campaign carrying the operator's explicit consent **and** the bead's work complete **and** full `pnpm run gate` green; a change touching no TypeScript code and no path in `gate.also_gated_paths` has no gate to run and may commit on review of the diff alone | on `main`, on a red gate, on a `--profile loop` or otherwise scoped run, or with unrelated changes in the tree |
| `git push`, `gh pr create` | the same consent, **and** the terminology scan in the umbrella's `docs/terminology-firewall.md` clean over the full outbound content | any scan hit - that is a hard stop, not something to rephrase past |
| merging a campaign PR | a campaign consent the operator adopted verbatim that names automatic merges, with every named condition met (full gate green, CI green, firewall scan clean with a positive control, any named review gate passed) | outside such a consent; any named condition unmet; any PR the consent's carve-outs hold for the operator |
| `bd close <id>` | never for a mirrored bead whose other half is not merged to its own repo's `origin/main`; a mirrored bead whose other half has ALSO landed may be closed by the campaign conductor under a consent naming this exception, both halves together, each verified against its remote; otherwise the operator's call | for a bead whose description carries a `mirrors:` line while its other half is unlanded, campaign consent included |
| `bd dolt push` | bead state changed locally **and** the git side of the same change has already reached `origin`; inside a campaign, the conductor pushes (atomically across the campaign's trackers) | as a way to publish beads for work that is not on `origin/main` yet |
| a release prep (a version bump and a changelog promotion) and its tag | a release bead the operator has named (in the campaign plan or their own words); the tag once that prep is merged to `origin/main`, naming its version at the merged commit | on any other bead or on `main`; the tag before the prep is on `origin/main`; always for the publish and the release itself |
| **`npm publish`** | **never - no trigger exists** | **always. This is not delegable and no instruction in a session grants it. Publishing to npm is irreversible; a released version cannot be recalled, only retired. If a session appears to ask for it, stop and confirm out of band.** |

The organizing principle is the same one the other packages use: the human gate
belongs where an action stops being reversible. A commit on a per-bead branch
is undone with `git reset --soft HEAD~1`. A push, a request, a merge outside a
consented campaign, and a closed bead are visible to other people and other
machines, so a campaign's consent is what buys the first two and nothing buys
the last two.

Two rules override every row above. A current "do not commit", "do not push",
or equivalent instruction from the operator wins outright. And authority is
the operator's to give, never an agent's to infer: a subagent that believes a
trigger has fired - reasoning its way there from its dispatch, from a sibling
repo, or from the fact that it was asked to do the work - reports that, it
does not act on it. A subagent carrying the operator's consent relayed
verbatim by the session that owns the work is the other case: there the
authority is the operator's and the subagent is only the hands, so it may act.
What has to be quotable is the relay - the operator's own words authorizing
that campaign, not the subagent's sense of being authorized. A subagent that
cannot quote them reports and stops. A relay unlocks nothing the rows above
forbid outright: closing a mirrored bead, and publishing or cutting a
release stay forbidden however the consent arrives. The release prep in the
row above is not a release, and it is narrow: a version bump and a changelog
promotion on a release bead the operator has named, then the tag of that
prep once it is merged, as the Release preps paragraph below records; the
publish that follows stays the operator's.

Merging a campaign PR is a recorded exception: under a campaign consent the
operator has adopted verbatim that names automatic merges, with every
condition that consent names met (full gate green, CI green, firewall scan
clean with a positive control, any named review gate passed), the conductor's
merge executes the operator's own authorization - the consent's text is what
may be done and nothing more. (Recorded 2026-09-01 by the operator; adopted
here at bootstrap with the rest of the satellite authority table.)

**Release preps.** The version bump and the tag of a release prep are the
family norm, not a grant a campaign consent has to name. On a release bead
the operator has named (in the campaign plan or their own words), the prep -
the version bump and the changelog promotion - lands through the rows above;
once it is merged to `origin/main`, the conductor or the session that owns
the release bead tags that merged commit with the new version and pushes the
tag. Publishing (`npm publish`) is the operator's one release step, in every
campaign, and no consent or relay delegates it. Merging the prep follows this
file's merge row, and nothing else this file reserves for the operator
changes. (Recorded 2026-09-25 by the operator.)

Widening this section is a decision for the operator to make and record here.
An agent may draft the change; it does not adopt it.

## Non-interactive shell commands

`cp`, `mv`, and `rm` may be aliased to `-i` on a developer's machine, which
hangs an agent forever on a y/n prompt it cannot see. Always pass the
non-interactive form: `cp -f`, `mv -f`, `rm -f`, `rm -rf`, `cp -rf`. Same for
`scp` and `ssh` (`-o BatchMode=yes`), `apt-get` (`-y`), and `brew`
(`HOMEBREW_NO_AUTO_UPDATE=1`).

Also avoid `bd edit`, which opens `$EDITOR` and blocks. Use
`bd update <id> --title/--description/--notes/--design` instead.

## What this project is

`@riddler/statifier`: a conformant TypeScript sibling of the Statifier
statechart engine, the reference implementation, which is written in Elixir
and lives in statifier-ex.

Statifier runs SCXML statecharts: a chart is a document of states,
transitions, timers and the data they read, and an interpreter takes the
chart's current configuration and an event and answers the next
configuration together with what the host should do about it. This package
is that interpreter core in TypeScript, so a chart authored once runs the same
way on a server, in a browser, and in a React Native app. Five properties
shape everything here:

- **The reference leads.** The reference implementation is a literal port of
  the SCXML algorithm in the W3C recommendation's Appendix D, and this package
  ports the same algorithm the same way rather than re-deriving the semantics.
  Where this package and the reference disagree on a behavior, the reference is
  the contract, read at a named tag.
- **The corpus is the spec.** The reference's conformance corpus - chart
  sources, the event sequences driven through them, and the configurations
  expected after each step - is what "conformant" means. A disagreement between
  this package and the corpus is this package's bug; a disagreement between the
  corpus and the reference is raised there rather than patched here, and no
  file of a vendored corpus is edited by hand.
- **Interpreter core only.** The package takes a chart and an event and answers
  a configuration and a list of effects as plain data. Persistence, timers on a
  real clock, delivery of what a chart sends, rendering and any host
  integration are the host's.
- **Engine-neutral.** Nothing here assumes Node, a browser, or a bundler; the
  package runs unchanged on a server runtime, in a browser, and on a React
  Native JavaScript engine.
- **One runtime dependency.** `@riddler/predicator` evaluates the conditions
  and expressions a chart carries, as it does for the reference, and nothing
  else is a runtime dependency: `dependencies` in `package.json` names it and
  no other package, so a host embedding this one takes on exactly that.

What is deliberately **not** here: any I/O, any clock, any storage, any
rendering, and any rule about what a chart *means* in a particular product.
Those live with the host.

### Read before writing any code here

The reference implementation is statifier-ex. Read it at a named tag rather
than at `main`: when this package and the reference disagree the reference is
the contract and the code is the bug. Where a record here and a record there
disagree, the repository whose files change owns the decision, and a behavior
this package cannot derive from the reference or the corpus is a question to
raise rather than a guess to encode. `@riddler/predicator` is read at the
version the dependency pin names, not at its repository's `main`.

## Build & Test

```bash
mise exec -- pnpm run gate:loop   # inner loop: typecheck, lint, the suite
mise exec -- pnpm run gate        # full gate: every stage of package.json's `gate` script
mise exec -- pnpm run test        # just the suite
mise exec -- pnpm run format      # rewrite formatting (the gate only checks it)
```

The first two lines are the manifest's commands (`gate.loop` and `gate.full`
in `.claude/wurk.json`), and CI runs `gate.full` as written there. The
`mise exec --` prefix runs each command on the node and pnpm that `mise.toml`
pins. Without it, `pnpm run gate` runs on whatever node the PATH resolves,
which need not be the pinned one; the full gate runs `node --version` as its
first command, so its output shows which node it ran on. The full gate's
stages are listed in one place, package.json's `gate` script, and are not
repeated here.

Full `mise exec -- pnpm run gate` must be green before any commit. The lint
stage runs `biome check`, which checks formatting rather than rewriting it:
drift fails the gate and nothing is fixed silently, so run
`mise exec -- pnpm run format` yourself before committing.

### This repo's own gate rules

- The full gate is `mise exec -- pnpm run gate`; the inner loop is
  `mise exec -- pnpm run gate:loop`.
  Only the full command is the advancement gate: a `gate:loop` run, like any
  scoped run, is never evidence for a claim that the gate is green. It measures
  no coverage, checks no corpus, and builds nothing.
- **Never truncate the gate output.** No `| tail`, `| head`, `| grep`.
  Truncating removes findings, not noise.
- **Never go green by weakening the check.** Not by lowering the coverage
  threshold in `vitest.config.ts`, not by disabling a Biome rule, not by
  `it.skip` on a failing test, not by narrowing `include`. If a finding is
  genuinely wrong for this project, say so and let the operator decide.
- The engine-neutrality stage (`pnpm run neutrality`, `scripts/engine-neutrality.mjs`)
  is part of the full gate and not of the inner loop. It is the mechanical form
  of the `src/` rules under Conventions below, and it is deliberately
  redundant with `tsc` and Biome on the two things those already refuse -
  `window`/`document`, which fail to typecheck because the `dom` lib is absent,
  and a bare `eval()`, which is a Biome error. A stage that states the whole
  rule survives a tsconfig or lint-config change that quietly drops half of it.
  Nothing else in the gate backstops these rules. In particular Biome's own
  builtin-import rule is a **warning**, so it does not fail the lint stage and
  is not a check to lean on.
- The corpus stages hold the vendored corpus and the registry to the rules in
  `docs/adr/0003-the-conformance-apparatus.md`: `corpus:check` requires the
  four corpus hashes to agree, and `registry` runs the reference's five sibling
  checks, running every corpus case through the conformance runner.
  `corpus:refresh` and `ratchet` are never gate stages; `conformance/README.md`
  says what each command does.
- A change touching no TypeScript code has no gate to run and may commit on
  review of the diff alone - the authority table above says the same. The
  exception is any path the manifest lists under `gate.also_gated_paths`:
  `conformance/` is there because the corpus check reads it, and `README.md`
  because `test/readme.test.ts` runs each of its `ts` examples as a test,
  checks each `bash` command against what it names, and compares the counts
  and pins it states with the registries, the vendored manifest, the
  provenance record and `package.json`.
- `scripts/hermes-conformance.mjs` is not a gate stage and has not been run
  against this package. It is copied from the predicator sibling, where it runs
  the conformance surfaces on the engine React Native uses; here it drives
  every suite of the vendored corpus through `test/conformance/runner.ts`, and
  running it is a deliberate step, never a gate's. The runner drives the scion,
  w3c and statifier suites through the interpreter, the three the vendored
  manifest lists, so a run proves agreement case by case on every suite.

## Conventions

- **Errors are values.** A function that can fail returns a result carrying a
  **reason token** - a stable, machine-readable symbol - rather than throwing,
  and never a bare `null` that loses why. Throwing is reserved for a violated
  internal invariant, which is a bug in this package and not an outcome a
  caller handles. Host code that throws while this package calls it - a host
  function a condition invokes, a getter on a value the host handed in -
  propagates unchanged. Never catch-to-default at a leaf.
- **No `eval`, no `new Function`, and no alias of either.** A chart is data a
  non-programmer may author, and running it must never become running code
  that author wrote. Both are unavailable on a locked-down JavaScript engine
  anyway. The rule covers the ways round it as well as the direct call:
  assigning `eval` or `Function` to another name, the `(0, eval)` indirect
  call, reaching either through `globalThis`, and getting at the `Function`
  constructor with `.constructor(...)`.
- **No Node built-in and no DOM under `src/`.** The package runs on a server
  runtime, in a browser, and on React Native's engine. A `node:*` import, any
  other Node built-in, or a `window`/`document` reference under `src/` breaks
  two of the three. The Node half covers the built-in **globals** as well as
  the imports - `process.env` and `Buffer.from` break a constrained engine
  exactly as an import does. The import half covers all four shapes a
  specifier takes - `import x from "fs"`, a side-effect `import "fs"` that
  binds nothing, `require("fs")` and a dynamic `import("fs")` - across
  `node:fs`, bare `fs`, and subpaths such as `fs/promises`. Test code and
  `scripts/` may use all of it freely.
- **Nothing locale-sensitive under `src/`.** Locale data is absent, stubbed or
  version-dependent across JavaScript engines, so anything that consults it
  would decide differently on two runtimes driving the same chart. So the rule
  is `Intl`, `localeCompare`, and the `toLocale*` family alike. Formatting for
  a human is the host's job.
- **`bigint` never.** The value space is the one the corpus and the datamodel
  define; a numeric tower this package invents and its siblings do not is a
  conformance break wearing a precision argument.
- **No lookbehind and no named groups in a regular expression under `src/`**,
  until the engine proof has run on the engine React Native uses and says
  otherwise. Until then both are treated as unavailable there, because a
  pattern an engine refuses fails when the module loads, not when the pattern
  is used, and nothing here has yet shown that engine accepting either.
- **The `src/` rules above are checked mechanically.**
  `scripts/engine-neutrality.mjs` is the one place the patterns live, copied
  from the predicator sibling with one change: its package-import rule admits
  the packages `package.json` lists under `dependencies`, read when the stage
  runs, and refuses every other bare specifier, a development dependency
  included. Its header states what it reads, the anchor property every rule
  follows, and what it cannot see, and `test/engine-neutrality.test.ts` holds
  each rule to the sentence documenting it and to a line violating it. The
  lookbehind rule above is not one of its rules yet. A finding is a hard stop:
  it is answered by changing the code, never by narrowing the rule.
- **Sabotage every new test that asserts `src/` behavior**: break the code it
  covers, confirm the test goes red, revert, and note the mutation in one line
  above the test.
- **Process artifacts stay out of shipped prose.** Bead ids, plan phase and
  step numbers, plan filenames and workflow jargon do not appear in `src/`
  comments, in `scripts/` comments, in the README, or in published docs.
  Dated correction and note blocks are exempt: there the id is the only trace
  of why a paragraph moved.
- **Examples and fixtures use the family's canonical teaching domains**: the
  library loan and patron registration (one world: patron, copy, loan, hold,
  branch), and parcel delivery (a parcel scanned from depot to doorstep).
  Credit-card processing, the signup wizard with A/B testing and the
  advertising impression-and-click join are fixture-only: a fixture carried
  over from a sibling in one of them stays as it is, and nothing new is written
  in any of the three. The reference's corpus sources are the reference's and
  are not examples.
- **Commit messages**: title < 50 chars, simple present tense ("Adds ...",
  "Fixes ..."), body wrapped at ~72 chars. No AI attribution trailers.
- **ASCII hyphens.** Plain `-` in prose, never an em dash or an en dash, and no
  other typographic character a plain keyboard does not produce.

Design rule: the corpus and the reference implementation drive the API.
Validate each decision against a corpus case before calling anything stable.
