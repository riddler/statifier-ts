// Data and payloads: `<datamodel>`, `<data>`, `<donedata>`, `<param>` and
// `<content>`.

import type { Location } from "../xml/parser.js";
import type { AttributeLocations } from "./scxml.js";

/** A `<datamodel>`: its `<data>` children in source order. */
export interface Datamodel {
  readonly location: Location;
  readonly data: readonly Data[];
}

/** A `<data>`. `id` is required, so a `<data>` without one does not lower. */
export interface Data {
  readonly location: Location;
  readonly id: string;
  /** The `expr` attribute, uncompiled. */
  readonly expr: string | null;
  /** The `src` attribute, as written. */
  readonly src: string | null;
  /**
   * The element's own text children joined, untrimmed: the in-line value.
   * Only the parser's line-break fold has touched it.
   */
  readonly text: string;
  readonly attributeLocations: AttributeLocations<"id" | "expr" | "src">;
}

/**
 * A `<donedata>`. Both slots are built whatever was written; that at most
 * one of them may be used is the validator's rule.
 */
export interface Donedata {
  readonly location: Location;
  /** The `<content>` child; the last one written when there are several. */
  readonly content: Content | null;
  readonly params: readonly Param[];
}

/**
 * A `<param>`. `name` is required, so a `<param>` without one does not
 * lower. The `location` attribute is `paramLocation`, because `location` is
 * the element's own span on every node.
 */
export interface Param {
  readonly location: Location;
  readonly name: string;
  /** The `expr` attribute, uncompiled. */
  readonly expr: string | null;
  /** The `location` attribute, uncompiled. */
  readonly paramLocation: string | null;
  readonly attributeLocations: AttributeLocations<"name" | "expr" | "location">;
}

/**
 * A `<content>`. Its text is its payload, so text inside it is never stray.
 * An element inside it is not lowered at all: `markup` is the source text
 * from the first to the last non-blank child, sliced verbatim with no line
 * break folded, and a child from a foreign namespace is kept there as
 * opaque content.
 */
export interface Content {
  readonly location: Location;
  /** The `expr` attribute, uncompiled. */
  readonly expr: string | null;
  /** The element's own text children joined, untrimmed. */
  readonly text: string;
  /** The markup children as source text; null when there is no element child. */
  readonly markup: string | null;
  /** The span `markup` was sliced from; null exactly when `markup` is. */
  readonly markupLocation: Location | null;
  readonly attributeLocations: AttributeLocations<"expr">;
}
