// The in-memory driver: what a host calls to run a chart.
//
// The core answers one external event at a time and hands back effects as
// data; this module is the small loop around it that a session process is
// in the reference (`Statifier.Session` and `Statifier.Session.Effects` in
// statifier-ex at v2.9.0), with no process, no real clock and no I/O. It
// keeps the external queue, routes every `<send>` the way the reference's
// effect planner does, holds delayed sends as pending timers on a virtual
// clock, and hands a send of a registered type to the host's processor.
//
// Every call takes the compiled chart and a state and answers a new state
// and the effects the core produced, in order. The state is a plain JSON
// value: no class instance, no function, no Map or Set. Its fields are the
// reference's string-id position export (`Statifier.Position.export/1`),
// spelled in camel case as the rest of this package spells the reference's
// fields, plus the driver's own: the session id, the virtual clock, the
// pending timers, the external queue, the internal queue, the delayed sends
// processors hold, the budget halt, the stopped chart's donedata, and the
// session's invocations with each child's own state, nested.
// `JSON.stringify` then `JSON.parse` answers a state that steps exactly as
// the original does.
//
// How each part of the core's state is written:
//
// - A state is named by its id. A state the document gave no id is named
//   `#` and its index, a spelling no XML id can take, so the state stays
//   lossless for every chart the compiler accepts. Every list of states is
//   sorted by that string, so the order says nothing about the chart.
// - A datamodel value, and every value an event or a send carries, is
//   written as predicator's tagged-value text: plain JSON loses an integral
//   float, a date, a datetime, a duration and undefined, and that text keeps
//   them.
// - A queued event keeps its name, type, data, cause and addressing fields.
//   The failure an `error.execution` carries whole is not kept: its data,
//   the failure as a value, is what `_event.data` reads, and nothing in the
//   core reads the rest.
//
// The virtual clock. A delayed send of a built-in type becomes a pending
// timer due at the clock's time plus its delay. `advance` moves the clock
// forward and fires every timer due by the new time, earliest first and, at
// one due time, in the order they were scheduled; each fired send is routed
// then, as the reference routes a delayed send when its timer fires, and a
// self-addressed one runs to completion as an external event before the
// next timer fires. A `<cancel>` removes every pending timer under its send
// id. When the chart stops, its pending timers and its queued external
// events are discarded.
//
// Routing, as the reference's planner and session route a send: no target
// joins this session's external queue, and so does this session's own
// `#_scxml_` address; `#_internal` is delivered onto the internal queue and
// the chart runs to a stable configuration again; `#_parent` from an invoked
// child, and `#_<invokeid>` naming a live invocation, deliver as external
// events (below); another session, a parent the session does not have, or an
// invocation that is not live names nothing this driver can reach, so the
// send fails with `error.communication` on the internal queue. The driver
// declares to the core what it can reach - this session's own id, whether it
// has a parent, and the ids of its live invocations - where the reference's
// session stamps its routes: when the session starts, when an input reaches
// it from outside (the host's event, a child's message taken from the
// mailbox, an event delivered to a child, a fired timer), and before a
// delivery onto the internal queue. Decoding the state a call is handed
// declares them too, for every session in it; that declaration is the one
// the session's own state gives, and the call declares it again at those
// points before an input is taken. An event the chart queued for itself is
// taken under the routes already declared, as the reference's drain takes
// it, so a send there judges an invocation started or cancelled since by the
// earlier declaration. The core refuses an immediate send to anything the
// declaration does not reach where the send runs: the block stops and
// `error.communication` joins the internal queue ahead of anything the rest
// of the block would have raised. A send the declaration reaches but that
// names nothing live by the time the driver routes it fails here, after the
// block, with the same event. A delayed send's route is judged here when its
// timer fires. A delivery onto the internal queue runs after the effects of
// the drive that produced it, as the reference defers it.
//
// Invocations, as the reference's session and its built-in `scxml` handler
// run them (`Statifier.Session`, `Statifier.Session.Invocations`,
// `Statifier.Invoke.Source` and `Statifier.Invoke.Handler.Scxml` at v2.9.0),
// with one session tree in place of processes. An `invoke` effect of the
// SCXML type is recorded live under its id, then its content is compiled
// with the relaxed namespace rule and started as a child session with its
// own id (the parent's, a dot and the invoke id), its datamodel seeded from
// the params a root `<data>` of the child names; a content that is not
// markup, or does not compile, raises `error.communication` and leaves the id
// recorded with no child, as the reference's table keeps it. Any other type
// raises `error.execution` and records nothing. A child runs on the parent's
// virtual clock and is stepped by this driver, never by a timer, a thread or
// I/O: starting it, an event sent to it and an autoforwarded event each run
// it to a stable configuration at once, and its timers fire with the
// parent's, in due-then-scheduled order across the whole tree.
//
// What a child sends its parent - an event to `#_parent`, stamped with the
// invoke id; a notice that it reached a top-level final, ahead of everything
// its final batch sends; and `done.invoke.<id>` with its donedata - waits in
// the parent's mailbox and is taken once the parent's own external queue is
// empty, one entry at a time, as the reference's session takes a message
// only after its own inbox drains. An entry whose invocation is no longer
// live is discarded there, as the reference discards it at drain; the done
// event retires its invocation once taken. A `cancel_invoke` retires the
// invocation and stops its child, running the child's `<onexit>` handlers,
// unless the child already said it completed, which leaves the entry for
// its done event. An `autoforward` delivers the event, unchanged, to a live
// child.
//
// What a child inherits is the host's to choose, call by call, as the
// reference's session options choose it, and each choice is off by default.
// Off, a child is started with no registered send type, and its effects are
// not among a call's effects: those are the host's session's own. With
// `inheritSendTypes`, every session of the tree is started and decoded with
// the call's processors, so a child's send of a registered type is handed to
// its processor with the child's own session id, under the same encode-first
// rule and the same ledger as the host's session's. With `inheritObservers`,
// every effect a child's run answers is reported among the call's effects, in
// the order the run made it, wrapped in a `child` effect that names the
// child's session id, and a child starts with its parent's trace flag.
//
// Registered send types. The processors a host registers are passed with
// every call, as the reference re-stamps its send types before each drive:
// the registered set is never stored. A send of a registered type is handed
// to its processor's `deliver`, and is reported among the call's effects as
// every send is; it is never routed and never scheduled, delayed or not; the
// processor holds a delayed one, and a `<cancel>` of its send id reaches that
// processor's `cancel` once. A processor is called only once the call's
// state is written, in the order the run made the calls: a call refused
// because a value cannot be written as tagged-value text, a host event's
// data or a starting datamodel value among them, calls no processor, so a
// host that retries it hands nothing twice.
//
// A failed send. A host reports a send it was handed and could not deliver
// through `reportSendFailed`, at any later time, with the send's id, content
// index and owner as the handed send carries them: the driver keeps no table
// of handed sends, as the reference's `Statifier.Session.failed_send/3` takes
// the send itself. The report raises `error.communication` onto the internal
// queue, its origin the send's content and its `sendid` the send's id, and
// runs the chart to a stable configuration within that call, as the
// reference's `Interpreter.deliver_internal/5` does at v2.10.0. A processor's
// `deliver` that answers a failure raises the same event within the run that
// handed the send, at the send's place in it, ahead of anything that run has
// yet to take from its external queue, as the reference raises the failure
// its processor plans in `deliver/3`. Since the processors are called only
// once the state is written, the driver makes the run again from the call's
// own arguments with the answers it already has, and each send is handed to
// its processor once. A `deliver` that throws is the host's own exception and
// propagates unchanged.
//
// A macrostep that spends its round budget halts the driver as the
// reference halts its session: further external events are queued and not
// taken, and pending timers still fire.

import {
  PDateTime,
  evaluate as predicatorEvaluate,
  typeName,
  Undefined,
  type Value,
} from "@riddler/predicator";
import { decodeTagged, encodeTagged } from "@riddler/predicator/tagged";
import { type Chart, type ChartIdentity, compileInvokeContent } from "./compiler.js";
import {
  type Done,
  exitInterpreter,
  handleEvent,
  type InterpreterEffect,
  initialize,
  type MachineState,
  mainEventLoop,
  type RoundBudget,
} from "./core/interpreter.js";
import { builtInInvokeType, type Invoke } from "./core/invoke.js";
import {
  type Cancel,
  classifyType,
  parseTarget,
  type Routes,
  type Send,
  type SendDelayed,
  type SendFields,
} from "./core/send.js";
import {
  type Cause,
  type Draws,
  type Event,
  type EventType,
  type Origin,
  type Owner,
  SCXML_EVENT_PROCESSOR,
  scxmlLocation,
  withDraws,
} from "./datamodel.js";
import { stateShapeFailure } from "./driver-shape.js";
import { type Machine, stateAt } from "./machine.js";

// ---------------------------------------------------------------------------
// The public shapes
// ---------------------------------------------------------------------------

/** An event as it waits in a queue: its values as tagged-value text. */
export interface QueuedEvent {
  readonly name: string;
  readonly type: EventType;
  /** The event's data as tagged-value text. */
  readonly data: string;
  readonly cause?: Cause;
  readonly sendid?: string;
  readonly origin?: string;
  readonly origintype?: string;
  readonly invokeid?: string;
}

