// The compiler: the validated chart in, the Machine out; and the whole
// pipeline, SCXML text in, a Chart with its identity out.
//
// Ported from the reference's compiler (`Statifier.Compiler`,
// `Statifier.Compiler.Expressions` and `Statifier.Compiler.Error` in
// statifier-ex at v2.9.0) and its pipeline entry (`Statifier.compile/2`).
//
// One walk numbers everything in document order. A state takes its index
// when the walk reaches it, before its children; its own `<onentry>` and
// `<onexit>` content, then its transitions (a history state's are its
// default; any other kind's plain transitions come before its `<initial>`
// element's), then its `<data>`, then its `<invoke>` elements' `<finalize>`
// content are numbered before the walk descends. A transition's targets can
// name a state the walk has not reached yet, so targets are resolved, and
// conditions compiled, once the walk is done.
//
// Every expression compiles once, through the expression language's
// compiler. A failure is one of two things, class by class, as in the
// reference:
//
// - A load-time error. A transition's `cond`, a `<log>`'s `expr`, an `<if>`
//   or `<elseif>` condition, a `<foreach>`'s `array`, a `<content>`'s `expr`
//   and a `<param>`'s value under `<donedata>`, `<invoke>` or `<send>`, an
//   `<invoke>`'s `typeexpr` and `srcexpr`, a `<send>`'s `eventexpr`,
//   `targetexpr`, `typeexpr` and `delayexpr`, and a `<cancel>`'s
//   `sendidexpr`: the chart does not compile, and every such error is
//   answered, in source order. A `<send>` answers at most one error for its
//   attributes and `<content>`, the first in that order, and one for each
//   `<param>` only when they all compiled.
// - A deferred failure. An `<assign>`'s `expr`, a `<data>`'s `expr` and a
//   `namelist` entry compile to an `Invalid` that fails when it runs, raising
//   `error.execution` then, so a chart whose only defect is one of these
//   still loads.
//
// A `<script>`'s body, in-line or top-level, compiles as a statement program
// through the expression language's program compiler, as the reference's
// `compile_program/3` does. Its failure is deferred, as an `<assign>`'s is: the
// script compiles to an `Invalid` that raises `error.execution` when it runs,
// so a chart whose only defect is a script body still loads.
//
// A `<send>`'s literal attributes fold to literals, and its `id` and
// `idlocation` stay as written: whether its target and type can be carried
// is judged when it runs, not here.

import {
  compile as compileExpression,
  compileProgramWithSpans,
  type ParseError as ExpressionParseError,
  evaluate as evaluateExpression,
  fromHost,
  type Value,
} from "@riddler/predicator";
import type { ContentNode, Invalid } from "./core/content.js";
import type { ParamNode } from "./core/send.js";
import { type CompiledProgram, type Expr, ON_UNBOUND } from "./datamodel.js";
import type { Content, Data, Datamodel, Donedata, Param } from "./document/data.js";
import type { Assign, Cancel, Foreach, If, Log, Script, Send } from "./document/executable.js";
import type { Invoke } from "./document/invoke.js";
import type { Document, ContentNode as DocumentContentNode } from "./document/scxml.js";
import type { Block, State, Transition } from "./document/states.js";
import { isBlank, type LoweringError, lower, trimBlank } from "./lowering.js";
import type {
  CompiledBlock,
  CompiledData,
  CompiledDonedata,
  CompiledInvoke,
  CompiledParam,
  CompiledState,
  CompiledTransition,
  DataValue,
  Machine,
} from "./machine.js";
import { sha256Hex, utf8Bytes } from "./sha256.js";
import { type ValidationError, validate } from "./validator.js";
import { type Location, type ParseError, parseXml } from "./xml/parser.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * The node an expression belongs to, in the index spaces the Machine uses: a
 * transition's `tIndex`, a content node's `cIndex`, a final state's index for
 * its `<donedata>`, a `<data>`'s `dIndex`, a top-level `<script>`'s position,
 * or an `<invoke>` by its state and its position there.
 */
