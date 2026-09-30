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

/** The compiled chart. */
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
