// The predicator binding: how a chart's conditions and expressions reach the
// expression language, and how a failure there becomes an event.
//
// Predicator is the whole datamodel, as it is for the reference. This module
// holds that datamodel as predicator values, builds the context an
// evaluation runs against, supplies `In()` as a host function, passes the
// unbound policy and the protected roots the reference passes, seeds the
// system variables, and turns an evaluation failure into the
// `error.execution` platform event the reference raises. It is a leaf: it
// never throws on a failed evaluation, it answers the failure as a value,
// and only the caller decides to enqueue it.
//
// A context is built per evaluation site and never stored. `In()` reads the
// configuration it was built with, which moves at every microstep, and
// `_event` is rewritten on every internal round, so a context kept across
// either would answer against a position the chart has already left.

import {
  contextLocation,
  contextPut,
  type EvaluateOptions,
  execute as executeProgram,
  fromHost,
  type HostFunction,
  type HostValue,
  isFloat,
  type LocationError,
  type LocationPath,
  type ParseError,
  type PDateTime,
  type PredicatorError,
  type Program,
  evaluate as predicatorEvaluate,
  toHost,
  Undefined,
  type Value,
} from "@riddler/predicator";
import { decodeTagged, evaluateTagged, executeTagged } from "@riddler/predicator/tagged";

// ---------------------------------------------------------------------------
// The datamodel and the context
// ---------------------------------------------------------------------------

/**
 * The datamodel: predicator values under their root names.
 *
 * A root bound to the absence is declared and unbound: it reads as undefined.
 * A root the map does not hold is undeclared, and under the unbound policy
 * below reading it is an error. The two are different answers and both
 * matter - a declared `_event` before any event reads undefined rather than
 * failing.
 */
export type Datamodel = ReadonlyMap<string, Value>;

/**
 * What `In()` reads: the chart's own index for a state id, and the indexes of
 * the states the chart is in right now.
 */
export interface ActiveStates {
  /** The index of a declared state, or undefined for an id the chart never declared. */
  readonly indexOf: (stateId: string) => number | undefined;
  /** The indexes of the states in the current configuration. */
  readonly configuration: ReadonlySet<number>;
}

/** One evaluation site's view: the datamodel and the configuration, as they stand. */
export interface EvaluationContext {
  readonly data: Datamodel;
  readonly states: ActiveStates;
}

/**
 * The policy for a load of a root the context does not bind.
 *
 * The reference evaluates with its unbound policy set to refuse, and
 * predicator's own default is to answer the absence, so the binding names it
 * rather than inheriting a default that differs.
 */
export const ON_UNBOUND = "error";

/** Builds the context one evaluation site runs against. */
export function evaluationContext(data: Datamodel, states: ActiveStates): EvaluationContext {
  return { data, states };
}

/**
 * Binds one root into a context, replacing what it held. The configuration
 * carries over, so the result is safe only inside the evaluation site that
 * built the context it came from.
 */
export function bind(context: EvaluationContext, root: string, value: Value): EvaluationContext {
  const data = new Map(context.data);
  data.set(root, value);
  return { data, states: context.states };
}

/**
 * `In(stateId)`: true when the id names a state in the configuration, false
 * for an inactive state and for an id the chart never declared. An undeclared
 * id is answered rather than refused: asking about a state the chart does not
 * have gets the answer any inactive state gets. An id that is not a string
 * names no state either.
 *
 * The function takes exactly one argument. A call with another count fails
 * the evaluation; predicator answers what a host function throws as an
 * evaluation error, and the message is the one the reference's evaluator
 * gives for the same call.
 */
export function inState(states: ActiveStates, args: readonly Value[]): boolean {
  if (args.length !== 1) {
    throw new Error(`Function In() expects 1 arguments, got ${args.length}`);
  }
  const [stateId] = args;
  if (typeof stateId !== "string") return false;
  const index = states.indexOf(stateId);
  return index !== undefined && states.configuration.has(index);
}

/** The functions every evaluation gets: `In()` over this context's configuration. */
function functionsOf(context: EvaluationContext): Record<string, HostFunction> {
  return { In: (args) => inState(context.states, args) };
}

/**
 * The clock `Date.now()` and a relative date read, and the source
 * `Math.random()` draws from, as predicator's `now` and `random` options
 * take them.
 */
export interface Draws {
  readonly now: () => PDateTime;
  readonly random: () => number;
}

