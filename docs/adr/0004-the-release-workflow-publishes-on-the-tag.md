# ADR-0004: The release workflow publishes on the tag push

Status: proposed (2026-10-04)

## Context

Until this record, the publish to npm was the one release step a person ran by
hand. The version bump, the changelog promotion and the tag are already the
automation's: `CLAUDE.md`'s authority table gives a release prep and its tag a
trigger (the row "a release prep (a version bump and a changelog promotion)
and its tag", read at `136326e`), and its bold `npm publish` row gave the
publish none ("never - no trigger exists", same file, same commit). The
release extension spelled the hand step out under "The publish line, the
operator's" (`.claude/wurk/release.md`, read at `136326e`): pull `main`,
reinstall with `--frozen-lockfile`, then `mise exec -- npm publish` from the
checkout.

A hand step at the end of a release is the step that drifts: it runs on
whatever machine and node are to hand, it is the one a person skips or
reorders, and nothing records which commit it published from. The package's
own publish guard exists because such a step already shipped a wrong tarball
once (`scripts/publish-guard.mjs`, its header comment, read at `136326e`).
What a publish has to prove is mechanical - the commit is on the default
branch, the tag names the version that commit states, the gate is green
there - so a machine can check it every time and a person never has to
remember it.

`package.json` already carries what npm trusted publishing matches against:
`repository.url` names this repository and `publishConfig.access` is `public`
(read at `136326e`). The `prepack` script runs the publish guard on any `npm
publish` (same file).

## Decision

**A GitHub Actions workflow, `.github/workflows/release.yml`, publishes the
package to npm when a version tag is pushed, and only then.** Its trigger is a
push of a tag matching `v*.*.*` and nothing else: no branch push, no pull
request, no manual dispatch.

**It publishes only when three conditions hold at the tagged commit**, each a
step that stops the run when it fails; the first two stop it before any
toolchain is installed, and the publish step comes after all three:

| Condition | How the workflow checks it (step name in `release.yml`) |
|---|---|
| The tagged commit is on the default branch | "Check the tagged commit is on the default branch": `git merge-base --is-ancestor` against the default branch, whose name is read from the push event (`github.event.repository.default_branch`), never written in the file |
| The tag names the version the commit states | "Check the tag names the version in package.json": the tag without its leading `v` equals `.version` in `package.json` at the tagged commit |
| The full quality gate is green at the tagged commit | "Full quality gate": the `gate.full` command read from `.claude/wurk.json`, after the toolchain, cache and install steps copied from `ci.yml`; a red gate publishes nothing |

A fourth check runs before the toolchain: when npm already shows the version
("Check npm does not already show this version"), the run stops and reports
it rather than publishing again.

**The registry is npm, and the trust model is npm trusted publishing.** The
job holds `id-token: write` beside `contents: read`; npm exchanges the run's
OIDC identity for a short-lived publish credential, so no token exists in the
file or in the repository's secrets, and npm attaches provenance to the
published version itself. The trusted publisher on npm names this repository
and the workflow file `release.yml`, which is why the file has that name. The
job checks npm and node against the trusted-publishing floor and upgrades npm
only when it is below it ("Check npm and node meet the trusted-publishing
floor"). The publish step is `mise exec -- npm publish`, so the existing
`prepack` guard runs unchanged, on the node `mise.toml` pins. The last step
prints the published version's address on npm.

**A failed publish.** The workflow never retries. A run that stops at a check
or at the gate publishes nothing, and the tag stands as the record of what was
attempted: the fix lands on the default branch and the next patch version is
tagged; a tag is never moved or pushed again. A run whose publish step failed
on a registry or network error is re-run once by hand from the run's page in
the Actions tab, on the same commit and tag; a gate that failed is never
re-run, and a second failure of the publish step is the maintainer's to read.
(No automatic retry and the one hand re-run: decided by the conductor under a
standing consent, 2026-10-04.)

**Docs.** npm has no separate documentation publish: the README and the
shipped sources travel in the tarball, so the publish is the whole release.
(Decided by the conductor under a standing consent, 2026-10-04.)

**A published version stands.** npm never lets a `name@version` be used again,
even after an unpublish, so a version the workflow has published is permanent
as a number; the workflow's registry check reports it on any later run instead
of trying again.

**The authority table moves with it.** `CLAUDE.md`'s bold `npm publish` row,
its relay paragraph and its "Release preps" paragraph now say, in the
maintainers' own words, that an agent or a session never runs `npm publish`,
that the release workflow publishes on the tag push the release-prep row
already allows, and that a failed workflow is re-run from its Actions page,
never worked round by a local publish; the release extension's publish line
says the same (ruled by the operator, 2026-10-04).

The workflow's shape - it runs the gate itself rather than looking up the CI
run on the commit, reads the default branch from the event payload, reads the
version from `package.json` at the tag, copies the toolchain steps from
`ci.yml` rather than sharing them, uses npm trusted publishing, and carries no
manual dispatch - was decided by the conductor under a standing consent,
2026-10-03.

## Consequences

- No person and no agent runs `npm publish` for this package any more; the
  tag push is the last act anyone performs for a release, and the run's log is
  the record of which commit was published and what the gate said there.
- A tag on a commit that is not on the default branch, or naming a version
  `package.json` does not state, publishes nothing and costs one short run.
  The tag stays; the fix is a new patch version.
- Every release runs the full gate one more time, on a runner, on the exact
  commit published. The release costs those minutes.
- The workflow copies the toolchain steps from `ci.yml`. A change to how CI
  provisions the toolchain or runs the gate is made in both files; nothing
  checks that they agree.
- `ci.yml` checks out shallow; the release workflow checks out the full
  history, which its ancestry check needs.
- The trusted publisher configuration on npm is set up outside this
  repository by the maintainer, and renaming `release.yml` breaks it.
- GitHub starts no workflow run for a push of more than three tags at once,
  so a release tag is pushed on its own.
- Nothing under `src/` changes and the package's behaviour does not change.
- This record stays proposed until the workflow has published a version of
  the package.
