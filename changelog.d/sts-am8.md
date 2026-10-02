### Added

- A built-in Basic HTTP Event I/O Processor on its own entry point, `@riddler/statifier/basichttp`: `basicHttp` answers the processor and the send types to register it under (its URI and `basichttp`), each send becomes one POST with a hand-encoded form body or a text body and the `scxml-send-key` deduplication header, delivery is at least once, and a miss is handed to the host's `report` function with the sending session's id for the host to pass to `reportSendFailed`.
- `fetchTransport`, the processor's default transport, looks up the global fetch function when a request is made and answers the failure `fetch_unavailable` when there is none, so importing either entry point reaches no host global.
- `decodeRequest` turns an inbound POST to a session's location into the event a host's server front passes to `step`, refusing a method other than POST, text that is not UTF-8 and a malformed `scxml-send-key` as values.
- A send processor may supply its session's `_ioprocessors` entry through an optional `ioprocessorsEntry`, and its `deliver` and `cancel` are handed the sending session's id as a `ProcessorContext`.
- A host's HTTP transport (`HttpTransport`) is an object with one `post` method, so a later member can be added without changing its shape.
