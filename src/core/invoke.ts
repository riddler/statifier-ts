// The invoke passes: starting a state's invocations at the end of a
// macrostep, and the finalize and autoforward pass an external event meets
// before it selects anything.
//
// Ported from the reference's interpreter module (`Statifier.Interpreter` in
// statifier-ex at v2.9.0: `run_invoke_pass`, `invoke_one`,
// `generate_invoke_id`, `apply_invoke_passes`, `apply_finalize` and
// `auto_assign_finalize`), itself a literal port of the SCXML
// recommendation's Appendix D. The cancel of an invocation whose state exits
// is exit's, in the exit-and-entry module.
//
// The core starts no child. Starting an invocation answers an `invoke`
// effect describing it and records it live; forwarding an event to one
// answers an `autoforward` effect carrying the event whole. Running the
// child, delivering to it, and turning what it answers into events -
// `done.invoke.<id>` among them - are the driver's. An event that arrives
// from an invocation is an ordinary external event here: the only thing
// its `invokeid` changes is which `<finalize>` runs before selection.
//
// `src` is resolved and carried, never dereferenced.
//
// Where this departs from the reference: the reference lets a host declare
// the invoke types it implements, and refuses a type outside that set; no
// such declaration exists here yet, so every invocation is judged as the
// reference judges one in a session that declared none. The effect is
// answered for any type; only the built-in SCXML type is recorded live. The
// reference's trace and datamodel effects are not emitted here, as nowhere
// else in this core.

import { typeName, type Value } from "@riddler/predicator";
import {
  type EvaluationContext,
  type Event,
  type ExecutionReason,
  type Expr,
  evaluate,
  executionError,
  type Origin,
  writeLocation,
} from "../datamodel.js";
import {
  type CompiledInvoke,
  type CompiledParam,
  type CompiledState,
  documentOrder,
  stateAt,
} from "../machine.js";
import type { Invalid } from "./content.js";
import {
  contextOf,
  type ExitEntryEffect,
  type ExitEntryState,
  invocationKey,
  runBlock,
} from "./exit-entry.js";
import { paramsData, textData } from "./send.js";

// ---------------------------------------------------------------------------
// The state the passes read and write, and their effects
// ---------------------------------------------------------------------------

/**
 * What the invoke passes read and write beyond exit and entry: the sequence
 * a generated invoke id is minted from. The next generated id takes the
 * counter plus one, so the first is `inv_1`. An author-written id does not
 * consume it, and it is never reset.
 */
export interface InvokeState extends ExitEntryState {
  readonly invokeCounter: number;
}

/**
 * An invocation the host starts. `type` and `src` are the resolved values,
 * null when the element wrote neither attribute of the pair; `params` is the
 * `namelist` and `<param>` values as data; `content` is the `<content>`
 * child's data, or null when it has none. `invokeId` is always set,
 * generated when the author named none.
 */
export interface Invoke {
  readonly kind: "invoke";
  readonly invokeId: string;
  readonly type: Value;
  readonly src: Value;
  readonly params: Value;
  readonly content: Value;
  readonly autoforward: boolean;
  readonly stateIndex: number;
  readonly invokeIndex: number;
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
}

/** An external event the host forwards, unchanged, to the live invocation `invokeId` names. */
export interface Autoforward {
  readonly kind: "autoforward";
  readonly invokeId: string;
  readonly stateIndex: number;
  readonly event: Event;
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
}

/** An effect the invoke passes produced. */
export type InvokeEffect = ExitEntryEffect | Invoke | Autoforward;

/** What a pass answers: the state it leaves and its effects, in order. */
export interface Passed<S extends InvokeState> {
  readonly state: S;
  readonly effects: readonly InvokeEffect[];
}

/** The URI of the SCXML invoke type. */
export const SCXML_INVOKE_TYPE = "http://www.w3.org/TR/scxml/";

/**
 * Whether the SCXML processor runs an invoke type itself: no type at all, its
 * short form `scxml`, or its URI with or without the trailing slash.
 */
export function builtInInvokeType(type: Value): boolean {
  return (
    type === null ||
    type === "scxml" ||
    type === SCXML_INVOKE_TYPE ||
    type === "http://www.w3.org/TR/scxml"
  );
}

// ---------------------------------------------------------------------------
// The invoke pass
// ---------------------------------------------------------------------------