// The draws pinned for the evaluations the current driver call's run makes,
// or none, when predicator reads its own clock and random source.
let pinnedDraws: Draws | null = null;

/**
 * Runs `run` with every evaluation it makes reading `draws`, and restores
 * what was pinned before, whether `run` returns or throws. A driver call
 * pins one source for its runs, so a run made again reads what the first
 * run read.
 */
export function withDraws<T>(draws: Draws, run: () => T): T {
  const outer = pinnedDraws;
  pinnedDraws = draws;
  try {
    return run();
  } finally {
    pinnedDraws = outer;
  }
}

/** The `now` and `random` options for an evaluation: the pinned draws, or none. */
export function drawOptions(): Partial<Draws> {
  return pinnedDraws === null ? {} : { now: pinnedDraws.now, random: pinnedDraws.random };
}

/** The datamodel as the plain object predicator reads a context from. */
function contextObject(data: Datamodel): { [root: string]: Value } {
  return Object.fromEntries(data);
}

/**
 * A value predicator handed back, normalized into the domain again. What
 * predicator answers is always inside the domain, so a refusal here is a
 * broken invariant rather than an outcome.
 */
function domainValue(value: HostValue): Value {
  const normalized = fromHost(value);
  if (!normalized.ok) {
    throw new Error(`predicator answered a value outside the domain: ${normalized.reason}`);
  }
  return normalized.value;
}

// ---------------------------------------------------------------------------
// Expressions and their failures
// ---------------------------------------------------------------------------

/**
 * An expression a chart carries: a literal the document wrote, which needs no
 * evaluation, or a compiled program with the source it was compiled from.
 */
export type Expr =
  | { readonly kind: "static"; readonly value: Value }
  | { readonly kind: "compiled"; readonly program: Program; readonly source: string };

/**
 * An expression or a program the compiler could not compile. The failure is
 * deferred to the node that carries it, which fails when it runs rather than
 * refusing the whole chart when it loads.
 */
export interface Invalid {
  readonly kind: "invalid";
  readonly source: string;
  readonly message: string;
}

/**
 * Why an evaluation or a write failed. It is the data an `error.execution`
 * event carries.
 *
 * - `evaluator_error`: predicator refused the expression, or the location a
 *   write names: a location that does not parse, that names no place to
 *   write, or whose write passes through something that is not a container.
 *   `error` is predicator's own error value, unwrapped, and `source` the
 *   expression's or the location's text.
 * - `non_boolean_cond`: a condition evaluated to something other than true or
 *   false, which the specification treats exactly as an evaluation error.
 * - `system_variable`: a write reached a root beginning with an underscore.
 *
 * The rest are executable content's:
 *
 * - `compile_error`: the node's expression or program never compiled, so the
 *   failure the compiler deferred is answered when the node runs. `source` is
 *   the text that failed and `message` the compiler's.
 * - `unbound_location`: a write named a location whose root the datamodel
 *   does not hold. A write never declares a root.
 * - `not_iterable`: a `<foreach>`'s `array` evaluated to something other than
 *   a list.
 * - `illegal_item_name`, `illegal_index_name`: a `<foreach>`'s `item` or
 *   `index` is not a bare variable name.
 * - `nested_content`: a node inside an `<if>` partition or a `<foreach>` body
 *   failed; `cIndex` is that node's and `reason` its own failure.
 *
 * And `<send>`'s:
 *
 * - `invalid_delay`: a `delay` or `delayexpr` resolved to something that is
 *   not a delay - text the duration parser refuses, or a value that is
 *   neither text nor a duration.
 * - `unsupported_type`: the resolved `type` names no processor this session
 *   has, built in or registered.
 * - `invalid_target`: the resolved `target` is not one the SCXML processor
 *   supports.
 * - `unreachable_target`: the resolved `target` names a session, a parent or
 *   an invocation the host's declared routes do not reach; the one refusal
 *   raised as `error.communication` rather than `error.execution`.
 * - `send_rejected`: a `<send>` whose arguments all resolved was refused for
 *   its target or its type after its send id was minted. `sendId` is that id,
 *   `reason` the `unsupported_type`, `invalid_target` or `unreachable_target`
 *   refusal, and `errorKind` the error event the refusal raises when it stops
 *   a block: `communication` for `unreachable_target`, `execution` for the
 *   other two. Inside an `<if>` or a `<foreach>` it is nested content like any
 *   other failure, so the kind travels in the data rather than in the name.
 *
 * And `<data>`'s:
 *
 * - `src`: the value is a `src`, which the host resolves and nothing here
 *   fetches.
 */
