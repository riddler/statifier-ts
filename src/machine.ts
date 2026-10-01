// The Machine: the compiled chart the interpreter runs.
//
// Ported from the reference's compiled structs (`Statifier.Machine` and the
// modules under `Statifier.Machine.*` in statifier-ex at v2.9.0). The
// compiler is the only producer, and a Machine exists only when every
// expression that gates loading compiled, so the interpreter never meets a
// chart it cannot run.
//
// Every state is interned to an index in document order. Index 0 is the
// `<scxml>` root, synthesized from the document's own fields: the
// specification treats `<scxml>` as a state when it computes a transition's
// domain, and giving it an index removes the special case. A state's
// descendants are exactly the indexes after its own up to and including its
// `last`, so ancestry and document order are integer comparisons with no
// table beside them.
//
// Transitions and `<data>` elements have their own dense index spaces,
// `tIndex` and `dIndex`, assigned in document order. Executable content
// carries its `cIndex` on each node (the index an `error.execution` names)
// and sits inline in the block, transition, branch or loop body that holds
// it, which is the shape the block runner takes.
//
// Field names follow the reference's, spelled in camel case; an absent value
// is null where the reference has nil.

import type { ContentNode, Invalid } from "./core/content.js";
import type { CompiledProgram, Expr } from "./datamodel.js";
import type { AttributeLocations, StateKind } from "./document/scxml.js";
import type { Location } from "./xml/parser.js";

/** A compiled state. The root at index 0 has kind `scxml`, no id and no parent. */
export interface CompiledState {
  readonly index: number;
  readonly id: string | null;
  readonly kind: "scxml" | StateKind;
  /** The parent's index; null only for the root. */
  readonly parent: number | null;
  /** The highest index in this state's subtree: its descendants are `index + 1` to `last`. */
  readonly last: number;
  /** The direct children in document order, history states included. */
  readonly children: readonly number[];
  /**
   * The states a default entry enters: the `initial` attribute, else the
   * `<initial>` element's target, else the first child in document order.
   * Empty for every kind but a compound `state` and the root.
   */
  readonly initial: readonly number[];
  readonly historyType: "shallow" | "deep" | null;
  /** The direct children that are history states. */
  readonly historyChildren: readonly number[];
  /** The selectable transitions' `tIndex`es, in document order. Empty for a history state. */
  readonly transitions: readonly number[];
  readonly onentry: readonly CompiledBlock[];
  readonly onexit: readonly CompiledBlock[];
  /** The `<initial>` element's transition, or null when none was written. */
  readonly initialTransition: number | null;
  /** A history state's default transition, or null. */
  readonly historyDefault: number | null;
  readonly donedata: CompiledDonedata | null;
  /** The `dIndex`es of the `<data>` this state's own `<datamodel>` declares. */
  readonly data: readonly number[];
  readonly invoke: readonly CompiledInvoke[];
  readonly location: Location;
  readonly attributeLocations: AttributeLocations<string>;
}

/** One `<onentry>`, `<onexit>` or `<finalize>` block. */
export interface CompiledBlock {
  readonly location: Location;
  readonly content: readonly ContentNode[];
}

/** A compiled transition. */
export interface CompiledTransition {
  readonly tIndex: number;
  /** The index of the state that holds it. */
  readonly source: number;
  readonly targets: readonly number[];
  /** Each event descriptor split on its dots: `a.b c` is `[["a", "b"], ["c"]]`. */
  readonly events: readonly (readonly string[])[];
  /** The compiled condition, or null when none was written. */
  readonly cond: Expr | null;
  readonly type: "internal" | "external";
  readonly content: readonly ContentNode[];
  readonly location: Location;
  /** Where the condition was written; null exactly when `cond` is. */
  readonly condLocation: Location | null;
  readonly attributeLocations: AttributeLocations<string>;
}

/**
 * A `<data>` element's value: a compiled or literal expression, an
 * expression that did not compile (it fails when the datamodel binds it), or
 * a `src` the host resolves.
 */
export type DataValue = Expr | Invalid | { readonly kind: "src"; readonly src: string };

/** A compiled `<data>` element. */
export interface CompiledData {
  readonly dIndex: number;
  readonly id: string;
  readonly value: DataValue;
  readonly location: Location;
  /** Where the value was written: the attribute when one was, else the element. */
  readonly valueLocation: Location;
}

/** A compiled `<param>`, or one `namelist` entry. */
export interface CompiledParam {
  readonly name: string;
  /** Whether the value came from an `expr` or from a `location`. */
  readonly kind: "expr" | "location";
  /** Only a `namelist` entry can hold an expression that did not compile. */
  readonly expr: Expr | Invalid;
  readonly exprLocation: Location;
  readonly location: Location;
}

/** A final state's compiled `<donedata>`: its `<content>` or its `<param>`s. */
export interface CompiledDonedata {
  readonly location: Location;
  readonly expr: Expr | null;
  readonly exprLocation: Location | null;
  readonly params: readonly CompiledParam[];
}

/** A compiled `<invoke>`. Nothing drives an invocation yet. */
export interface CompiledInvoke {
  /** Its position among its state's `<invoke>` elements. */
  readonly index: number;
  readonly location: Location;
  readonly type: Expr | null;
  readonly src: Expr | null;
  readonly id: string | null;
  readonly idlocation: string | null;
  readonly namelist: readonly CompiledParam[];
  readonly params: readonly CompiledParam[];
  readonly content: Expr | null;
  readonly autoforward: boolean;
  readonly finalize: CompiledBlock | null;
  readonly attributeLocations: AttributeLocations<string>;
}

