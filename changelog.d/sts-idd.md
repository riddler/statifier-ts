### Added

- A state's `<invoke>` elements start when the macrostep that entered it is stable: each one answers an `invoke` effect carrying its id, type, source, params and content, and the host runs the invocation; the core runs none itself.
- An external event runs the `<finalize>` of the live invocation its `invokeid` names before any transition is selected, and answers an `autoforward` effect carrying the event unchanged for each live invocation that forwards.

### Changed

- An `<invoke>` whose type, source, params or content fails to evaluate, or whose `idlocation` cannot be written, raises `error.execution` naming that invocation and starts nothing; a live invocation answers a `cancel_invoke` effect when its state exits.
