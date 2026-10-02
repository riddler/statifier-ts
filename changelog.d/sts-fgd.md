### Changed

- The one runtime dependency, `@riddler/predicator`, is required at `^0.4.1`, whose equality answers two maps or lists holding the same absent members equal, so the `_event` value of an event that lacks its optional fields now compares equal to itself and to a copy of it in a chart's conditions, as it does in the reference.
- The w3c case `test329` is claimed: a consumer relying on the `w3c-mandatory` claim now also has a copy of a system variable, `_event` included, comparing equal to the variable after an attempt to assign it fails.