/** A send as the state records it: its values as tagged-value text. */
export interface SendRecord {
  readonly kind: "send" | "send_delayed";
  readonly event: string;
  readonly target: string;
  readonly type: string;
  readonly data: string;
  readonly sendId: string;
  readonly idFromAuthor: boolean;
  readonly cIndex: number;
  readonly owner: Owner;
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
  readonly ordinal: number | null;
  /** The delay of a delayed send; null for an immediate one. */
  readonly delayMs: number | null;
}

/** A delayed send waiting on the virtual clock. */
export interface PendingTimer {
  readonly sendId: string;
  /** The virtual time it fires at, in milliseconds. */
  readonly dueMs: number;
  /** The order it was scheduled in: two timers due together fire in this order. */
  readonly sequence: number;
  readonly send: SendRecord;
}

/** A live invocation: its state, its position among that state's invokes, and its id. */
export interface ActiveInvocation {
  readonly state: string;
  readonly invokeIndex: number;
  readonly invokeId: string;
}

/**
 * An invocation the driver holds live: its id, whether it autoforwards,
 * whether its child has said it reached a top-level final, the content
 * markup its child was compiled from, and the child's own state. `source`
 * and `state` are both null when the content could not start a child: the
 * id stays live, as the reference's table keeps it, and nothing answers.
 */
export interface InvocationRecord {
  readonly invokeId: string;
  readonly autoforward: boolean;
  readonly completed: boolean;
  readonly source: string | null;
  readonly state: State | null;
}

/**
 * What a child has sent its parent and the parent has not taken yet: the
 * notice that it reached a top-level final (`completed`, no event), an
 * event sent to `#_parent` (`event`), or its `done.invoke.<id>` (`done`).
 */
export interface MailRecord {
  readonly kind: "completed" | "event" | "done";
  readonly invokeId: string;
  readonly event: QueuedEvent | null;
}

/**
 * A running chart's state: a plain JSON value. The first block of fields is
 * the reference's string-id position export; the rest are the driver's own.
 */
export interface State {
  readonly identity: ChartIdentity;
  /** The active states, root excluded, sorted. */
  readonly configuration: readonly string[];
  readonly enteredStates: readonly string[];
  readonly statesToInvoke: readonly string[];
  /** Each history state's recorded states, sorted. */
  readonly historyValues: Readonly<Record<string, readonly string[]>>;
  readonly activeInvocations: readonly ActiveInvocation[];
  /** The sequence a generated invoke id is minted from: the next takes it plus one. */
  readonly invokeCounter: number;
  readonly sendCounter: number;
  readonly timerCounter: number;
  /** Every datamodel root, the system variables included, as tagged-value text. */
  readonly datamodel: Readonly<Record<string, string>>;
  readonly running: boolean;
  readonly status: "running" | "done";
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
  /**
   * Whether the chart answers trace effects: `start` sets it false, and it is
   * carried as it stands.
   */
  readonly trace: boolean;
  readonly maxMacrostepRounds: RoundBudget;

  /** The id the host minted for the session. */
  readonly sessionId: string;
  /**
   * The virtual clock, in milliseconds since the chart started. A child's
   * state carries its host session's clock, which every session of the tree
   * shares; only the host session's is read.
   */
  readonly nowMs: number;
  readonly timers: readonly PendingTimer[];
  /**
   * How many timers have ever been scheduled, in the whole tree: the next
   * one's sequence. A child's state carries its host session's.
   */
  readonly timerSequence: number;
  /** External events not yet taken, oldest first. */
  readonly externalQueue: readonly QueuedEvent[];
  /** Internal events not yet taken; empty unless a macrostep spent its budget. */
  readonly internalQueue: readonly QueuedEvent[];
  /** The registered types holding a delayed send, by send id. */
  readonly heldSends: Readonly<Record<string, readonly string[]>>;
  /** Set when a macrostep spent its round budget: external events then wait. */
  readonly halted: "budget_exhausted" | null;
  /** Set once the chart has stopped. */
  readonly done: DoneRecord | null;
  /** The invoke id this session runs as in its parent; null for a host's session. */
  readonly invokedAs: string | null;
  /** The live invocations, in the order they started. */
  readonly invocations: readonly InvocationRecord[];
  /** What the children have sent and this session has not taken, oldest first. */
  readonly mailbox: readonly MailRecord[];
}

/** What the state keeps of a stopped chart. */
export interface DoneRecord {
  /** The top-level final's donedata as tagged-value text. */
  readonly donedata: string;
  /** The configuration as it stood when the chart stopped, sorted. */
  readonly configuration: readonly string[];
}

/**
 * What a processor's `deliver` answers for a send it could not deliver: the
 * send then fails as `reportSendFailed` fails it, within the run that handed
 * it, at the send's place in that run. `reason` is the host's own words; the
 * chart is not handed them.
 */
export interface DeliveryFailure {
  readonly kind: "failure";
  readonly reason: string;
}

/**
 * What the driver tells a processor about the session it is called for: the
 * session's id, the one `_sessionid` reads. A processor that serves several
 * sessions tells their sends apart by it.
 */
export interface ProcessorContext {
  readonly sessionId: string;
}

/**
 * A host's processor for one registered send type. The driver calls its
 * `deliver` and `cancel` once the call's state is written, in the order the
 * run made the calls; a refused call calls neither.
 */
export interface SendProcessor {
  /**
   * Takes a send of its type, the event a delivery of it would carry, and the
   * sending session's context. Answers a `DeliveryFailure` for a send it could
   * not deliver. Any other answer, nothing included, is a send it took: the
   * answer is typed `unknown` so that a processor written as an expression,
   * whose value is whatever that expression answers, stays a processor.
   */
  readonly deliver: (send: Send | SendDelayed, event: Event, context: ProcessorContext) => unknown;
  /** Takes a `<cancel>` naming a delayed send it holds, and the session's context. */
  readonly cancel?: (cancel: Cancel, context: ProcessorContext) => void;
  /**
   * The entry the session's `_ioprocessors` holds under a type this processor
   * is registered for, asked once per registered type as the session starts,
   * with the type and the session's context. Without it the entry is empty.
   * Asked while the starting state is built, so a start the driver refuses
   * may already have asked it.
   */
  readonly ioprocessorsEntry?: (
    type: string,
    context: ProcessorContext,
  ) => Readonly<Record<string, Value>>;
}

/** The processors a host registers, by send type. */
export type SendProcessors = Readonly<Record<string, SendProcessor>>;

/**
 * An effect an invoked child's run answered, reported among a call's effects
 * when the call passes `inheritObservers`: the child's session id, which is
 * its parent's, a dot and its invoke id, and the effect as the child's run
 * answered it. A grandchild's effect is reported the same way, under its own
 * session id, never nested.
 */
export interface ChildEffect {
  readonly kind: "child";
  readonly sessionId: string;
  readonly effect: InterpreterEffect;
}

/** An effect a driver call answers: the host's session's own, or a child's. */
export type DriveEffect = InterpreterEffect | ChildEffect;

/** What every call but `start` takes beside its arguments. */
export interface DriveOptions {
  /**
   * The processors for the send types the host registers.
   *
   * `sendTypes` must name the same set of types for a session's whole life.
   * A send's type is judged against the processors passed with each call, so
   * a type passed on one call and not the next is handed on the first and
   * refused with `error.execution` on the second. The reference fixes
   * `_ioprocessors` when the chart starts, from the registered set
   * (`SystemVariables.initial/3`), so a set that changed afterwards would also
   * disagree with what the chart reads there. This package does the same: a
   * registered type's entry in `_ioprocessors` is written at start and kept.
   */
  readonly sendTypes?: SendProcessors;
  /**
   * Whether an invoked child reaches the processors in `sendTypes`, as the
   * reference's `inherit_send_types` session option decides it. When true,
   * every session of the tree, a child's children included, is started and
   * run with the call's processors: its `_ioprocessors` holds their entries,
   * and a send of a registered type is handed to its processor with the
   * child's own session id in the context. False when absent: a child
   * registers no send type, and a send of a type the host registers raises
   * `error.execution` in it.
   *
   * Like `sendTypes`, it must stay the same for a session's whole life: a
   * child's `_ioprocessors` is written as it starts.
   */
  readonly inheritSendTypes?: boolean;
  /**
   * Whether an invoked child's effects are among the call's effects, as the
   * reference's `inherit_observers` session option decides whether a child's
   * messages reach its parent's observers. When true, every effect a child's
   * run answers, a child's children included, is reported in the order the
   * run made it as a `ChildEffect` naming the child's session id, and a child
   * starts with its parent's `trace` flag. False when absent: a child's
   * effects are not reported, and a child starts with the flag clear.
   */
  readonly inheritObservers?: boolean;
}

/**
 * What `start` takes.
 *
 * `sendTypes` must name the same set of types for a session's whole life.
 * A send's type is judged against the processors passed with each call, so
 * a type passed on one call and not the next is handed on the first and
 * refused with `error.execution` on the second. The reference fixes
 * `_ioprocessors` when the chart starts, from the registered set
 * (`SystemVariables.initial/3`), so a set that changed afterwards would also
 * disagree with what the chart reads there. This package does the same: a
 * registered type's entry in `_ioprocessors` is written at start and kept.
 */
