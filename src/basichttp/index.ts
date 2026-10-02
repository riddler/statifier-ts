// The Basic HTTP entry point, `@riddler/statifier/basichttp`.
//
// The Basic HTTP Event I/O Processor a host registers as a send type, the
// default transport it makes its requests through, and the decoder a host
// that runs a server turns an inbound request into an event with. They live
// on an entry point of their own because the default transport reads the
// host's global fetch function: the main entry point reaches no host global,
// and a host that never imports this one never reaches it either. The fetch
// function is looked up when a request is made, not when this module loads.
//
// ADR-0002's Amendment "the Basic HTTP processor" records the contract.

export {
  type DecodeRefused,
  type DecodeResult,
  decodeRequest,
  type InboundRequest,
} from "./decode.js";
export { type FetchTransportOptions, fetchTransport } from "./fetch-transport.js";
export {
  BASIC_HTTP_EVENT_PROCESSOR,
  type BasicHttpOptions,
  type BasicHttpRefusal,
  type BasicHttpResult,
  basicHttp,
  type ReportedSendFailure,
} from "./processor.js";
