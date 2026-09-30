// The parser's element tree in, the typed chart out.
//
// The second arrow of the pipeline, ported from the reference's lowering
// (`Statifier.Lowering` and `Statifier.Lowering.Builders` in statifier-ex at
// v2.9.0). One walk: every element is dispatched by its local name to one
// builder, each builder lowers its own children first and then places each
// lowered child into a slot of its own node, and a child its node has no slot
// for is reported as misplaced. No builder is told its parent's name.
//
// Which elements are SCXML's own is decided by the namespace the parser
// resolved, never by the name as written: an element whose name resolves to
// the SCXML namespace, or to no namespace at all, is SCXML's vocabulary, so a
// chart that declares no namespace lowers exactly as its declared twin does
// and a prefixed root (`<s:scxml xmlns:s="...">`) lowers as `<scxml>` does.
// Reporting a missing declaration is the validator's job.
//
// What is refused, each as a value with a reason token and a location:
//
// - an element in SCXML's vocabulary whose local name has no builder
//   (`unsupported_element`, naming it as written);
// - an element in any other namespace (`foreign_element`), except inside
//   `<content>` and `<assign>`, whose element children are kept as opaque
//   source text rather than lowered;
// - a root that is not `<scxml>` (`unexpected_root`);
// - a lowered child its parent has no slot for (`misplaced_element`);
// - text that is not blank where the content model has no room for it
//   (`stray_text`); `<content>`, `<data>`, `<assign>` and `<script>` hold text
//   as their payload and are exempt;
// - a required attribute that is absent (`missing_attribute`), an attribute
//   on `<else>`, which takes none (`unexpected_attribute`), and `<script
//   src>`, which the specification defines and this engine does not fetch
//   (`unsupported_attribute`).
//
// The walk never stops at the first error: every error in the tree is
// collected and answered in source order. A chart answers its typed form only
// when there are none, never a partial one.
//
// Blank means the reference's reading: text is blank when trimming Unicode
// whitespace leaves nothing, and an attribute list splits on Unicode
// whitespace other than the no-break spaces. Both sets are written out below
// rather than taken from the language's own trim, whose set differs from the
// reference's by two characters.

import type { Content, Data, Datamodel, Donedata, Param } from "./document/data.js";
import type {
  Assign,
  Cancel,
  Foreach,
  IfBranch,
  Log,
  Raise,
  Script,
  Send,
} from "./document/executable.js";
import type { Invoke } from "./document/invoke.js";
import type { AttributeLocations, ContentNode, Document, StateKind } from "./document/scxml.js";
import type { Block, Initial, State, Transition } from "./document/states.js";
import type { Element, Location } from "./xml/parser.js";

/** The SCXML namespace. */
export const SCXML_NAMESPACE = "http://www.w3.org/2005/07/scxml";

/** Why a chart could not be lowered, with the detail each reason carries. */
export type LoweringError =
  | LoweringErrorOf<"unsupported_element", { readonly name: string }>
  | LoweringErrorOf<"misplaced_element", { readonly name: string; readonly parent: string }>
  | LoweringErrorOf<"stray_text", { readonly text: string }>
  | LoweringErrorOf<"unexpected_root", { readonly name: string }>
  | LoweringErrorOf<"missing_attribute", { readonly element: string; readonly attribute: string }>
  | LoweringErrorOf<"foreign_element", { readonly name: string; readonly uri: string }>
  | LoweringErrorOf<
      "unexpected_attribute",
      { readonly element: string; readonly attribute: string }
    >
  | LoweringErrorOf<
      "unsupported_attribute",
      { readonly element: string; readonly attribute: string }
    >;

type LoweringErrorOf<R extends string, D> = {
  readonly reason: R;
  readonly message: string;
  readonly location: Location;
} & D;

/** The reason tokens a lowering error can carry. */
export type LoweringErrorReason = LoweringError["reason"];

export type LoweringResult =
  | { readonly ok: true; readonly document: Document }
  | { readonly ok: false; readonly errors: readonly LoweringError[] };

/**
 * Lowers a parsed `<scxml>` element tree into its typed chart. `source` is
 * the text the tree was parsed from; `<content>` and `<assign>` slice their
 * markup children out of it.
 *
 * Answers the chart only when the whole walk found no error; otherwise every
 * error found, in source order.
 */
