### Added

- The HTTP transport types (`HttpTransport`, `HttpRequest`, `HttpAnswer`, `HttpStatus`, `HttpFailure`) are exported, so a host can write the transport that makes the Basic HTTP processor's POST requests over its own HTTP client: it is handed the method, URL, headers (with the `scxml-send-key` deduplication header) and encoded body, and answers the status that came back or a failure as a value.
