// The main entry point.
//
// The version of the build a host is running; `compile`, which turns SCXML
// text into a Chart - its identity and the compiled Machine the interpreter
// will run; the driver's calls, which start a chart, send it events, move
// its virtual clock, and read its configuration and whether it is done; and
// position export and import, a running chart's state in the string-id
// vocabulary out and back in; and the HTTP transport types, the seam a host
// implements to make the Basic HTTP processor's requests over its own HTTP,
// exported as types only, so nothing here reaches a host global; and the
// types a compile error reaches - each stage's error, its reason tokens and
// details, and the source span it names - so a host can narrow one.
//
// The identity lives on the Chart wrapper, not on the Machine, by choice. The
// Machine type is exported only because a Chart carries one: it is opaque and
// unstable until a release fixes it. ADR-0002 (the core contract) records
// both.

import { version as packageVersion } from "../package.json";

export {
  type Chart,
  type ChartIdentity,
  type CompileError,
  type CompileOptions,
  type CompileResult,
  type CompilerError,
  compile,
  type ExpressionOwner,
} from "./compiler.js";
export type { Effect, Log } from "./core/content.js";
export type { BindingEffect } from "./core/datamodel.js";
export type {
  ContentOwner,
  DatamodelChange,
  DatamodelInit,
  Trace,
  TraceContentExecuted,
  TraceCounters,
  TraceDone,
  TraceEntrySet,
  TraceEventDequeued,
  TraceExitSet,
  TraceFinalizeAutoforward,
  TraceInvokePass,
  TraceMacrostepStable,
  TraceTransitionsSelected,
} from "./core/effects.js";
export type { CancelInvoke, ExitEntryEffect } from "./core/exit-entry.js";
export type {
  BudgetExhausted,
  Done,
  InterpreterEffect,
  RoundBudget,
} from "./core/interpreter.js";
export type { Autoforward, Invoke, InvokeEffect } from "./core/invoke.js";
export type { Cancel, Send, SendDelayed, SendFields } from "./core/send.js";
export type {
  Cause,
  Event,
  EventType,
  ExecutionReason,
  Origin,
  Owner,
} from "./datamodel.js";
export type { StateKind } from "./document/scxml.js";
export {
  type ActiveInvocation,
  advance,
  configuration,
  type DoneRecord,
  type DoneStatus,
  type DriveOptions,
  type DriveRefusal,
  type DriveRefused,
  type DriveResult,
  type HostEvent,
  type InvocationRecord,
  isDone,
  type MailRecord,
  type MalformedDetail,
  type PendingTimer,
  type QueuedEvent,
  type SendProcessor,
  type SendProcessors,
  type SendRecord,
  type StartOptions,
  type State,
  start,
  step,
} from "./driver.js";
export type {
  HttpAnswer,
  HttpFailure,
  HttpRequest,
  HttpStatus,
  HttpTransport,
} from "./http-transport.js";
export type { LoweringError, LoweringErrorOf } from "./lowering.js";
export type { Machine } from "./machine.js";
export {
  type ExportedPosition,
  type ExportRefused,
  type ExportResult,
  exportPosition,
  type ImportRefused,
  type ImportResult,
  importPosition,
  type MalformedExport,
} from "./position.js";
export type {
  DefaultTransitionOwner,
  Empty,
  ErrorOf,
  ValidationError,
} from "./validator.js";
export type { Location, ParseError, ParseErrorReason } from "./xml/parser.js";

/**
 * The version of this build, as `package.json` carries it.
 *
 * The manifest is the one place the version is written. The bundler inlines
 * that one field at build time, so the answer is the version the published
 * build was cut at, and nothing is read from disk when this is called.
 */
export function version(): string {
  return packageVersion;
}
