### Changed

- A `<send>` or an `<invoke>` that writes its `idlocation`, and an empty `<finalize>` that writes a returned value back, now answer a `datamodel_change` for each write, as the reference does: a send's or an invocation's comes just before its own effect, and a `<send>` refused for its target, its type or its route still answers none, though its write stands.
- A `datamodel_change`'s `owner` may now be `{ kind: "invoke", stateIndex, invokeIndex }`, naming the invocation whose `idlocation` write it reports, and such a change names no `cIndex`; a host that switches on the owner's `kind` adds a case for it. The `Owner` a block's effects carry is unchanged.
