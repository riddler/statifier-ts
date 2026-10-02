// `<send>` and `<cancel>`: the nodes, the effects they produce, and the rules
// that decide what a send is before the host ever sees it.
//
// Ported from the reference's send and cancel nodes and the two modules they
// consult (`Statifier.Machine.Content.Send`, `Statifier.Machine.Content.Cancel`,
// `Statifier.Send.Target`, `Statifier.Send.Routes`, `Statifier.Send.Types` and
// `Statifier.EventData` in statifier-ex at v2.9.0). The core delivers nothing
// and schedules nothing. A `<send>` answers one effect describing the
// message - `Send` when it goes now, `SendDelayed` with the delay in
// milliseconds when it waits - and the host delivers it, to the session's own
// external queue or anywhere else. A `<cancel>` answers a `Cancel` naming the send id; matching it against what
// is pending is the host's too.
//
// A `<send>` resolves its arguments in a fixed order - the event, the target,
// the type, the delay, the `namelist` and `<param>` values in document order,
// then `<content>` - and the first one that fails discards the whole send: no
// id is minted and no effect produced, and the block runner raises
// `error.execution`. Once every argument resolved, the send id is minted and
// `idlocation` written. Only then are the target and type judged; a send the
// SCXML processor cannot carry is refused in the core, keeping the minted id
// and the `idlocation` write, and the block stops on `error.execution` naming
// that id. An immediate send of the SCXML processor whose target the
// host's declared routes do not reach is refused the same way, and the block
// stops on `error.communication` naming that id, as the reference's send node
// judges a route against the snapshot its session stamps. With no routes
// declared the core makes no judgement; a delayed send's route, and
// re-entering a failed delivery as `error.communication`, stay the host's.

import {
  compile,
  Duration,
  fromHost,
  evaluate as predicatorEvaluate,
  Undefined,
  type Value,
} from "@riddler/predicator";
import {
  type Counters,
  type EvaluationContext,
  type ExecutionReason,
  type Expr,
  evaluate,
  type Invalid,
  type Owner,
  SCXML_EVENT_PROCESSOR,
  writeLocation,
} from "../datamodel.js";
import { delayToMs } from "../duration.js";

// ---------------------------------------------------------------------------
// The nodes
// ---------------------------------------------------------------------------

/**
 * One value a `<send>` carries in its data: a `namelist` entry, named by its
 * location and reading it, or a `<param>`.
 */
export interface ParamNode {
  readonly name: string;
  readonly expr: Expr | Invalid;
}

/**
 * A `<send>`. Each attribute pair - `event`/`eventexpr`, `target`/`targetexpr`,
 * `type`/`typeexpr`, `delay`/`delayexpr` - folds into one expression: a
 * literal from the plain attribute, a compiled program from the `expr` one,
 * null when neither was written. `id` is the author's literal id and
 * `idlocation` the raw location the minted id is written to. `content` is the
 * `<content>` child: a literal is its text, a compiled program its `expr`.
 */
export interface SendNode {
  readonly kind: "send";
  readonly cIndex: number;
  readonly event: Expr | Invalid | null;
  readonly target: Expr | Invalid | null;
  readonly type: Expr | Invalid | null;
  readonly id: string | null;
  readonly idlocation: string | null;
  readonly delay: Expr | Invalid | null;
  readonly namelist: readonly ParamNode[];
  readonly params: readonly ParamNode[];
  readonly content: Expr | Invalid | null;
}

/** A `<cancel>`: `sendid` folds the `sendid`/`sendidexpr` pair into one expression. */
export interface CancelNode {
  readonly kind: "cancel";
  readonly cIndex: number;
  readonly sendid: Expr | Invalid;
}

// ---------------------------------------------------------------------------
// The session's send state
// ---------------------------------------------------------------------------

/**
 * What a session carries for its sends across blocks.
 *
 * `sendCounter` is the sequence a generated send id is minted from: the next
 * generated id is `send_` followed by the counter plus one, so the first is
 * `send_1`. An author-written id does not consume it. `timerCounter` is the
 * ordinal sequence stamped on every delayed send, every cancel and every
 * immediate send of a registered type; the first ordinal is 1. Neither is
 * ever reset. `sendTypes` is the set of send types the host registered a
 * processor for, or null when it registered none. `routes` is what the host
 * declared it can reach, or null when it declared nothing; like `sendTypes`
 * it is stamped by the driver before each drive and never travels in a
 * position.
 */