export function lower(root: Element, source: string): LoweringResult {
  if (!isScxmlVocabulary(root.namespace)) {
    return { ok: false, errors: [foreignElement(root)] };
  }
  const name = localName(root.name);
  if (name !== "scxml") {
    return {
      ok: false,
      errors: [
        {
          reason: "unexpected_root",
          name,
          message: `expected the root element to be <scxml>, got ${quote(name)}`,
          location: root.location,
        },
      ],
    };
  }

  const errors: LoweringError[] = [];
  const chart = buildScxml(root, { source, errors });
  if (errors.length === 0) return { ok: true, document: chart };

  // A stable sort, so errors at one offset keep the order they were found in.
  const sorted = [...errors].sort((a, b) => a.location.startOffset - b.location.startOffset);
  return { ok: false, errors: sorted };
}

// ---------------------------------------------------------------------------
// The walk

interface Context {
  readonly source: string;
  readonly errors: LoweringError[];
}

// What a builder hands its parent: the node, tagged with the slot it goes in.
type Lowered =
  | { readonly slot: "state"; readonly node: State }
  | { readonly slot: "transition"; readonly node: Transition }
  | { readonly slot: "initial"; readonly node: Initial }
  | { readonly slot: "onentry" | "onexit" | "finalize"; readonly node: Block }
  | { readonly slot: "donedata"; readonly node: Donedata }
  | { readonly slot: "datamodel"; readonly node: Datamodel }
  | { readonly slot: "data"; readonly node: Data }
  | { readonly slot: "param"; readonly node: Param }
  | { readonly slot: "content"; readonly node: Content }
  | { readonly slot: "invoke"; readonly node: Invoke }
  | { readonly slot: "executable"; readonly node: ContentNode }
  | { readonly slot: "elseif" | "else"; readonly node: IfBranch };

// A builder answers null when it cannot build its node at all (a required
// attribute is absent); it has reported why into the context by then.
type Builder = (element: Element, ctx: Context) => Lowered | null;

const BUILDERS: ReadonlyMap<string, Builder> = new Map<string, Builder>([
  ["state", (element, ctx) => ({ slot: "state", node: buildState(element, ctx, "state") })],
  ["parallel", (element, ctx) => ({ slot: "state", node: buildState(element, ctx, "parallel") })],
  ["final", (element, ctx) => ({ slot: "state", node: buildState(element, ctx, "final") })],
  ["history", (element, ctx) => ({ slot: "state", node: buildState(element, ctx, "history") })],
  ["initial", buildInitial],
  ["transition", buildTransition],
  ["onentry", (element, ctx) => ({ slot: "onentry", node: buildBlock(element, ctx) })],
  ["onexit", (element, ctx) => ({ slot: "onexit", node: buildBlock(element, ctx) })],
  ["finalize", (element, ctx) => ({ slot: "finalize", node: buildBlock(element, ctx) })],
  ["raise", buildRaise],
  ["log", buildLog],
  ["donedata", buildDonedata],
  ["content", buildContent],
  ["param", buildParam],
  ["datamodel", buildDatamodel],
  ["data", buildData],
  ["assign", buildAssign],
  ["if", buildIf],
  ["elseif", buildElseif],
  ["else", buildElse],
  ["foreach", buildForeach],
  ["script", buildScript],
  ["invoke", buildInvoke],
  ["send", buildSend],
  ["cancel", buildCancel],
]);

// Lowers `element`'s children: each child element through its builder, each
// run of text checked for the stray-text rule. Answers the lowered children
// in source order.
function walkChildren(element: Element, ctx: Context): Lowered[] {
  const lowered: Lowered[] = [];
  for (const child of element.children) {
    if (child.type === "text") {
      if (!isBlank(child.value)) ctx.errors.push(strayText(child.value, child.location));
      continue;
    }
    if (!isScxmlVocabulary(child.namespace)) {
      ctx.errors.push(foreignElement(child));
      continue;
    }
    const builder = BUILDERS.get(localName(child.name));
    if (builder === undefined) {
      ctx.errors.push({
        reason: "unsupported_element",
        name: child.name,
        message: `unsupported element ${quote(child.name)}`,
        location: child.location,
      });
      continue;
    }
    const result = builder(child, ctx);
    if (result !== null) lowered.push(result);
  }
  return lowered;
}