export type ExecutionReason =
  | {
      readonly kind: "evaluator_error";
      readonly source: string;
      readonly error: PredicatorError | ParseError | LocationError;
    }
  | { readonly kind: "non_boolean_cond"; readonly value: Value }
  | { readonly kind: "system_variable"; readonly root: string }
  | { readonly kind: "compile_error"; readonly source: string; readonly message: string }
  | { readonly kind: "unbound_location"; readonly location: string }
  | { readonly kind: "not_iterable"; readonly value: Value }
  | { readonly kind: "illegal_item_name"; readonly name: string }
  | { readonly kind: "illegal_index_name"; readonly name: string }
  | { readonly kind: "nested_content"; readonly cIndex: number; readonly reason: ExecutionReason }
  | { readonly kind: "invalid_delay"; readonly value: Value }
  | { readonly kind: "unsupported_type"; readonly type: Value }
  | { readonly kind: "invalid_target"; readonly target: Value }
  | { readonly kind: "unreachable_target"; readonly target: Value }
  | {
      readonly kind: "send_rejected";
      readonly sendId: string;
      readonly errorKind: "execution" | "communication";
      readonly reason: ExecutionReason;
    }
  | { readonly kind: "src"; readonly src: string };

function evaluatorError(
  source: string,
  error: PredicatorError | ParseError | LocationError,
): ExecutionReason {
  return { kind: "evaluator_error", source, error };
}

/** What evaluating an expression answered. */
export type EvaluateOutcome =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly reason: ExecutionReason };

/**
 * The message predicator's tagged evaluation gives a result the encoding
 * cannot carry. It is the only failure of that entry point that is not the
 * evaluation's own, and the message is the one place it is told apart: its
 * reason is the encoding's, a token an evaluation failure can share.
 */
const TAGGED_REFUSAL = "the result is outside the tagged encoding";

/**
 * A tagged-encoding text predicator handed back, decoded into the domain.
 * Predicator encoded it, so a refusal here is a broken invariant rather than
 * an outcome.
 */
function decodedValue(text: HostValue): Value {
  if (typeof text !== "string") {
    throw new Error("predicator answered a tagged result that is not text");
  }
  const decoded = decodeTagged(text);
  if (!decoded.ok) {
    throw new Error(`predicator answered a tagged result it cannot decode: ${decoded.reason}`);
  }
  return decoded.value;
}

/**
 * Evaluates an expression against a context. A literal comes back as the
 * document wrote it; a compiled program runs under the binding's functions
 * and unbound policy. A failure is answered, never thrown.
 *
 * The value comes back as predicator's own, as the reference hands it back:
 * an integral float stays a float, at the top and nested. Predicator's main
 * evaluation projects its result to plain host values, which loses that
 * brand, so the result is read through the tagged encoding, which carries it.
 * A result the encoding cannot carry - a map holding the encoding's reserved
 * key is the one an evaluation can reach - is read through the plain
 * projection instead, as it was before, rather than failing.
 */
export function evaluate(context: EvaluationContext, expr: Expr): EvaluateOutcome {
  if (expr.kind === "static") return { ok: true, value: expr.value };
  const data = contextObject(context.data);
  const options = {
    functions: functionsOf(context),
    onUnbound: ON_UNBOUND,
    ...drawOptions(),
  } as const;
  const tagged = evaluateTagged(expr.program, data, { ...options, tagged: true });
  if (tagged.ok) return { ok: true, value: decodedValue(tagged.value) };
  if (tagged.error.message !== TAGGED_REFUSAL) {
    return { ok: false, reason: evaluatorError(expr.source, tagged.error) };
  }
  const result = predicatorEvaluate(expr.program, data, options);
  if (!result.ok) return { ok: false, reason: evaluatorError(expr.source, result.error) };
  return { ok: true, value: domainValue(result.value) };
}

/** What evaluating a transition's condition answered. */
export type CondOutcome =
  | { readonly ok: true; readonly value: boolean }
  | { readonly ok: false; readonly reason: ExecutionReason };

/**
 * Evaluates a transition's condition. No condition always passes. A condition
 * that fails to evaluate, or evaluates to something other than a boolean,
 * answers the failure: the specification treats both as false and requires
 * `error.execution` for both, so the failure carries the reason the event
 * will carry.
 */
