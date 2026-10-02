// The export surface of each entry point: the main one, then the Basic HTTP
// one, `@riddler/statifier/basichttp`, each in a block of its own.
//
// A runtime name is pinned by listing it: the module's own keys, sorted, must
// be exactly the list below, so a name added or dropped at the entry point
// fails here until the list moves with it. A type-only export leaves no
// runtime name, so it is pinned by a declaration that names it through the
// entry point: `tsc` refuses the file when the type is no longer exported.
// Later changes add their names here.

import { describe, expect, it } from "vitest";
import type {
  BasicHttpOptions,
  BasicHttpRefusal,
  BasicHttpResult,
  DecodeRefused,
  DecodeResult,
  FetchTransportOptions,
  InboundRequest,
  ReportedSendFailure,
} from "../src/basichttp/index.js";
import * as basicHttpEntry from "../src/basichttp/index.js";
import type {
  AcceptsCheck,
  Chart,
  ChartIdentity,
  ChildEffect,
  CompileError,
  CompileOptions,
  CompileResult,
  CompilerError,
  DefaultTransitionOwner,
  DeliveryFailure,
  DriveEffect,
  ExpressionOwner,
  FailedSend,
  HttpAnswer,
  HttpFailure,
  HttpRequest,
  HttpStatus,
  HttpTransport,
  Location,
  LoweringError,
  LoweringErrorOf,
  ParseError,
  ParseErrorReason,
  ProcessorContext,
  StateKind,
  ValidationError,
  ValidationErrorOf,
  ValidationNoDetail,
} from "../src/index.js";
import * as entry from "../src/index.js";

const RUNTIME_NAMES = [
  "advance",
  "checkAccepts",
  "compile",
  "configuration",
  "exportPosition",
  "importPosition",
  "isDone",
  "reportSendFailed",
  "start",
  "step",
  "version",
];

// The transport types, each named through the entry point. Removing one of
// them from `src/index.ts` makes this declaration fail to typecheck.
type TransportTypes = [HttpTransport, HttpRequest, HttpAnswer, HttpStatus, HttpFailure];
const transportTypesNamed: TransportTypes | undefined = undefined;

// The types a compile error reaches, each named through the entry point:
// the four roots `compile` answers and takes - `CompileResult`,
// `CompileOptions`, the `Chart` a success carries and its `ChartIdentity` -
// and every type the declarations of `CompileResult`, `CompileError` and
// `CompileOptions` reach, except the opaque `Machine` a `Chart` carries and
// the expression language's own refusal, which its package exports. Removing
// one of them from `src/index.ts` makes this declaration fail to typecheck.
type CompileErrorTypes = [
  CompileResult,
  CompileOptions,
  Chart,
  ChartIdentity,
  ParseError,
  ParseErrorReason,
  Location,
  LoweringError,
  LoweringErrorOf<"stray_text", { readonly text: string }>,
  ValidationError,
  ValidationErrorOf<"empty_id", ValidationNoDetail>,
  DefaultTransitionOwner,
  StateKind,
  CompilerError,
  ExpressionOwner,
];
const compileErrorTypesNamed: CompileErrorTypes | undefined = undefined;

// A compile error is exactly one of the four named stage errors: a member
// added to `CompileError` that is not one of them, or one dropped, makes
// `CompileErrorIsTheNamedUnion` false and this declaration fail to typecheck.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type CompileErrorIsTheNamedUnion = Equal<
  CompileError,
  ParseError | LoweringError | ValidationError | CompilerError
>;
const compileErrorIsTheNamedUnion: CompileErrorIsTheNamedUnion = true;
// The failed-send types, named the same way.
type FailedSendTypes = [FailedSend, DeliveryFailure];
const failedSendTypesNamed: FailedSendTypes | undefined = undefined;
// The accepts check's answer, named the same way.
const acceptsCheckNamed: AcceptsCheck | undefined = undefined;
// The context a processor is called with, named the same way.
const processorContextNamed: ProcessorContext | undefined = undefined;
// The effects a driver call answers, a child's included, named the same way.
type DriveEffectTypes = [DriveEffect, ChildEffect];
const driveEffectTypesNamed: DriveEffectTypes | undefined = undefined;