// Places each lowered child through `place`, which answers false for a slot
// the parent does not have; each of those is reported as misplaced.
function placeChildren(
  lowered: readonly Lowered[],
  parent: string,
  ctx: Context,
  place: (child: Lowered) => boolean,
): void {
  for (const child of lowered) {
    if (!place(child)) ctx.errors.push(misplaced(loweredName(child), parent, loweredSpan(child)));
  }
}

// The element name a misplaced child is reported under: its slot's, or for
// executable content the node's own kind. The four state kinds share the
// `state` slot, so a misplaced one of any kind is reported as `state`, as the
// reference reports it.
function loweredName(child: Lowered): string {
  return child.slot === "executable" ? child.node.kind : child.slot;
}

function loweredSpan(child: Lowered): Location {
  if (child.slot === "executable" && child.node.kind === "assign") return child.node.nodeLocation;
  return (child.node as { readonly location: Location }).location;
}

// Reports each element child of an element that holds text only.
function refuseElementChildren(element: Element, parent: string, ctx: Context): void {
  for (const child of element.children) {
    if (child.type === "element") ctx.errors.push(misplaced(child.name, parent, child.location));
  }
}

// ---------------------------------------------------------------------------
// The builders

function buildScxml(element: Element, ctx: Context): Document {
  const lowered = walkChildren(element, ctx);
  const states: State[] = [];
  const scripts: Script[] = [];
  let datamodelElement: Datamodel | null = null;

  placeChildren(lowered, element.name, ctx, (child) => {
    if (child.slot === "state") states.push(child.node);
    else if (child.slot === "datamodel") datamodelElement = child.node;
    else if (child.slot === "executable" && child.node.kind === "script") scripts.push(child.node);
    else return false;
    return true;
  });

  return {
    location: element.location,
    name: attribute(element, "name"),
    version: attribute(element, "version"),
    xmlns: attribute(element, "xmlns"),
    namespace: element.namespace,
    datamodel: attribute(element, "datamodel"),
    binding: attribute(element, "binding") === "late" ? "late" : "early",
    initial: list(element, "initial"),
    states,
    datamodelElement,
    scripts,
    attributeLocations: locations(element, [
      "initial",
      "name",
      "datamodel",
      "binding",
      "version",
      "xmlns",
    ]),
  };
}

// `<state>`, `<parallel>`, `<final>` and `<history>`: one builder, the kind
// its own. A history's `type` maps onto its two values with `shallow` the
// default, and an out-of-range value still keeps its location so a check
// can point at it.
function buildState(element: Element, ctx: Context, kind: StateKind): State {
  const lowered = walkChildren(element, ctx);
  const states: State[] = [];
  const transitions: Transition[] = [];
  const onentry: Block[] = [];
  const onexit: Block[] = [];
  const invoke: Invoke[] = [];
  let initialElement: Initial | null = null;
  let donedata: Donedata | null = null;
  let datamodelElement: Datamodel | null = null;

  placeChildren(lowered, element.name, ctx, (child) => {
    switch (child.slot) {
      case "state":
        states.push(child.node);
        return true;
      case "transition":
        transitions.push(child.node);
        return true;
      case "initial":
        initialElement = child.node;
        return true;
      case "onentry":
        onentry.push(child.node);
        return true;
      case "onexit":
        onexit.push(child.node);
        return true;
      case "donedata":
        donedata = child.node;
        return true;
      case "datamodel":
        datamodelElement = child.node;
        return true;
      case "invoke":
        invoke.push(child.node);
        return true;
      default:
        return false;
    }
  });

  const history = kind === "history";
  return {
    kind,
    location: element.location,
    id: attribute(element, "id"),
    initial: list(element, "initial"),
    initialElement,
    states,
    transitions,
    onentry,
    onexit,
    historyType: history ? (attribute(element, "type") === "deep" ? "deep" : "shallow") : null,
    donedata,
    datamodelElement,
    invoke,
    attributeLocations: locations(element, history ? ["id", "initial", "type"] : ["id", "initial"]),
  };
}

