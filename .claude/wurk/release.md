# Release extension

Additional required steps for `/wurk:release` in this repo. The skill reads
this file before step 1 of its recipe and treats what is here as required
steps placed where this file says. Extensions add; they never override, and
nothing below rewrites a step the skill already performs.

Read this together with `.claude/wurk.json`'s `release` block. Between them
they name every file a release commit here touches, and no others.

## The kit does not implement `kind: "npm"`

`release.kind` is `npm`. The manifest validator accepts it - `release` is a
known section and the kit does not validate its nested keys - but the
`/wurk:release` skill implements `hex` and refuses an unimplemented kind by
name at run time, exactly as it refuses a missing recipe. So a release here is
performed by hand against the checklist below and reviewed as a diff, until
the kit grows an `npm` recipe. That is a known state, not a defect to work
around by mislabelling the kind: the block says what this package is so the
day the recipe lands nothing has to be discovered again.

The reference for every shape below is **the most recent release-prep commit
on `main`**, resolved when you read this rather than named here. Find it with:

```bash
git log --oneline --no-patch -L '/"version"/,+1:package.json'
```

The first line is the last commit that moved `"version"` in `package.json`.
Every line but the last is a release prep, because a prep is the only change
that moves the version; the last line is the commit that created
`package.json`, which wrote a starting version without cutting a release. So
when the output has more than one line, its first line is the reference; when
it has only one, no prep has landed and the checklist below is the only
reference there is.

Where this file and the reference commit disagree, the commit is the evidence
and this file is the defect.

**This file names no SHA for that reference, on purpose, and it carries no
version string anywhere.** A hard-coded reference stops being the most recent
the moment the next release lands. Nothing here needs editing at a release, and
a release commit does not touch this file - the table at the end lists every
file it does touch, and this is not one of them.

## Before the prep: reinstall when the lockfile moved

Cut the prep on a tree whose installed dependencies match its lockfile. After
pulling `main` into the checkout or worktree the prep is cut in, compare
`pnpm-lock.yaml` with the one the last install read; when it moved, reinstall
before anything else runs:

```bash
mise exec -- pnpm install --frozen-lockfile
```

The gate, the build and the publish guard all run on what is installed, not
on what the lockfile names, so a tree pulled but not reinstalled is checked
against an earlier tree's dependencies. `--frozen-lockfile` installs exactly
what the lockfile names and refuses rather than rewriting it; a release commit
never touches `pnpm-lock.yaml` (the table at the end).

## Why the recipe names no changelog

A `changelog` step renames a `## [Unreleased]` heading in one file to
`## [X.Y.Z] - YYYY-MM-DD`. This repo keeps such a heading, but nothing is ever
written under it: `changelog.mode` is `fragments`, and both `CHANGELOG.md`'s
header and the heading's own paragraph say so - unreleased work lives one file
per issue in `changelog.d/`, and the fragments are assembled into a version
section at release. Pointing `release.changelog` at `CHANGELOG.md` would make
the skill's precondition read an unreleased section that is always empty, and
its edit rename the heading the next release still needs.

So `release.changelog` is deliberately absent, and a recipe that does not name
a changelog names no changelog edit. The promotion this repo actually performs
is the step below - a required step, not an optional one. A release commit
without it is not a release commit.

The unreleased-work check reads `changelog.d/` here: if the directory holds no
fragment other than its own `README.md`, there is nothing to release, and the
run stops exactly as it would on an empty unreleased section.

## The required step: promote the changelog fragments

Placed where the skill's changelog step would have been.

1. Read every `changelog.d/*.md` fragment except `README.md`. Each is a Keep a
   Changelog section heading followed by its bullets.
2. Insert a new `## [X.Y.Z] YYYY-MM-DD` section into `CHANGELOG.md` directly
   above the previous version's section, or directly below the
   `## [Unreleased]` section for the first one; that heading and its paragraph
   stay where they are. The heading form is the bracketed version and the
   date, with no separator between them.

   **The date is the operator's local date, not UTC** (the convention the
   operator set on 2026-09-06). A prep run late in the local evening is cut
   under a UTC date that is already tomorrow; writing that UTC date puts a
   section in the file dated a day the release was not cut on, and a reader
   comparing it against the tag or the commit date sees a discrepancy that is
   not real. Take the date from `date +%F` on the machine cutting the prep and
   write that.