/**
 * `for state in statesToInvoke.sort(entryOrder): for inv in
 * state.invoke.sort(documentOrder): invoke(inv)`, then
 * `statesToInvoke.clear()`. One context is threaded through the whole pass,
 * so an invocation's arguments read the id an earlier one wrote to its
 * `idlocation`. An invocation whose start fails raises `error.execution` and
 * answers nothing; its siblings are unaffected.
 */
export function runInvokePass<S extends InvokeState>(state: S): Passed<S> {
  if (state.statesToInvoke.size === 0) return { state, effects: [] };
  let current = state;
  let context = contextOf(state);
  const effects: InvokeEffect[] = [];
  for (const s of documentOrder(state.statesToInvoke)) {
    const owner = stateAt(state.machine, s);
    for (const invoke of owner.invoke) {
      const started = invokeOne(current, context, owner, invoke);
      current = started.state;
      context = started.context;
      effects.push(...started.effects);
    }
  }
  return { state: { ...current, statesToInvoke: new Set<number>() }, effects };
}

interface Started<S extends InvokeState> extends Passed<S> {
  readonly context: EvaluationContext;
}

type Resolved =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly reason: ExecutionReason };

// `invoke(inv)`: the type, then the source, then the `namelist` and `<param>`
// values in document order, then `<content>`, each against the threaded
// context, the first failure aborting this invocation. Then the id is minted
// or read, `idlocation` written, the invocation recorded live when its type
// is the built-in one, and the effect answered.
function invokeOne<S extends InvokeState>(
  state: S,
  context: EvaluationContext,
  owner: CompiledState,
  invoke: CompiledInvoke,
): Started<S> {
  const s = owner.index;
  const abort = (at: S, reason: ExecutionReason): Started<S> => ({
    state: raiseError(at, { kind: "invoke", stateIndex: s, invokeIndex: invoke.index }, reason),
    context,
    effects: [],
  });

  const type = resolve(context, invoke.type);
  if (!type.ok) return abort(state, type.reason);
  const src = resolve(context, invoke.src);
  if (!src.ok) return abort(state, src.reason);
  const params = resolveParams(context, [...invoke.namelist, ...invoke.params]);
  if (!params.ok) return abort(state, params.reason);
  const content = resolveContent(context, invoke.content);
  if (!content.ok) return abort(state, content.reason);

  const minted = generateInvokeId(state, owner, invoke);
  let current = minted.state;
  let written = context;
  if (invoke.idlocation !== null) {
    const write = writeLocation(context, invoke.idlocation, minted.invokeId);
    if (!write.ok) return abort(current, write.reason);
    written = write.context;
    current = { ...current, datamodel: write.context.data };
  }

  if (builtInInvokeType(type.value)) {
    const activeInvocations = new Map(current.activeInvocations);
    activeInvocations.set(invocationKey(s, invoke.index), minted.invokeId);
    current = { ...current, activeInvocations };
  }

  const effect: Invoke = {
    kind: "invoke",
    invokeId: minted.invokeId,
    type: type.value,
    src: src.value,
    params: paramsData(params.pairs),
    content: content.value,
    autoforward: invoke.autoforward,
    stateIndex: s,
    invokeIndex: invoke.index,
    macrostep: current.macrostep,
    microstep: current.microstep,
    round: current.round,
  };
  return { state: current, context: written, effects: [effect] };
}

// `generate_invoke_id`: the author's literal id, used as written and never
// consuming the counter; otherwise `inv_` and the counter plus one, after the
// state's id and a dot when the state has one.
function generateInvokeId<S extends InvokeState>(
  state: S,
  owner: CompiledState,
  invoke: CompiledInvoke,
): { readonly state: S; readonly invokeId: string } {
  if (invoke.id !== null) return { state, invokeId: invoke.id };
  const invokeCounter = state.invokeCounter + 1;
  const platformId = `inv_${invokeCounter}`;
  const invokeId = owner.id === null ? platformId : `${owner.id}.${platformId}`;
  return { state: { ...state, invokeCounter }, invokeId };
}

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

type ResolvedParams =
  | { readonly ok: true; readonly pairs: (readonly [string, Value])[] }
  | { readonly ok: false; readonly reason: ExecutionReason };

