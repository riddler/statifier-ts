// Executable content: `<raise>`, `<log>`, `<assign>`, `<if>` with its
// `<elseif>` and `<else>` partitions, `<foreach>`, `<script>`, `<send>` and
// `<cancel>`. Each node carries `kind`, the element that produced it, so a
// block's content list can be read without guessing.

import type { Location } from "../xml/parser.js";
import type { Content, Param } from "./data.js";
import type { AttributeLocations, ContentNode } from "./scxml.js";

/** A `<raise>`. `event` is required and is one name, never split. */
export interface Raise {
  readonly kind: "raise";
  readonly location: Location;
  readonly event: string;
  readonly attributeLocations: AttributeLocations<"event">;
}

/** A `<log>`. */
export interface Log {
  readonly kind: "log";
  readonly location: Location;
  readonly label: string | null;
  /** The `expr` attribute, uncompiled. */
  readonly expr: string | null;
  readonly attributeLocations: AttributeLocations<"label" | "expr">;
}

/**
 * An `<assign>`. As in the reference, `location` is the required `location`
 * ATTRIBUTE (the path being assigned, uncompiled) and the element's own span
 * is `nodeLocation`: the rename keeps the path and the span from being
 * mistaken for each other.
 *
 * `expr`, `text` and `markup` can all be present at once; that only one
 * value source may be used is the validator's rule. `markup` is the source
 * text of the element children, sliced as `<content>`'s is.
 */
export interface Assign {
  readonly kind: "assign";
  readonly location: string;
  readonly nodeLocation: Location;
  /** The `expr` attribute, uncompiled. */
  readonly expr: string | null;
  /** The element's own text children joined, untrimmed. */
  readonly text: string;
  readonly markup: string | null;
  readonly markupLocation: Location | null;
  readonly attributeLocations: AttributeLocations<"location" | "expr">;
}

/**
 * An `<if>`, as its partitions: the first branch carries the `<if>`'s own
 * `cond` and each `<elseif>` or `<else>` opens the next.
 */
export interface If {
  readonly kind: "if";
  readonly location: Location;
  readonly branches: readonly IfBranch[];
}

/**
 * One partition of an `<if>`. `location` is the span of the element that
 * opened it (the `<if>`, an `<elseif>` or an `<else>`); `cond` is null for
 * an `<else>`.
 */
export interface IfBranch {
  readonly location: Location;
  /** The branch's `cond`, uncompiled. */
  readonly cond: string | null;
  readonly content: readonly ContentNode[];
  readonly attributeLocations: AttributeLocations<"cond">;
}

/** A `<foreach>`. `array` and `item` are required. */
export interface Foreach {
  readonly kind: "foreach";
  readonly location: Location;
  /** The `array` attribute, uncompiled. */
  readonly array: string;
  readonly item: string;
  readonly index: string | null;
  readonly content: readonly ContentNode[];
  readonly attributeLocations: AttributeLocations<"array" | "item" | "index">;
}

/**
 * A `<script>`: its text is the program body. A `<script>` with `src` does
 * not lower (nothing is fetched), so a lowered script never has one.
 */
export interface Script {
  readonly kind: "script";
  readonly location: Location;
  /** The element's own text children joined, untrimmed. */
  readonly text: string;
}

/**
 * A `<send>`. Every attribute is raw and may be absent; each mutually
 * exclusive pair can be written at once and lowers as written, for the
 * validator to report.
 */
export interface Send {
  readonly kind: "send";
  readonly location: Location;
  readonly event: string | null;
  readonly eventexpr: string | null;
  readonly target: string | null;
  readonly targetexpr: string | null;
  readonly type: string | null;
  readonly typeexpr: string | null;
  readonly id: string | null;
  readonly idlocation: string | null;
  readonly delay: string | null;
  readonly delayexpr: string | null;
  /** The `namelist` attribute, split on whitespace. */
  readonly namelist: readonly string[];
  readonly params: readonly Param[];
  /** The `<content>` child; the last one written when there are several. */
  readonly content: Content | null;
  readonly attributeLocations: AttributeLocations<
    | "event"
    | "eventexpr"
    | "target"
    | "targetexpr"
    | "type"
    | "typeexpr"
    | "id"
    | "idlocation"
    | "delay"
    | "delayexpr"
    | "namelist"
  >;
}

/** A `<cancel>`. Both attributes may be written; the pair is the validator's rule. */
export interface Cancel {
  readonly kind: "cancel";
  readonly location: Location;
  readonly sendid: string | null;
  readonly sendidexpr: string | null;
  readonly attributeLocations: AttributeLocations<"sendid" | "sendidexpr">;
}
