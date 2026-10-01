// The main entry point.
//
// The version of the build a host is running; `compile`, which turns SCXML
// text into a Chart - its identity and the compiled Machine the interpreter
// will run; and the driver's calls, which start a chart, send it events,
// move its virtual clock, and read its configuration and whether it is done.

import { version as packageVersion } from "../package.json";

export {
  type Chart,
  type ChartIdentity,
  type CompileError,
  type CompileOptions,
  type CompileResult,
  compile,
} from "./compiler.js";
export type { Done, InterpreterEffect, RoundBudget } from "./core/interpreter.js";
export type { Cancel, Send, SendDelayed } from "./core/send.js";
export type { Event } from "./datamodel.js";
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
  isDone,
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
export type { Machine } from "./machine.js";

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
