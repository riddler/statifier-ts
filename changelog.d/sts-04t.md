### Changed

- A driver call over a chart that sends itself `#_internal` events without end now returns: a session that delivers more undelayed internal sends in one call than its `maxMacrostepRounds` halts with `budget_exhausted`, as it does for re-handed failures and undelayed self-sends (the state reads `halted: "budget_exhausted"`, the call answers one `budget_exhausted` effect with `ok: true`, and the send past the budget waits unrun on the internal queue); a call within the budget, and an `"infinity"` budget, answer as before.