export interface SendState {
  readonly sendCounter: number;
  readonly timerCounter: number;
  readonly sendTypes: ReadonlySet<string> | null;
  readonly routes: Routes | null;
}

/** A session's send state before its first send. */
export const INITIAL_SEND_STATE: SendState = {
  sendCounter: 0,
  timerCounter: 0,
  sendTypes: null,
  routes: null,
};

// ---------------------------------------------------------------------------
// The effects
// ---------------------------------------------------------------------------

/**
 * The fields both send effects carry. `event`, `target` and `type` are the
 * resolved values, null when the element wrote neither attribute of the pair.
 * `data` is the payload. `sendId` is always set, generated when the author
 * named none; `idFromAuthor` says whether the author wrote `id` or
 * `idlocation`, the one place that distinction survives.
 */
export interface SendFields {
  readonly event: Value;
  readonly target: Value;
  readonly type: Value;
  readonly data: Value;
  readonly sendId: string;
  readonly idFromAuthor: boolean;
  readonly cIndex: number;
  readonly owner: Owner;
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
}

/**
 * A `<send>` with no delay. `ordinal` is set only for a registered type, so a
 * host processor can tell apart two sends sharing every other field.
 */
export interface Send extends SendFields {
  readonly kind: "send";
  readonly ordinal: number | null;
}

/** A `<send>` with a delay: the host schedules it `delayMs` from now. */
export interface SendDelayed extends SendFields {
  readonly kind: "send_delayed";
  readonly delayMs: number;
  readonly ordinal: number;
}

/** A `<cancel>`: the host drops the pending delayed send `sendId` names, if any. */
export interface Cancel {
  readonly kind: "cancel";
  readonly sendId: Value;
  readonly cIndex: number;
  readonly owner: Owner;
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
  readonly ordinal: number;
}

// ---------------------------------------------------------------------------
// Targets and types
// ---------------------------------------------------------------------------

/**
 * What a resolved `target` names, before anything checks that it exists: no
 * target at all is the session itself, then the special targets of the SCXML
 * processor. Anything else is invalid.
 */
export type Route =
  | { readonly kind: "self" }
  | { readonly kind: "internal" }
  | { readonly kind: "parent" }
  | { readonly kind: "session"; readonly sessionId: string }
  | { readonly kind: "invoke"; readonly invokeId: string }
  | { readonly kind: "invalid"; readonly target: Value };

/**
 * Parses a resolved target. The specification spells the internal and parent
 * targets with and without the leading `#`; both spellings are accepted, as
 * the reference accepts them.
 */
export function parseTarget(target: Value): Route {
  if (target === null) return { kind: "self" };
  if (typeof target !== "string") return { kind: "invalid", target };
  if (target === "#_internal" || target === "_internal") return { kind: "internal" };
  if (target === "#_parent" || target === "_parent") return { kind: "parent" };
  if (target.startsWith("#_scxml_") && target.length > "#_scxml_".length) {
    return { kind: "session", sessionId: target.slice("#_scxml_".length) };
  }
  if (target.startsWith("#_") && target.length > "#_".length) {
    return { kind: "invoke", invokeId: target.slice("#_".length) };
  }
  return { kind: "invalid", target };
}

/**
 * What a host declares it can reach, at the moment of one drive: the session
 * ids a `#_scxml_` target may name, whether the session has a parent, and the
 * invocations a `#_` target may name. The session itself and its internal
 * queue need no entry. The reference's `Statifier.Send.Routes`.
 */
export interface Routes {
  readonly sessions: ReadonlySet<string>;
  readonly parent: boolean;
  readonly invokes: ReadonlySet<string>;
}

/** Whether the declared routes reach a parsed target. */
export function reachable(routes: Routes, route: Route): boolean {
  switch (route.kind) {
    case "self":
    case "internal":
      return true;
    case "session":
      return routes.sessions.has(route.sessionId);
    case "parent":
      return routes.parent;
    case "invoke":
      return routes.invokes.has(route.invokeId);
    case "invalid":
      return false;
  }
}

/**
 * How a resolved `type` is carried: by the SCXML processor, by a processor
 * the host registered, or not at all.
 */
export type TypeClass = "built_in" | "registered" | "unsupported";

/**
 * Whether the SCXML processor carries a type: no type at all, its short form
 * `scxml`, or its URI.
 */
export function builtInType(type: Value): boolean {
  return type === null || type === "scxml" || type === SCXML_EVENT_PROCESSOR;
}