export function evaluateCond(context: EvaluationContext, cond: Expr | undefined): CondOutcome {
  if (cond === undefined) return { ok: true, value: true };
  const outcome = evaluate(context, cond);
  if (!outcome.ok) return outcome;
  if (typeof outcome.value === "boolean") return { ok: true, value: outcome.value };
  return { ok: false, reason: { kind: "non_boolean_cond", value: outcome.value } };
}

/** Whether a condition's outcome enables its transition: only a true does. */
export function condEnables(outcome: CondOutcome): boolean {
  return outcome.ok && outcome.value;
}

// ---------------------------------------------------------------------------
// Events raised about a failure
// ---------------------------------------------------------------------------

/** Where an event came from. `external` events arrived from outside the chart. */
export type EventType = "external" | "internal" | "platform";

/**
 * The block a content node runs in: a state's `<onentry>` or `<onexit>` by its
 * position among the state's blocks of that kind, a transition's own content,
 * or an `<invoke>`'s `<finalize>` by the invoke's position in its state.
 */
export type Owner =
  | { readonly kind: "onentry"; readonly stateIndex: number; readonly ordinal: number }
  | { readonly kind: "onexit"; readonly stateIndex: number; readonly ordinal: number }
  | { readonly kind: "transition"; readonly tIndex: number }
  | { readonly kind: "finalize"; readonly stateIndex: number; readonly invokeIndex: number };

/**
 * Which node an internally raised event is about: a transition's condition;
 * a content node, named by its index and the block it ran in; a state, for
 * the `done.state.<id>` a final state's entry raises and for its
 * `<donedata>`'s `<content>` failing; one `<param>` of a state's
 * `<donedata>`, by its position there, so that two failing params raise
 * events with different origins; a `<data>` whose value failed to bind, by
 * its `dIndex`; a `<script>` child of `<scxml>`, by its position among
 * them; an `<invoke>` whose start failed, by its state and its position
 * there; or the write an empty `<finalize>` makes for one returned value, by
 * the same pair.
 */
export type Origin =
  | { readonly kind: "transition"; readonly tIndex: number }
  | { readonly kind: "content"; readonly cIndex: number; readonly owner: Owner }
  | { readonly kind: "state"; readonly stateIndex: number }
  | { readonly kind: "donedata_param"; readonly stateIndex: number; readonly paramIndex: number }
  | { readonly kind: "data"; readonly dIndex: number }
  | { readonly kind: "global_script"; readonly index: number }
  | { readonly kind: "invoke"; readonly stateIndex: number; readonly invokeIndex: number }
  | { readonly kind: "finalize"; readonly stateIndex: number; readonly invokeIndex: number };

/** Why an internally raised event exists: its origin and the counters at the raise. */
export interface Cause {
  readonly origin: Origin;
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
}

/** The counters an event's cause is stamped from. */
export interface Counters {
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
}

/**
 * An event, with the fields `_event` exposes. An `error.execution` the
 * platform raised about a failure also carries the failure whole as `reason`,
 * and its data is that reason as a datamodel value, which is what `_event.data`
 * reads.
 */
export interface Event {
  readonly name: string;
  readonly type: EventType;
  readonly data: Value;
  readonly reason?: ExecutionReason;
  readonly cause?: Cause;
  readonly sendid?: string;
  readonly origin?: string;
  readonly origintype?: string;
  readonly invokeid?: string;
}

/**
 * Builds the `error.execution` platform event for a failure, with its cause
 * stamped from the counters as they stand at the raise.
 */
export function executionError(origin: Origin, counters: Counters, reason: ExecutionReason): Event {
  const cause: Cause = {
    origin,
    macrostep: counters.macrostep,
    microstep: counters.microstep,
    round: counters.round,
  };
  return { name: "error.execution", type: "platform", data: reasonValue(reason), reason, cause };
}

/**
 * Appends one `error.execution` to the internal queue for every condition in
 * the round that failed, in the order the round evaluated them. An outcome
 * that did not fail raises nothing. The queue passed in is not changed.
 */
export function raiseCondErrors(
  internalQueue: readonly Event[],
  outcomes: readonly { readonly tIndex: number; readonly outcome: CondOutcome }[],
  counters: Counters,
): Event[] {
  const queue = [...internalQueue];
  for (const { tIndex, outcome } of outcomes) {
    if (!outcome.ok) {
      queue.push(executionError({ kind: "transition", tIndex }, counters, outcome.reason));
    }
  }
  return queue;
}