function buildInitial(element: Element, ctx: Context): Lowered {
  const lowered = walkChildren(element, ctx);
  const transitions: Transition[] = [];
  placeChildren(lowered, element.name, ctx, (child) => {
    if (child.slot !== "transition") return false;
    transitions.push(child.node);
    return true;
  });
  return { slot: "initial", node: { location: element.location, transitions } };
}

function buildTransition(element: Element, ctx: Context): Lowered {
  const content = executableBody(element, ctx);
  const type = attribute(element, "type");
  return {
    slot: "transition",
    node: {
      location: element.location,
      event: list(element, "event"),
      target: list(element, "target"),
      cond: attribute(element, "cond"),
      type: type === "internal" ? "internal" : "external",
      content,
      attributeLocations: locations(element, ["event", "target", "cond", "type"]),
    },
  };
}

// `<onentry>`, `<onexit>` and `<finalize>`: one block per element. A written
// empty `<finalize/>` is an empty block, which is how an invocation tells it
// from one with no `<finalize>` at all.
function buildBlock(element: Element, ctx: Context): Block {
  return { location: element.location, content: executableBody(element, ctx) };
}

// The children of an element whose one slot is executable content.
function executableBody(element: Element, ctx: Context): ContentNode[] {
  return placeExecutable(walkChildren(element, ctx), element.name, ctx);
}

function placeExecutable(lowered: readonly Lowered[], parent: string, ctx: Context): ContentNode[] {
  const content: ContentNode[] = [];
  placeChildren(lowered, parent, ctx, (child) => {
    if (child.slot !== "executable") return false;
    content.push(child.node);
    return true;
  });
  return content;
}

// Lowers an element that has no slot at all, so every child it has is
// reported as misplaced.
function refuseLoweredChildren(element: Element, ctx: Context): void {
  placeChildren(walkChildren(element, ctx), element.name, ctx, () => false);
}

function buildRaise(element: Element, ctx: Context): Lowered | null {
  const lowered = walkChildren(element, ctx);
  const event = attribute(element, "event");
  if (event === null) {
    ctx.errors.push(missingAttribute("raise", "event", element.location));
    return null;
  }
  placeChildren(lowered, element.name, ctx, () => false);
  const node: Raise = {
    kind: "raise",
    location: element.location,
    event,
    attributeLocations: locations(element, ["event"]),
  };
  return { slot: "executable", node };
}

function buildLog(element: Element, ctx: Context): Lowered {
  refuseLoweredChildren(element, ctx);
  const node: Log = {
    kind: "log",
    location: element.location,
    label: attribute(element, "label"),
    expr: attribute(element, "expr"),
    attributeLocations: locations(element, ["label", "expr"]),
  };
  return { slot: "executable", node };
}

// Both slots are built whatever was written; a later `<content>` replaces an
// earlier one.
function buildDonedata(element: Element, ctx: Context): Lowered {
  const lowered = walkChildren(element, ctx);
  const params: Param[] = [];
  let content: Content | null = null;
  placeChildren(lowered, element.name, ctx, (child) => {
    if (child.slot === "param") params.push(child.node);
    else if (child.slot === "content") content = child.node;
    else return false;
    return true;
  });
  return { slot: "donedata", node: { location: element.location, content, params } };
}

function buildParam(element: Element, ctx: Context): Lowered | null {
  const lowered = walkChildren(element, ctx);
  const name = attribute(element, "name");
  if (name === null) {
    ctx.errors.push(missingAttribute("param", "name", element.location));
    return null;
  }
  placeChildren(lowered, element.name, ctx, () => false);
  return {
    slot: "param",
    node: {
      location: element.location,
      name,
      expr: attribute(element, "expr"),
      paramLocation: attribute(element, "location"),
      attributeLocations: locations(element, ["name", "expr", "location"]),
    },
  };
}

// The children of `<content>` are its payload and are never walked, so no
// child of it is stray, foreign or misplaced.
function buildContent(element: Element, ctx: Context): Lowered {
  const { markup, markupLocation } = sliceMarkup(element, ctx.source);
  return {
    slot: "content",
    node: {
      location: element.location,
      expr: attribute(element, "expr"),
      text: ownText(element),
      markup,
      markupLocation,
      attributeLocations: locations(element, ["expr"]),
    },
  };
}

