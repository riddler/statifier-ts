// The state family and what hangs off a state: `<state>`, `<parallel>`,
// `<final>` and `<history>` as one node with a kind, `<initial>`,
// `<transition>`, and the `<onentry>`, `<onexit>` and `<finalize>` blocks.

import type { Location } from "../xml/parser.js";
import type { Datamodel, Donedata } from "./data.js";
import type { Invoke } from "./invoke.js";
import type { AttributeLocations, ContentNode, StateKind } from "./scxml.js";

/**
 * A state of any kind. One node covers the four kinds so a walk over every
 * state needs no per-kind dispatch; the slots a kind does not use stay empty.
 */
export interface State {
  readonly kind: StateKind;
  readonly location: Location;
  /** The `id` attribute. */
  readonly id: string | null;
  /** The `initial` attribute, split on whitespace. */
  readonly initial: readonly string[];
  /** The `<initial>` child; the last one written when there are several. */
  readonly initialElement: Initial | null;
  /** The child states, in source order. */
  readonly states: readonly State[];
  /** The child transitions, in source order. */
  readonly transitions: readonly Transition[];
  /** One block per `<onentry>` element, in source order, never flattened. */
  readonly onentry: readonly Block[];
  /** One block per `<onexit>` element, in source order, never flattened. */
  readonly onexit: readonly Block[];
  /**
   * A history state's `type`: `shallow` when absent or not one of the two.
   * Null on every other kind.
   */
  readonly historyType: "shallow" | "deep" | null;
  /** The `<donedata>` child; the last one written when there are several. */
  readonly donedata: Donedata | null;
  /** The `<datamodel>` child; the last one written when there are several. */
  readonly datamodelElement: Datamodel | null;
  /** The `<invoke>` children, in source order. */
  readonly invoke: readonly Invoke[];
  readonly attributeLocations: AttributeLocations<"id" | "initial" | "type">;
}

/**
 * An `<initial>` element. It holds however many transitions were written,
 * zero and two included; the count is the validator's rule.
 */
export interface Initial {
  readonly location: Location;
  readonly transitions: readonly Transition[];
}

/** A `<transition>`. */
export interface Transition {
  readonly location: Location;
  /** The `event` attribute, split on whitespace. */
  readonly event: readonly string[];
  /** The `target` attribute, split on whitespace. */
  readonly target: readonly string[];
  /** The `cond` attribute, uncompiled. */
  readonly cond: string | null;
  /** The `type` attribute: `external` when absent or not one of the two. */
  readonly type: "internal" | "external";
  /**
   * The executable content, unwrapped: a transition has no block element of
   * its own to give a block a location.
   */
  readonly content: readonly ContentNode[];
  readonly attributeLocations: AttributeLocations<"event" | "target" | "cond" | "type">;
}

/**
 * The executable content of one `<onentry>`, `<onexit>` or `<finalize>`
 * element. Each element is its own block so an error in one does not stop
 * the next.
 */
export interface Block {
  readonly location: Location;
  readonly content: readonly ContentNode[];
}
