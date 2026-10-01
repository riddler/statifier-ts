# @riddler/statifier

A conformant TypeScript sibling of the Statifier statechart engine.

Statifier runs SCXML statecharts. A chart is a document of states,
transitions, timers and the data they read - a library loan that comes due
and may be renewed, a parcel scanned from depot to doorstep - and an
interpreter takes the chart's current configuration and an event and answers
the next configuration together with what the host should do about it.

The reference implementation is
[statifier-ex](https://github.com/riddler/statifier-ex), written in Elixir.
This package is the interpreter core in TypeScript: the same algorithm, held
to the same conformance corpus, so a chart authored once runs the same way on
a server, in a browser, or in a React Native app.

**This is the start of the package, not a usable engine.** Nothing has been
published yet, and the interpreter is not written yet. What exists is the
scaffold: the build, the quality gate, and the one entry point below.

## Install

Nothing is published yet. When the first version is, the install will be:

```bash
pnpm add @riddler/statifier@^0.1.0
```

The package has **one runtime dependency**,
[`@riddler/predicator`](https://github.com/riddler/predicator-ts), which
evaluates the conditions and expressions a chart carries, as it does for the
reference. `dependencies` in `package.json` names it and no other package.

The package assumes no host environment. It imports no Node built-in and
touches no DOM, so nothing under `src/` reaches for anything a server runtime,
a browser or React Native's JavaScript engine does not offer. A gate stage
checks `src/` for those constructs rather than leaving the rule to review.

That is a check on the text. A check on a run - the conformance corpus driven
through this package on the JavaScript engine React Native uses, and diffed
against a run on the server runtime - is what `scripts/hermes-conformance.mjs`
is for, and the engine proof is not yet run: the conformance runner drives
the corpus's scion suite through the interpreter, but the script has not
been run on that engine, and no claim here rests on it.

`engines.node` in `package.json` is `>=20`, and that is the floor a
consumer's runtime has to clear. It is not the toolchain: what builds and
gates this repository is the one node and the one pnpm `mise.toml` pins.

## The entry point

```ts
import { version } from "@riddler/statifier";

version(); // the version of this build, as package.json carries it
```

`version()` is the whole surface today. The interpreter core - reading a
chart, driving it with events, and exporting and importing where an execution
stands - arrives behind it, and this README gains a reference section when it
does.

## Conformance

The conformance corpus is the reference's, and it is the spec: a case this
package answers differently from the corpus is this package's bug. The
corpus is copied byte for byte from the reference at a named tag, recorded in
`conformance/statifier.vendored.json`, and a registry beside it,
`conformance/registry.json`, lists the cases this package claims to pass -
written only by a run that observed the pass, and never narrowed. A claim is
the exact set of its entries: this package claims the scion suite with the
entries that registry lists, which are every case of that suite, and not yet
any case of the other suites.
[`conformance/README.md`](conformance/README.md) says how the copy, the
check, the runner and the ratchet work.

## Development

```bash
mise install                        # the node and pnpm mise.toml pins
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm run gate          # the full quality gate
```

## License

MIT - see [LICENSE](LICENSE).