/** Classifies a resolved type. A built-in spelling stays built in whatever the host registered. */
export function classifyType(sendTypes: ReadonlySet<string> | null, type: Value): TypeClass {
  if (builtInType(type)) return "built_in";
  if (sendTypes !== null && typeof type === "string" && sendTypes.has(type)) return "registered";
  return "unsupported";
}

/**
 * Why a send with this target and type cannot be carried, or null when it can.
 * The type is judged first. A registered type's target is its processor's own
 * route and is never parsed.
 *
 * Pure over values, so a caller that knows a `<send>`'s literal `target` and
 * `type` before the chart runs can ask the same question the core asks when
 * the send executes.
 */
export function rejectReason(
  target: Value,
  type: Value,
  sendTypes: ReadonlySet<string> | null,
): ExecutionReason | null {
  const typeClass = classifyType(sendTypes, type);
  if (typeClass === "unsupported") return { kind: "unsupported_type", type };
  if (typeClass === "registered") return null;
  if (parseTarget(target).kind === "invalid") return { kind: "invalid_target", target };
  return null;
}

/**
 * Why the declared routes cannot carry a send, or null when they can or
 * nothing was declared. Only an immediate send of the SCXML processor is
 * judged: a delayed one is routed when its timer fires, and a registered
 * type's target is its processor's own.
 */
function unreachableReason(
  target: Value,
  type: Value,
  delayMs: number | null,
  state: SendState,
): ExecutionReason | null {
  if (state.routes === null || delayMs !== null) return null;
  if (classifyType(state.sendTypes, type) !== "built_in") return null;
  if (reachable(state.routes, parseTarget(target))) return null;
  return { kind: "unreachable_target", target };
}

// ---------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------

/** The whitespace a text payload is normalized over: the ASCII set, as the reference's. */
const RUNS_OF_SPACE = /[ \t\n\v\f\r]+/g;

/**
 * A `<content>` body as data. Blank text is no data. Text that is a
 * predicator literal - a number, a string, a list, a map - is that value;
 * anything else is the text trimmed, each run of whitespace one space.
 */
export function textData(text: string): Value {
  const trimmed = text.trim();
  if (trimmed === "") return Undefined;
  const compiled = compile(trimmed);
  if (compiled.ok) {
    const result = predicatorEvaluate(compiled.instructions, {}, { onUnbound: "error" });
    if (result.ok) {
      const normalized = fromHost(result.value);
      if (normalized.ok) return normalized.value;
    }
  }
  return trimmed.replace(RUNS_OF_SPACE, " ");
}

/**
 * `namelist` and `<param>` values as data: a map in document order, the last
 * of a repeated name winning, or no data when there are none.
 */
export function paramsData(pairs: readonly (readonly [string, Value])[]): Value {
  if (pairs.length === 0) return Undefined;
  return Object.fromEntries(new Map(pairs));
}

// ---------------------------------------------------------------------------
// Executing a send
// ---------------------------------------------------------------------------

/** Where a send or cancel ran: the block and the counters as they stand. */
export interface Stamp {
  readonly owner: Owner;
  readonly counters: Counters;
}

/**
 * What executing a `<send>` or `<cancel>` answered. On success, the context
 * and send state it leaves and its effect. A failure with no `context` is an
 * argument failure and changed nothing; a failure with one is a refused send,
 * whose minted id and `idlocation` write stand.
 */
export type SendOutcome<E> =
  | {
      readonly ok: true;
      readonly context: EvaluationContext;
      readonly state: SendState;
      readonly effect: E;
    }
  | {
      readonly ok: false;
      readonly reason: ExecutionReason;
      readonly context?: EvaluationContext;
      readonly state?: SendState;
    };

type Resolved =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly reason: ExecutionReason };

function resolve(context: EvaluationContext, expr: Expr | Invalid | null): Resolved {
  if (expr === null) return { ok: true, value: null };
  if (expr.kind === "invalid") {
    return {
      ok: false,
      reason: { kind: "compile_error", source: expr.source, message: expr.message },
    };
  }
  return evaluate(context, expr);
}

type ResolvedDelay =
  | { readonly ok: true; readonly ms: number | null }
  | { readonly ok: false; readonly reason: ExecutionReason };

/** The delay in whole milliseconds, null for a send with none. */
function resolveDelay(context: EvaluationContext, delay: Expr | Invalid | null): ResolvedDelay {
  if (delay === null) return { ok: true, ms: null };
  const outcome = resolve(context, delay);
  if (!outcome.ok) return outcome;
  const value = outcome.value;
  if (typeof value !== "string" && !(value instanceof Duration)) {
    return { ok: false, reason: { kind: "invalid_delay", value } };
  }
  const ms = delayToMs(value);
  if (!ms.ok) return { ok: false, reason: { kind: "invalid_delay", value } };
  return { ok: true, ms: ms.ms };
}

