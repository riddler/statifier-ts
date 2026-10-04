### Changed

- The package is held to the reference's conformance corpus at `v2.11.0` (it was `v2.10.0`), and claims the three statifier cases that tag adds, each stating the exported position after its steps; the runner now compares the package's `exportPosition` with every stated position, so a consumer relying on the `statifier` claim can read it as parity with the reference's export for those three cases and no other position.
