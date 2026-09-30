// `<invoke>`, lowered to its typed node. Nothing drives an invocation yet;
// the node is complete so the driver that does needs no second lowering
// pass.

import type { Location } from "../xml/parser.js";
import type { Content, Param } from "./data.js";
import type { AttributeLocations } from "./scxml.js";
import type { Block } from "./states.js";

/**
 * An `<invoke>`. Each mutually exclusive pair the specification names
 * (`type` and `typeexpr`, `src` and `srcexpr`, `id` and `idlocation`,
 * `namelist` and a `<param>`, a source and a `<content>`) can be written at
 * once and lowers as written; reporting the pair is the validator's rule.
 */
export interface Invoke {
  readonly location: Location;
  readonly type: string | null;
  readonly typeexpr: string | null;
  readonly src: string | null;
  readonly srcexpr: string | null;
  readonly id: string | null;
  readonly idlocation: string | null;
  /** The `namelist` attribute, split on whitespace. */
  readonly namelist: readonly string[];
  /** The `autoforward` attribute: false when absent or not `true`. */
  readonly autoforward: boolean;
  readonly params: readonly Param[];
  /** The `<content>` child; the last one written when there are several. */
  readonly content: Content | null;
  /**
   * The `<finalize>` child, or null when none was written. A written empty
   * `<finalize/>` is an empty block, not null.
   */
  readonly finalize: Block | null;
  readonly attributeLocations: AttributeLocations<
    "type" | "typeexpr" | "src" | "srcexpr" | "id" | "idlocation" | "namelist" | "autoforward"
  >;
}