type ResolvedParams =
  | { readonly ok: true; readonly pairs: (readonly [string, Value])[] }
  | { readonly ok: false; readonly reason: ExecutionReason };

/** Every `namelist` and `<param>` value, stopping at the first that fails. */
function resolveParams(context: EvaluationContext, params: readonly ParamNode[]): ResolvedParams {
  const pairs: (readonly [string, Value])[] = [];
  for (const param of params) {
    const outcome = resolve(context, param.expr);
    if (!outcome.ok) return outcome;
    pairs.push([param.name, outcome.value]);
  }
  return { ok: true, pairs };
}

/** The `<content>` child's data: its text read as data, or its `expr`'s value. */
function resolveContent(context: EvaluationContext, content: Expr | Invalid): Resolved {
  if (content.kind === "static") {
    const text = content.value;
    return { ok: true, value: typeof text === "string" ? textData(text) : text };
  }
  return resolve(context, content);
}

/**
 * Executes a `<send>`: resolves its arguments, mints or reads its id, writes
 * `idlocation`, judges its target and type, and answers the effect.
 */
export function executeSend(
  context: EvaluationContext,
  node: SendNode,
  state: SendState,
  stamp: Stamp,
): SendOutcome<Send | SendDelayed> {
  const event = resolve(context, node.event);
  if (!event.ok) return event;
  const target = resolve(context, node.target);
  if (!target.ok) return target;
  const type = resolve(context, node.type);
  if (!type.ok) return type;
  const delay = resolveDelay(context, node.delay);
  if (!delay.ok) return delay;
  const params = resolveParams(context, [...node.namelist, ...node.params]);
  if (!params.ok) return params;
  let data: Value;
  if (node.content === null) {
    data = paramsData(params.pairs);
  } else {
    const content = resolveContent(context, node.content);
    if (!content.ok) return content;
    data = content.value;
  }

  let next = state;
  let sendId: string;
  if (node.id !== null) {
    sendId = node.id;
  } else {
    next = { ...next, sendCounter: next.sendCounter + 1 };
    sendId = `send_${next.sendCounter}`;
  }

  let written = context;
  if (node.idlocation !== null) {
    const write = writeLocation(context, node.idlocation, sendId);
    if (!write.ok) return write;
    written = write.context;
  }

  const invalid = rejectReason(target.value, type.value, next.sendTypes);
  const unreachable =
    invalid === null ? unreachableReason(target.value, type.value, delay.ms, next) : null;
  const rejected: ExecutionReason | null = invalid ?? unreachable;
  if (rejected !== null) {
    const errorKind = invalid === null ? "communication" : "execution";
    return {
      ok: false,
      reason: { kind: "send_rejected", sendId, errorKind, reason: rejected },
      context: written,
      state: next,
    };
  }

  const registered = classifyType(next.sendTypes, type.value) === "registered";
  if (delay.ms !== null || registered) {
    next = { ...next, timerCounter: next.timerCounter + 1 };
  }

  const fields: SendFields = {
    event: event.value,
    target: target.value,
    type: type.value,
    data,
    sendId,
    idFromAuthor: node.id !== null || node.idlocation !== null,
    cIndex: node.cIndex,
    owner: stamp.owner,
    ...stamp.counters,
  };
  const effect: Send | SendDelayed =
    delay.ms === null
      ? { kind: "send", ...fields, ordinal: registered ? next.timerCounter : null }
      : { kind: "send_delayed", ...fields, delayMs: delay.ms, ordinal: next.timerCounter };
  return { ok: true, context: written, state: next, effect };
}

/**
 * Executes a `<cancel>`: resolves the send id and answers the effect naming
 * it. An id that names nothing pending is the host's no-op, not a failure.
 */
export function executeCancel(
  context: EvaluationContext,
  node: CancelNode,
  state: SendState,
  stamp: Stamp,
): SendOutcome<Cancel> {
  const sendId = resolve(context, node.sendid);
  if (!sendId.ok) return sendId;
  const next = { ...state, timerCounter: state.timerCounter + 1 };
  const effect: Cancel = {
    kind: "cancel",
    sendId: sendId.value,
    cIndex: node.cIndex,
    owner: stamp.owner,
    ...stamp.counters,
    ordinal: next.timerCounter,
  };
  return { ok: true, context, state: next, effect };
}
