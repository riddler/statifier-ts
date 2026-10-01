// The datamodel's `<data>` binding: every declared id created when the chart
// starts, and each value bound at the time its binding says.
//
// Ported from the reference's interpreter datamodel module
// (`Statifier.Interpreter.Datamodel` in statifier-ex at v2.9.0). The SCXML
// recommendation's Appendix D calls `initializeDatamodel` from `interpret` and
// `initializeDataModel` from `enterStates` but gives neither a body, so what
// both do is the specification's prose, as the reference reads it:
//
// - Every `<data>` id is created when the chart starts, under both bindings:
//   bound to the absence, so a read before its value is bound answers
//   undefined rather than failing.
// - Under early binding every `<data>` is bound when the chart starts. Under
//   late binding only the root's own is; a state's own `<data>` is bound when
//   that state is entered for the first time, before its `<onentry>`, and
//   never again.
// - A value the host supplied when the chart started wins over the root's own
//   `<data>` of the same id, which is then not bound at all. A state's own
//   `<data>` has no such override.
// - Every `<data>` bound at one time is evaluated against one context, built
//   once before any of them binds, so no `<data>` reads another's value.
// - A value that fails - an expression that did not compile, a `src` (never
//   fetched: the host resolves a `src`), or an expression whose evaluation
//   fails - raises `error.execution` and leaves the id bound to the absence.
//
// Whether a state's entry is its first is the caller's question: exit and
// entry keeps the states ever entered and calls `enterStateData` only on a
// first entry. The datamodel change effects the reference emits for each
// binding land with the datamodel effects.

import { Undefined } from "@riddler/predicator";
import {
  type ActiveStates,
  type Counters,
  type Datamodel,
  type EvaluationContext,
  type Event,
  type ExecutionReason,
  evaluate,
  evaluationContext,
  executionError,
} from "../datamodel.js";
import { type CompiledData, type Machine, stateAt } from "../machine.js";

/** What `<data>` binding reads and writes: the chart, the configuration `In()` reads, the datamodel and the internal queue. */
export interface BindingState extends Counters {
  readonly machine: Machine;
  readonly configuration: ReadonlySet<number>;
  readonly datamodel: Datamodel;
  readonly internalQueue: readonly Event[];
}

/**
 * `initializeDatamodel`: creates every `<data>` id and binds what binds when
 * the chart starts - every `<data>` under early binding, the root's own under
 * late binding. The ids the datamodel already holds when this runs are the
 * host's, and a root `<data>` whose id is among them is not bound.
 */
export function initializeDatamodel<S extends BindingState>(state: S): S {
  const { machine } = state;
  const hostIds = new Set(state.datamodel.keys());
  const seeded = new Map(state.datamodel);
  for (const data of machine.dataElements) {
    if (!seeded.has(data.id)) seeded.set(data.id, Undefined);
  }
  const rootData = new Set(stateAt(machine, 0).data);
  const dIndexes =
    machine.binding === "early" ? machine.dataElements.map((data) => data.dIndex) : [...rootData];
  const toBind = dIndexes.filter(
    (dIndex) => !(rootData.has(dIndex) && hostIds.has(dataAt(machine, dIndex).id)),
  );
  return bindAll({ ...state, datamodel: seeded }, toBind);
}

/**
 * `enterStates`' per-state `initializeDataModel`: binds a state's own
 * `<data>` under late binding. Nothing under early binding, where every
 * `<data>` bound when the chart started, and nothing for the root, whose own
 * `<data>` bound then too; binding it again would overwrite a value the host
 * supplied.
 */
export function enterStateData<S extends BindingState>(state: S, stateIndex: number): S {
  const { machine } = state;
  if (machine.binding === "early" || stateIndex === 0) return state;
  return bindAll(state, stateAt(machine, stateIndex).data);
}

// Every listed `<data>` in ascending order against one context built before
// any binds.
function bindAll<S extends BindingState>(state: S, dIndexes: readonly number[]): S {
  if (dIndexes.length === 0) return state;
  const context = contextOf(state);
  let current = state;
  for (const dIndex of [...dIndexes].sort((a, b) => a - b)) {
    current = bindValue(current, context, dataAt(state.machine, dIndex));
  }
  return current;
}

// One `<data>`'s value, or its failure raised with the id left as it was.
function bindValue<S extends BindingState>(
  state: S,
  context: EvaluationContext,
  data: CompiledData,
): S {
  const { value } = data;
  if (value.kind === "invalid") {
    return raiseBindingError(state, data.dIndex, {
      kind: "compile_error",
      source: value.source,
      message: value.message,
    });
  }
  if (value.kind === "src") {
    return raiseBindingError(state, data.dIndex, { kind: "src", src: value.src });
  }
  const outcome = evaluate(context, value);
  if (!outcome.ok) return raiseBindingError(state, data.dIndex, outcome.reason);
  return { ...state, datamodel: new Map(state.datamodel).set(data.id, outcome.value) };
}

function raiseBindingError<S extends BindingState>(
  state: S,
  dIndex: number,
  reason: ExecutionReason,
): S {
  const event = executionError({ kind: "data", dIndex }, state, reason);
  return { ...state, internalQueue: [...state.internalQueue, event] };
}

function dataAt(machine: Machine, dIndex: number): CompiledData {
  const data = machine.dataElements[dIndex];
  if (data === undefined) throw new Error(`no data at index ${dIndex}`);
  return data;
}

function contextOf(state: BindingState): EvaluationContext {
  const states: ActiveStates = {
    indexOf: (stateId) => state.machine.idToIndex.get(stateId),
    configuration: state.configuration,
  };
  return evaluationContext(state.datamodel, states);
}
