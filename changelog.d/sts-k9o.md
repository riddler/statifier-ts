### Changed

- An immediate send to a session, a parent or an invocation the driver cannot reach is refused where it runs: the rest of its block does not run, `error.communication` carrying the send id joins the internal queue ahead of anything the block would have raised after it, and no `send` effect is reported for it. The w3c suite's `w3c/test496` is now claimed; a delayed send to such a target still answers `error.communication` when its timer fires.
