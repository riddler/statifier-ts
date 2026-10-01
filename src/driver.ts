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
// processors hold, the budget halt and the stopped chart's donedata.
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
//   float, a date, a duration and undefined, and that text keeps them.
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
// the chart runs to a stable configuration again; a parent, another session
// or an invocation names nothing this driver can reach, so the send fails
// with `error.communication` on the internal queue. A delivery onto the
// internal queue runs after the effects of the drive that produced it, as
// the reference defers it.
//
// Registered send types. The processors a host registers are passed with
// every call, as the reference re-stamps its send types before each drive:
// the registered set is never stored. A send of a registered type is handed
// to its processor's `deliver`, and is reported among the call's effects as
// every send is; it is never routed and never scheduled, delayed or not; the processor holds a delayed one, and a
// `<cancel>` of its send id reaches that processor's `cancel` once.
//
// A macrostep that spends its round budget halts the driver as the
// reference halts its session: further external events are queued and not
// taken, and pending timers still fire.

import { Undefined, type Value } from "@riddler/predicator";
import { decodeTagged, encodeTagged } from "@riddler/predicator/tagged";
import type { Chart, ChartIdentity } from "./compiler.js";
import {
  type Done,
  handleEvent,
  type InterpreterEffect,
  initialize,
  type MachineState,
  mainEventLoop,
  type RoundBudget,
} from "./core/interpreter.js";
import {
  type Cancel,
  classifyType,
  parseTarget,
  type Send,
  type SendDelayed,
} from "./core/send.js";
import {
  type Cause,
  type Event,
  type EventType,
  type Origin,
  type Owner,
  SCXML_EVENT_PROCESSOR,
  scxmlLocation,
} from "./datamodel.js";
import { stateShapeFailure } from "./driver-shape.js";
import type { Machine } from "./machine.js";

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
  /** No invocation is started yet, so this stays at zero. */
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
  /** Nothing emits trace effects yet, so this stays false. */
  readonly trace: boolean;
  readonly maxMacrostepRounds: RoundBudget;

  /** The id the host minted for the session. */
  readonly sessionId: string;
  /** The virtual clock, in milliseconds since the chart started. */
  readonly nowMs: number;
  readonly timers: readonly PendingTimer[];
  /** How many timers have ever been scheduled: the next one's sequence. */
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
}

/** What the state keeps of a stopped chart. */
export interface DoneRecord {
  /** The top-level final's donedata as tagged-value text. */
  readonly donedata: string;
  /** The configuration as it stood when the chart stopped, sorted. */
  readonly configuration: readonly string[];
}

/** A host's processor for one registered send type. */
export interface SendProcessor {
  /** Takes a send of its type, and the event a delivery of it would carry. */
  readonly deliver: (send: Send | SendDelayed, event: Event) => void;
  /** Takes a `<cancel>` naming a delayed send it holds. */
  readonly cancel?: (cancel: Cancel) => void;
}

/** The processors a host registers, by send type. */
export type SendProcessors = Readonly<Record<string, SendProcessor>>;

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
   * disagree with what the chart reads there; this package's `_ioprocessors`
   * holds the SCXML Event I/O Processor's entry only, and is fixed at start.
   */
  readonly sendTypes?: SendProcessors;
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
 * disagree with what the chart reads there; this package's `_ioprocessors`
 * holds the SCXML Event I/O Processor's entry only, and is fixed at start.
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
 * Why a call was refused. `not_running`: the chart has stopped.
 * `chart_mismatch`: the state was not made by this chart. `malformed_state`:
 * the state names a state the chart does not have, carries text that does
 * not decode, or holds a pending timer that is not a delayed send; the
 * refusal's `detail` says which. `unencodable_value`: a value cannot be
 * written as tagged-value text. `invalid_duration`: `advance` was given a
 * negative or non-finite time.
 */
export type DriveRefusal =
  | "not_running"
  | "chart_mismatch"
  | "malformed_state"
  | "unencodable_value"
  | "invalid_duration";

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
      readonly effects: readonly InterpreterEffect[];
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
// The six calls (beside `compile`)
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
 * disagree with what the chart reads there; this package's `_ioprocessors`
 * holds the SCXML Event I/O Processor's entry only, and is fixed at start.
 */