export type ExpressionOwner =
  | { readonly kind: "transition"; readonly tIndex: number }
  | { readonly kind: "content"; readonly cIndex: number }
  | { readonly kind: "donedata"; readonly stateIndex: number }
  | { readonly kind: "data"; readonly dIndex: number }
  | { readonly kind: "global_script"; readonly index: number }
  | { readonly kind: "invoke"; readonly stateIndex: number; readonly invokeIndex: number };

/**
 * An expression that did not compile. `element` and `attribute` name where
 * it was written, `location` is the attribute's value when one was written
 * and the element otherwise, and `error` is the expression language's own
 * refusal, in the expression's coordinates.
 *
 * It is not exported by name: a host meets it as one member of
 * `CompileError`.
 */
export interface CompilerError {
  readonly reason: "expression_compile_error";
  readonly message: string;
  readonly location: Location;
  readonly element: string;
  readonly attribute: string;
  readonly owner: ExpressionOwner;
  readonly source: string;
  readonly error: ExpressionParseError;
}

export type CompilerResult =
  | { readonly ok: true; readonly machine: Machine }
  | { readonly ok: false; readonly errors: readonly CompilerError[] };

/** Where an expression was written: what a failure names. */
interface Site {
  readonly owner: ExpressionOwner;
  readonly element: string;
  readonly attribute: string;
  readonly location: Location;
}

type Compiled =
  | { readonly ok: true; readonly expr: Expr }
  | { readonly ok: false; readonly error: CompilerError };

/** The message the reference writes for an expression that did not compile. */
function compileErrorMessage(source: string, error: ExpressionParseError): string {
  const { line, column } = error.position;
  return (
    `failed to compile expression ${JSON.stringify(source)}: ${error.message} ` +
    `(predicator line ${line}, column ${column})`
  );
}

function compileExpr(source: string, site: Site): Compiled {
  const compiled = compileExpression(source);
  if (compiled.ok) {
    return { ok: true, expr: { kind: "compiled", program: compiled.instructions, source } };
  }
  return {
    ok: false,
    error: {
      reason: "expression_compile_error",
      message: compileErrorMessage(source, compiled.error),
      location: site.location,
      element: site.element,
      attribute: site.attribute,
      owner: site.owner,
      source,
      error: compiled.error,
    },
  };
}

function staticExpr(value: Value): Expr {
  return { kind: "static", value };
}

function invalidOf(error: CompilerError): Invalid {
  return { kind: "invalid", source: error.source, message: error.message };
}

/**
 * A `<script>`'s body compiled as a statement program, or the `Invalid` that
 * raises `error.execution` when the script runs, carrying the message the
 * reference writes for a body that did not compile. It compiles with spans,
 * as the reference does; what it keeps is the instructions and the source,
 * which is what runs.
 */
function compileScript(script: Script): CompiledProgram | Invalid {
  const source = script.text;
  const compiled = compileProgramWithSpans(source);
  if (compiled.ok) return { program: compiled.instructions, source };
  return { kind: "invalid", source, message: compileErrorMessage(source, compiled.error) };
}

/**
 * An in-line value (a `<data>` or `<assign>` body) folded to a literal: the
 * trimmed text compiled and evaluated against an empty datamodel that
 * refuses every unbound name, and the trimmed text itself when either step
 * fails. So `[1, 2]` is a list, `3` a number, and `hello` the string
 * `hello` rather than a read of a variable. It never reads the datamodel.
 */