// Every `namelist` and `<param>` value, stopping at the first that fails: the
// whole element is abandoned, unlike a `<donedata>` param that fails alone.
function resolveParams(
  context: EvaluationContext,
  params: readonly CompiledParam[],
): ResolvedParams {
  const pairs: (readonly [string, Value])[] = [];
  for (const param of params) {
    const outcome = resolve(context, param.expr);
    if (!outcome.ok) return outcome;
    pairs.push([param.name, outcome.value]);
  }
  return { ok: true, pairs };
}

// The `<content>` child's data: null when there is none, its text read as
// data, or its `expr`'s value.
function resolveContent(context: EvaluationContext, content: Expr | null): Resolved {
  if (content === null) return { ok: true, value: null };
  if (content.kind === "static") {
    const text = content.value;
    return { ok: true, value: typeof text === "string" ? textData(text) : text };
  }
  return evaluate(context, content);
}

// ---------------------------------------------------------------------------
// The finalize and autoforward pass
// ---------------------------------------------------------------------------

/**
 * `for state in configuration: for inv in state.invoke: if inv.invokeid ==
 * externalEvent.invokeid: applyFinalize(inv, externalEvent); if
 * inv.autoforward: send(inv.id, externalEvent)`, run after `_event` is set
 * and before selection. The configuration is walked in document order and
 * each state's invocations in document order; an invocation that is not live
 * is skipped. The two tests are independent: a live invocation that matches
 * and forwards does both, its `<finalize>` first.
 */
export function applyInvokePasses<S extends InvokeState>(state: S, event: Event): Passed<S> {
  if (state.activeInvocations.size === 0) return { state, effects: [] };
  let current = state;
  const effects: InvokeEffect[] = [];
  for (const s of documentOrder(state.configuration)) {
    for (const invoke of stateAt(state.machine, s).invoke) {
      const invokeId = current.activeInvocations.get(invocationKey(s, invoke.index));
      if (invokeId === undefined) continue;
      if (invokeId === event.invokeid) {
        const finalized = applyFinalize(current, s, invoke, event);
        current = finalized.state;
        effects.push(...finalized.effects);
      }
      if (invoke.autoforward) {
        effects.push({
          kind: "autoforward",
          invokeId,
          stateIndex: s,
          event,
          macrostep: current.macrostep,
          microstep: current.microstep,
          round: current.round,
        });
      }
    }
  }
  return { state: current, effects };
}

// `applyFinalize`: no `<finalize>` does nothing; an empty one writes the
// returned values back; any other runs as a block of its own.
function applyFinalize<S extends InvokeState>(
  state: S,
  s: number,
  invoke: CompiledInvoke,
  event: Event,
): Passed<S> {
  if (invoke.finalize === null) return { state, effects: [] };
  if (invoke.finalize.content.length === 0) {
    return { state: autoAssignFinalize(state, s, invoke, event), effects: [] };
  }
  return runBlock(state, invoke.finalize.content, {
    kind: "finalize",
    stateIndex: s,
    invokeIndex: invoke.index,
  });
}

// An empty `<finalize>`: each `namelist` entry and each `<param location>`
// whose name the event's data carries is written, as by `<assign>`, with that
// value. Only data that is a map carries named values. A write that fails
// raises `error.execution` and leaves the other writes standing.
function autoAssignFinalize<S extends InvokeState>(
  state: S,
  s: number,
  invoke: CompiledInvoke,
  event: Event,
): S {
  const data = event.data;
  if (!isMap(data)) return state;
  let current = state;
  let context = contextOf(state);
  const origin: Origin = { kind: "finalize", stateIndex: s, invokeIndex: invoke.index };
  for (const param of [...invoke.namelist, ...invoke.params]) {
    if (param.kind !== "location" || param.expr.kind !== "compiled") continue;
    if (!Object.hasOwn(data, param.name)) continue;
    const value = data[param.name] as Value;
    const write = writeLocation(context, param.expr.source, value);
    if (write.ok) {
      context = write.context;
      current = { ...current, datamodel: write.context.data };
    } else {
      current = raiseError(current, origin, write.reason);
    }
  }
  return current;
}

function isMap(value: Value): value is { readonly [key: string]: Value } {
  return typeName(value) === "map";
}

function raiseError<S extends InvokeState>(state: S, origin: Origin, reason: ExecutionReason): S {
  const event = executionError(origin, state, reason);
  return { ...state, internalQueue: [...state.internalQueue, event] };
}
