### Changed

- Requires `@riddler/predicator` `^0.5.0`, whose location surface resolves and writes the locations a chart writes to.
- An `<assign>`, a `<send idlocation>` and an `<invoke idlocation>` naming a nested location over a declared root (`patron.name`, `holds[0]`, `holds[i]`) now write it, as the reference does, where they were refused with `unsupported_location`; intermediate maps and lists are created on the way, never a root.
- An empty `<finalize>` writing a returned value back to a nested location over a declared root now writes it, as the reference does, where it was refused with `unsupported_location`.
- A location that does not parse or names no place to write (`[0]`, `renewals + 1`), or whose write passes through something that is not a container, now answers `error.execution` with an `evaluator_error` reason carrying predicator's `ParseError` or `LocationError`, where it answered `unsupported_location`; the location resolves before the root is checked, so such a location reports that refusal before `system_variable` or `unbound_location`.
- A bare root spelled as one of the expression language's reserved words (`next`, `true`, `if`) now answers `error.execution` with an `evaluator_error` reason, as the reference does, where it was written; an unbound one reports that refusal before `unbound_location`. A host that names a `<data>` that way renames it.
- The `evaluator_error` member of `ExecutionReason` may now carry a `LocationError` as its `error`; a host that switches on the error's `type` adds a case for it.
- A `datamodel_change`'s `locationPath` is now the path the location resolved to and its `priorValue` the value read at that path before the write, for an `<assign>`, a `<send idlocation>`, an `<invoke idlocation>` and an empty `<finalize>`.
- A write at an index past a list's end pads the list with the absence (`holds[2]` on `["c-1"]` leaves `["c-1", Undefined, "c-3"]`), as the reference does.

### Removed

- `unsupported_location` is no longer a member of `ExecutionReason`: no write answers it, since every location over a declared root is either written or refused for a reason the location surface names. A host that switches on it removes that case and reads `evaluator_error` instead.