// ---------------------------------------------------------------------------
// The system variables
// ---------------------------------------------------------------------------

/** The SCXML Event I/O Processor's type URI, the key of its `_ioprocessors` entry. */
export const SCXML_EVENT_PROCESSOR = "http://www.w3.org/TR/scxml/#SCXMLEventProcessor";

/** The address a session is reached at through the SCXML Event I/O Processor. */
export function scxmlLocation(sessionId: string): string {
  return `#_scxml_${sessionId}`;
}

/**
 * The four system variables as they stand before any event. `_sessionid` is
 * the id the host minted for the session. `_name` is the chart's name, or
 * undefined when the chart has none. `_event` is declared with no value, so a
 * read before the first event answers undefined rather than failing.
 * `_ioprocessors` holds the SCXML Event I/O Processor's entry, keyed by its
 * URI with the session's location, and an entry for each send type the host
 * registered a processor for (`sendTypes`, null for none): the one its
 * processor supplied (`entries`, by type), or an empty one. A registered
 * type never replaces the SCXML entry: a set naming the processor's URI still
 * reads the SCXML entry under it. The entries are written here, once, when the
 * chart starts, and a resumed chart reads the ones it started with.
 */
export function systemVariables(
  sessionId: string,
  name: string | undefined,
  sendTypes: ReadonlySet<string> | null = null,
  entries: ReadonlyMap<string, Value> = new Map(),
): Datamodel {
  // Built from entries, so every type is an own key, and the SCXML entry
  // comes last, so it wins over a registered type of the same spelling.
  const ioprocessors: Value = Object.fromEntries([
    ...[...(sendTypes ?? [])].map((type) => [type, entries.get(type) ?? {}] as const),
    [SCXML_EVENT_PROCESSOR, { location: scxmlLocation(sessionId) }] as const,
  ]);
  return new Map<string, Value>([
    ["_sessionid", sessionId],
    ["_name", name ?? Undefined],
    ["_event", Undefined],
    ["_ioprocessors", ioprocessors],
  ]);
}

/**
 * A session's starting datamodel: the host's roots with the system variables
 * over them, so a host value under a system variable's name never survives.
 */
export function initialDatamodel(
  host: Datamodel,
  sessionId: string,
  name: string | undefined,
  sendTypes: ReadonlySet<string> | null = null,
  entries?: ReadonlyMap<string, Value>,
): Datamodel {
  const data = new Map(host);
  for (const [root, value] of systemVariables(sessionId, name, sendTypes, entries)) {
    data.set(root, value);
  }
  return data;
}

/** An execution reason as a datamodel value, so `_event.data` can read it. */
export function reasonValue(reason: ExecutionReason): Value {
  switch (reason.kind) {
    case "evaluator_error":
      return {
        kind: reason.kind,
        source: reason.source,
        type: reason.error.type,
        reason: reason.error.reason,
        message: reason.error.message,
      };
    case "non_boolean_cond":
      return { kind: reason.kind, value: reason.value };
    case "system_variable":
      return { kind: reason.kind, root: reason.root };
    case "compile_error":
      return { kind: reason.kind, source: reason.source, message: reason.message };
    case "unbound_location":
      return { kind: reason.kind, location: reason.location };
    case "not_iterable":
      return { kind: reason.kind, value: reason.value };
    case "illegal_item_name":
    case "illegal_index_name":
      return { kind: reason.kind, name: reason.name };
    case "nested_content":
      return { kind: reason.kind, c_index: reason.cIndex, reason: reasonValue(reason.reason) };
    case "invalid_delay":
      return { kind: reason.kind, value: reason.value };
    case "unsupported_type":
      return { kind: reason.kind, type: reason.type };
    case "invalid_target":
    case "unreachable_target":
      return { kind: reason.kind, target: reason.target };
    case "send_rejected":
      return {
        kind: reason.kind,
        send_id: reason.sendId,
        error_kind: reason.errorKind,
        reason: reasonValue(reason.reason),
      };
    case "src":
      return { kind: reason.kind, src: reason.src };
  }
}

/**
 * `_event`'s value for an event: the name, the type, and the optional fields,
 * each undefined when the event has none, and the data.
 */