function inlineValue(text: string): Expr {
  const trimmed = trimBlank(text);
  const compiled = compileExpression(trimmed);
  if (compiled.ok) {
    const result = evaluateExpression(compiled.instructions, {}, { onUnbound: ON_UNBOUND });
    if (result.ok) {
      const value = fromHost(result.value);
      if (value.ok) return staticExpr(value.value);
    }
  }
  return staticExpr(trimmed);
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

interface PendingTransition {
  readonly transition: Transition;
  readonly source: number;
  readonly tIndex: number;
  readonly content: readonly ContentNode[];
}

/** Everything the numbering walk threads. */
interface Walk {
  readonly idToIndex: Map<string, number>;
  readonly states: CompiledState[];
  readonly transitions: PendingTransition[];
  readonly data: CompiledData[];
  /** Data `dIndex`es by the index of the state whose `<datamodel>` declared them. */
  readonly dataByState: Map<number, number[]>;
  cNext: number;
  // The four error groups, merged and sorted by offset at the end.
  readonly transitionErrors: CompilerError[];
  readonly contentErrors: CompilerError[];
  readonly donedataErrors: CompilerError[];
  readonly invokeErrors: CompilerError[];
}

/**
 * Compiles a validated chart into its Machine, or answers every load-time
 * expression error in source order.
 *
 * The chart must have passed the validator: an unresolved id here is a
 * broken invariant and throws, rather than being answered.
 */
export function compileDocument(chart: Document): CompilerResult {
  const walk: Walk = {
    idToIndex: new Map(),
    states: [],
    transitions: [],
    data: [],
    dataByState: new Map(),
    cNext: 0,
    transitionErrors: [],
    contentErrors: [],
    donedataErrors: [],
    invokeErrors: [],
  };

  // The root's own <data> come first in the dIndex space.
  assignData(walk, chart.datamodelElement, 0);
  const walked = walkSiblings(walk, chart.states, 1, 0);

  walk.states[0] = {
    index: 0,
    id: null,
    kind: "scxml",
    parent: null,
    last: walked.next - 1,
    children: walked.indexes,
    initial:
      chart.initial.length > 0 ? resolveIds(walk, chart.initial) : firstChild(walked.indexes),
    historyType: null,
    historyChildren: historyChildrenOf(walk, walked.indexes),
    transitions: [],
    onentry: [],
    onexit: [],
    initialTransition: null,
    historyDefault: null,
    donedata: null,
    data: walk.dataByState.get(0) ?? [],
    invoke: [],
    location: chart.location,
    attributeLocations: chart.attributeLocations,
  };

  const transitions = walk.transitions.map((pending) => buildTransition(walk, pending));
  const globalScripts: (CompiledProgram | Invalid)[] = chart.scripts.map(compileScript);

  const errors = [
    ...walk.transitionErrors,
    ...walk.contentErrors,
    ...walk.donedataErrors,
    ...walk.invokeErrors,
  ];
  if (errors.length > 0) {
    // A stable sort, so errors at one offset keep the order of their groups.
    const sorted = errors.sort((a, b) => a.location.startOffset - b.location.startOffset);
    return { ok: false, errors: sorted };
  }

  return {
    ok: true,
    machine: {
      states: walk.states,
      idToIndex: walk.idToIndex,
      transitions,
      dataElements: walk.data,
      globalScripts,
      name: chart.name,
      datamodel: chart.datamodel,
      binding: chart.binding,
      location: chart.location,
    },
  };
}

/**
 * Numbers one group of sibling states and their subtrees, depth first.
 * `next` is the first unused state index; answers the group's own indexes
 * and the first index after the whole group.
 */
function walkSiblings(
  walk: Walk,
  siblings: readonly State[],
  next: number,
  parent: number,
): { indexes: number[]; next: number } {
  const indexes: number[] = [];
  let index = next;
  for (const state of siblings) {
    indexes.push(index);

    const onentry = assignBlocks(walk, state.onentry);
    const onexit = assignBlocks(walk, state.onexit);
    let transitions: number[] = [];
    let initialTransition: number | null = null;
    let historyDefault: number | null = null;
    if (state.kind === "history") {
      historyDefault = firstOrNull(assignTransitions(walk, state.transitions, index));
    } else {
      transitions = assignTransitions(walk, state.transitions, index);
      const initialTransitions = state.initialElement?.transitions ?? [];
      initialTransition = firstOrNull(assignTransitions(walk, initialTransitions, index));
    }
    const donedata = state.donedata === null ? null : buildDonedata(walk, index, state.donedata);
    assignData(walk, state.datamodelElement, index);
    const invoke = state.invoke.map((node, invokeIndex) =>
      buildInvoke(walk, node, index, invokeIndex),
    );

    const subtree = walkSiblings(walk, state.states, index + 1, index);

    walk.states[index] = {
      index,
      id: state.id,
      kind: state.kind,
      parent,
      last: subtree.next - 1,
      children: subtree.indexes,
      initial: resolveInitial(walk, state, subtree.indexes),
      historyType: state.historyType,
      historyChildren: historyChildrenOf(walk, subtree.indexes),
      transitions,
      onentry,
      onexit,
      initialTransition,
      historyDefault,
      donedata,
      data: walk.dataByState.get(index) ?? [],
      invoke,
      location: state.location,
      attributeLocations: state.attributeLocations,
    };
    if (state.id !== null && state.id !== "") walk.idToIndex.set(state.id, index);

    index = subtree.next;
  }
  return { indexes, next: index };
}

function firstOrNull(indexes: readonly number[]): number | null {
  return indexes[0] ?? null;
}

function firstChild(children: readonly number[]): number[] {
  const [first] = children;
  return first === undefined ? [] : [first];
}

function resolveIds(walk: Walk, ids: readonly string[]): number[] {
  return ids.map((id) => {
    const index = walk.idToIndex.get(id);
    if (index === undefined) {
      throw new Error(`the compiler met an unresolved state id ${JSON.stringify(id)}`);
    }
    return index;
  });
}

/**
 * A compound state's default entry, in the specification's precedence: the
 * `initial` attribute, then the `<initial>` element's one transition, then
 * the first child. Only a `state` resolves one: a parallel enters every
 * child, and a final or history state is never entered by default.
 */
function resolveInitial(walk: Walk, state: State, children: readonly number[]): number[] {
  if (state.kind !== "state") return [];
  if (state.initial.length > 0) return resolveIds(walk, state.initial);
  const initialTransitions = state.initialElement?.transitions ?? [];
  const [only] = initialTransitions;
  if (only !== undefined && initialTransitions.length === 1) return resolveIds(walk, only.target);
  return firstChild(children);
}

function historyChildrenOf(walk: Walk, children: readonly number[]): number[] {
  return children.filter((child) => walk.states[child]?.kind === "history");
}

function assignTransitions(
  walk: Walk,
  transitions: readonly Transition[],
  source: number,
): number[] {
  return transitions.map((transition) => {
    const content = compileContentList(walk, transition.content);
    const tIndex = walk.transitions.length;
    walk.transitions.push({ transition, source, tIndex, content });
    return tIndex;
  });
}

function buildTransition(walk: Walk, pending: PendingTransition): CompiledTransition {
  const { transition, source, tIndex, content } = pending;
  let cond: Expr | null = null;
  let condLocation: Location | null = null;
  if (transition.cond !== null) {
    condLocation = transition.attributeLocations.cond ?? transition.location;
    const compiled = compileExpr(transition.cond, {
      owner: { kind: "transition", tIndex },
      element: "transition",
      attribute: "cond",
      location: condLocation,
    });
    if (compiled.ok) cond = compiled.expr;
    else walk.transitionErrors.push(compiled.error);
  }
  return {
    tIndex,
    source,
    targets: resolveIds(walk, transition.target),
    events: transition.event.map((descriptor) => descriptor.split(".")),
    cond,
    type: transition.type,
    content,
    location: transition.location,
    condLocation,
    attributeLocations: transition.attributeLocations,
  };
}

// ---------------------------------------------------------------------------
// Executable content
// ---------------------------------------------------------------------------

function assignBlocks(walk: Walk, blocks: readonly Block[]): CompiledBlock[] {
  return blocks.map((block) => ({
    location: block.location,
    content: compileContentList(walk, block.content),
  }));
}

function compileContentList(walk: Walk, nodes: readonly DocumentContentNode[]): ContentNode[] {
  return nodes.map((node) => compileContent(walk, node));
}

/**
 * Compiles one content node, taking the next content index first, so a
 * container's index precedes its children's.
 */
function compileContent(walk: Walk, node: DocumentContentNode): ContentNode {
  const cIndex = walk.cNext++;
  switch (node.kind) {
    case "raise":
      return { kind: "raise", cIndex, event: node.event };
    case "log":
      return compileLog(walk, node, cIndex);
    case "assign":
      return { kind: "assign", cIndex, location: node.location, value: assignValue(node, cIndex) };
    case "if":
      return compileIf(walk, node, cIndex);
    case "foreach":
      return compileForeach(walk, node, cIndex);
    case "script":
      return { kind: "script", cIndex, program: compileScript(node) };
    case "send":
      return compileSend(walk, node, cIndex);
    case "cancel":
      return compileCancel(walk, node, cIndex);
  }
}

function compileLog(walk: Walk, node: Log, cIndex: number): ContentNode {
  if (node.expr === null) return { kind: "log", cIndex, label: node.label, expr: null };
  const compiled = compileExpr(node.expr, {
    owner: { kind: "content", cIndex },
    element: "log",
    attribute: "expr",
    location: node.attributeLocations.expr ?? node.location,
  });
  if (compiled.ok) return { kind: "log", cIndex, label: node.label, expr: compiled.expr };
  walk.contentErrors.push(compiled.error);
  return { kind: "log", cIndex, label: node.label, expr: invalidOf(compiled.error) };
}

/**
 * An `<assign>`'s value: its `expr`, whose compile failure is deferred to
 * when the node runs; else its markup children as a string; else its text
 * folded as an in-line value; else null.
 */
function assignValue(node: Assign, cIndex: number): Expr | Invalid {
  if (node.expr !== null) {
    const compiled = compileExpr(node.expr, {
      owner: { kind: "content", cIndex },
      element: "assign",
      attribute: "expr",
      location: node.attributeLocations.expr ?? node.nodeLocation,
    });
    return compiled.ok ? compiled.expr : invalidOf(compiled.error);
  }
  if (node.markup !== null) return staticExpr(node.markup);
  if (isBlank(node.text)) return staticExpr(null);
  return inlineValue(node.text);
}

/** Every branch's condition compiles; each failure is its own error. */
function compileIf(walk: Walk, node: If, cIndex: number): ContentNode {
  const branches = node.branches.map((branch, position) => {
    let cond: Expr | Invalid | null = null;
    if (branch.cond !== null) {
      const compiled = compileExpr(branch.cond, {
        owner: { kind: "content", cIndex },
        element: position === 0 ? "if" : "elseif",
        attribute: "cond",
        location: branch.attributeLocations.cond ?? branch.location,
      });
      if (compiled.ok) {
        cond = compiled.expr;
      } else {
        walk.contentErrors.push(compiled.error);
        cond = invalidOf(compiled.error);
      }
    }
    return { cond, content: compileContentList(walk, branch.content) };
  });
  return { kind: "if", cIndex, branches };
}

function compileForeach(walk: Walk, node: Foreach, cIndex: number): ContentNode {
  const compiled = compileExpr(node.array, {
    owner: { kind: "content", cIndex },
    element: "foreach",
    attribute: "array",
    location: node.attributeLocations.array ?? node.location,
  });
  if (!compiled.ok) walk.contentErrors.push(compiled.error);
  return {
    kind: "foreach",
    cIndex,
    array: compiled.ok ? compiled.expr : invalidOf(compiled.error),
    item: node.item,
    index: node.index,
    content: compileContentList(walk, node.content),
  };
}

type SendAttribute = "eventexpr" | "targetexpr" | "typeexpr" | "delayexpr" | "namelist";

/**
 * A `<send>`. Each attribute pair folds into one expression: the literal
 * attribute wins over its `expr` twin (the validator refuses a chart that
 * writes both), and a pair with neither written is null. `<content>` is its
 * `expr` compiled, else its markup or text as written. The attributes and
 * `<content>` compile in that order and the first failure stops the rest,
 * `<param>` children included; the `<param>`s then each answer their own
 * failure. A `namelist` entry is a location read by its own name, and its
 * compile failure is deferred to when the send runs.
 */
function compileSend(walk: Walk, node: Send, cIndex: number): ContentNode {
  const owner: ExpressionOwner = { kind: "content", cIndex };
  const site = (attribute: SendAttribute): Site => ({
    owner,
    element: "send",
    attribute,
    location: node.attributeLocations[attribute] ?? node.location,
  });
  const pair = (
    value: string | null,
    source: string | null,
    attribute: SendAttribute,
  ): Compiled | null => {
    if (value !== null) return { ok: true, expr: staticExpr(value) };
    if (source === null) return null;
    return compileExpr(source, site(attribute));
  };

  const namelistSite = site("namelist");
  const namelist = node.namelist.map((name): ParamNode => {
    const compiled = compileExpr(name, namelistSite);
    return { name, expr: compiled.ok ? compiled.expr : invalidOf(compiled.error) };
  });

  const slots: (() => Compiled | null)[] = [
    () => pair(node.event, node.eventexpr, "eventexpr"),
    () => pair(node.target, node.targetexpr, "targetexpr"),
    () => pair(node.type, node.typeexpr, "typeexpr"),
    () => pair(node.delay, node.delayexpr, "delayexpr"),
    () => (node.content === null ? null : contentValue(node.content, owner)),
  ];
  const folded: (Expr | null)[] = [];
  for (const slot of slots) {
    const compiled = slot();
    if (compiled !== null && !compiled.ok) {
      walk.contentErrors.push(compiled.error);
      break;
    }
    folded.push(compiled === null ? null : compiled.expr);
  }

  const params: ParamNode[] = [];
  if (folded.length === slots.length) {
    for (const param of node.params) {
      const built = compileParam(param, owner);
      if (isCompilerError(built)) walk.contentErrors.push(built);
      else params.push({ name: built.name, expr: built.expr });
    }
  }

  const [event = null, target = null, type = null, delay = null, content = null] = folded;
  return {
    kind: "send",
    cIndex,
    event,
    target,
    type,
    id: node.id,
    idlocation: node.idlocation,
    delay,
    namelist,
    params,
    content,
  };
}

/** A `<cancel>`: `sendid` as a literal, else `sendidexpr` compiled; the validator guarantees one. */
function compileCancel(walk: Walk, node: Cancel, cIndex: number): ContentNode {
  if (node.sendid !== null) return { kind: "cancel", cIndex, sendid: staticExpr(node.sendid) };
  if (node.sendidexpr === null) {
    throw new Error("the compiler met a <cancel> with neither sendid nor sendidexpr");
  }
  const compiled = compileExpr(node.sendidexpr, {
    owner: { kind: "content", cIndex },
    element: "cancel",
    attribute: "sendidexpr",
    location: node.attributeLocations.sendidexpr ?? node.location,
  });
  if (compiled.ok) return { kind: "cancel", cIndex, sendid: compiled.expr };
  walk.contentErrors.push(compiled.error);
  return { kind: "cancel", cIndex, sendid: invalidOf(compiled.error) };
}

// ---------------------------------------------------------------------------
// Data, donedata, params and invoke
// ---------------------------------------------------------------------------

function assignData(walk: Walk, datamodel: Datamodel | null, stateIndex: number): void {
  if (datamodel === null) return;
  const owned = walk.dataByState.get(stateIndex) ?? [];
  for (const data of datamodel.data) {
    const dIndex = walk.data.length;
    const { value, valueLocation } = dataValue(data, dIndex);
    walk.data.push({ dIndex, id: data.id, value, location: data.location, valueLocation });
    owned.push(dIndex);
  }
  walk.dataByState.set(stateIndex, owned);
}

/**
 * A `<data>`'s value, in the specification's precedence: `expr` (a compile
 * failure deferred to when the datamodel binds it), then `src`, then the
 * text folded as an in-line value, then null.
 */
function dataValue(data: Data, dIndex: number): { value: DataValue; valueLocation: Location } {
  if (data.expr !== null) {
    const valueLocation = data.attributeLocations.expr ?? data.location;
    const compiled = compileExpr(data.expr, {
      owner: { kind: "data", dIndex },
      element: "data",
      attribute: "expr",
      location: valueLocation,
    });
    return { value: compiled.ok ? compiled.expr : invalidOf(compiled.error), valueLocation };
  }
  if (data.src !== null) {
    return {
      value: { kind: "src", src: data.src },
      valueLocation: data.attributeLocations.src ?? data.location,
    };
  }
  if (isBlank(data.text)) return { value: staticExpr(null), valueLocation: data.location };
  return { value: inlineValue(data.text), valueLocation: data.location };
}

/**
 * A `<content>`'s value: its `expr` compiled, else its markup children as a
 * string, else its text as written.
 */
function contentValue(content: Content, owner: ExpressionOwner): Compiled {
  if (content.expr === null) {
    return { ok: true, expr: staticExpr(content.markup ?? content.text) };
  }
  return compileExpr(content.expr, {
    owner,
    element: "content",
    attribute: "expr",
    location: content.attributeLocations.expr ?? content.location,
  });
}

/**
 * A `<param>`'s `expr` when it has no `location`, else its `location`. The
 * validator guarantees at least one under a `<send>`, `<donedata>` or
 * `<invoke>`, and exactly one under the last two.
 */
function compileParam(param: Param, owner: ExpressionOwner): CompiledParam | CompilerError {
  const kind = param.expr !== null && param.paramLocation === null ? "expr" : "location";
  const source = kind === "expr" ? param.expr : param.paramLocation;
  if (source === null) {
    throw new Error(`the compiler met a <param> ${JSON.stringify(param.name)} with no value`);
  }
  const exprLocation =
    (kind === "expr" ? param.attributeLocations.expr : param.attributeLocations.location) ??
    param.location;
  const compiled = compileExpr(source, {
    owner,
    element: "param",
    attribute: kind,
    location: exprLocation,
  });
  if (!compiled.ok) return compiled.error;
  return { name: param.name, kind, expr: compiled.expr, exprLocation, location: param.location };
}

function isCompilerError(value: CompiledParam | CompilerError): value is CompilerError {
  return "reason" in value;
}

function buildDonedata(walk: Walk, stateIndex: number, donedata: Donedata): CompiledDonedata {
  const owner: ExpressionOwner = { kind: "donedata", stateIndex };
  if (donedata.content !== null) {
    const content = donedata.content;
    const compiled = contentValue(content, owner);
    if (!compiled.ok) walk.donedataErrors.push(compiled.error);
    return {
      location: donedata.location,
      expr: compiled.ok ? compiled.expr : null,
      exprLocation:
        content.expr === null
          ? (content.markupLocation ?? content.location)
          : (content.attributeLocations.expr ?? content.location),
      params: [],
    };
  }
  const params: CompiledParam[] = [];
  for (const param of donedata.params) {
    const built = compileParam(param, owner);
    if (isCompilerError(built)) walk.donedataErrors.push(built);
    else params.push(built);
  }
  return { location: donedata.location, expr: null, exprLocation: null, params };
}

function buildInvoke(
  walk: Walk,
  node: Invoke,
  stateIndex: number,
  invokeIndex: number,
): CompiledInvoke {
  const owner: ExpressionOwner = { kind: "invoke", stateIndex, invokeIndex };

  // The literal attribute wins over its expression twin; the validator
  // refuses a chart that writes both.
  const pair = (value: string | null, source: string | null, attribute: "typeexpr" | "srcexpr") => {
    if (value !== null) return staticExpr(value);
    if (source === null) return null;
    const compiled = compileExpr(source, {
      owner,
      element: "invoke",
      attribute,
      location: node.attributeLocations[attribute] ?? node.location,
    });
    if (compiled.ok) return compiled.expr;
    walk.invokeErrors.push(compiled.error);
    return null;
  };

  let content: Expr | null = null;
  if (node.content !== null) {
    const compiled = contentValue(node.content, owner);
    if (compiled.ok) content = compiled.expr;
    else walk.invokeErrors.push(compiled.error);
  }

  const params: CompiledParam[] = [];
  for (const param of node.params) {
    const built = compileParam(param, owner);
    if (isCompilerError(built)) walk.invokeErrors.push(built);
    else params.push(built);
  }

  // A namelist entry is a location read by its own name; a compile failure is
  // deferred to when the invocation starts.
  const namelistLocation = node.attributeLocations.namelist ?? node.location;
  const namelist = node.namelist.map((name): CompiledParam => {
    const compiled = compileExpr(name, {
      owner,
      element: "invoke",
      attribute: "namelist",
      location: namelistLocation,
    });
    return {
      name,
      kind: "location",
      expr: compiled.ok ? compiled.expr : invalidOf(compiled.error),
      exprLocation: namelistLocation,
      location: node.location,
    };
  });

  const finalize =
    node.finalize === null
      ? null
      : {
          location: node.finalize.location,
          content: compileContentList(walk, node.finalize.content),
        };

  return {
    index: invokeIndex,
    location: node.location,
    type: pair(node.type, node.typeexpr, "typeexpr"),
    src: pair(node.src, node.srcexpr, "srcexpr"),
    id: node.id,
    idlocation: node.idlocation,
    namelist,
    params,
    content,
    autoforward: node.autoforward,
    finalize,
    attributeLocations: node.attributeLocations,
  };
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * A chart's identity: `sha256:` and the lowercase hexadecimal SHA-256 of its
 * source's UTF-8 bytes, beside the name and version the host gave it. Two
 * byte-identical sources have the same hash whatever the compiler does.
 */
export interface ChartIdentity {
  readonly contentHash: string;
  readonly name: string | null;
  readonly version: string | null;
}

/**
 * A compiled chart: its identity and its Machine.
 *
 * The identity lives here, on the wrapper, by choice: the reference stamps
 * its identity onto its Machine, and this package keeps it on the `Chart`,
 * which every driver call that moves a chart takes. `machine` is opaque and
 * unstable: a host passes the `Chart` on and reads none of the Machine's
 * members, whose shape changes without notice until a release fixes it.
 * ADR-0002 (the core contract) records both choices.
 */
export interface Chart {
  readonly identity: ChartIdentity;
  readonly machine: Machine;
}

/** What `compile` takes beside the source: the host's name and version for the chart. */
export interface CompileOptions {
  readonly chartName?: string;
  readonly chartVersion?: string;
}

/**
 * Why a chart did not compile, from whichever stage refused it: the parser,
 * the lowering, the validator, or the compiler's own refusal of an expression.
 */
export type CompileError = ParseError | LoweringError | ValidationError | CompilerError;

export type CompileResult =
  | { readonly ok: true; readonly chart: Chart }
  | { readonly ok: false; readonly errors: readonly CompileError[] };

/** The identity of a chart compiled from `source`. */
export function chartIdentity(source: string, options: CompileOptions = {}): ChartIdentity {
  return {
    contentHash: `sha256:${sha256Hex(utf8Bytes(source))}`,
    name: options.chartName ?? null,
    version: options.chartVersion ?? null,
  };
}

/**
 * Compiles SCXML text into a Chart: parse, lower, validate, compile, in that
 * order, stopping at the first stage that refuses. Every refusal is answered
 * as a list, the parser's single error included, so every stage fails in one
 * shape.
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const parsed = parseXml(source);
  if (!parsed.ok) return { ok: false, errors: [parsed.error] };
  const lowered = lower(parsed.root, source);
  if (!lowered.ok) return lowered;
  const validated = validate(lowered.document, source);
  if (!validated.ok) return validated;
  const compiled = compileDocument(validated.document);
  if (!compiled.ok) return compiled;
  return {
    ok: true,
    chart: { identity: chartIdentity(source, options), machine: compiled.machine },
  };
}