function buildDatamodel(element: Element, ctx: Context): Lowered {
  const lowered = walkChildren(element, ctx);
  const data: Data[] = [];
  placeChildren(lowered, element.name, ctx, (child) => {
    if (child.slot !== "data") return false;
    data.push(child.node);
    return true;
  });
  return { slot: "datamodel", node: { location: element.location, data } };
}

// A `<data>` holds text, not markup: its text is the value and each element
// child is misplaced.
function buildData(element: Element, ctx: Context): Lowered | null {
  refuseElementChildren(element, "data", ctx);
  const id = attribute(element, "id");
  if (id === null) {
    ctx.errors.push(missingAttribute("data", "id", element.location));
    return null;
  }
  return {
    slot: "data",
    node: {
      location: element.location,
      id,
      expr: attribute(element, "expr"),
      src: attribute(element, "src"),
      text: ownText(element),
      attributeLocations: locations(element, ["id", "expr", "src"]),
    },
  };
}

// An `<assign>`'s children are its in-line value, text or markup, and are
// never walked, exactly as `<content>`'s are.
function buildAssign(element: Element, ctx: Context): Lowered | null {
  const path = attribute(element, "location");
  if (path === null) {
    ctx.errors.push(missingAttribute("assign", "location", element.location));
    return null;
  }
  const { markup, markupLocation } = sliceMarkup(element, ctx.source);
  const node: Assign = {
    kind: "assign",
    location: path,
    nodeLocation: element.location,
    expr: attribute(element, "expr"),
    text: ownText(element),
    markup,
    markupLocation,
    attributeLocations: locations(element, ["location", "expr"]),
  };
  return { slot: "executable", node };
}

// An `<if>` is folded into partitions: the first branch is the `<if>`'s own,
// each `<elseif>` or `<else>` closes the open branch and opens the next, and
// executable content joins whichever branch is open.
function buildIf(element: Element, ctx: Context): Lowered | null {
  const lowered = walkChildren(element, ctx);
  const cond = attribute(element, "cond");
  if (cond === null) {
    ctx.errors.push(missingAttribute("if", "cond", element.location));
    return null;
  }

  const branches: {
    location: Location;
    cond: string | null;
    content: ContentNode[];
    attributeLocations: AttributeLocations<"cond">;
  }[] = [
    {
      location: element.location,
      cond,
      content: [],
      attributeLocations: locations(element, ["cond"]),
    },
  ];
  placeChildren(lowered, element.name, ctx, (child) => {
    if (child.slot === "elseif" || child.slot === "else") {
      branches.push({ ...child.node, content: [] });
      return true;
    }
    if (child.slot !== "executable") return false;
    branches[branches.length - 1]?.content.push(child.node);
    return true;
  });

  return { slot: "executable", node: { kind: "if", location: element.location, branches } };
}

function buildElseif(element: Element, ctx: Context): Lowered | null {
  refuseElementChildren(element, "elseif", ctx);
  const cond = attribute(element, "cond");
  if (cond === null) {
    ctx.errors.push(missingAttribute("elseif", "cond", element.location));
    return null;
  }
  return {
    slot: "elseif",
    node: {
      location: element.location,
      cond,
      content: [],
      attributeLocations: locations(element, ["cond"]),
    },
  };
}

// `<else>` takes no attributes. One written anyway is reported, the first of
// them only, and the branch still builds so the `<else>` behaves as one.
function buildElse(element: Element, ctx: Context): Lowered {
  refuseElementChildren(element, "else", ctx);
  const first = element.attributes[0];
  if (first !== undefined) {
    ctx.errors.push({
      reason: "unexpected_attribute",
      element: "else",
      attribute: first.name,
      message: `element "else" does not accept attribute ${quote(first.name)}`,
      location: first.location,
    });
  }
  return {
    slot: "else",
    node: { location: element.location, cond: null, content: [], attributeLocations: {} },
  };
}