export function eventValue(event: Event): Value {
  return {
    name: event.name,
    type: event.type,
    sendid: event.sendid ?? Undefined,
    origin: event.origin ?? Undefined,
    origintype: event.origintype ?? Undefined,
    invokeid: event.invokeid ?? Undefined,
    data: event.data,
  };
}

/** The datamodel with `_event` set to an event's value. */
export function putEvent(data: Datamodel, event: Event): Datamodel {
  const next = new Map(data);
  next.set("_event", eventValue(event));
  return next;
}

// ---------------------------------------------------------------------------
// Protected roots
// ---------------------------------------------------------------------------

/**
 * Whether a root is a system variable's. The rule is the underscore prefix,
 * not a list of names: it covers the four variables this module seeds and any
 * other root spelled that way, a platform root such as `_x` among them, which
 * nothing seeds.
 */
export function isSystemRoot(root: string): boolean {
  return root.startsWith("_");
}

/**
 * The roots a program may not write, derived from the datamodel it runs
 * against: every root already bound that begins with an underscore.
 * Predicator's option is a list of names rather than a prefix, so the list is
 * derived per run. A system root the program creates fresh is not on it;
 * `runProgram` catches that one after the run.
 */
export function protectedRoots(data: Datamodel): string[] {
  return [...data.keys()].filter(isSystemRoot);
}

/**
 * The check a write to a resolved location makes before it writes: a root
 * beginning with an underscore is refused, whether or not it is bound.
 */
export function checkSystemVariable(
  path: readonly (string | number)[],
): { readonly ok: true } | { readonly ok: false; readonly reason: ExecutionReason } {
  const [root] = path;
  if (typeof root === "string" && isSystemRoot(root)) {
    return { ok: false, reason: { kind: "system_variable", root } };
  }
  return { ok: true };
}

/**
 * What a write to a location answered: the context it leaves, the path the
 * location resolved to and the value that path held before the write, or why
 * the write was refused.
 */
export type WriteOutcome =
  | {
      readonly ok: true;
      readonly context: EvaluationContext;
      readonly path: LocationPath;
      readonly priorValue: Value;
    }
  | { readonly ok: false; readonly reason: ExecutionReason };

/**
 * The value at a path in the datamodel, read before a write: a string key
 * against a map, an integer index against a list, and the absence on any
 * miss or on a step through anything else. The read is at the full path, so
 * a path that was never written and one that holds the absence read alike.
 * An integer against a map is a step through something else here, as it is
 * in the reference's read, even though the write names the key the
 * integer's decimal spelling names.
 */
function readPath(data: Datamodel, path: LocationPath): Value {
  const [root, ...rest] = path;
  if (typeof root !== "string" || !data.has(root)) return Undefined;
  let current = data.get(root) as Value;
  for (const segment of rest) {
    if (typeof segment === "string") {
      if (!isMapValue(current) || !Object.hasOwn(current, segment)) return Undefined;
      current = current[segment] as Value;
    } else {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) return Undefined;
      current = current[segment] as Value;
    }
  }
  return current;
}

/** Whether a datamodel value is a map: a plain object that is not a list. */
function isMapValue(value: Value): value is { [key: string]: Value } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isFloat(value) &&
    isPlainMap(value)
  );
}

/**
 * Resolves a location's source to a path. The context is read only for a
 * variable inside a bracket key, so it is handed over only when the source
 * carries a bracket; a location with none resolves against the empty context
 * to the same path.
 */
function resolveLocation(
  context: EvaluationContext,
  location: string,
):
  | { readonly ok: true; readonly path: LocationPath }
  | { readonly ok: false; readonly reason: ExecutionReason } {
  const roots = location.trim().includes("[") ? contextObject(context.data) : {};
  const resolved = contextLocation(location, roots);
  if (!resolved.ok) return { ok: false, reason: evaluatorError(location, resolved.error) };
  return resolved;
}

/**
 * Writes a value at a location, as an `<assign>`, a `<send idlocation>`, an
 * `<invoke idlocation>` and an empty `<finalize>` do, in the reference's
 * order: the location is resolved to a path, which a source that does not
 * parse or names no place to write refuses; a root that begins with an
 * underscore is refused; a root the datamodel does not hold is refused; the
 * value the path holds is read; then the value is written at the path and its
 * root bound. A write never declares a root, and creates only what lies
 * between the root and the leaf: a missing or absent slot on the way becomes
 * a list before an index and a map before a key, and a list is padded with
 * the absence out to an index past its end. A write the location surface
 * refuses - through a scalar, a string key against a list, a negative index -
 * answers that refusal.
 */
