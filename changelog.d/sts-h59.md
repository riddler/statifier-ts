### Changed

- `checkAccepts` answers an `undefined` declaration, or a call that leaves the argument out, as it answers `null`: no declaration, both lists empty, where it answered like an empty list. The type already leaves `undefined` out, so only a caller outside it sees the change.
