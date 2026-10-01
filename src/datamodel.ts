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
  execute as executeProgram,
  fromHost,
  type HostFunction,
  type HostValue,
  type ParseError,
  type PredicatorError,
  type Program,
  evaluate as predicatorEvaluate,
  toHost,
  Undefined,
  type Value,
} from "@riddler/predicator";
import { decodeTagged, evaluateTagged } from "@riddler/predicator/tagged";

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
 * Why an evaluation or a write failed. It is the data an `error.execution`
 * event carries.
 *
 * - `evaluator_error`: predicator refused the expression. `error` is its own
 *   error value, unwrapped, and `source` the expression's text.
 * - `non_boolean_cond`: a condition evaluated to something other than true or
 *   false, which the specification treats exactly as an evaluation error.
 * - `system_variable`: a write reached a root beginning with an underscore.
 *
 * The rest are executable content's:
 *
 * - `compile_error`: the node's expression or program never compiled, so the
 *   failure the compiler deferred is answered when the node runs. `source` is
 *   the text that failed and `message` the compiler's.
 * - `unbound_location`: an `<assign>` named a root the datamodel does not
 *   hold. A write never declares a root.
 * - `unsupported_location`: an `<assign>` named a location that is not a bare
 *   root. The reference writes a nested path; this port does not yet.
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
 * - `send_rejected`: a `<send>` whose arguments all resolved was refused for
 *   its target or its type after its send id was minted. `sendId` is that id
 *   and `reason` the `unsupported_type` or `invalid_target` refusal.
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
      readonly error: PredicatorError | ParseError;
    }
  | { readonly kind: "non_boolean_cond"; readonly value: Value }
  | { readonly kind: "system_variable"; readonly root: string }
  | { readonly kind: "compile_error"; readonly source: string; readonly message: string }
  | { readonly kind: "unbound_location"; readonly location: string }
  | { readonly kind: "unsupported_location"; readonly location: string }
  | { readonly kind: "not_iterable"; readonly value: Value }
  | { readonly kind: "illegal_item_name"; readonly name: string }
  | { readonly kind: "illegal_index_name"; readonly name: string }
  | { readonly kind: "nested_content"; readonly cIndex: number; readonly reason: ExecutionReason }
  | { readonly kind: "invalid_delay"; readonly value: Value }
  | { readonly kind: "unsupported_type"; readonly type: Value }
  | { readonly kind: "invalid_target"; readonly target: Value }
  | { readonly kind: "send_rejected"; readonly sendId: string; readonly reason: ExecutionReason }
  | { readonly kind: "src"; readonly src: string };

function evaluatorError(source: string, error: PredicatorError | ParseError): ExecutionReason {
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
  const options = { functions: functionsOf(context), onUnbound: ON_UNBOUND } as const;
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
 * its `dIndex`; or a `<script>` child of `<scxml>`, by its position among
 * them.
 */
export type Origin =
  | { readonly kind: "transition"; readonly tIndex: number }
  | { readonly kind: "content"; readonly cIndex: number; readonly owner: Owner }
  | { readonly kind: "state"; readonly stateIndex: number }
  | { readonly kind: "donedata_param"; readonly stateIndex: number; readonly paramIndex: number }
  | { readonly kind: "data"; readonly dIndex: number }
  | { readonly kind: "global_script"; readonly index: number };

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
 * `_ioprocessors` holds the SCXML Event I/O Processor's entry.
 */
export function systemVariables(sessionId: string, name: string | undefined): Datamodel {
  return new Map<string, Value>([
    ["_sessionid", sessionId],
    ["_name", name ?? Undefined],
    ["_event", Undefined],
    ["_ioprocessors", { [SCXML_EVENT_PROCESSOR]: { location: scxmlLocation(sessionId) } }],
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
): Datamodel {
  const data = new Map(host);
  for (const [root, value] of systemVariables(sessionId, name)) data.set(root, value);
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
    case "unsupported_location":
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
      return { kind: reason.kind, target: reason.target };
    case "send_rejected":
      return { kind: reason.kind, send_id: reason.sendId, reason: reasonValue(reason.reason) };
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

/** What a write to a location answered: the context it leaves, or why it was refused. */
export type WriteOutcome =
  | { readonly ok: true; readonly context: EvaluationContext }
  | { readonly ok: false; readonly reason: ExecutionReason };

/** The root a location names, and whether the location is that root alone. */
function locationRoot(location: string): { root: string; bare: boolean } | undefined {
  const trimmed = location.trim();
  const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(trimmed);
  if (match === null) return undefined;
  return { root: match[0], bare: match[0].length === trimmed.length };
}

/**
 * Writes a value at a location, as an `<assign>` and a `<send idlocation>`
 * do. The location is checked in order: a root that begins with an
 * underscore is refused, then a root the datamodel does not hold, then
 * anything but a bare root. A write never declares a root.
 */
export function writeLocation(
  context: EvaluationContext,
  location: string,
  value: Value,
): WriteOutcome {
  const unsupported: WriteOutcome = {
    ok: false,
    reason: { kind: "unsupported_location", location },
  };
  const parsed = locationRoot(location);
  if (parsed === undefined) return unsupported;
  const system = checkSystemVariable([parsed.root]);
  if (!system.ok) return system;
  if (!context.data.has(parsed.root)) {
    return { ok: false, reason: { kind: "unbound_location", location } };
  }
  if (!parsed.bare) return unsupported;
  return { ok: true, context: bind(context, parsed.root, value) };
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
 * The roots a run changed or created, split into system roots and the rest.
 * The comparison is at the top level: a write always goes through a root, so a
 * nested write changes its root's value.
 */
export function partitionChangedRoots(
  before: Datamodel,
  after: { readonly [root: string]: HostValue },
): { system: string[]; other: Map<string, Value> } {
  const system: string[] = [];
  const other = new Map<string, Value>();
  for (const [root, value] of Object.entries(after)) {
    const prior = before.get(root);
    if (prior !== undefined && sameHostValue(toHost(prior), value)) continue;
    if (isSystemRoot(root)) system.push(root);
    else other.set(root, domainValue(value));
  }
  return { system: system.sort(), other };
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
 */
export function runProgram(context: EvaluationContext, compiled: CompiledProgram): ProgramOutcome {
  const before = context.data;
  const result = executeProgram(compiled.program, contextObject(before), {
    functions: functionsOf(context),
    onUnbound: ON_UNBOUND,
    protectedRoots: protectedRoots(before),
  });

  let after: { readonly [root: string]: HostValue } = {};
  let failure: ExecutionReason | undefined;
  if (result.ok) {
    after = result.context;
  } else {
    if ("context" in result && result.context !== undefined) after = result.context;
    const root = refusedRoot(result.error);
    failure =
      root !== undefined
        ? { kind: "system_variable", root }
        : evaluatorError(compiled.source, result.error);
  }

  const { system, other } = partitionChangedRoots(before, after);
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