export function writeLocation(
  context: EvaluationContext,
  location: string,
  value: Value,
): WriteOutcome {
  const resolved = resolveLocation(context, location);
  if (!resolved.ok) return resolved;
  const { path } = resolved;
  const system = checkSystemVariable(path);
  if (!system.ok) return system;
  const [root] = path;
  if (typeof root !== "string" || !context.data.has(root)) {
    return { ok: false, reason: { kind: "unbound_location", location } };
  }
  const priorValue = readPath(context.data, path);
  if (path.length === 1) {
    return { ok: true, context: bind(context, root, value), path, priorValue };
  }
  const put = contextPut({ [root]: context.data.get(root) as Value }, path, value);
  if (!put.ok) return { ok: false, reason: evaluatorError(location, put.error) };
  return { ok: true, context: bind(context, root, put.context[root] as Value), path, priorValue };
}

/** A statement program with the source it was compiled from. */
export interface CompiledProgram {
  readonly program: Program;
  readonly source: string;
}

/** What running a program answered: the datamodel it leaves, and a failure if one stopped it. */
export type ProgramOutcome =
  | { readonly ok: true; readonly data: Datamodel }
  | { readonly ok: false; readonly data: Datamodel; readonly reason: ExecutionReason };

/**
 * The root a protected-root refusal names, read from the refusal's
 * `details.root`. The message is not read: predicator does not hold it
 * normative.
 */
export function refusedRoot(error: PredicatorError | ParseError): string | undefined {
  if (error.type !== "EvaluationError" || error.reason !== "protected_root") return undefined;
  return error.details?.root;
}

/** Whether a value is a plain map: an object built from a literal or with no prototype. */
function isPlainMap(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Whether two datamodel values are the same value, strictly, as the
 * reference's diff compares them: a float and an integer of the same
 * magnitude differ. Two floats whose signs of zero differ differ too, since
 * the tagged encoding carries the sign. Lists and maps compare member by
 * member, and a date, a datetime and a duration by their parts.
 */
function sameValue(a: Value, b: Value): boolean {
  if (isFloat(a) || isFloat(b)) {
    return isFloat(a) && isFloat(b) && Object.is(a.valueOf(), b.valueOf());
  }
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return a.length === b.length && a.every((member, i) => sameValue(member, b[i] as Value));
  }
  if (isPlainMap(a) !== isPlainMap(b)) return false;
  if (!isPlainMap(a) && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  const left = a as { readonly [key: string]: Value };
  const right = b as { readonly [key: string]: Value };
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) => Object.hasOwn(right, key) && sameValue(left[key] as Value, right[key] as Value),
    )
  );
}

/**
 * The roots a run changed or created, split into system roots and the rest.
 * The comparison is at the top level: a write always goes through a root, so a
 * nested write changes its root's value. It is strict on the values the run
 * bound, as the reference's is: a root rewritten from the float 2.0 to the
 * integer 2 changed.
 */
export function partitionChangedRoots(
  before: Datamodel,
  after: { readonly [root: string]: Value },
): { system: string[]; other: Map<string, Value> } {
  const system: string[] = [];
  const other = new Map<string, Value>();
  for (const [root, value] of Object.entries(after)) {
    const prior = before.get(root);
    if (prior !== undefined && sameValue(prior, value)) continue;
    if (isSystemRoot(root)) system.push(root);
    else other.set(root, value);
  }
  return { system: system.sort(), other };
}

/** How a program run ended: the context it halted with, and its failure if it had one. */
interface ProgramHalt {
  readonly context: { readonly [root: string]: Value };
  readonly error?: PredicatorError | ParseError;
}

/** A halt context predicator wrote as tagged text, decoded into the domain. */
function decodedContext(text: string): { readonly [root: string]: Value } {
  const value = decodedValue(text);
  if (typeof value !== "object" || value === null || Array.isArray(value) || !isPlainMap(value)) {
    throw new Error("predicator answered a tagged context that is not a map");
  }
  return value as { readonly [root: string]: Value };
}

