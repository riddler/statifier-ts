// The typed chart: what lowering produces from the parser's element tree, and
// what the validator and the compiler read.
//
// Ported from the reference implementation's document structs
// (`Statifier.Document` and the modules under `Statifier.Document.*` in
// statifier-ex at v2.9.0). Field names follow the reference's, spelled in
// camel case; an absent value is `null` where the reference has `nil`, and an
// atom is a string literal. The shape is the reference's in every other
// respect, so the compiler ported after it reads the same fields.
//
// Three properties hold everywhere under this directory:
//
// - Expressions are raw. `cond`, `expr`, `array` and every other attribute a
//   datamodel will evaluate are the exact source text the author wrote,
//   uncompiled. Compiling them is the compiler's job, once, and nothing here
//   imports the expression language.
// - The tree is pre-validation. It can hold shapes the validator exists to
//   report (a history with a stray child transition, a send with both `event`
//   and `eventexpr`), because lowering builds what is written and leaves the
//   rules to the validator.
// - `attributeLocations` records only what was written. Every node with
//   source attributes carries a map from attribute name to the span of that
//   attribute's value (the text inside the quotes), and a key is present
//   exactly when the author wrote the attribute. Lowering applies defaults
//   (`binding` is `early`, a transition's `type` is `external`, a history's
//   `type` is `shallow`), so a field's value alone cannot say whether the
//   author wrote it; the map can, and it is where a diagnostic underlines.
//
// `<scxml>` is its own node rather than a state of a special kind, as in the
// reference: its attributes are not state attributes, and the compiler
// synthesizes its root state from these fields.

import type { Location } from "../xml/parser.js";
import type { Datamodel } from "./data.js";
import type { Assign, Cancel, Foreach, If, Log, Raise, Script, Send } from "./executable.js";
import type { State } from "./states.js";

/**
 * Value spans of the attributes an element wrote, keyed by attribute name. A
 * key is present only when the attribute was written in the source.
 */
export type AttributeLocations<K extends string> = Readonly<Partial<Record<K, Location>>>;

/** The executable content a block, a transition, a branch or a loop body holds. */
export type ContentNode = Raise | Log | Assign | If | Foreach | Script | Send | Cancel;

/**
 * What a state node is: the element that produced it. `<initial>` is not a
 * kind (it is a slot on its parent, not a state a transition can target).
 */
export type StateKind = "state" | "parallel" | "final" | "history";

/** The `<scxml>` root. */
export interface Document {
  readonly location: Location;
  /** The `name` attribute. */
  readonly name: string | null;
  /** The `version` attribute. */
  readonly version: string | null;
  /** The `xmlns` attribute as written; it never resolves a prefix. */
  readonly xmlns: string | null;
  /**
   * The namespace the root element's name resolves to. It differs from
   * `xmlns` for a prefixed root such as `<s:scxml xmlns:s="...">`, where
   * `xmlns` is null and this is the declared namespace.
   */
  readonly namespace: string | null;
  /** The `datamodel` attribute. */
  readonly datamodel: string | null;
  /** The `binding` attribute; `early` when absent or not one of the two. */
  readonly binding: "early" | "late";
  /** The `initial` attribute, split on whitespace. */
  readonly initial: readonly string[];
  /** The `<state>`, `<parallel>` and `<final>` children, in source order. */
  readonly states: readonly State[];
  /** The `<datamodel>` child; the last one written when there are several. */
  readonly datamodelElement: Datamodel | null;
  /** Every `<script>` that is a direct child of `<scxml>`, in source order. */
  readonly scripts: readonly Script[];
  readonly attributeLocations: AttributeLocations<
    "initial" | "name" | "datamodel" | "binding" | "version" | "xmlns"
  >;
}
