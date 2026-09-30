# Changelog fragments

Changelog entries for unreleased work live here as one file per issue, not as
edits to `CHANGELOG.md`. At release the fragments are assembled into a single
version section and deleted.

## Why fragments

Parallel work happens in one worktree per issue, so several branches are
usually open at once. If each branch appended to an `## [Unreleased]` block at
the top of `CHANGELOG.md`, every branch would touch the same few lines of the
same file and nearly every pull request would conflict with every other one.

A fragment is named after its issue, so no two branches ever write the same
file and the conflict cannot happen.

## When a change needs a fragment

The changelog serves **people who use the package**. Repo history is git's job,
and work tracking is beads' job. Neither belongs here.

Write a fragment for:

- a public API addition, change, or removal
- a change in observable behavior
- a bug fix a user could have noticed
- a change in what the interpreter accepts or refuses
- anything breaking

Do **not** write a fragment for:

- test harness or fixtures
- documentation, ADRs, or plans
- internal refactors with no visible effect
- quality gate, CI, or agent tooling changes

If you are unsure, ask whether someone who only ever calls the public API could
tell the difference. If not, skip it.

The change that created this package takes no fragment, and neither does the
`version()` entry point it shipped with: nothing had been released before it,
so there is no earlier behavior for an entry to differ from. The first
release's lead paragraph says what the package is.

## Format

One file per issue, named for the beads issue ID:

    changelog.d/sts-abc.md

Contents are the Keep a Changelog section heading followed by the entry:

```markdown
### Added

- A transition whose event descriptor ends in a wildcard matches every event under that prefix.
```

Rules:

- Use only the standard headings: `Added`, `Changed`, `Deprecated`, `Removed`,
  `Fixed`, `Security`.
- One line per change, present tense, describing the effect on the user.
- No nested bullets. Detail belongs in the pull request and the commit body; a
  changelog line that needs sub-points is really several changes or one that is
  over-explained.
- One file may carry more than one heading if an issue genuinely spans them.
- For a breaking change, say what to do about it, not just what broke.
- A change in which conformance corpus this package is held to, or in which of
  its cases the package claims, is visible to every consumer relying on that
  claim. Say what moved and what a consumer should check.

## At release

Assemble the fragments into a new version section in `CHANGELOG.md`, grouped by
heading and ordered `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
`Security`. Within one heading, fragments go in fragment-name order and each
fragment's own bullets keep the order they have in their file. Delete the
fragments in the same commit that cuts the release, and tag it.
