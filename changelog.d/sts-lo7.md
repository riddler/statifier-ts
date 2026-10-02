### Changed

- A `done` effect from a chart that stopped without exiting a top-level final, as a cancelled chart does, carries `null` donedata, as the reference's nil, so a host can tell it apart from a top-level final that declares no donedata, which still carries undefined.