export interface StartOptions extends DriveOptions {
  /** The session's id, minted by the host: `_sessionid` reads it. */
  readonly sessionId: string;
  /** The datamodel's initial values, under the system variables. */
  readonly datamodel?: Readonly<Record<string, Value>>;
  /** The rounds one macrostep may spend; 10000 when absent. */
  readonly maxMacrostepRounds?: RoundBudget;
}

/** An event a host sends the chart. */
export interface HostEvent {
  readonly name: string;
  readonly data?: Value;
}

/**
 * A send a host reports it could not deliver: the fields of the send it was
 * handed that the failure event is built from. A handed `Send` or
 * `SendDelayed` carries them, so a host may pass it as it was handed.
 */
export interface FailedSend {
  readonly send: Pick<SendFields, "sendId" | "cIndex" | "owner">;
  /** The host's own words for the miss; the chart is not handed them. */
  readonly reason?: string;
}

/**
 * Why a call was refused. `not_running`: the chart has stopped.
 * `chart_mismatch`: the state was not made by this chart. `malformed_state`:
 * the state names a state the chart does not have, carries text that does
 * not decode, or holds a pending timer that is not a delayed send; the
 * refusal's `detail` says which. `unencodable_value`: a value cannot be
 * written as tagged-value text. `invalid_duration`: `advance` was given a
 * negative or non-finite time. `not_a_send`: `reportSendFailed` was given a
 * send without a string `sendId`, a whole non-negative `cIndex` and an
 * `owner` of one of the four kinds.
 */
export type DriveRefusal =
  | "not_running"
  | "chart_mismatch"
  | "malformed_state"
  | "unencodable_value"
  | "invalid_duration"
  | "not_a_send";

/**
 * What failed in a malformed state: a field missing or of the wrong type
 * (checked over the whole state before anything decodes), a state name the
 * chart does not hold, the field whose tagged-value text did not decode, or
 * the pending timer whose send is not a delayed one. A field is written as a
 * path into the state, such as `datamodel.renewals` or `timers[0].send.data`;
 * a state that is not an object at all is the field `state`.
 */
export type MalformedDetail =
  | { readonly kind: "bad_shape"; readonly field: string }
  | { readonly kind: "unknown_state"; readonly name: string }
  | { readonly kind: "undecodable_value"; readonly field: string }
  | { readonly kind: "not_a_delayed_send"; readonly field: string };

/** A refused call: the reason, and for a malformed state what failed. */
export type DriveRefused =
  | { readonly ok: false; readonly reason: Exclude<DriveRefusal, "malformed_state"> }
  | { readonly ok: false; readonly reason: "malformed_state"; readonly detail: MalformedDetail };

/** What every call that moves a chart answers. */
export type DriveResult =
  | {
      readonly ok: true;
      readonly state: State;
      readonly effects: readonly DriveEffect[];
    }
  | DriveRefused;

/**
 * Whether the chart has stopped, and with what. A state without the driver
 * state's shape, or a stopped chart whose stored donedata does not decode,
 * answers `ok: false` with the malformed detail rather than a stand-in value.
 */
export type DoneStatus =
  | { readonly ok: true; readonly done: false }
  | {
      readonly ok: true;
      readonly done: true;
      readonly donedata: Value;
      readonly configuration: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: "malformed_state";
      readonly detail: MalformedDetail;
    };

// ---------------------------------------------------------------------------
// The driver's calls (beside `compile`)
// ---------------------------------------------------------------------------

/**
 * Starts a chart: its datamodel bound, its initial states entered, run to a
 * stable configuration.
 *
 * `sendTypes` must name the same set of types for a session's whole life.
 * A send's type is judged against the processors passed with each call, so
 * a type passed on one call and not the next is handed on the first and
 * refused with `error.execution` on the second. The reference fixes
 * `_ioprocessors` when the chart starts, from the registered set
 * (`SystemVariables.initial/3`), so a set that changed afterwards would also
 * disagree with what the chart reads there. This package does the same: a
 * registered type's entry in `_ioprocessors` is written at start and kept.
 */
export function start(chart: Chart, options: StartOptions): DriveResult {
  return drive(options.sendTypes ?? {}, (processors) => {
    const out: DriveEffect[] = [];
    const live = launch({
      chart,
      sessionId: options.sessionId,
      datamodel: new Map(Object.entries(options.datamodel ?? {})),
      maxMacrostepRounds: options.maxMacrostepRounds ?? 10_000,
      clock: { nowMs: 0, sequence: 0 },
      processors,
      inherit: inheritanceOf(options),
      out,
      parent: null,
      invokedAs: null,
      trace: false,
    });
    return { ok: true, live, out };
  });
}

/**
 * Sends the chart one external event and runs it, and every event it
 * queues, to a stable configuration.
 *
 * `sendTypes` must name the same set of types for a session's whole life.
 * A send's type is judged against the processors passed with each call, so
 * a type passed on one call and not the next is handed on the first and
 * refused with `error.execution` on the second. The reference fixes
 * `_ioprocessors` when the chart starts, from the registered set
 * (`SystemVariables.initial/3`), so a set that changed afterwards would also
 * disagree with what the chart reads there. This package does the same: a
 * registered type's entry in `_ioprocessors` is written at start and kept.
 */
export function step(
  chart: Chart,
  state: State,
  event: HostEvent,
  options: DriveOptions = {},
): DriveResult {
  return drive(options.sendTypes ?? {}, (sendTypes) => {
    const out: DriveEffect[] = [];
    const opened = open(chart, state, { ...options, sendTypes }, out);
    if (!opened.ok) return opened;
    const live = opened.live;
    if (!live.core.running) return { ok: false, reason: "not_running" };
    live.externalQueue.push({ name: event.name, type: "external", data: event.data ?? Undefined });
    stamp(live);
    drain(live);
    return { ok: true, live, out };
  });
}

/**
 * Moves the virtual clock forward `ms` milliseconds, firing every pending
 * timer due by then in due-then-scheduled order, each run to completion
 * before the next. The timers of the chart's invoked children fire on the
 * same clock, in the same order.
 *
 * `sendTypes` must name the same set of types for a session's whole life.
 * A send's type is judged against the processors passed with each call, so
 * a type passed on one call and not the next is handed on the first and
 * refused with `error.execution` on the second. The reference fixes
 * `_ioprocessors` when the chart starts, from the registered set
 * (`SystemVariables.initial/3`), so a set that changed afterwards would also
 * disagree with what the chart reads there. This package does the same: a
 * registered type's entry in `_ioprocessors` is written at start and kept.
 */
export function advance(
  chart: Chart,
  state: State,
  ms: number,
  options: DriveOptions = {},
): DriveResult {
  if (!Number.isFinite(ms) || ms < 0) return { ok: false, reason: "invalid_duration" };
  return drive(options.sendTypes ?? {}, (sendTypes) => {
    const out: DriveEffect[] = [];
    const opened = open(chart, state, { ...options, sendTypes }, out);
    if (!opened.ok) return opened;
    const live = opened.live;
    const until = live.clock.nowMs + ms;
    for (;;) {
      const next = nextDue(live, until);
      if (next === undefined) break;
      const { session, timer } = next;
      session.timers = session.timers.filter((pending) => pending !== timer);
      live.clock.nowMs = timer.dueMs;
      stamp(session);
      fire(session, timer.send);
      // The session the timer fired in runs to a stable configuration, then
      // each session above it takes what its child sent.
      for (let at: Live | null = session; at !== null; at = at.parent) drain(at);
    }
    live.clock.nowMs = until;
    return { ok: true, live, out };
  });
}

/**
 * Reports a send the host was handed as failed: `error.communication` joins
 * the internal queue, its origin the send's content and its `sendid` the
 * send's id whether or not the author named it, and the chart runs to a
 * stable configuration, then takes whatever its external queue holds, as
 * `step` does. A report is refused as the other calls refuse a state, with
 * `not_running` once the chart has stopped, and with `not_a_send` for a send
 * without the fields the event is built from. The driver keeps no record of
 * the sends it handed, so a report is not checked against one.
 *
 * `sendTypes` must name the same set of types for a session's whole life.
 * A send's type is judged against the processors passed with each call, so
 * a type passed on one call and not the next is handed on the first and
 * refused with `error.execution` on the second. The reference fixes
 * `_ioprocessors` when the chart starts, from the registered set
 * (`SystemVariables.initial/3`), so a set that changed afterwards would also
 * disagree with what the chart reads there. This package does the same: a
 * registered type's entry in `_ioprocessors` is written at start and kept.
 */
export function reportSendFailed(
  chart: Chart,
  state: State,
  failure: FailedSend,
  options: DriveOptions = {},
): DriveResult {
  const send = failure?.send;
  if (!isSendOrigin(send)) return { ok: false, reason: "not_a_send" };
  return drive(options.sendTypes ?? {}, (sendTypes) => {
    const out: DriveEffect[] = [];
    const opened = open(chart, state, { ...options, sendTypes }, out);
    if (!opened.ok) return opened;
    const live = opened.live;
    if (!live.core.running) return { ok: false, reason: "not_running" };
    failSend(live, send);
    return { ok: true, live, out };
  });
}

/** The active states' ids, root excluded, sorted. */
export function configuration(state: State): readonly string[] {
  return state.configuration;
}