// Both required attributes are checked before giving up, so a `<foreach>`
// missing both reports both.
function buildForeach(element: Element, ctx: Context): Lowered | null {
  const lowered = walkChildren(element, ctx);
  const array = attribute(element, "array");
  const item = attribute(element, "item");
  if (array === null) ctx.errors.push(missingAttribute("foreach", "array", element.location));
  if (item === null) ctx.errors.push(missingAttribute("foreach", "item", element.location));
  if (array === null || item === null) return null;
  const content = placeExecutable(lowered, element.name, ctx);

  const node: Foreach = {
    kind: "foreach",
    location: element.location,
    array,
    item,
    index: attribute(element, "index"),
    content,
    attributeLocations: locations(element, ["array", "item", "index"]),
  };
  return { slot: "executable", node };
}

// A `<script>`'s text is its program. `src` would name a program to fetch,
// and nothing is fetched, so a `<script src>` does not lower.
function buildScript(element: Element, ctx: Context): Lowered | null {
  refuseElementChildren(element, "script", ctx);
  if (attribute(element, "src") !== null) {
    ctx.errors.push({
      reason: "unsupported_attribute",
      element: "script",
      attribute: "src",
      message:
        'element "script"\'s "src" attribute is defined by the specification but not implemented by this engine',
      location: element.location,
    });
    return null;
  }
  const node: Script = { kind: "script", location: element.location, text: ownText(element) };
  return { slot: "executable", node };
}

function buildInvoke(element: Element, ctx: Context): Lowered {
  const lowered = walkChildren(element, ctx);
  const params: Param[] = [];
  let content: Content | null = null;
  let finalize: Block | null = null;
  placeChildren(lowered, element.name, ctx, (child) => {
    if (child.slot === "param") params.push(child.node);
    else if (child.slot === "content") content = child.node;
    else if (child.slot === "finalize") finalize = child.node;
    else return false;
    return true;
  });
  return {
    slot: "invoke",
    node: {
      location: element.location,
      type: attribute(element, "type"),
      typeexpr: attribute(element, "typeexpr"),
      src: attribute(element, "src"),
      srcexpr: attribute(element, "srcexpr"),
      id: attribute(element, "id"),
      idlocation: attribute(element, "idlocation"),
      namelist: list(element, "namelist"),
      autoforward: attribute(element, "autoforward") === "true",
      params,
      content,
      finalize,
      attributeLocations: locations(element, [
        "type",
        "typeexpr",
        "src",
        "srcexpr",
        "id",
        "idlocation",
        "namelist",
        "autoforward",
      ]),
    },
  };
}

function buildSend(element: Element, ctx: Context): Lowered {
  const lowered = walkChildren(element, ctx);
  const params: Param[] = [];
  let content: Content | null = null;
  placeChildren(lowered, element.name, ctx, (child) => {
    if (child.slot === "param") params.push(child.node);
    else if (child.slot === "content") content = child.node;
    else return false;
    return true;
  });
  const node: Send = {
    kind: "send",
    location: element.location,
    event: attribute(element, "event"),
    eventexpr: attribute(element, "eventexpr"),
    target: attribute(element, "target"),
    targetexpr: attribute(element, "targetexpr"),
    type: attribute(element, "type"),
    typeexpr: attribute(element, "typeexpr"),
    id: attribute(element, "id"),
    idlocation: attribute(element, "idlocation"),
    delay: attribute(element, "delay"),
    delayexpr: attribute(element, "delayexpr"),
    namelist: list(element, "namelist"),
    params,
    content,
    attributeLocations: locations(element, [
      "event",
      "eventexpr",
      "target",
      "targetexpr",
      "type",
      "typeexpr",
      "id",
      "idlocation",
      "delay",
      "delayexpr",
      "namelist",
    ]),
  };
  return { slot: "executable", node };
}

function buildCancel(element: Element, ctx: Context): Lowered {
  refuseLoweredChildren(element, ctx);
  const node: Cancel = {
    kind: "cancel",
    location: element.location,
    sendid: attribute(element, "sendid"),
    sendidexpr: attribute(element, "sendidexpr"),
    attributeLocations: locations(element, ["sendid", "sendidexpr"]),
  };
  return { slot: "executable", node };
}

// ---------------------------------------------------------------------------
// Reading an element

// The first attribute written with this name, or null. Duplicates stay in the
// tree for a check to report; the first one is the one that counts.
function attribute(element: Element, name: string): string | null {
  for (const candidate of element.attributes) {
    if (candidate.name === name) return candidate.value;
  }
  return null;
}

