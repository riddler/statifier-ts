### Added

- `reportSendFailed(chart, state, { send, reason? }, opts?)` reports a send a host's processor was handed and could not deliver: the chart takes `error.communication` carrying the send's id as `_event.sendid` and runs to a stable configuration within the call; a stopped chart refuses it with `not_running`, and a send without its `sendId`, `cIndex` and `owner` with `not_a_send`.
- A processor's `deliver` may answer `{ kind: "failure", reason }` (the exported `DeliveryFailure`), and the send then fails the same way within the call that handed it; any other answer is a send the processor took, and a processor that throws still throws out of the call.
- The statifier corpus case `send/registered_send_failed` is claimed: a consumer relying on the `statifier` claim now also has a registered send that the host reports failed reaching the sender as `error.communication`.
