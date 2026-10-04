### Added

- `HostEvent` takes an optional `origintype`, which `step` queues on the event and the chart reads as `_event.origintype`; a host event without one reads it as undefined, as before.

### Changed

- An event `decodeRequest` answers carries `origintype` set to the Basic HTTP processor's URI, as the reference's decoder sets it, so a chart that reads `_event.origintype` on an inbound Basic HTTP event reads that URI where it read undefined.
