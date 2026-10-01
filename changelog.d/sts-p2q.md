### Added

- Starting a chart answers a `datamodel_init` effect first, carrying the datamodel before any `<data>` value binds, then a `datamodel_change` effect for each `<data>` that binds; an `<assign>` whose write lands answers a `datamodel_change` with the path, the new and the prior value, and the node that wrote it, unless it ran inside an `<if>` or a `<foreach>` that then failed.
- A state whose `trace` flag is set answers `trace` effects naming each step the interpreter takes, its `trace` field one of `event_dequeued`, `transitions_selected`, `exit_set`, `content_executed`, `entry_set`, `macrostep_stable`, `done`, `invoke_pass` and `finalize_autoforward`; `start` leaves the flag false, and a drive now reads it from the state it is given and writes it back.

### Changed

- An `<if>` or a `<foreach>` that fails no longer answers the effects of the nodes it ran before the failure: their logs, sends and datamodel changes are dropped, as the reference drops them, while what they wrote to the datamodel is kept.
- The effects a call answers now include `datamodel_init` and `datamodel_change`, so a host matching every effect `kind` exhaustively meets two new kinds on every start and on an `<assign>` whose write lands, and a third, `trace`, once it sets the trace flag; a host that ignores a `kind` it does not know needs no change.