/**
 * The compiled chart.
 *
 * Opaque and unstable: it is exported only because a `Chart` carries one. A
 * host reads none of its members and codes against none of them; its shape
 * changes without notice until a release fixes it. ADR-0002 (the core
 * contract) records this.
 */
export interface Machine {
  /** Every state by index, the root at 0, in document order. */
  readonly states: readonly CompiledState[];
  /** The index of every state written with a non-empty id. */
  readonly idToIndex: ReadonlyMap<string, number>;
  /** Every transition by `tIndex`. */
  readonly transitions: readonly CompiledTransition[];
  /** Every `<data>` element by `dIndex`, the root's own first. */
  readonly dataElements: readonly CompiledData[];
  /** The `<script>` children of `<scxml>`, run once when the chart starts. */
  readonly globalScripts: readonly (CompiledProgram | Invalid)[];
  readonly name: string | null;
  readonly datamodel: string | null;
  readonly binding: "early" | "late";
  readonly location: Location;
}

// ---------------------------------------------------------------------------
// Topology queries
// ---------------------------------------------------------------------------
//
// The reference's `Statifier.Machine` query functions the interpreter reads,
// one function each. Every answer is an integer comparison or a walk up the
// parents: a state's subtree is the index range from its own index to its
// `last`.

/** The state at `index` (`Machine.at/2`). An index the Machine does not hold is a bug here. */
export function stateAt(machine: Machine, index: number): CompiledState {
  const state = machine.states[index];
  if (state === undefined) throw new Error(`no state at index ${index}`);
  return state;
}

/** The transition at `tIndex` (`Machine.transition/2`). */
export function transitionAt(machine: Machine, tIndex: number): CompiledTransition {
  const transition = machine.transitions[tIndex];
  if (transition === undefined) throw new Error(`no transition at index ${tIndex}`);
  return transition;
}

/**
 * Whether `descendant` is a descendant of `ancestor` (`Machine.descendant?/3`,
 * the specification's `isDescendant`). Proper: a state is not its own
 * descendant, which is what keeps a transition's domain out of its own exit
 * set and makes the least common compound ancestor reject a candidate that is
 * itself in the list.
 */
export function isDescendant(machine: Machine, descendant: number, ancestor: number): boolean {
  return ancestor < descendant && descendant <= stateAt(machine, ancestor).last;
}

/** Whether the state has no children (`Machine.atomic?/2`). A final state is atomic. */
export function isAtomic(machine: Machine, index: number): boolean {
  return stateAt(machine, index).children.length === 0;
}

/**
 * Whether the state is compound (`Machine.compound?/2`): a `state` or the
 * root with at least one child. A parallel is never compound: it enters every
 * region at once and has no default child to enter.
 */
export function isCompound(machine: Machine, index: number): boolean {
  const state = stateAt(machine, index);
  return (state.kind === "state" || state.kind === "scxml") && state.children.length > 0;
}

/** Whether the state is a `<parallel>` (`Machine.parallel?/2`). */
export function isParallel(machine: Machine, index: number): boolean {
  return stateAt(machine, index).kind === "parallel";
}

/** Whether the state is a `<final>` (`Machine.final?/2`). */
export function isFinal(machine: Machine, index: number): boolean {
  return stateAt(machine, index).kind === "final";
}

/**
 * The state's child states in document order, history pseudo-states left
 * out (`Machine.child_states/2`, the specification's `getChildStates`): the
 * regions of a parallel, the children of a compound.
 */
export function childStates(machine: Machine, index: number): number[] {
  const state = stateAt(machine, index);
  return state.children.filter((child) => !state.historyChildren.includes(child));
}

/** Whether the state is a history pseudo-state (`Machine.history?/2`). */
export function isHistory(machine: Machine, index: number): boolean {
  return stateAt(machine, index).kind === "history";
}

/**
 * The state's proper ancestors, nearest first and the root last
 * (`Machine.proper_ancestors/2`, the specification's `getProperAncestors`
 * with no bound). The state itself is not among them.
 */
export function properAncestors(machine: Machine, index: number): number[] {
  const ancestors: number[] = [];
  let parent = stateAt(machine, index).parent;
  while (parent !== null) {
    ancestors.push(parent);
    parent = stateAt(machine, parent).parent;
  }
  return ancestors;
}

/**
 * The least common compound ancestor of the states in `indexes`
 * (`Machine.lcca/2`, the specification's `findLCCA`): the nearest proper
 * ancestor of the first index that is compound and has every index in the
 * list as a proper descendant. A parallel never qualifies. The root
 * qualifies for any list whose first index is not the root itself; null
 * answers the case where no ancestor qualifies, as the reference answers nil.
 */
export function lcca(machine: Machine, indexes: readonly number[]): number | null {
  const [first] = indexes;
  if (first === undefined) return null;
  for (const candidate of properAncestors(machine, first)) {
    if (!isCompound(machine, candidate)) continue;
    if (indexes.every((index) => isDescendant(machine, index, candidate))) return candidate;
  }
  return null;
}

/** The indexes in document order (`Machine.document_order/2`): ascending, as a new list. */
export function documentOrder(indexes: Iterable<number>): number[] {
  return [...indexes].sort((a, b) => a - b);
}

/**
 * The indexes in exit order (`Machine.exit_order/2`): descending, as a new
 * list, so a descendant always leaves before its ancestors.
 */
export function exitOrder(indexes: Iterable<number>): number[] {
  return [...indexes].sort((a, b) => b - a);
}