3. Under the heading, write a short lead paragraph saying what the release is,
   then the fragments' bullets grouped by heading and ordered `Added`,
   `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.

   Within one heading, when more than one fragment contributed bullets to it,
   the fragments go in **fragment-name order**, and each fragment's own bullets
   keep the order they have in their file. That is an arbitrary but stable
   rule, and stable is the point: it is not a judgement about which change
   matters most, so no release worker has to make one.

   **Carry every bullet over byte for byte.** The lead paragraph is the only
   prose written at release time; reordering, consolidating or rewording a
   fragment's bullet is an editorial pass a human does separately, before the
   release.
4. Delete the promoted fragment files in the same commit. `README.md` stays.

`CHANGELOG.md` has **no link-reference block** at the end, so a release here
adds no `[X.Y.Z]:` line. Adding one is a change to the file's shape, not a
release step.

Whether the release is major, minor or patch is not decided here - the version
is explicit input. The fragments' headings are evidence for that judgement,
not a rule that computes it.

## The README install pin

`release.readme_pin` is `true`. `README.md` carries an install snippet naming
`@riddler/statifier`, and a release moves the version in it to the version
being cut. Read it and check it against the version file:

```bash
grep '@riddler/statifier' README.md    # the pin
grep '"version"' package.json          # the version it should track
```

If they ever disagree, the pin edit repairs the drift in one move rather than
stepping one release at a time: it goes straight to the current version, and
that is the recipe working, not a mistake to correct back.

## No second version carrier

Nothing under `src/` carries the package version. `package.json` is the only
place it is written, and a release moves it in exactly one place. `version()`
in `src/index.ts` is **not** a second carrier: it imports the field from
`package.json`, and the build inlines what the manifest says at build time. If
a second carrier is ever added, it gets a step in this file on the same day.

## The required step you do not perform: the publish builds first

Placed last among the required steps because it is the only one that runs
itself. `package.json` declares `prepack`, which runs
`scripts/publish-guard.mjs`. That script removes the build output and rebuilds
it from the tree, then refuses unless three properties hold of what the build
wrote: no emitted map carries embedded source text, every file those maps name
as a source is one the tarball will contain, and every file the manifest's
entry points name exists and is one the tarball will contain. What the tarball
will contain is npm's own answer (`npm pack --dry-run`), not a reading of the
`files` list, so a pattern entry, a negation and a missing list all count the
way npm counts them. A refusal exits non-zero, which stops the pack or the
publish before a tarball exists.

The middle property is the other half of the first, not a separate check. The
build stops embedding source text in its maps only because the `files` list
ships the source directory instead, so undoing either half on its own leaves
every published map pointing at a file the tarball does not contain. The guard
refuses on either, and says so in those terms when it does.

**Why it is mechanical rather than a line on this checklist.** A published
version cannot be replaced - the number can be retired but not reused - so the
publish is the one step here whose mistake does not come back. In the sibling
package this guard is copied from, the checklist had no build step, and the
build output is not tracked, so a publish packed whatever happened to be
sitting in the output directory. That shipped: a release went out carrying a
build made the day before its own tree, with maps that still embedded the
source the build config had stopped embedding, so the tarball carried the
source three times over and unpacked to far more than the tree it was cut
from, with nothing in the output to say so. A step telling a person to build
first is exactly the step a person skips at the end of a release, which is why
this one refuses instead of reminding.

`prepack` is the hook, chosen for what it fires on. It runs on `npm publish`
and on `npm pack` alike, so the tarball this checklist's own audits inspect is
built from the tree as well; and it does not run on an install, so nothing in
it reaches a routine `pnpm install`. Under this repo's package manager,
`pnpm publish` runs the hook twice - once itself and once through the pack it
delegates - so the build runs twice at a publish. That is slower and not
wrong: the guard is idempotent, and the second run reads the first run's
output.

So your part at a release is to notice a refusal and read it, not to run
anything. If the guard refuses, the output is wrong and the release stops
there; the lines above the refusal name which property failed.

This step touches no file and so is absent from the table below.

### The publish line, the operator's

The publish is the operator's step and never an agent's (`CLAUDE.md`'s
authority table). It is run from the repository's checkout on `main` once the
prep is merged and its tag pushed, in this order:

```bash
git pull
mise exec -- pnpm install --frozen-lockfile
mise exec -- npm publish
```

The pull brings the checkout to `main`, whose head is the tagged commit when
nothing has merged since the prep; `git describe --tags --exact-match` names
the tag when it is. The install matches the installed dependencies to that
tree's lockfile, because the guard's rebuild uses what is installed: a
checkout pulled but not reinstalled builds against the dependencies of the
tree it was last installed for. And `npm publish` runs under `mise exec --`,
so npm and the guard it runs use the node `mise.toml` pins rather than
whatever node the shell's PATH holds, which may be newer than the pin.

## The files a release commit touches

Exactly these, and a release commit that touches anything else is wrong:

| File | Moved by |
|---|---|
| `package.json` | the recipe's `version_file` |
| `README.md` | the recipe's `readme_pin` |
| `CHANGELOG.md` | the promotion step |
| `changelog.d/*.md` (deleted) | the promotion step |

`pnpm-lock.yaml` is not in that table: nothing in the lockfile carries this
package's own version.

## What a release here still is not

The skill does not tag, push, open a request or publish, and this extension
does not either. A release commit is the version bump and the changelog
promotion above, on a release bead the operator has named (in the campaign
plan or their own words), and nothing more. What follows it is set by
`CLAUDE.md` - its authority table and its Release preps paragraph - not here.
The prep is pushed, opened and merged under the rows for those steps. Once the
prep is merged to `origin/main`, the conductor or the session that owns the
release bead tags that merged commit with the new version and pushes the tag;
the tag never comes before the prep is on `origin/main`. The publish
(`npm publish`) and the release itself stay the operator's, in every campaign
and outside every campaign, and no consent or relay delegates them.