const BASIC_HTTP_RUNTIME_NAMES = [
  "BASIC_HTTP_EVENT_PROCESSOR",
  "basicHttp",
  "decodeRequest",
  "fetchTransport",
];

// The Basic HTTP entry point's types, each named through that entry point.
type BasicHttpTypes = [
  BasicHttpOptions,
  BasicHttpRefusal,
  BasicHttpResult,
  ReportedSendFailure,
  FetchTransportOptions,
  InboundRequest,
  DecodeResult,
  DecodeRefused,
];
const basicHttpTypesNamed: BasicHttpTypes | undefined = undefined;

describe("the main entry point", () => {
  // Sabotage: exporting one more function from `src/index.ts`, or dropping
  // `version`, turns this red.
  it("exports exactly the runtime names listed", () => {
    expect(Object.keys(entry).sort()).toEqual(RUNTIME_NAMES);
  });

  it("exports the HTTP transport types, as types only", () => {
    expect(transportTypesNamed).toBeUndefined();
    expect(Object.keys(entry).filter((name) => name.startsWith("Http"))).toEqual([]);
  });

  // Sabotage: dropping `type Location` (or any other name the tuple above
  // lists) from `src/index.ts` turns the typecheck red.
  it("exports the types a compile error reaches, as types only", () => {
    expect(compileErrorTypesNamed).toBeUndefined();
    expect(compileErrorIsTheNamedUnion).toBe(true);
  });

  // Sabotage: dropping `type FailedSend` from `src/index.ts` turns the
  // typecheck red.
  it("exports the failed-send types, as types only", () => {
    expect(failedSendTypesNamed).toBeUndefined();
    expect(Object.keys(entry)).not.toContain("FailedSend");
    expect(Object.keys(entry)).not.toContain("DeliveryFailure");
  });

  // Sabotage: dropping `type AcceptsCheck` from `src/index.ts` turns the
  // typecheck red.
  it("exports the accepts check's answer, as a type only", () => {
    expect(acceptsCheckNamed).toBeUndefined();
    expect(Object.keys(entry)).not.toContain("AcceptsCheck");
  });

  // Sabotage: dropping `type ProcessorContext` from `src/index.ts` turns the
  // typecheck red.
  it("exports the processor context type, as a type only", () => {
    expect(processorContextNamed).toBeUndefined();
    expect(Object.keys(entry)).not.toContain("ProcessorContext");
  });

  // Sabotage: dropping `type ChildEffect` from `src/index.ts` turns the
  // typecheck red.
  it("exports the drive effect types, as types only", () => {
    expect(driveEffectTypesNamed).toBeUndefined();
    expect(Object.keys(entry)).not.toContain("ChildEffect");
    expect(Object.keys(entry)).not.toContain("DriveEffect");
  });

  it("exports nothing from the Basic HTTP entry point", () => {
    for (const name of BASIC_HTTP_RUNTIME_NAMES) expect(Object.keys(entry)).not.toContain(name);
  });
});

describe("the Basic HTTP entry point", () => {
  // Sabotage: exporting one more function from `src/basichttp/index.ts`, or
  // dropping `fetchTransport`, turns this red.
  it("exports exactly the runtime names listed", () => {
    expect(Object.keys(basicHttpEntry).sort()).toEqual(BASIC_HTTP_RUNTIME_NAMES);
  });

  // Sabotage: dropping `type ReportedSendFailure` (or any other name the
  // tuple above lists) from `src/basichttp/index.ts` turns the typecheck red.
  it("exports its types, as types only", () => {
    expect(basicHttpTypesNamed).toBeUndefined();
  });

  it("answers the processor's type URI, SCXML appendix C.2's", () => {
    expect(basicHttpEntry.BASIC_HTTP_EVENT_PROCESSOR).toBe(
      "http://www.w3.org/TR/scxml/#BasicHTTPEventProcessor",
    );
  });
});