// An attribute split on whitespace; an absent attribute and an empty one
// both answer an empty list, told apart by the attribute's location.
function list(element: Element, name: string): string[] {
  const raw = attribute(element, name);
  if (raw === null) return [];
  return raw.split(SPLIT_WHITESPACE).filter((part) => part !== "");
}

// The value spans of the named attributes that were written.
function locations<K extends string>(element: Element, names: readonly K[]): AttributeLocations<K> {
  const spans: Partial<Record<K, Location>> = {};
  for (const name of names) {
    for (const candidate of element.attributes) {
      if (candidate.name === name) {
        spans[name] = candidate.valueLocation;
        break;
      }
    }
  }
  return spans;
}

// The element's own text children joined; a child element's text is not
// included.
function ownText(element: Element): string {
  let text = "";
  for (const child of element.children) {
    if (child.type === "text") text += child.value;
  }
  return text;
}

// The source text from the first to the last non-blank child, when at least
// one child is an element; nothing otherwise. The slice is the raw source,
// line breaks unfolded.
function sliceMarkup(
  element: Element,
  source: string,
): { markup: string | null; markupLocation: Location | null } {
  const significant = element.children.filter(
    (child) => child.type === "element" || !isBlank(child.value),
  );
  const first = significant[0];
  const last = significant[significant.length - 1];
  if (first === undefined || last === undefined || !significant.some((c) => c.type === "element")) {
    return { markup: null, markupLocation: null };
  }
  const markupLocation: Location = {
    startLine: first.location.startLine,
    startColumn: first.location.startColumn,
    startOffset: first.location.startOffset,
    endLine: last.location.endLine,
    endColumn: last.location.endColumn,
    endOffset: last.location.endOffset,
  };
  return {
    markup: source.slice(markupLocation.startOffset, markupLocation.endOffset),
    markupLocation,
  };
}

// ---------------------------------------------------------------------------
// Names, namespaces and whitespace

function isScxmlVocabulary(namespace: string | null): boolean {
  return namespace === null || namespace === SCXML_NAMESPACE;
}

function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

// Unicode whitespace, as the reference trims it.
const BLANK = /^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;

// Unicode whitespace less the three no-break spaces, as the reference splits
// an attribute list on it.
const SPLIT_WHITESPACE = /[\t-\r \u0085\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]+/;

const TRIM_EDGES =
  /^[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t-\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;

/**
 * Whether trimming Unicode whitespace from `text` leaves nothing, as the
 * reference trims it. The validator reads text payloads by the same rule.
 */
export function isBlank(text: string): boolean {
  return BLANK.test(text);
}

/**
 * `text` with Unicode whitespace trimmed from both ends, as the reference
 * trims it. The compiler folds an in-line value by the same rule.
 */
export function trimBlank(text: string): string {
  return text.replace(TRIM_EDGES, "");
}

// ---------------------------------------------------------------------------
// Errors

function quote(text: string): string {
  return JSON.stringify(text);
}

function strayText(value: string, location: Location): LoweringError {
  const trimmed = value.replace(TRIM_EDGES, "");
  const codePoints = Array.from(trimmed);
  const preview = codePoints.length > 40 ? `${codePoints.slice(0, 40).join("")}...` : trimmed;
  return {
    reason: "stray_text",
    text: trimmed,
    message: `stray text ${quote(preview)} is not allowed here`,
    location,
  };
}

function misplaced(name: string, parent: string, location: Location): LoweringError {
  return {
    reason: "misplaced_element",
    name,
    parent,
    message: `element ${quote(name)} is not allowed inside ${quote(parent)}`,
    location,
  };
}

function missingAttribute(
  element: string,
  attributeName: string,
  location: Location,
): LoweringError {
  return {
    reason: "missing_attribute",
    element,
    attribute: attributeName,
    message: `element ${quote(element)} is missing required attribute ${quote(attributeName)}`,
    location,
  };
}

function foreignElement(element: Element): LoweringError {
  const uri = element.namespace ?? "";
  return {
    reason: "foreign_element",
    name: element.name,
    uri,
    message: `element ${quote(element.name)} is bound to foreign namespace ${quote(uri)}, not SCXML`,
    location: element.location,
  };
}