/**
 * Whether the chart has stopped and, when it has, the top-level final's
 * donedata and the configuration the chart stopped in, as the `done` effect
 * carried them.
 *
 * A state imported from a stopped position answers undefined for the
 * donedata and an empty configuration. Neither travels in a position, as the
 * reference's position carries neither: a chart leaves every state as it
 * stops, so a stopped position's configuration is empty, and the
 * configuration it stopped in is carried only by the `done` effect.
 */
export function isDone(state: State): DoneStatus {
  const badShape = stateShapeFailure(state);
  if (badShape !== null) {
    return { ok: false, reason: "malformed_state", detail: { kind: "bad_shape", field: badShape } };
  }
  if (state.done === null) return { ok: true, done: false };
  const { configuration } = state.done;
  const donedata = decodeTagged(state.done.donedata);
  if (!donedata.ok) {
    const detail: MalformedDetail = { kind: "undecodable_value", field: "done.donedata" };
    return { ok: false, reason: "malformed_state", detail };
  }
  return { ok: true, done: true, donedata: donedata.value, configuration };
}

/**
 * A state decoded over its chart and written again, as every call that moves
 * a chart writes the state it answers, with nothing driven and no effect.
 * Refused as the other calls refuse a state. Internal: the position module's
 * import builds its state through it, so an imported state is in the form a
 * drive leaves.
 */
export function rewrite(chart: Chart, state: State): DriveResult {
  const out: DriveEffect[] = [];
  const opened = open(chart, state, {}, out);
  if (!opened.ok) return opened;
  const codec: Codec = { failed: false };
  const written = encodeState(codec, opened.live);
  if (codec.failed) return { ok: false, reason: "unencodable_value" };
  return { ok: true, state: written, effects: out };
}

// ---------------------------------------------------------------------------
// The working form
// ---------------------------------------------------------------------------

// The state decoded for one call: the core's own state, the driver's fields
// with their values decoded, and the chart. Mutated in place during the call
// and encoded once at its end. A child session is a `Live` of its own, held
// by its parent's invocation and pointing back at that parent; every session
// of one tree shares one clock.
interface Live {
  readonly chart: Chart;
  core: MachineState;
  readonly sessionId: string;
  readonly clock: Clock;
  timers: LiveTimer[];
  externalQueue: Event[];
  heldSends: Map<string, string[]>;
  halted: "budget_exhausted" | null;
  done: { readonly donedata: Value; readonly configuration: readonly number[] } | null;
  /** The invoke id this session runs as in its parent; null for the host's session. */
  readonly invokedAs: string | null;
  /** The session that invoked this one; null for the host's session. */
  readonly parent: Live | null;
  /** The live invocations by id, in the order they started. */
  invocations: Map<string, Invocation>;
  /** What the children sent and this session has not taken, oldest first. */
  mailbox: Mail[];
  /**
   * Set while a cancelled child runs its exit: it neither announces its
   * completion nor returns a done event, as the reference's cancel overrides
   * its halt. What its `<onexit>` sends `#_parent` is sent, and discarded by
   * the parent, which has already retired the invocation.
   */
  cancelled: boolean;
  /**
   * The processors this session hands registered sends to: the host's, and a
   * child's too when the call passes `inheritSendTypes`; none otherwise.
   */
  readonly processors: SendProcessors;
  /** What the call passes the children of its tree. */
  readonly inherit: Inheritance;
  /**
   * Where this session's effects are reported: the call's own for the host's
   * session, and for a child when the call passes `inheritObservers`; a list
   * nothing reads otherwise.
   */
  readonly out: DriveEffect[];
}

// What a call passes the children of its tree, from its options.
interface Inheritance {
  readonly sendTypes: boolean;
  readonly observers: boolean;
}

function inheritanceOf(options: DriveOptions): Inheritance {
  return {
    sendTypes: options.inheritSendTypes === true,
    observers: options.inheritObservers === true,
  };
}

// What a child of `parent` is started or decoded with: the parent's
// processors and its effect list when the call passes them on, and otherwise
// no processor and a list nothing reads.
function inheritedBy(parent: {
  readonly processors: SendProcessors;
  readonly inherit: Inheritance;
  readonly out: DriveEffect[];
}): { readonly processors: SendProcessors; readonly out: DriveEffect[] } {
  return {
    processors: parent.inherit.sendTypes ? parent.processors : {},
    out: parent.inherit.observers ? parent.out : [],
  };
}

// The virtual clock and the sequence timers are scheduled in, one per tree.
interface Clock {
  nowMs: number;
  sequence: number;
}

interface LiveTimer {
  readonly sendId: string;
  readonly dueMs: number;
  readonly sequence: number;
  readonly send: SendDelayed;
}

// A live invocation. `child` is null when its content could not start one.
interface Invocation {
  readonly invokeId: string;
  readonly autoforward: boolean;
  completed: boolean;
  readonly source: string | null;
  readonly child: Live | null;
}

type Mail =
  | { readonly kind: "completed"; readonly invokeId: string }
  | { readonly kind: "event" | "done"; readonly invokeId: string; readonly event: Event };

// What starting a session takes: the host's session or an invoked child.
interface Launch {
  readonly chart: Chart;
  readonly sessionId: string;
  readonly datamodel: Map<string, Value>;
  readonly maxMacrostepRounds?: RoundBudget;
  readonly clock: Clock;
  readonly processors: SendProcessors;
  readonly inherit: Inheritance;
  readonly out: DriveEffect[];
  readonly parent: Live | null;
  readonly invokedAs: string | null;
  /** Whether the session starts with its trace flag set. */
  readonly trace: boolean;
}

// Starts a session and runs it to a stable configuration. A child's
// invocation is recorded before it runs, so what it sends while starting
// reaches a live invocation.
function launch(spec: Launch, register?: (live: Live) => void): Live {
  const stepped = initialize(spec.chart.machine, {
    sessionId: spec.sessionId,
    datamodel: spec.datamodel,
    ...(spec.maxMacrostepRounds === undefined
      ? {}
      : { maxMacrostepRounds: spec.maxMacrostepRounds }),
    sendTypes: registeredSet(spec.processors),
    ioprocessors: entriesOf(spec.processors, spec.sessionId),
    trace: spec.trace,
    routes: {
      sessions: new Set([spec.sessionId]),
      parent: spec.invokedAs !== null,
      invokes: new Set(),
    },
  });
  const live: Live = {
    chart: spec.chart,
    core: stepped.state,
    sessionId: spec.sessionId,
    clock: spec.clock,
    timers: [],
    externalQueue: [],
    heldSends: new Map(),
    halted: null,
    done: null,
    invokedAs: spec.invokedAs,
    parent: spec.parent,
    invocations: new Map(),
    mailbox: [],
    cancelled: false,
    processors: spec.processors,
    inherit: spec.inherit,
    out: spec.out,
  };
  register?.(live);
  perform(live, stepped.effects);
  drain(live);
  return live;
}

// What this session can reach, declared to the core where the reference's
// session stamps its routes (the header says where): its own session id,
// whether it has a parent, and the ids of its live invocations.
function routesOf(live: Live): Routes {
  return {
    sessions: new Set([live.sessionId]),
    parent: live.invokedAs !== null,
    invokes: new Set(live.invocations.keys()),
  };
}

function stamp(live: Live): void {
  live.core = { ...live.core, sends: { ...live.core.sends, routes: routesOf(live) } };
}

function registeredSet(processors: SendProcessors): ReadonlySet<string> | null {
  const types = Object.keys(processors);
  return types.length === 0 ? null : new Set(types);
}

// The `_ioprocessors` entries the registered processors supply, asked once
// per type as the session starts: the reference's `ioprocessors_entry/2`,
// asked by `SystemVariables.initial/3`. A type whose processor has no
// `ioprocessorsEntry` supplies none, and its entry stays empty.
function entriesOf(processors: SendProcessors, sessionId: string): ReadonlyMap<string, Value> {
  const entries = new Map<string, Value>();
  for (const type of Object.keys(processors)) {
    const entry = processorFor(processors, type)?.ioprocessorsEntry;
    if (entry !== undefined) entries.set(type, entry(type, { sessionId }));
  }
  return entries;
}

// Every session of the tree, the host's first and each child after its
// parent, in the order the invocations started.
function sessionsOf(live: Live): Live[] {
  const all = [live];
  for (const invocation of live.invocations.values()) {
    if (invocation.child !== null) all.push(...sessionsOf(invocation.child));
  }
  return all;
}