/**
 * Runs a program and answers the context it halted with as domain values.
 *
 * The context is read through predicator's tagged statement run, which
 * carries a float's brand where the plain projection drops it. A context the
 * encoding cannot carry - a map holding the encoding's reserved key, or a
 * duration with a fractional part - comes back from the tagged run with no
 * context, so the program is run again under the plain projection and its
 * context is read from there, as it was before, rather than failing a run
 * that succeeded. There a root is compared as it was before too, by its
 * projection, so a root the program left alone is handed back as the value
 * it held rather than as its projection normalized again. The fallback runs
 * the program a second time, so a host function it calls is called again;
 * `In()`, the one this binding supplies, reads a configuration that does not
 * move between the two runs.
 */
function haltOf(program: Program, before: Datamodel, options: EvaluateOptions): ProgramHalt {
  const data = contextObject(before);
  const tagged = executeTagged(program, data, options);
  if (tagged.ok) return { context: decodedContext(tagged.context) };
  if (tagged.context !== undefined) {
    return { context: decodedContext(tagged.context), error: tagged.error };
  }
  const plain = executeProgram(program, data, options);
  if (plain.ok) return { context: domainContext(plain.context, before) };
  const context = "context" in plain && plain.context !== undefined ? plain.context : {};
  return { context: domainContext(context, before), error: plain.error };
}

/** Whether two values predicator projected for a host are the same value. */
function sameHostValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((member, i) => sameHostValue(member, other[i]));
  }
  const left = a as { [key: string]: unknown };
  const right = b as { [key: string]: unknown };
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameHostValue(left[key], right[key]))
  );
}

/**
 * A halt context predicator projected for a host, normalized into the domain
 * again. A root whose projection is its projection before the run is handed
 * back as the value it held, so the diff does not read the projection's lost
 * brand as a change.
 */
function domainContext(
  context: { readonly [root: string]: HostValue },
  before: Datamodel,
): { readonly [root: string]: Value } {
  const domain: { [root: string]: Value } = {};
  for (const [root, value] of Object.entries(context)) {
    const prior = before.get(root);
    domain[root] =
      prior !== undefined && sameHostValue(toHost(prior), value) ? prior : domainValue(value);
  }
  return domain;
}

/**
 * Runs a statement program against a context and merges what it wrote.
 *
 * Every system root already bound is protected for the run, so a write to one
 * fails at the statement that attempts it and no later statement runs. A
 * system root the program creates fresh cannot be named in advance; the diff
 * after the run finds it, it is never merged, and the run answers the failure.
 * Either way the reason is `system_variable` naming the root, and the writes to
 * other roots that the program made before it stopped are merged. When several
 * fresh system roots changed, the one named is the first in sort order.
 *
 * What merges is the value the program bound, as the reference merges it: a
 * float the program stored stays a float, a float nested beside a member the
 * program changed keeps its brand, and a root rewritten from a float to the
 * integer of the same magnitude is a change.
 */
export function runProgram(context: EvaluationContext, compiled: CompiledProgram): ProgramOutcome {
  const before = context.data;
  const halt = haltOf(compiled.program, before, {
    functions: functionsOf(context),
    onUnbound: ON_UNBOUND,
    protectedRoots: protectedRoots(before),
    ...drawOptions(),
  });

  let failure: ExecutionReason | undefined;
  if (halt.error !== undefined) {
    const root = refusedRoot(halt.error);
    failure =
      root !== undefined
        ? { kind: "system_variable", root }
        : evaluatorError(compiled.source, halt.error);
  }

  const { system, other } = partitionChangedRoots(before, halt.context);
  const data = new Map(before);
  for (const [root, value] of other) data.set(root, value);

  if (failure !== undefined) return { ok: false, data, reason: failure };
  const [first] = system;
  if (first !== undefined) {
    return { ok: false, data, reason: { kind: "system_variable", root: first } };
  }
  return { ok: true, data };
}

// ---------------------------------------------------------------------------
// The datamodel attribute
// ---------------------------------------------------------------------------

/**
 * The spellings the `datamodel` attribute accepts: the specification's three
 * named values and the platform's two. Accepting `ecmascript` does not mean
 * ECMAScript runs - predicator is the datamodel whatever the attribute says;
 * the list only catches a misspelling.
 */
export const DATAMODEL_SPELLINGS: readonly string[] = [
  "predicator",
  "elixir",
  "null",
  "ecmascript",
  "xpath",
];

/** Whether the `datamodel` attribute's value is an accepted spelling. */
export function acceptsDatamodel(spelling: string): boolean {
  return DATAMODEL_SPELLINGS.includes(spelling);
}
