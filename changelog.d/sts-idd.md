### Added

- A state's `<invoke>` elements start when the macrostep that entered it is stable: each one answers an `invoke` effect carrying its id, type, source, params and content, and the host runs the invocation; the core runs none itself.
- An external event runs the `<finalize>` of the live invocation its `invokeid` names before any transition is selected, and answers an `autoforward` effect carrying the event unchanged for each live invocation that forwards.

### Changed

- An `<invoke>` whose type, source, params or content fails to evaluate, or whose `idlocation` cannot be written, raises `error.execution` naming that invocation and starts nothing; a live invocation answers a `cancel_invoke` effect when its state exits.
- The effects a call answers now include the `invoke` and `autoforward` kinds (the exported `Invoke` and `Autoforward` types), and a `cancel_invoke` (the exported `CancelInvoke`) is now reachable once an invocation is live, so a host matching every effect `kind` exhaustively meets `invoke` as each invocation starts, `autoforward` when an external event reaches an invocation that forwards, and `cancel_invoke` when an invoking state exits, and, once it passes `inheritObservers`, the `child` kind that option adds; the driver acts on all three itself, so such a host adds a case that records or ignores each, and a host that ignores a `kind` it does not know needs no change.