// The earliest timer due by `until` anywhere in the tree, the first scheduled
// among equals.
function nextDue(
  root: Live,
  until: number,
): { readonly session: Live; readonly timer: LiveTimer } | undefined {
  let best: { session: Live; timer: LiveTimer } | undefined;
  for (const session of sessionsOf(root)) {
    for (const timer of session.timers) {
      if (timer.dueMs > until) continue;
      if (
        best === undefined ||
        timer.dueMs < best.timer.dueMs ||
        (timer.dueMs === best.timer.dueMs && timer.sequence < best.timer.sequence)
      ) {
        best = { session, timer };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Draining, performing and routing
// ---------------------------------------------------------------------------

// Takes the external queue one event per macrostep, while the chart runs and
// no macrostep has spent its budget; once it is empty, takes the mailbox one
// entry at a time, each run to completion before the next.
function drain(live: Live): void {
  while (live.halted === null && live.core.running) {
    const [event, ...rest] = live.externalQueue;
    if (event !== undefined) {
      live.externalQueue = rest;
      take(live, event);
      continue;
    }
    const [mail, ...later] = live.mailbox;
    if (mail === undefined) return;
    live.mailbox = later;
    takeMail(live, mail);
  }
}

// One external event, one macrostep, under the routes last declared: an
// event the chart queued for itself declares nothing new, as the reference's
// drain does not.
function take(live: Live, event: Event): void {
  const outcome = handleEvent(live.core, event);
  if (!outcome.ok) return;
  live.core = outcome.state;
  perform(live, outcome.effects);
}

// One mailbox entry. A message carrying an event declares the routes as it
// arrives, as the reference's session stamps a child's message when its cast
// arrives, then an entry whose invocation is no longer live is discarded, as
// the reference's session discards it at drain; the done event retires its
// invocation once it has been taken.
function takeMail(live: Live, mail: Mail): void {
  if (mail.kind !== "completed") stamp(live);
  const invocation = live.invocations.get(mail.invokeId);
  if (invocation === undefined) return;
  switch (mail.kind) {
    case "completed":
      invocation.completed = true;
      return;
    case "event":
      take(live, mail.event);
      return;
    case "done":
      take(live, mail.event);
      live.invocations.delete(mail.invokeId);
      return;
  }
}

// Acts on a batch of effects in order. A delivery onto the internal queue
// runs the chart at once, but its own effects are acted on after the batch,
// as the reference defers them. A child whose batch stops it tells its
// parent first, ahead of everything the batch sends, as the reference's
// session announces its completion.
function perform(live: Live, effects: readonly InterpreterEffect[]): void {
  if (
    live.parent !== null &&
    live.invokedAs !== null &&
    !live.cancelled &&
    effects.some((effect) => effect.kind === "done")
  ) {
    live.parent.mailbox.push({ kind: "completed", invokeId: live.invokedAs });
  }
  let batch = effects;
  while (batch.length > 0) {
    const deferred: InterpreterEffect[] = [];
    for (const effect of batch) {
      live.out.push(
        live.invokedAs === null ? effect : { kind: "child", sessionId: live.sessionId, effect },
      );
      deferred.push(...performOne(live, effect));
    }
    batch = deferred;
  }
}

function performOne(live: Live, effect: InterpreterEffect): readonly InterpreterEffect[] {
  switch (effect.kind) {
    case "send":
      if (registered(live, effect)) return handOff(live, effect);
      return route(live, effect);
    case "send_delayed":
      if (registered(live, effect)) return handOff(live, effect);
      live.timers.push({
        sendId: effect.sendId,
        dueMs: live.clock.nowMs + effect.delayMs,
        sequence: live.clock.sequence,
        send: effect,
      });
      live.clock.sequence += 1;
      return [];
    case "cancel":
      cancelSend(live, effect);
      return [];
    case "invoke":
      return invoke(live, effect);
    case "cancel_invoke":
      cancelInvocation(live, effect.invokeId);
      return [];
    case "autoforward":
      deliverToChild(live.invocations.get(effect.invokeId), effect.event);
      return [];
    case "done":
      stopped(live, effect);
      return [];
    case "budget_exhausted":
      live.halted = "budget_exhausted";
      return [];
    default:
      return [];
  }
}

function registered(live: Live, send: Send | SendDelayed): boolean {
  return (
    classifyType(live.core.sends.sendTypes, send.type) === "registered" &&
    typeof send.type === "string" &&
    Object.hasOwn(live.processors, send.type)
  );
}

// A registered type's send: handed to its processor with the event a
// delivery would carry, and, when delayed, held under its send id. A
// failure the processor answered is raised here, at the send's place in the
// run, as the reference raises the failure its processor plans in
// `deliver/3`: ahead of anything the run has yet to take.
function handOff(live: Live, send: Send | SendDelayed): readonly InterpreterEffect[] {
  const type = send.type as string;
  if (send.kind === "send_delayed") {
    const held = live.heldSends.get(send.sendId) ?? [];
    live.heldSends.set(send.sendId, [...new Set([...held, type])].sort(byCodeUnit));
  }
  const answered = processorFor(live.processors, type)?.deliver(
    send,
    deliveredEvent(send, live.sessionId),
    { sessionId: live.sessionId },
  );
  return failed(answered) ? sendFailure(live, send) : [];
}

// A `<cancel>`: every pending timer under the id goes, and each processor
// holding a delayed send under it is told once.
function cancelSend(live: Live, cancel: Cancel): void {
  live.timers = live.timers.filter((timer) => timer.sendId !== cancel.sendId);
  if (typeof cancel.sendId !== "string") return;
  const held = live.heldSends.get(cancel.sendId);
  if (held === undefined) return;
  live.heldSends.delete(cancel.sendId);
  for (const type of held) {
    processorFor(live.processors, type)?.cancel?.(cancel, { sessionId: live.sessionId });
  }
}

// The processor registered for a type on this call, read as an own key only.
function processorFor(processors: SendProcessors, type: string): SendProcessor | undefined {
  return Object.hasOwn(processors, type) ? processors[type] : undefined;
}

// A call to a host's processor, held until the call's state is written. It
// answers whether the processor answered a failure: only a delivery can.
type HostCall = () => boolean;

// What one driver call has asked its host's processors. `answered` holds,
// in the order the run made them, whether each call made so far answered a
// failure; it outlives a run, since a run that a failure changes is made
// again. `next` counts the calls the current run has reached, and `held`
// keeps the calls it reached past `answered`, to be made once its state is
// written.
interface Ledger {
  readonly answered: boolean[];
  next: number;
  readonly held: HostCall[];
}

// The answer a processor call already made gives a run made again: a
// failure, or nothing.
const ANSWERED_FAILURE: DeliveryFailure = { kind: "failure", reason: "" };

// The fields of a send a failure event is built from.
type SendOrigin = Pick<SendFields, "sendId" | "cIndex" | "owner">;

const OWNER_KINDS: ReadonlySet<unknown> = new Set(["onentry", "onexit", "transition", "finalize"]);

function isSendOrigin(send: unknown): send is SendOrigin {
  if (typeof send !== "object" || send === null) return false;
  const { sendId, cIndex, owner } = send as Record<string, unknown>;
  return (
    typeof sendId === "string" &&
    Number.isInteger(cIndex) &&
    (cIndex as number) >= 0 &&
    typeof owner === "object" &&
    owner !== null &&
    OWNER_KINDS.has((owner as Record<string, unknown>).kind)
  );
}

// What a processor's `deliver` answered: a failure only when it is one.
function failed(answered: unknown): boolean {
  return (
    typeof answered === "object" &&
    answered !== null &&
    (answered as Record<string, unknown>).kind === "failure"
  );
}

// The host's processors with each call answered from the ledger when an
// earlier run of the same driver call made it, and held on the ledger
// otherwise: the same types, so the registered set and `_ioprocessors` read
// the same, a `cancel` only where the host gave one, and the
// `ioprocessorsEntry` the host gave asked unheld, since it is asked while
// the state is built rather than once it is written, and once per type and
// session however often the run is made. A type the host listed with no
// processor stays listed and is handed nothing, as it was before. Built as
// own entries, so a type named `__proto__` stays a type rather than setting
// the prototype of the object that holds them.
function held(
  processors: SendProcessors,
  ledger: Ledger,
  entries: Map<string, Readonly<Record<string, Value>>>,
): SendProcessors {
  return Object.fromEntries(
    Object.keys(processors).map((type): [string, SendProcessor] => [
      type,
      holding(processors[type], ledger, entries),
    ]),
  );
}

function holding(
  processor: SendProcessor | undefined,
  ledger: Ledger,
  entries: Map<string, Readonly<Record<string, Value>>>,
): SendProcessor {
  if (processor === undefined || processor === null) return { deliver: () => {} };
  // The call's place among the calls the run makes: answered when an earlier
  // run made it, held otherwise.
  const reached = (call: HostCall): boolean | undefined => {
    const at = ledger.next;
    ledger.next += 1;
    if (at < ledger.answered.length) return ledger.answered[at];
    ledger.held.push(call);
    return undefined;
  };
  const entry = processor.ioprocessorsEntry;
  return {
    deliver: (send, event, context) =>
      reached(() => failed(processor.deliver(send, event, context))) === true
        ? ANSWERED_FAILURE
        : undefined,
    ...(processor.cancel === undefined
      ? {}
      : {
          cancel: (c: Cancel, context: ProcessorContext) => {
            reached(() => {
              processor.cancel?.(c, context);
              return false;
            });
          },
        }),
    ...(entry === undefined
      ? {}
      : {
          ioprocessorsEntry: (type: string, context: ProcessorContext) => {
            const key = `${type}\u0000${context.sessionId}`;
            const known = entries.get(key);
            if (known !== undefined) return known;
            const asked = entry(type, context);
            entries.set(key, asked);
            return asked;
          },
        }),
  };
}

// The chart stopped: its donedata and final configuration are kept, and its
// pending timers, queued external events, untaken mail and the invocations
// its exit left (the completed ones) discarded. A child that stopped on its
// own returns `done.invoke.<id>` to its parent.
function stopped(live: Live, done: Done): void {
  live.done = { donedata: done.donedata, configuration: done.configuration };
  live.timers = [];
  live.externalQueue = [];
  live.mailbox = [];
  live.invocations = new Map();
  if (live.parent !== null && live.invokedAs !== null && !live.cancelled) {
    live.parent.mailbox.push({
      kind: "done",
      invokeId: live.invokedAs,
      event: doneInvokeEvent(live.parent.sessionId, live.invokedAs, done.donedata),
    });
  }
}

// An immediate built-in send, routed now.
function route(live: Live, send: Send | SendDelayed): readonly InterpreterEffect[] {
  const target = parseTarget(send.target);
  switch (target.kind) {
    case "self":
      live.externalQueue.push(deliveredEvent(send, live.sessionId));
      return [];
    case "session":
      if (target.sessionId === live.sessionId) {
        live.externalQueue.push(deliveredEvent(send, live.sessionId));
        return [];
      }
      return communicationError(live, send);
    case "internal":
      return deliverInternal(live, "internal", send.event, contentOrigin(send), {
        data: send.data,
        sendid: authorSendId(send),
      });
    case "parent":
      if (live.parent === null || live.invokedAs === null) return communicationError(live, send);
      live.parent.mailbox.push({
        kind: "event",
        invokeId: live.invokedAs,
        event: { ...deliveredEvent(send, live.sessionId), invokeid: live.invokedAs },
      });
      return [];
    case "invoke": {
      const invocation = live.invocations.get(target.invokeId);
      if (invocation === undefined) return communicationError(live, send);
      deliverToChild(invocation, deliveredEvent(send, live.sessionId));
      return [];
    }
    default:
      return communicationError(live, send);
  }
}

// A fired timer's send, routed as an immediate one is; a self-addressed one
// joins the external queue and is taken by the drain that follows.
function fire(live: Live, send: SendDelayed): void {
  perform(live, route(live, send));
}

// A send the host could not deliver, the reference's `failed_send/3`:
// `error.communication` on the internal queue, its origin the send's content
// and its `sendid` the send's id unconditionally, then the effects that raise
// left are acted on and the session takes what is queued.
function failSend(live: Live, send: SendOrigin): void {
  perform(live, sendFailure(live, send));
  drain(live);
}

// The failed send's `error.communication` on the internal queue, its origin
// the send's content and its `sendid` the send's id unconditionally, as the
// reference's `failed_send/3` and the Basic HTTP processor's `deliver/3`
// plan both write it; answers the effects the chart's run left.
function sendFailure(live: Live, send: SendOrigin): readonly InterpreterEffect[] {
  const origin: Origin = { kind: "content", cIndex: send.cIndex, owner: send.owner };
  return deliverInternal(live, "platform", "error.communication", origin, {
    data: Undefined,
    sendid: send.sendId,
  });
}

// A send to something this driver cannot reach: `error.communication` on the
// internal queue, carrying the send id the delivered event would have.
function communicationError(live: Live, send: Send | SendDelayed): readonly InterpreterEffect[] {
  return deliverInternal(live, "platform", "error.communication", contentOrigin(send), {
    data: Undefined,
    sendid: authorSendId(send),
  });
}

// The reference's `Interpreter.deliver_internal/5`: the event joins the
// internal queue, stamped with the counters as they stand, and the chart
// runs to a stable configuration. A stopped chart takes nothing.
function deliverInternal(
  live: Live,
  type: "internal" | "platform",
  name: Value,
  origin: Origin,
  fields: { readonly data: Value; readonly sendid: string | undefined },
): readonly InterpreterEffect[] {
  if (!live.core.running) return [];
  stamp(live);
  const { macrostep, microstep, round } = live.core;
  const event: Event = {
    name: typeof name === "string" ? name : "",
    type,
    data: fields.data,
    cause: { origin, macrostep, microstep, round },
    ...(fields.sendid === undefined ? {} : { sendid: fields.sendid }),
  };
  const stepped = mainEventLoop({
    ...live.core,
    internalQueue: [...live.core.internalQueue, event],
  });
  live.core = stepped.state;
  return stepped.effects;
}

function contentOrigin(send: Send | SendDelayed): Origin {
  return { kind: "content", cIndex: send.cIndex, owner: send.owner };
}

// A delivered event carries the send id only when the author named one.
function authorSendId(send: Send | SendDelayed): string | undefined {
  return send.idFromAuthor ? send.sendId : undefined;
}

// The event a delivered send carries: the reference's `Send.Event.build/3`,
// from this session's own address through the SCXML Event I/O Processor.
function deliveredEvent(send: Send | SendDelayed, sessionId: string): Event {
  const sendid = authorSendId(send);
  return {
    name: typeof send.event === "string" ? send.event : "",
    type: "external",
    data: send.data,
    origin: scxmlLocation(sessionId),
    origintype: SCXML_EVENT_PROCESSOR,
    ...(sendid === undefined ? {} : { sendid }),
  };
}

// ---------------------------------------------------------------------------
// Invocations
// ---------------------------------------------------------------------------

// An `invoke` effect, as the reference's planner and its built-in `scxml`
// handler take it: a type other than the SCXML type raises `error.execution`
// and records nothing; the SCXML type is recorded live, then its content is
// compiled and started as a child. A content that is not markup, or that
// does not compile, raises `error.communication` and leaves the invocation
// live with no child; `src` is never dereferenced, so an invocation with no
// content fails the same way.
function invoke(live: Live, effect: Invoke): readonly InterpreterEffect[] {
  const origin: Origin = {
    kind: "invoke",
    stateIndex: effect.stateIndex,
    invokeIndex: effect.invokeIndex,
  };
  const failure: { readonly data: Value; readonly sendid: undefined } = {
    data: Undefined,
    sendid: undefined,
  };
  if (!builtInInvokeType(effect.type)) {
    return deliverInternal(live, "platform", "error.execution", origin, failure);
  }
  const record = (child: Live | null, source: string | null): void => {
    live.invocations.set(effect.invokeId, {
      invokeId: effect.invokeId,
      autoforward: effect.autoforward,
      completed: false,
      source,
      child,
    });
  };
  record(null, null);
  const source = typeof effect.content === "string" ? effect.content : null;
  const chart = source === null ? null : childChart(live.chart, source);
  if (source === null || chart === null) {
    return deliverInternal(live, "platform", "error.communication", origin, failure);
  }
  launch(
    {
      chart,
      sessionId: `${live.sessionId}.${effect.invokeId}`,
      datamodel: seed(effect.params, chart.machine),
      clock: live.clock,
      ...inheritedBy(live),
      inherit: live.inherit,
      parent: live,
      invokedAs: effect.invokeId,
      trace: live.inherit.observers && live.core.trace,
    },
    (child) => record(child, source),
  );
  return [];
}

// The reference's `Invocations.seed_datamodel/2`: only the params a root
// `<data>` of the child names, the rest dropped.
function seed(params: Value, machine: Machine): Map<string, Value> {
  if (typeName(params) !== "map") return new Map();
  const ids = new Set(
    stateAt(machine, 0).data.map((dIndex) => machine.dataElements[dIndex]?.id ?? ""),
  );
  const named = params as { readonly [key: string]: Value };
  return new Map(Object.entries(named).filter(([name]) => ids.has(name)));
}

// A `cancel_invoke`: the invocation is retired, then its child stops, its
// active states' `<onexit>` handlers running as the reference's
// `Interpreter.cancel/1` runs them. A child that already said it completed
// is left for its done event to retire, and an id that names nothing live is
// a no-op.
function cancelInvocation(live: Live, invokeId: string): void {
  const invocation = live.invocations.get(invokeId);
  if (invocation === undefined || invocation.completed) return;
  live.invocations.delete(invokeId);
  const child = invocation.child;
  if (child === null || !child.core.running) return;
  child.cancelled = true;
  const exited = exitInterpreter({ ...child.core, running: false });
  child.core = exited.state;
  perform(child, exited.effects);
}

// An event for a child: joins its external queue and the child runs to a
// stable configuration. Nothing reaches an invocation with no child, or a
// child that has stopped.
function deliverToChild(invocation: Invocation | undefined, event: Event): void {
  const child = invocation?.child;
  if (child === null || child === undefined || !child.core.running) return;
  child.externalQueue.push(event);
  stamp(child);
  drain(child);
}

// The reference's `Invoke.Answer.done/4`: built by the parent, so its
// origin is the parent's own address.
function doneInvokeEvent(parentSessionId: string, invokeId: string, donedata: Value): Event {
  return {
    name: `done.invoke.${invokeId}`,
    type: "external",
    data: donedata,
    invokeid: invokeId,
    origin: scxmlLocation(parentSessionId),
    origintype: SCXML_EVENT_PROCESSOR,
  };
}

// The child charts compiled from content markup, by source, for each parent
// chart: a state names its children's sources, and decoding it compiles each
// once per chart rather than once per call.
const childCharts = new WeakMap<Chart, Map<string, Chart | null>>();

function childChart(parent: Chart, source: string): Chart | null {
  let charts = childCharts.get(parent);
  if (charts === undefined) {
    charts = new Map();
    childCharts.set(parent, charts);
  }
  const cached = charts.get(source);
  if (cached !== undefined) return cached;
  const compiled = compileInvokeContent(source);
  const chart = compiled.ok ? compiled.chart : null;
  charts.set(source, chart);
  return chart;
}

// ---------------------------------------------------------------------------
// Encoding the state
// ---------------------------------------------------------------------------

// One encode or decode of a whole state. A value tagged-value text cannot
// carry, a text that does not decode, or a name the chart does not hold
// marks it failed, and the call answers the refusal rather than the state.
interface Codec {
  failed: boolean;
}

// What one run of a driver call leaves: the session and its effects, or the
// call's refusal.
type Ran = { readonly ok: true; readonly live: Live; readonly out: DriveEffect[] } | DriveRefused;

// A driver call: its run, made over the host's processors with their calls
// held, and its answer. The calls the run held are made only once its state
// is written, in the order the run made them: a refused call hands a
// processor nothing, so a host that retries it hands nothing twice. A
// delivery that answers a failure belongs to the run at the send's place,
// so the calls after it, which a run without the failure made, are not made;
// the run is made again from the call's own arguments, every call it makes
// up to the failure answered from the ledger rather than made twice and the
// failure raised where the send was handed, and the calls it holds past them
// are made the same way. The run is the same up to the failure each time,
// since it reads only the call's arguments, the processors' answers and the
// clock and random draws its expressions make, which every run of the call
// reads from one record, so each send is handed to its processor once.
function drive(processors: SendProcessors, run: (processors: SendProcessors) => Ran): DriveResult {
  const answered: boolean[] = [];
  const entries = new Map<string, Readonly<Record<string, Value>>>();
  const draws = recordedDraws();
  for (;;) {
    const ledger: Ledger = { answered, next: 0, held: [] };
    draws.rewind();
    const ran = withDraws(draws, () => run(held(processors, ledger, entries)));
    if (!ran.ok) return ran;
    const codec: Codec = { failed: false };
    const state = encodeState(codec, ran.live);
    if (codec.failed) return { ok: false, reason: "unencodable_value" };
    if (!madeUntilFailure(ledger)) return { ok: true, state, effects: ran.out };
  }
}

// The clock and random draws one driver call's runs read, recorded as the
// first run to reach each draw takes it, from predicator's own clock and
// random source, and answered in the same order to every run made again;
// `rewind` starts a run at the first draw. Each evaluation reads the clock
// at most once, as predicator caches its instant for the evaluation.
function recordedDraws(): Draws & { readonly rewind: () => void } {
  const instants: PDateTime[] = [];
  const numbers: number[] = [];
  let instant = 0;
  let number = 0;
  return {
    rewind: () => {
      instant = 0;
      number = 0;
    },
    now: () => {
      if (instant === instants.length) instants.push(systemInstant());
      const drawn = instants[instant] as PDateTime;
      instant += 1;
      return drawn;
    },
    random: () => {
      if (number === numbers.length) numbers.push(systemRandom());
      const drawn = numbers[number] as number;
      number += 1;
      return drawn;
    },
  };
}

// What predicator's own clock reads now, asked of predicator with no clock
// pinned, so this package reads no clock of its own.
function systemInstant(): PDateTime {
  const read = predicatorEvaluate("Date.now()");
  if (read.ok && read.value instanceof PDateTime) return read.value;
  throw new Error("predicator answered Date.now() with something other than a date-time");
}

// A draw from predicator's own random source, asked the same way.
function systemRandom(): number {
  const read = predicatorEvaluate("Math.random()");
  if (read.ok && typeof read.value === "number") return read.value;
  throw new Error("predicator answered Math.random() with something other than a number");
}

// Makes the held calls in order, recording each answer, up to and including
// the first that answers a failure; answers whether one did.
function madeUntilFailure(ledger: Ledger): boolean {
  for (const call of ledger.held) {
    const failure = call();
    ledger.answered.push(failure);
    if (failure) return true;
  }
  return false;
}

function text(codec: Codec, v: Value): string {
  const encoded = encodeTagged(v);
  if (encoded.ok) return encoded.text;
  codec.failed = true;
  return "";
}

function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function nameOf(machine: Machine, index: number): string {
  return machine.states[index]?.id ?? `#${index}`;
}

// The root is in every configuration by construction and is not written.
function names(machine: Machine, indexes: Iterable<number>): string[] {
  return [...indexes]
    .filter((index) => index !== 0)
    .map((index) => nameOf(machine, index))
    .sort(byCodeUnit);
}

function encodeEvent(codec: Codec, event: Event): QueuedEvent {
  return {
    name: event.name,
    type: event.type,
    data: text(codec, event.data),
    ...(event.cause === undefined ? {} : { cause: event.cause }),
    ...(event.sendid === undefined ? {} : { sendid: event.sendid }),
    ...(event.origin === undefined ? {} : { origin: event.origin }),
    ...(event.origintype === undefined ? {} : { origintype: event.origintype }),
    ...(event.invokeid === undefined ? {} : { invokeid: event.invokeid }),
  };
}

function encodeSend(codec: Codec, send: Send | SendDelayed): SendRecord {
  return {
    kind: send.kind,
    event: text(codec, send.event),
    target: text(codec, send.target),
    type: text(codec, send.type),
    data: text(codec, send.data),
    sendId: send.sendId,
    idFromAuthor: send.idFromAuthor,
    cIndex: send.cIndex,
    owner: send.owner,
    macrostep: send.macrostep,
    microstep: send.microstep,
    round: send.round,
    ordinal: send.ordinal,
    delayMs: send.kind === "send_delayed" ? send.delayMs : null,
  };
}

function encodeInvocation(codec: Codec, invocation: Invocation): InvocationRecord {
  return {
    invokeId: invocation.invokeId,
    autoforward: invocation.autoforward,
    completed: invocation.completed,
    source: invocation.child === null ? null : invocation.source,
    state: invocation.child === null ? null : encodeState(codec, invocation.child),
  };
}

function encodeMail(codec: Codec, mail: Mail): MailRecord {
  return {
    kind: mail.kind,
    invokeId: mail.invokeId,
    event: mail.kind === "completed" ? null : encodeEvent(codec, mail.event),
  };
}

function encodeState(codec: Codec, live: Live): State {
  const { machine } = live.chart;
  const core = live.core;
  const historyValues = [...core.historyValues]
    .map(([history, recorded]) => [nameOf(machine, history), names(machine, recorded)] as const)
    .sort(([a], [b]) => byCodeUnit(a, b));
  const activeInvocations = [...core.activeInvocations]
    .map(([key, invokeId]) => {
      const [stateIndex = 0, invokeIndex = 0] = key.split(":").map(Number);
      return { state: nameOf(machine, stateIndex), invokeIndex, invokeId };
    })
    .sort((a, b) => byCodeUnit(a.state, b.state) || a.invokeIndex - b.invokeIndex);
  return {
    identity: live.chart.identity,
    configuration: names(machine, core.configuration),
    enteredStates: names(machine, core.enteredStates),
    statesToInvoke: names(machine, core.statesToInvoke),
    historyValues: Object.fromEntries(historyValues),
    activeInvocations,
    invokeCounter: core.invokeCounter,
    sendCounter: core.sends.sendCounter,
    timerCounter: core.sends.timerCounter,
    datamodel: Object.fromEntries(
      [...core.datamodel].map(([root, v]) => [root, text(codec, v)] as const),
    ),
    running: core.running,
    status: core.status,
    macrostep: core.macrostep,
    microstep: core.microstep,
    round: core.round,
    trace: core.trace,
    maxMacrostepRounds: core.maxMacrostepRounds,
    sessionId: live.sessionId,
    nowMs: live.clock.nowMs,
    timers: live.timers.map((timer) => ({
      sendId: timer.sendId,
      dueMs: timer.dueMs,
      sequence: timer.sequence,
      send: encodeSend(codec, timer.send),
    })),
    timerSequence: live.clock.sequence,
    externalQueue: live.externalQueue.map((event) => encodeEvent(codec, event)),
    internalQueue: core.internalQueue.map((event) => encodeEvent(codec, event)),
    heldSends: Object.fromEntries([...live.heldSends].sort(([a], [b]) => byCodeUnit(a, b))),
    halted: live.halted,
    done:
      live.done === null
        ? null
        : {
            donedata: text(codec, live.done.donedata),
            configuration: names(machine, live.done.configuration),
          },
    invokedAs: live.invokedAs,
    invocations: [...live.invocations.values()].map((invocation) =>
      encodeInvocation(codec, invocation),
    ),
    mailbox: live.mailbox.map((mail) => encodeMail(codec, mail)),
  };
}

// ---------------------------------------------------------------------------
// Decoding the state
// ---------------------------------------------------------------------------

type Opened = { readonly ok: true; readonly live: Live } | DriveRefused;

// One decode of a whole state. The first thing that fails is kept as the
// detail, and the call answers the refusal rather than the state.
interface Decoder {
  detail: MalformedDetail | null;
}

function fail(decoder: Decoder, detail: MalformedDetail): void {
  if (decoder.detail === null) decoder.detail = detail;
}

function sameIdentity(a: ChartIdentity, b: ChartIdentity): boolean {
  return a.contentHash === b.contentHash && a.name === b.name && a.version === b.version;
}

// The state's shape is checked first, over every field, so nothing below
// reads a field that is missing or of the wrong type.
function open(chart: Chart, state: State, options: DriveOptions, out: DriveEffect[]): Opened {
  const badShape = stateShapeFailure(state);
  if (badShape !== null) {
    return { ok: false, reason: "malformed_state", detail: { kind: "bad_shape", field: badShape } };
  }
  if (!sameIdentity(chart.identity, state.identity)) return { ok: false, reason: "chart_mismatch" };
  const decoder: Decoder = { detail: null };
  const clock: Clock = { nowMs: state.nowMs, sequence: state.timerSequence };
  const live = decodeState(decoder, chart, state, {
    at: "",
    clock,
    processors: options.sendTypes ?? {},
    inherit: inheritanceOf(options),
    out,
    parent: null,
  });
  if (decoder.detail !== null) {
    return { ok: false, reason: "malformed_state", detail: decoder.detail };
  }
  return { ok: true, live };
}

function value(decoder: Decoder, source: string, field: string): Value {
  const decoded = decodeTagged(source);
  if (decoded.ok) return decoded.value;
  fail(decoder, { kind: "undecodable_value", field });
  return Undefined;
}

// A state's index from its name: its id, or `#` and the index of a state the
// document gave no id.
function indexOf(decoder: Decoder, machine: Machine, name: string): number {
  const index = machine.idToIndex.get(name);
  if (index !== undefined) return index;
  if (/^#[0-9]+$/.test(name)) {
    const numbered = Number(name.slice(1));
    if (numbered !== 0 && machine.states[numbered]?.id === null) return numbered;
  }
  fail(decoder, { kind: "unknown_state", name });
  return 0;
}

// Indexes in document order, so a set built from them iterates as the chart
// reads.
function indexes(decoder: Decoder, machine: Machine, list: readonly string[]): number[] {
  return list.map((name) => indexOf(decoder, machine, name)).sort((a, b) => a - b);
}

function decodeEvent(decoder: Decoder, queued: QueuedEvent, field: string): Event {
  return {
    name: queued.name,
    type: queued.type,
    data: value(decoder, queued.data, `${field}.data`),
    ...(queued.cause === undefined ? {} : { cause: queued.cause }),
    ...(queued.sendid === undefined ? {} : { sendid: queued.sendid }),
    ...(queued.origin === undefined ? {} : { origin: queued.origin }),
    ...(queued.origintype === undefined ? {} : { origintype: queued.origintype }),
    ...(queued.invokeid === undefined ? {} : { invokeid: queued.invokeid }),
  };
}

// A pending timer's send: always a delayed one.
function decodeTimer(decoder: Decoder, timer: PendingTimer, field: string): LiveTimer {
  const record = timer.send;
  const at = `${field}.send`;
  if (record.kind !== "send_delayed" || record.delayMs === null || record.ordinal === null) {
    fail(decoder, { kind: "not_a_delayed_send", field: at });
  }
  const send: SendDelayed = {
    kind: "send_delayed",
    event: value(decoder, record.event, `${at}.event`),
    target: value(decoder, record.target, `${at}.target`),
    type: value(decoder, record.type, `${at}.type`),
    data: value(decoder, record.data, `${at}.data`),
    sendId: record.sendId,
    idFromAuthor: record.idFromAuthor,
    cIndex: record.cIndex,
    owner: record.owner,
    macrostep: record.macrostep,
    microstep: record.microstep,
    round: record.round,
    delayMs: record.delayMs ?? 0,
    ordinal: record.ordinal ?? 0,
  };
  return { sendId: timer.sendId, dueMs: timer.dueMs, sequence: timer.sequence, send };
}

// A mailbox entry: an event for every kind but the completion notice.
function decodeMail(decoder: Decoder, record: MailRecord, field: string): Mail {
  if (record.kind === "completed") return { kind: "completed", invokeId: record.invokeId };
  if (record.event === null) {
    fail(decoder, { kind: "bad_shape", field: `${field}.event` });
    return { kind: "completed", invokeId: record.invokeId };
  }
  return {
    kind: record.kind,
    invokeId: record.invokeId,
    event: decodeEvent(decoder, record.event, `${field}.event`),
  };
}

// Where one session of the tree is decoded: its path into the whole state,
// the tree's clock, its processors, what the call passes the children of its
// tree, its effect sink, and its parent.
interface Place {
  readonly at: string;
  readonly clock: Clock;
  readonly processors: SendProcessors;
  readonly inherit: Inheritance;
  readonly out: DriveEffect[];
  readonly parent: Live | null;
}

// An invocation and its child: the child's chart is compiled from the
// recorded source, which must be the chart the child's state was made by.
// A source and a state are both present or both null; a source that does
// not compile to that chart is a field of the wrong shape. So is a child
// state whose invokedAs is not the invocation's id: that child could not
// reach its parent, nor return its done event to it.
function decodeInvocation(
  decoder: Decoder,
  record: InvocationRecord,
  parent: Live,
  place: Place,
): Invocation {
  const at = place.at;
  const invocation = (child: Live | null, source: string | null): Invocation => ({
    invokeId: record.invokeId,
    autoforward: record.autoforward,
    completed: record.completed,
    source,
    child,
  });
  if (record.source === null || record.state === null) {
    if (record.source !== record.state) fail(decoder, { kind: "bad_shape", field: `${at}.source` });
    return invocation(null, null);
  }
  const chart = childChart(parent.chart, record.source);
  if (chart === null || !sameIdentity(chart.identity, record.state.identity)) {
    fail(decoder, { kind: "bad_shape", field: `${at}.source` });
    return invocation(null, null);
  }
  if (record.state.invokedAs !== record.invokeId) {
    fail(decoder, { kind: "bad_shape", field: `${at}.state.invokedAs` });
  }
  const child = decodeState(decoder, chart, record.state, {
    ...place,
    at: `${at}.state.`,
    ...inheritedBy(parent),
    parent,
  });
  return invocation(child, record.source);
}

function decodeState(decoder: Decoder, chart: Chart, state: State, place: Place): Live {
  const { machine } = chart;
  const at = place.at;
  // The host's session runs as no invocation. A child's invokedAs is held to
  // its record's id where the record is decoded.
  if (place.parent === null && state.invokedAs !== null) {
    fail(decoder, { kind: "bad_shape", field: `${at}invokedAs` });
  }
  // The root is active, and entered, whenever any state is.
  const rooted = (list: readonly string[]): Set<number> =>
    new Set(list.length === 0 ? [] : [0, ...indexes(decoder, machine, list)]);
  const historyValues = new Map(
    Object.entries(state.historyValues).map(
      ([history, recorded]) =>
        [indexOf(decoder, machine, history), new Set(indexes(decoder, machine, recorded))] as const,
    ),
  );
  const activeInvocations = new Map(
    state.activeInvocations.map(
      (entry) =>
        [`${indexOf(decoder, machine, entry.state)}:${entry.invokeIndex}`, entry.invokeId] as const,
    ),
  );
  const core: MachineState = {
    machine,
    configuration: rooted(state.configuration),
    historyValues,
    datamodel: new Map(
      Object.entries(state.datamodel).map(
        ([root, t]) => [root, value(decoder, t, `${at}datamodel.${root}`)] as const,
      ),
    ),
    internalQueue: state.internalQueue.map((event, i) =>
      decodeEvent(decoder, event, `${at}internalQueue[${i}]`),
    ),
    macrostep: state.macrostep,
    microstep: state.microstep,
    round: state.round,
    sends: {
      sendCounter: state.sendCounter,
      timerCounter: state.timerCounter,
      sendTypes: registeredSet(place.processors),
      routes: null,
    },
    statesToInvoke: new Set(indexes(decoder, machine, state.statesToInvoke)),
    enteredStates: rooted(state.enteredStates),
    activeInvocations,
    invokeCounter: state.invokeCounter,
    running: state.running,
    status: state.status,
    maxMacrostepRounds: state.maxMacrostepRounds,
    trace: state.trace,
  };
  const live: Live = {
    chart,
    core,
    sessionId: state.sessionId,
    clock: place.clock,
    timers: state.timers.map((timer, i) => decodeTimer(decoder, timer, `${at}timers[${i}]`)),
    externalQueue: state.externalQueue.map((event, i) =>
      decodeEvent(decoder, event, `${at}externalQueue[${i}]`),
    ),
    heldSends: new Map(Object.entries(state.heldSends).map(([id, types]) => [id, [...types]])),
    halted: state.halted,
    done:
      state.done === null
        ? null
        : {
            donedata: value(decoder, state.done.donedata, `${at}done.donedata`),
            configuration: indexes(decoder, machine, state.done.configuration),
          },
    invokedAs: state.invokedAs,
    parent: place.parent,
    invocations: new Map(),
    mailbox: state.mailbox.map((mail, i) => decodeMail(decoder, mail, `${at}mailbox[${i}]`)),
    cancelled: false,
    processors: place.processors,
    inherit: place.inherit,
    out: place.out,
  };
  for (const [i, record] of state.invocations.entries()) {
    // A second record under one id would replace the first unseen.
    if (live.invocations.has(record.invokeId)) {
      fail(decoder, { kind: "bad_shape", field: `${at}invocations[${i}].invokeId` });
    }
    const invocation = decodeInvocation(decoder, record, live, {
      ...place,
      at: `${at}invocations[${i}]`,
    });
    live.invocations.set(invocation.invokeId, invocation);
  }
  stamp(live);
  return live;
}