export function start(chart: Chart, options: StartOptions): DriveResult {
  const processors = options.sendTypes ?? {};
  const stepped = initialize(chart.machine, {
    sessionId: options.sessionId,
    datamodel: new Map(Object.entries(options.datamodel ?? {})),
    maxMacrostepRounds: options.maxMacrostepRounds ?? 10_000,
    sendTypes: registeredSet(processors),
  });
  const live: Live = {
    chart,
    core: stepped.state,
    sessionId: options.sessionId,
    nowMs: 0,
    timers: [],
    timerSequence: 0,
    externalQueue: [],
    heldSends: new Map(),
    halted: null,
    done: null,
  };
  const out: InterpreterEffect[] = [];
  perform(live, stepped.effects, processors, out);
  drain(live, processors, out);
  return answer(live, out);
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
 * disagree with what the chart reads there; this package's `_ioprocessors`
 * holds the SCXML Event I/O Processor's entry only, and is fixed at start.
 */
export function step(
  chart: Chart,
  state: State,
  event: HostEvent,
  options: DriveOptions = {},
): DriveResult {
  const opened = open(chart, state, options);
  if (!opened.ok) return opened;
  const live = opened.live;
  if (!live.core.running) return { ok: false, reason: "not_running" };
  const processors = options.sendTypes ?? {};
  live.externalQueue.push({ name: event.name, type: "external", data: event.data ?? Undefined });
  const out: InterpreterEffect[] = [];
  drain(live, processors, out);
  return answer(live, out);
}

/**
 * Moves the virtual clock forward `ms` milliseconds, firing every pending
 * timer due by then in due-then-scheduled order, each run to completion
 * before the next.
 *
 * `sendTypes` must name the same set of types for a session's whole life.
 * A send's type is judged against the processors passed with each call, so
 * a type passed on one call and not the next is handed on the first and
 * refused with `error.execution` on the second. The reference fixes
 * `_ioprocessors` when the chart starts, from the registered set
 * (`SystemVariables.initial/3`), so a set that changed afterwards would also
 * disagree with what the chart reads there; this package's `_ioprocessors`
 * holds the SCXML Event I/O Processor's entry only, and is fixed at start.
 */
export function advance(
  chart: Chart,
  state: State,
  ms: number,
  options: DriveOptions = {},
): DriveResult {
  if (!Number.isFinite(ms) || ms < 0) return { ok: false, reason: "invalid_duration" };
  const opened = open(chart, state, options);
  if (!opened.ok) return opened;
  const live = opened.live;
  const processors = options.sendTypes ?? {};
  const until = live.nowMs + ms;
  const out: InterpreterEffect[] = [];
  for (;;) {
    const next = nextDue(live.timers, until);
    if (next === undefined) break;
    live.timers = live.timers.filter((timer) => timer !== next);
    live.nowMs = next.dueMs;
    fire(live, next.send, processors, out);
    drain(live, processors, out);
  }
  live.nowMs = until;
  return answer(live, out);
}

/** The active states' ids, root excluded, sorted. */
export function configuration(state: State): readonly string[] {
  return state.configuration;
}

/**
 * Whether the chart has stopped and, when it has, the top-level final's
 * donedata. A state imported from a stopped position answers undefined for
 * the donedata: the donedata does not travel in a position, as the
 * reference's position does not carry it.
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
  const opened = open(chart, state, {});
  if (!opened.ok) return opened;
  return answer(opened.live, []);
}

// ---------------------------------------------------------------------------
// The working form
// ---------------------------------------------------------------------------

// The state decoded for one call: the core's own state, the driver's fields
// with their values decoded, and the chart. Mutated in place during the call
// and encoded once at its end.
interface Live {
  readonly chart: Chart;
  core: MachineState;
  readonly sessionId: string;
  nowMs: number;
  timers: LiveTimer[];
  timerSequence: number;
  externalQueue: Event[];
  heldSends: Map<string, string[]>;
  halted: "budget_exhausted" | null;
  done: { readonly donedata: Value; readonly configuration: readonly number[] } | null;
}

interface LiveTimer {
  readonly sendId: string;
  readonly dueMs: number;
  readonly sequence: number;
  readonly send: SendDelayed;
}

function registeredSet(processors: SendProcessors): ReadonlySet<string> | null {
  const types = Object.keys(processors);
  return types.length === 0 ? null : new Set(types);
}

// The earliest timer due by `until`, the first scheduled among equals.
function nextDue(timers: readonly LiveTimer[], until: number): LiveTimer | undefined {
  let best: LiveTimer | undefined;
  for (const timer of timers) {
    if (timer.dueMs > until) continue;
    if (
      best === undefined ||
      timer.dueMs < best.dueMs ||
      (timer.dueMs === best.dueMs && timer.sequence < best.sequence)
    ) {
      best = timer;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Draining, performing and routing
// ---------------------------------------------------------------------------

// Takes the external queue one event per macrostep, while the chart runs and
// no macrostep has spent its budget.
function drain(live: Live, processors: SendProcessors, out: InterpreterEffect[]): void {
  while (live.halted === null && live.core.running) {
    const [event, ...rest] = live.externalQueue;
    if (event === undefined) return;
    live.externalQueue = rest;
    const outcome = handleEvent(live.core, event);
    if (!outcome.ok) return;
    live.core = outcome.state;
    perform(live, outcome.effects, processors, out);
  }
}

// Acts on a batch of effects in order. A delivery onto the internal queue
// runs the chart at once, but its own effects are acted on after the batch,
// as the reference defers them.
function perform(
  live: Live,
  effects: readonly InterpreterEffect[],
  processors: SendProcessors,
  out: InterpreterEffect[],
): void {
  let batch = effects;
  while (batch.length > 0) {
    const deferred: InterpreterEffect[] = [];
    for (const effect of batch) {
      out.push(effect);
      deferred.push(...performOne(live, effect, processors));
    }
    batch = deferred;
  }
}

function performOne(
  live: Live,
  effect: InterpreterEffect,
  processors: SendProcessors,
): readonly InterpreterEffect[] {
  switch (effect.kind) {
    case "send":
      if (registered(live, processors, effect)) return handOff(live, processors, effect);
      return route(live, effect);
    case "send_delayed":
      if (registered(live, processors, effect)) return handOff(live, processors, effect);
      live.timers.push({
        sendId: effect.sendId,
        dueMs: live.nowMs + effect.delayMs,
        sequence: live.timerSequence,
        send: effect,
      });
      live.timerSequence += 1;
      return [];
    case "cancel":
      cancelSend(live, processors, effect);
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

function registered(live: Live, processors: SendProcessors, send: Send | SendDelayed): boolean {
  return (
    classifyType(live.core.sends.sendTypes, send.type) === "registered" &&
    typeof send.type === "string" &&
    Object.hasOwn(processors, send.type)
  );
}

// A registered type's send: handed to its processor with the event a
// delivery would carry, and, when delayed, held under its send id.
function handOff(
  live: Live,
  processors: SendProcessors,
  send: Send | SendDelayed,
): readonly InterpreterEffect[] {
  const type = send.type as string;
  if (send.kind === "send_delayed") {
    const held = live.heldSends.get(send.sendId) ?? [];
    live.heldSends.set(send.sendId, [...new Set([...held, type])].sort(byCodeUnit));
  }
  processorFor(processors, type)?.deliver(send, deliveredEvent(send, live.sessionId));
  return [];
}

// A `<cancel>`: every pending timer under the id goes, and each processor
// holding a delayed send under it is told once.
function cancelSend(live: Live, processors: SendProcessors, cancel: Cancel): void {
  live.timers = live.timers.filter((timer) => timer.sendId !== cancel.sendId);
  if (typeof cancel.sendId !== "string") return;
  const held = live.heldSends.get(cancel.sendId);
  if (held === undefined) return;
  live.heldSends.delete(cancel.sendId);
  for (const type of held) processorFor(processors, type)?.cancel?.(cancel);
}

// The processor registered for a type on this call, read as an own key only.
function processorFor(processors: SendProcessors, type: string): SendProcessor | undefined {
  return Object.hasOwn(processors, type) ? processors[type] : undefined;
}

// The chart stopped: its donedata and final configuration are kept, and its
// pending timers and queued external events discarded.
function stopped(live: Live, done: Done): void {
  live.done = { donedata: done.donedata, configuration: done.configuration };
  live.timers = [];
  live.externalQueue = [];
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
    default:
      return communicationError(live, send);
  }
}

// A fired timer's send, routed as an immediate one is; a self-addressed one
// joins the external queue and is taken by the drain that follows.
function fire(
  live: Live,
  send: SendDelayed,
  processors: SendProcessors,
  out: InterpreterEffect[],
): void {
  perform(live, route(live, send), processors, out);
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
// Encoding the state
// ---------------------------------------------------------------------------

// One encode or decode of a whole state. A value tagged-value text cannot
// carry, a text that does not decode, or a name the chart does not hold
// marks it failed, and the call answers the refusal rather than the state.
interface Codec {
  failed: boolean;
}

function answer(live: Live, effects: InterpreterEffect[]): DriveResult {
  const codec: Codec = { failed: false };
  const state = encodeState(codec, live);
  if (codec.failed) return { ok: false, reason: "unencodable_value" };
  return { ok: true, state, effects };
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
    trace: false,
    maxMacrostepRounds: core.maxMacrostepRounds,
    sessionId: live.sessionId,
    nowMs: live.nowMs,
    timers: live.timers.map((timer) => ({
      sendId: timer.sendId,
      dueMs: timer.dueMs,
      sequence: timer.sequence,
      send: encodeSend(codec, timer.send),
    })),
    timerSequence: live.timerSequence,
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
function open(chart: Chart, state: State, options: DriveOptions): Opened {
  const badShape = stateShapeFailure(state);
  if (badShape !== null) {
    return { ok: false, reason: "malformed_state", detail: { kind: "bad_shape", field: badShape } };
  }
  if (!sameIdentity(chart.identity, state.identity)) return { ok: false, reason: "chart_mismatch" };
  const decoder: Decoder = { detail: null };
  const live = decodeState(decoder, chart, state, options);
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

function decodeState(decoder: Decoder, chart: Chart, state: State, options: DriveOptions): Live {
  const { machine } = chart;
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
        ([root, t]) => [root, value(decoder, t, `datamodel.${root}`)] as const,
      ),
    ),
    internalQueue: state.internalQueue.map((event, i) =>
      decodeEvent(decoder, event, `internalQueue[${i}]`),
    ),
    macrostep: state.macrostep,
    microstep: state.microstep,
    round: state.round,
    sends: {
      sendCounter: state.sendCounter,
      timerCounter: state.timerCounter,
      sendTypes: registeredSet(options.sendTypes ?? {}),
    },
    statesToInvoke: new Set(indexes(decoder, machine, state.statesToInvoke)),
    enteredStates: rooted(state.enteredStates),
    activeInvocations,
    invokeCounter: state.invokeCounter,
    running: state.running,
    status: state.status,
    maxMacrostepRounds: state.maxMacrostepRounds,
  };
  return {
    chart,
    core,
    sessionId: state.sessionId,
    nowMs: state.nowMs,
    timers: state.timers.map((timer, i) => decodeTimer(decoder, timer, `timers[${i}]`)),
    timerSequence: state.timerSequence,
    externalQueue: state.externalQueue.map((event, i) =>
      decodeEvent(decoder, event, `externalQueue[${i}]`),
    ),
    heldSends: new Map(Object.entries(state.heldSends).map(([id, types]) => [id, [...types]])),
    halted: state.halted,
    done:
      state.done === null
        ? null
        : {
            donedata: value(decoder, state.done.donedata, "done.donedata"),
            configuration: indexes(decoder, machine, state.done.configuration),
          },
  };
}
