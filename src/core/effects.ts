// The datamodel effects and the trace effects.
//
// Ported from the reference's effect vocabulary (the modules
// `Statifier.Effect.DatamodelChange`, `Statifier.Effect.DatamodelInit` and
// `Statifier.Effect.Trace.*` in statifier-ex at v2.9.0). Each is plain data
// carrying the `macrostep`, `microstep` and `round` counters, and names a
// state, a transition or a content node by its index, never by the compiled
// node.
//
// The two datamodel effects are core effects: every successful write an
// `<assign>` or a `<data>` binding makes answers a `datamodel_change`, and
// starting a chart answers one `datamodel_init`, whether or not tracing is
// on. Together they describe the datamodel from its starting values onward.
//
// The trace effects are emitted only when the position's `trace` flag is
// set, and are then ordinary members of the same effect list, in the order
// they were produced; with the flag clear nothing is built. Every one has
// the reference's tag, `trace`, as its `kind`, and names which trace it is
// in `trace`, spelled as the reference's telemetry spells it. A
// configuration a trace carries is the full configuration, ancestors
// included, in document order.
//
// Not emitted here: the reference's `conds_evaluated` trace, which its
// transition selection emits, and the `datamodel_change` its `<send
// idlocation>`, `<invoke idlocation>` and empty `<finalize>` writes answer.

import type { Value } from "@riddler/predicator";
import type { Counters, Event, Owner } from "../datamodel.js";

// ---------------------------------------------------------------------------
// The datamodel effects
// ---------------------------------------------------------------------------

/**
 * One successful datamodel write. `locationPath` is the resolved path written
 * and `locationSource` the text the author wrote; `newValue` is what was
 * written and `priorValue` what stood there before, undefined when nothing
 * did. A write an `<assign>` made names its node by `cIndex` and the block it
 * ran in by `owner`; a `<data>` binding names its `dIndex`, and has neither.
 */
export interface DatamodelChange {
  readonly kind: "datamodel_change";
  readonly locationPath: readonly (string | number)[];
  readonly locationSource: string;
  readonly newValue: Value;
  readonly priorValue: Value;
  readonly dIndex: number | null;
  readonly cIndex: number | null;
  readonly owner: Owner | null;
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
}

/**
 * The datamodel as a chart starts, answered once: every root the host
 * supplied, the system variables, and every declared `<data>` id bound to
 * undefined, before any `<data>` value is bound. Each binding after it
 * answers its own `datamodel_change`.
 */
export interface DatamodelInit {
  readonly kind: "datamodel_init";
  readonly datamodel: Readonly<Record<string, Value>>;
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
}

// ---------------------------------------------------------------------------
// The trace effects
// ---------------------------------------------------------------------------

interface TraceCounters {
  readonly kind: "trace";
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
}

/** An event was taken: from the host (`external`) or from the internal queue. */
export interface TraceEventDequeued extends TraceCounters {
  readonly trace: "event_dequeued";
  readonly event: Event;
  readonly from: "external" | "internal";
}

/**
 * A selection returned, the empty selection included: the transitions it
 * chose, in the order chosen, and the event it matched, or null for an
 * eventless selection.
 */
export interface TraceTransitionsSelected extends TraceCounters {
  readonly trace: "transitions_selected";
  readonly tIndexes: readonly number[];
  readonly event: Event | null;
}

/**
 * The states about to exit, in exit order, emitted before any exits; the
 * counters are those at that boundary and `configuration` is what stands once
 * every state in `indexes` has left.
 */
export interface TraceExitSet extends TraceCounters {
  readonly trace: "exit_set";
  readonly indexes: readonly number[];
  readonly configuration: readonly number[];
}

/**
 * The states about to enter, in entry order, emitted before any enters; the
 * counters are those at that boundary and `configuration` is what stands once
 * every state in `indexes` has joined.
 */
export interface TraceEntrySet extends TraceCounters {
  readonly trace: "entry_set";
  readonly indexes: readonly number[];
  readonly configuration: readonly number[];
}

/** The block a `content_executed` trace names: a block's owner, or a `<script>` child of `<scxml>`. */
export type ContentOwner = Owner | { readonly kind: "global_script"; readonly index: number };

/**
 * A block of executable content ran: the nodes of the block that ran, in
 * order, the one that failed included. An empty block answers no nodes; a
 * `<script>` child of `<scxml>` has no node index and answers none either.
 */
export interface TraceContentExecuted extends TraceCounters {
  readonly trace: "content_executed";
  readonly owner: ContentOwner;
  readonly cIndexes: readonly number[];
}

/** A macrostep reached a stable configuration with the chart still running. */
export interface TraceMacrostepStable extends TraceCounters {
  readonly trace: "macrostep_stable";
  readonly configuration: readonly number[];
}

/**
 * The chart stopped: the `done` effect's donedata, its error and the
 * configuration as it stood when the chart stopped, emitted just before it.
 */
export interface TraceDone extends TraceCounters {
  readonly trace: "done";
  readonly donedata: Value;
  readonly donedataError: Value | null;
  readonly configuration: readonly number[];
}

/**
 * The invoke pass ran: the states it walked, in entry order, a state that
 * owns no `<invoke>` included, and the ids of the invocations it left live,
 * in the order it started them.
 */
export interface TraceInvokePass extends TraceCounters {
  readonly trace: "invoke_pass";
  readonly stateIndexes: readonly number[];
  readonly invokeIds: readonly string[];
}

/**
 * The finalize and autoforward pass ran for an external event: the live
 * invocations whose id the event carried, and those it was forwarded to, in
 * the pass's order. Emitted every time, both lists empty included.
 */
export interface TraceFinalizeAutoforward extends TraceCounters {
  readonly trace: "finalize_autoforward";
  readonly event: Event;
  readonly finalized: readonly string[];
  readonly forwarded: readonly string[];
}

/** A trace effect. */
export type Trace =
  | TraceEventDequeued
  | TraceTransitionsSelected
  | TraceExitSet
  | TraceContentExecuted
  | TraceEntrySet
  | TraceMacrostepStable
  | TraceDone
  | TraceInvokePass
  | TraceFinalizeAutoforward;

/** The fields of one trace, without the tag and the counters every trace carries. */
export type TraceFields<T extends Trace> = Omit<T, "kind" | "macrostep" | "microstep" | "round">;

/**
 * The trace gate: one trace stamped from `counters` when `trace` is set,
 * nothing otherwise. `fields` is a function so that, with tracing off,
 * nothing a trace would carry is computed.
 */
export function traced<T extends Trace>(
  trace: boolean | undefined,
  counters: Counters,
  fields: () => TraceFields<T>,
): T[] {
  if (trace !== true) return [];
  const { macrostep, microstep, round } = counters;
  return [{ kind: "trace", ...fields(), macrostep, microstep, round } as T];
}
