// A test-only driver stub: just enough of the interpreter loop to drive a
// chart through selection, exit and entry, and read its configuration.
//
// This is a test harness, not the interpreter. The interpreter's own loop -
// the counters as the reference keeps them, the round budget, the running
// flag's terminal effects, the datamodel's initialization - replaces it. It
// is built only from the modules on main and exit and entry, and it follows
// Appendix D's shape: start enters the root's initial states; each event is
// one selection, then a microstep - exit, the transitions' content, enter -
// then the eventless-and-internal loop until the configuration is stable.
//
// The one step it takes on the datamodel's behalf is binding the root's
// `<data>` once before the first entry, each value evaluated as written.

import { Undefined, type Value } from "@riddler/predicator";
import { compile } from "../../src/compiler.js";
import { executeBlock } from "../../src/core/content.js";
import {
  type ExitEntryEffect,
  type ExitEntryState,
  enterStates,
  exitStates,
} from "../../src/core/exit-entry.js";
import { selectEventlessTransitions, selectTransitions } from "../../src/core/selection.js";
import { INITIAL_SEND_STATE } from "../../src/core/send.js";
import {
  type Event,
  evaluate,
  evaluationContext,
  initialDatamodel,
  putEvent,
} from "../../src/datamodel.js";
import {
  type CompiledTransition,
  type DataValue,
  isAtomic,
  type Machine,
  stateAt,
  transitionAt,
} from "../../src/machine.js";

/** A running chart: the state, and every effect produced so far, in order. */
export interface Stub {
  readonly state: ExitEntryState;
  readonly effects: readonly ExitEntryEffect[];
}

/** Compiles a chart, or throws naming why it did not compile. */
export function machineOf(source: string): Machine {
  const result = compile(source);
  if (!result.ok) throw new Error(`chart does not compile: ${JSON.stringify(result.errors)}`);
  return result.chart.machine;
}

/** Starts a chart: binds the root's data, enters the initial states, runs to stability. */
export function start(source: string): Stub {
  const machine = machineOf(source);
  let datamodel = initialDatamodel(new Map(), "stub", machine.name ?? undefined);
  for (const dIndex of stateAt(machine, 0).data) {
    const data = machine.dataElements[dIndex];
    if (data === undefined) throw new Error(`no data at ${dIndex}`);
    datamodel = new Map(datamodel).set(data.id, bindValue(machine, datamodel, data.value));
  }
  const state: ExitEntryState = {
    machine,
    configuration: new Set(),
    historyValues: new Map(),
    datamodel,
    internalQueue: [],
    macrostep: 0,
    microstep: 0,
    round: 0,
    sends: INITIAL_SEND_STATE,
    statesToInvoke: new Set(),
    activeInvocations: new Map(),
    running: true,
  };
  const entered = enterStates(state, [initialTransition(machine)]);
  return macrostep({ state: entered.state, effects: entered.effects });
}

/** Sends one external event, then runs to stability. A stopped chart takes nothing. */
export function send(stub: Stub, name: string): Stub {
  if (!stub.state.running) return stub;
  const event: Event = { name, type: "external", data: Undefined };
  return macrostep(react(stub, event));
}

/** The ids of the active atomic states, sorted: what the corpus compares. */
export function activeLeafIds(stub: Stub): string[] {
  const { machine, configuration } = stub.state;
  return [...configuration]
    .filter((index) => isAtomic(machine, index))
    .map((index) => stateAt(machine, index).id ?? `#${index}`)
    .sort();
}

// The root's initial states as a transition from the root, as the reference
// synthesizes one when the document wrote no `<initial>`.
function initialTransition(machine: Machine): CompiledTransition {
  const root = stateAt(machine, 0);
  if (root.initialTransition !== null) return transitionAt(machine, root.initialTransition);
  return {
    tIndex: -1,
    source: 0,
    targets: root.initial,
    events: [],
    cond: null,
    type: "external",
    content: [],
    location: machine.location,
    condLocation: null,
    attributeLocations: {},
  };
}

function bindValue(
  machine: Machine,
  datamodel: ReadonlyMap<string, Value>,
  value: DataValue,
): Value {
  if (value.kind !== "static" && value.kind !== "compiled") return Undefined;
  const context = evaluationContext(datamodel, {
    indexOf: (id) => machine.idToIndex.get(id),
    configuration: new Set(),
  });
  const outcome = evaluate(context, value);
  return outcome.ok ? outcome.value : Undefined;
}

// `_event` set, then one selection and, when anything fired, a microstep.
function react(stub: Stub, event: Event): Stub {
  const withEvent = { ...stub.state, datamodel: putEvent(stub.state.datamodel, event) };
  const selected = selectTransitions(withEvent, event);
  return microstep({ state: selected.state, effects: stub.effects }, selected.transitions);
}

// The eventless transitions until none fire, then one internal event, until
// the internal queue is empty too.
function macrostep(stub: Stub): Stub {
  let current = stub;
  for (;;) {
    if (!current.state.running) return current;
    const eventless = selectEventlessTransitions(current.state);
    if (eventless.transitions.length > 0) {
      current = microstep({ ...current, state: eventless.state }, eventless.transitions);
      continue;
    }
    const [next, ...rest] = eventless.state.internalQueue;
    if (next === undefined) return { ...current, state: eventless.state };
    current = react({ ...current, state: { ...eventless.state, internalQueue: rest } }, next);
  }
}

// Exit, the transitions' own content in order, enter.
function microstep(stub: Stub, transitions: readonly CompiledTransition[]): Stub {
  if (transitions.length === 0) return stub;
  const effects = [...stub.effects];
  const counted = { ...stub.state, microstep: stub.state.microstep + 1 };
  const exited = exitStates(counted, transitions);
  effects.push(...exited.effects);
  let state = exited.state;
  for (const t of transitions) {
    const context = evaluationContext(state.datamodel, {
      indexOf: (id) => state.machine.idToIndex.get(id),
      configuration: state.configuration,
    });
    const owner = { kind: "transition", tIndex: t.tIndex } as const;
    const outcome = executeBlock(context, t.content, { owner, counters: state }, state.sends);
    effects.push(...outcome.effects);
    state = {
      ...state,
      datamodel: outcome.context.data,
      sends: outcome.sends,
      internalQueue: [...state.internalQueue, ...outcome.raised],
    };
  }
  const entered = enterStates(state, transitions);
  effects.push(...entered.effects);
  return { state: entered.state, effects };
}
