// The typed chart in, the chart or every error it carries out.
//
// The third arrow of the pipeline, ported from the reference's validator
// (`Statifier.Validator` and the checks under `Statifier.Validator.Checks.*`
// in statifier-ex at v2.9.0). Lowering builds what is written; the validator
// holds what was built to the rules that gate compilation, and it is the only
// place a malformed chart is caught before the compiler.
//
// Only the error checks are here. The reference's second, non-fatal channel
// (its warning tier) is out of this package, and so are expression-level
// source spans: the charter record says so.
//
// Four contracts, the reference's own:
//
// - Collect-all. Every check runs over the whole chart on every call; a chart
//   that breaks five rules answers five errors.
// - Source order. The errors are sorted by where they start, whichever check
//   found them first; errors at one offset keep the order the checks ran in.
// - Never a partial result. The chart is answered only when there is no
//   error, and it is the caller's own chart, unchanged.
// - `source` is the chart's own text. The enumerated attributes are read back
//   out of it: lowering maps an out-of-range value onto the attribute's
//   default, so only the text as written can tell `type="external"` from a
//   misspelling of it.
//
// Where lowering already refuses a shape, no check here repeats it: a
// `<foreach>` without `array` or `item` and a `<script>` with `src` never
// reach the validator. Which `<send>` targets and types the engine can
// deliver is decided when the chart is compiled, not here.
//
// Each check reaches exactly the nodes the reference's reaches, with one
// exception. Where the reference's walk stops short (a `<content>` under
// `<send>` is not read by the content rule; an `<assign>`, `<if>` or
// `<script>` inside `<finalize>` is not read by theirs), this walk stops at
// the same place, so the two engines refuse the same charts. The exception is
// a `<param>` under `<send>` with neither `expr` nor `location`: the
// reference's compiler raises on it, and this validator refuses it instead,
// so the chart is answered as an error rather than a throw.

import { acceptsDatamodel } from "./datamodel.js";
import type { Content, Data, Datamodel, Param } from "./document/data.js";
import type { Assign, Cancel, If, Script } from "./document/executable.js";
import type { Invoke } from "./document/invoke.js";
import type { AttributeLocations, ContentNode, Document, StateKind } from "./document/scxml.js";
import type { Block, State, Transition } from "./document/states.js";
import { isBlank, SCXML_NAMESPACE } from "./lowering.js";
import type { Location } from "./xml/parser.js";

/**
 * The slot a default transition's rule was broken in: a state's `<initial>`
 * element, or a history state's own transition. `id` is the owning state's.
 */
export interface DefaultTransitionOwner {
  readonly kind: "initial" | "history";
  readonly id: string | null;
}

/** Why a chart does not validate, with the detail each reason carries. */
export type ValidationError =
  | ErrorOf<"duplicate_id", { readonly id: string }>
  | ErrorOf<"empty_id", Empty>
  | ErrorOf<"unresolved_target", { readonly id: string }>
  | ErrorOf<"unresolved_initial", { readonly id: string }>
  | ErrorOf<"initial_not_descendant", { readonly id: string; readonly parentId: string }>
  | ErrorOf<"initial_on_atomic_state", { readonly id: string }>
  | ErrorOf<"initial_attribute_and_element", { readonly id: string | null }>
  | ErrorOf<"transition_count", { readonly owner: DefaultTransitionOwner; readonly count: number }>
  | ErrorOf<"transition_missing_target", { readonly owner: DefaultTransitionOwner }>
  | ErrorOf<
      "transition_forbidden_attribute",
      { readonly owner: DefaultTransitionOwner; readonly attribute: "event" | "cond" }
    >
  | ErrorOf<
      "history_bad_parent",
      { readonly id: string | null; readonly parentKind: StateKind | "scxml" }
    >
  | ErrorOf<"history_bad_type", { readonly raw: string }>
  | ErrorOf<"transition_bad_type", { readonly raw: string }>
  | ErrorOf<"scxml_bad_binding", { readonly raw: string }>
  | ErrorOf<"final_has_states", { readonly id: string | null }>
  | ErrorOf<"final_has_transitions", { readonly id: string | null }>
  | ErrorOf<"final_parent_missing_id", { readonly finalId: string | null }>
  | ErrorOf<
      "default_entry_not_enterable",
      { readonly id: string | null; readonly childKind: StateKind }
    >
  | ErrorOf<"donedata_not_on_final", { readonly id: string | null }>
  | ErrorOf<"donedata_content_and_params", { readonly id: string | null }>
  | ErrorOf<"content_expr_and_text", { readonly expr: string }>
  | ErrorOf<"param_expr_and_location", { readonly name: string }>
  | ErrorOf<"param_no_value", { readonly name: string }>
  | ErrorOf<"bad_namespace", { readonly uri: string | null }>
  | ErrorOf<"bad_version", { readonly version: string | null }>
  | ErrorOf<"scxml_bad_datamodel", { readonly raw: string }>
  | ErrorOf<"data_expr_and_src", { readonly id: string }>
  | ErrorOf<"data_value_and_children", { readonly id: string }>
  | ErrorOf<"data_reserved_id", { readonly id: string }>
  | ErrorOf<"datamodel_bad_parent", { readonly kind: StateKind }>
  | ErrorOf<"assign_expr_and_text", { readonly expr: string }>
  | ErrorOf<"if_elseif_after_else", Empty>
  | ErrorOf<"if_duplicate_else", Empty>
  | ErrorOf<"script_no_src_or_text", Empty>
  | ErrorOf<"invoke_type_and_typeexpr", Empty>
  | ErrorOf<"invoke_src_and_srcexpr", Empty>
  | ErrorOf<"invoke_src_and_content", Empty>
  | ErrorOf<"invoke_id_and_idlocation", Empty>
  | ErrorOf<"invoke_namelist_and_param", Empty>
  | ErrorOf<"invoke_bad_autoforward", { readonly raw: string }>
  | ErrorOf<"send_event_and_eventexpr", Empty>
  | ErrorOf<"send_target_and_targetexpr", Empty>
  | ErrorOf<"send_type_and_typeexpr", Empty>
  | ErrorOf<"send_id_and_idlocation", Empty>
  | ErrorOf<"send_delay_and_delayexpr", Empty>
  | ErrorOf<"send_delay_and_internal_target", Empty>
  | ErrorOf<"send_namelist_and_content", Empty>
  | ErrorOf<"send_param_and_content", Empty>
  | ErrorOf<"cancel_sendid_and_sendidexpr", Empty>
  | ErrorOf<"cancel_no_sendid", Empty>;

type Empty = Readonly<Record<never, never>>;

type ErrorOf<R extends string, D> = {
  readonly reason: R;
  readonly message: string;
  readonly location: Location;
} & D;

/** The reason tokens a validation error can carry. */
export type ValidationErrorReason = ValidationError["reason"];

export type ValidationResult =
  | { readonly ok: true; readonly document: Document }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

/**
 * Holds `chart` to every rule that gates compilation. `source` must be the
 * text `chart` was lowered from: the enumerated attributes are read back
 * out of it.
 *
 * Answers the chart, unchanged, when no rule is broken; otherwise every error
 * found, in source order.
 */
export function validate(chart: Document, source: string): ValidationResult {
  const index = buildIndex(chart);
  const errors = CHECKS.flatMap((check) => check(chart, index, source));
  if (errors.length === 0) return { ok: true, document: chart };
  // A stable sort, so errors at one offset keep the order the checks ran in.
  const sorted = [...errors].sort((a, b) => a.location.startOffset - b.location.startOffset);
  return { ok: false, errors: sorted };
}

type Check = (chart: Document, index: Index, source: string) => ValidationError[];

// The reference's check order; it decides the order of errors at one offset.
const CHECKS: readonly Check[] = [
  checkIds,
  checkTargets,
  checkInitialTargets,
  checkInitialElements,
  checkHistories,
  checkFinals,
  checkFinalParents,
  checkDefaultEntries,
  checkDonedata,
  checkContents,
  checkParams,
  checkBoilerplate,
  checkEnums,
  checkData,
  checkAssigns,
  checkIfs,
  checkScripts,
  checkInvokes,
  checkSends,
  checkCancels,
];

// ---------------------------------------------------------------------------
// The index the checks share, built once per call and never kept

interface Index {
  /** Every state, in document order (a parent before its children). */
  readonly all: readonly State[];
  /** The named states by id; a repeated id keeps its last occurrence. */
  readonly byId: ReadonlyMap<string, State>;
  /** Each named state's named ancestors, itself excluded. */
  readonly ancestors: ReadonlyMap<string, ReadonlySet<string>>;
  /** Each state's parent: another state, or the chart for a top-level one. */
  readonly parents: ReadonlyMap<State, State | Document>;
  /**
   * Every transition in the chart: each state's own, then its `<initial>`
   * element's (a history state's own only), in document order.
   */
  readonly transitions: readonly Transition[];
}

function buildIndex(chart: Document): Index {
  const all: State[] = [];
  const byId = new Map<string, State>();
  const ancestors = new Map<string, ReadonlySet<string>>();
  const parents = new Map<State, State | Document>();
  const transitions: Transition[] = [];

  const walk = (states: readonly State[], parent: State | Document, named: readonly string[]) => {
    for (const state of states) {
      all.push(state);
      parents.set(state, parent);
      if (state.id !== null) {
        byId.set(state.id, state);
        ancestors.set(state.id, new Set(named));
      }
      transitions.push(...state.transitions);
      if (state.kind !== "history" && state.initialElement !== null) {
        transitions.push(...state.initialElement.transitions);
      }
      walk(state.states, state, state.id === null ? named : [...named, state.id]);
    }
  };
  walk(chart.states, chart, []);

  return { all, byId, ancestors, parents, transitions };
}

function isDescendant(index: Index, ancestorId: string, id: string): boolean {
  return index.ancestors.get(id)?.has(ancestorId) ?? false;
}

// A state with children to enter: a `<state>` or `<parallel>` that has any.
function isCompound(state: State): boolean {
  return (state.kind === "state" || state.kind === "parallel") && state.states.length > 0;
}

// The value span of an attribute when it was written, else the element's own.
function spanOf<K extends string>(
  node: { readonly location: Location; readonly attributeLocations: AttributeLocations<K> },
  key: K,
): Location {
  return node.attributeLocations[key] ?? node.location;
}

function slice(location: Location, source: string): string {
  return source.slice(location.startOffset, location.endOffset);
}

// ---------------------------------------------------------------------------
// States: ids, targets, initial references, history, final, default entry

// Every id-typed attribute, a state's and a `<data>`'s, shares one uniqueness
// set. The first occurrence in source order is canonical; each later one is
// reported at its own span. An empty id is its own error and joins no set.
function checkIds(chart: Document, index: Index): ValidationError[] {
  const entries: { id: string | null; location: Location }[] = [];
  const addData = (datamodel: Datamodel | null) => {
    for (const data of datamodel?.data ?? []) {
      entries.push({ id: data.id, location: spanOf(data, "id") });
    }
  };
  addData(chart.datamodelElement);
  for (const state of index.all) {
    entries.push({ id: state.id, location: spanOf(state, "id") });
    addData(state.datamodelElement);
  }
  entries.sort((a, b) => a.location.startOffset - b.location.startOffset);

  const errors: ValidationError[] = [];
  for (const entry of entries) {
    if (entry.id === "") {
      errors.push({
        reason: "empty_id",
        message: "state id must not be empty - an absent id is legal, an empty one is not",
        location: entry.location,
      });
    }
  }
  const seen = new Set<string>();
  for (const { id, location } of entries) {
    if (id === null || id === "") continue;
    if (seen.has(id)) {
      errors.push({
        reason: "duplicate_id",
        id,
        message: `duplicate state id ${quote(id)}`,
        location,
      });
    }
    seen.add(id);
  }
  return errors;
}

// Every transition's targets resolve. This check owns existence: the checks
// after it skip an unresolved id rather than report it again.
function checkTargets(_document: Document, index: Index): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const transition of index.transitions) {
    const location = spanOf(transition, "target");
    for (const id of transition.target) {
      if (!index.byId.has(id)) {
        errors.push({
          reason: "unresolved_target",
          id,
          message: `transition target ${quote(id)} does not resolve to a state in the document`,
          location,
        });
      }
    }
  }
  return errors;
}

// Every `initial` reference resolves and lands on a descendant. A state with
// nothing to default into is reported once and nothing else is checked on it.
// The chart's own `initial` need only resolve: it has no containing state.
function checkInitialTargets(chart: Document, index: Index): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const state of index.all) {
    if (state.id === null) continue;
    if (state.initial.length === 0 && state.initialElement === null) continue;
    const parentId = state.id;

    if (state.states.length === 0 || state.kind !== "state") {
      errors.push({
        reason: "initial_on_atomic_state",
        id: parentId,
        message: `state ${quote(parentId)} has no child states to default into`,
        location:
          state.initial.length > 0 || state.initialElement === null
            ? spanOf(state, "initial")
            : state.initialElement.location,
      });
      continue;
    }

    const location = spanOf(state, "initial");
    for (const id of state.initial) {
      if (!index.byId.has(id)) {
        errors.push(unresolvedInitial(id, location));
      } else if (!isDescendant(index, parentId, id)) {
        errors.push(notDescendant(id, parentId, location));
      }
    }
    for (const transition of state.initialElement?.transitions ?? []) {
      errors.push(...descendancyErrors(transition, parentId, index));
    }
  }

  const location = spanOf(chart, "initial");
  for (const id of chart.initial) {
    if (!index.byId.has(id)) errors.push(unresolvedInitial(id, location));
  }
  return errors;
}

// A resolved target of `transition` that is not a descendant of `parentId`.
function descendancyErrors(
  transition: Transition,
  parentId: string,
  index: Index,
): ValidationError[] {
  const location = spanOf(transition, "target");
  return transition.target
    .filter((id) => index.byId.has(id) && !isDescendant(index, parentId, id))
    .map((id) => notDescendant(id, parentId, location));
}

function unresolvedInitial(id: string, location: Location): ValidationError {
  return {
    reason: "unresolved_initial",
    id,
    message: `initial state ${quote(id)} does not resolve to a state in the document`,
    location,
  };
}

function notDescendant(id: string, parentId: string, location: Location): ValidationError {
  return {
    reason: "initial_not_descendant",
    id,
    parentId,
    message: `initial state ${quote(id)} is not a descendant of ${quote(parentId)}`,
    location,
  };
}

// A state's `<initial>` element: not beside an `initial` attribute, and one
// default transition.
function checkInitialElements(_document: Document, index: Index): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const state of index.all) {
    const initial = state.initialElement;
    if (initial === null) continue;
    if (state.initial.length > 0) {
      errors.push({
        reason: "initial_attribute_and_element",
        id: state.id,
        message: `state ${quoteNullable(state.id)} has both an initial attribute and an <initial> element - at most one is legal`,
        location: initial.location,
      });
    }
    errors.push(
      ...defaultTransitionErrors(
        { kind: "initial", id: state.id },
        initial.transitions,
        initial.location,
      ),
    );
  }
  return errors;
}

// The content model an `<initial>` element and a history state share: exactly
// one transition, with a target, and neither `event` nor `cond`. A wrong count
// is reported at the owner, since there may be no transition to point at.
function defaultTransitionErrors(
  owner: DefaultTransitionOwner,
  transitions: readonly Transition[],
  ownerLocation: Location,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (transitions.length !== 1) {
    errors.push({
      reason: "transition_count",
      owner,
      count: transitions.length,
      message: `${describeOwner(owner)} must have exactly one transition, found ${transitions.length}`,
      location: ownerLocation,
    });
  }
  for (const transition of transitions) {
    if (transition.target.length === 0) {
      errors.push({
        reason: "transition_missing_target",
        owner,
        message: `${describeOwner(owner)} transition must specify a target`,
        location: transition.location,
      });
    }
    // An absent `event` and an empty one both lower to an empty list; only
    // the written attribute's span tells them apart.
    if (transition.attributeLocations.event !== undefined) {
      errors.push(forbiddenAttribute(owner, "event", transition));
    }
    if (transition.cond !== null) errors.push(forbiddenAttribute(owner, "cond", transition));
  }
  return errors;
}

function forbiddenAttribute(
  owner: DefaultTransitionOwner,
  attribute: "event" | "cond",
  transition: Transition,
): ValidationError {
  return {
    reason: "transition_forbidden_attribute",
    owner,
    attribute,
    message: `${describeOwner(owner)} transition must not specify ${attribute}`,
    location: spanOf(transition, attribute),
  };
}

function describeOwner(owner: DefaultTransitionOwner): string {
  const element = owner.kind === "initial" ? "<initial>" : "<history>";
  if (owner.id === null) return element;
  return owner.kind === "initial"
    ? `${element} on ${quote(owner.id)}`
    : `${element} ${quote(owner.id)}`;
}

// A history state: its parent, its default transition, that transition's
// target under the parent, and its `type` as written.
function checkHistories(_document: Document, index: Index, source: string): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const state of index.all) {
    if (state.kind !== "history") continue;
    const parent = index.parents.get(state);
    const compoundParent = parent !== undefined && isState(parent) && isCompound(parent);

    if (!compoundParent) {
      const parentKind = parent !== undefined && isState(parent) ? parent.kind : "scxml";
      errors.push({
        reason: "history_bad_parent",
        id: state.id,
        parentKind,
        message: `history ${quoteNullable(state.id)} must be a child of a compound <state> or <parallel>, not ${parentKind}`,
        location: state.location,
      });
    }
    errors.push(
      ...defaultTransitionErrors(
        { kind: "history", id: state.id },
        state.transitions,
        state.location,
      ),
    );
    // A non-compound parent is already reported; its descendancy says nothing.
    if (compoundParent && parent.id !== null) {
      for (const transition of state.transitions) {
        errors.push(...descendancyErrors(transition, parent.id, index));
      }
    }
    const typeSpan = state.attributeLocations.type;
    if (typeSpan !== undefined) {
      const raw = slice(typeSpan, source);
      if (raw !== "shallow" && raw !== "deep") {
        errors.push({
          reason: "history_bad_type",
          raw,
          message: `history type ${quote(raw)} must be "shallow" or "deep"`,
          location: typeSpan,
        });
      }
    }
  }
  return errors;
}

function isState(node: State | Document): node is State {
  return "kind" in node;
}

// A `<final>` holds `onentry`, `onexit` and `donedata` only. Each state or
// transition child is reported at its own span.
function checkFinals(_document: Document, index: Index): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const state of index.all) {
    if (state.kind !== "final") continue;
    for (const child of state.states) {
      errors.push({
        reason: "final_has_states",
        id: child.id,
        message: `state ${quoteNullable(child.id)} must not be a child of <final> - only onentry, onexit, and donedata are legal there`,
        location: child.location,
      });
    }
    for (const transition of state.transitions) {
      errors.push({
        reason: "final_has_transitions",
        id: state.id,
        message: `state ${quoteNullable(state.id)} is a <final> and must not carry a <transition> - only onentry, onexit, and donedata are legal there`,
        location: transition.location,
      });
    }
  }
  return errors;
}

// A state holding a `<final>` needs an id: entering the final raises
// `done.state.` followed by it. Reported once per parent, at the parent. An
// empty id is the id check's; a top-level final raises no such event.
function checkFinalParents(_document: Document, index: Index): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const state of index.all) {
    if (state.id !== null) continue;
    const final = state.states.find((child) => child.kind === "final");
    if (final === undefined) continue;
    errors.push({
      reason: "final_parent_missing_id",
      finalId: final.id,
      message:
        "a state containing a <final> child must have an id - its completion event is named done.state.<id>",
      location: state.location,
    });
  }
  return errors;
}

// A `<state>` with no initial of either form enters its first child, which
// must not be a history state. A `<parallel>` enters every child, so it has
// no first child to be wrong about.
function checkDefaultEntries(_document: Document, index: Index): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const state of index.all) {
    if (state.kind !== "state" || state.initial.length > 0 || state.initialElement !== null) {
      continue;
    }
    const first = state.states[0];
    if (first === undefined || first.kind !== "history") continue;
    errors.push({
      reason: "default_entry_not_enterable",
      id: state.id,
      childKind: "history",
      message: `state ${quoteNullable(state.id)} has no initial attribute or <initial> element, and its first child is a history pseudo-state, which cannot be entered by default`,
      location: first.location,
    });
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Payloads: donedata, content, param, data

function checkDonedata(_document: Document, index: Index): ValidationError[] {
  const notOnFinal: ValidationError[] = [];
  const contentAndParams: ValidationError[] = [];
  for (const state of index.all) {
    const donedata = state.donedata;
    if (donedata === null) continue;
    if (state.kind !== "final") {
      notOnFinal.push({
        reason: "donedata_not_on_final",
        id: state.id,
        message: `state ${quoteNullable(state.id)} carries <donedata>, which is only legal on <final>`,
        location: donedata.location,
      });
    }
    if (donedata.content !== null && donedata.params.length > 0) {
      contentAndParams.push({
        reason: "donedata_content_and_params",
        id: state.id,
        message: `<donedata> on ${quoteNullable(state.id)} must not specify both a <content> child and one or more <param> children`,
        location: donedata.location,
      });
    }
  }
  return [...notOnFinal, ...contentAndParams];
}

// A `<content>` under a `<donedata>` or an `<invoke>` carries `expr` or an
// in-line payload, not both. Blank text is formatting, not a payload.
function checkContents(_document: Document, index: Index): ValidationError[] {
  const contents: Content[] = [];
  for (const state of index.all) {
    if (state.donedata?.content) contents.push(state.donedata.content);
    for (const invoke of state.invoke) if (invoke.content !== null) contents.push(invoke.content);
  }
  const errors: ValidationError[] = [];
  for (const content of contents) {
    if (content.expr === null) continue;
    const payload = content.markup !== null ? "markup" : isBlank(content.text) ? null : "text";
    if (payload === null) continue;
    errors.push({
      reason: "content_expr_and_text",
      expr: content.expr,
      message: `<content> must not specify both an expr attribute (${quote(content.expr)}) and inline ${payload}`,
      location: content.location,
    });
  }
  return errors;
}

// A `<param>` under a `<donedata>` or an `<invoke>` carries exactly one of
// `expr` and `location`. A `<param>` under a `<send>`, one in a `<finalize>`
// included, carries at least one: the reference's rule does not reach it and
// its compiler raises on one with neither, where this check answers the
// reference's own `param_no_value`. One with both compiles its `location`,
// as the reference's compiler does, so it is not refused here.
function checkParams(_document: Document, index: Index): ValidationError[] {
  const params: Param[] = [];
  for (const state of index.all) {
    params.push(...(state.donedata?.params ?? []));
    for (const invoke of state.invoke) params.push(...invoke.params);
  }
  const errors: ValidationError[] = [];
  for (const send of nodesOf(index, "send", true)) {
    for (const param of send.params) {
      if (param.expr === null && param.paramLocation === null) errors.push(paramNoValue(param));
    }
  }
  for (const param of params) {
    if (param.expr === null && param.paramLocation === null) {
      errors.push(paramNoValue(param));
    } else if (param.expr !== null && param.paramLocation !== null) {
      errors.push({
        reason: "param_expr_and_location",
        name: param.name,
        message: `<param> ${quote(param.name)} must not specify both an expr attribute and a location attribute`,
        location: param.location,
      });
    }
  }
  return errors;
}

function paramNoValue(param: Param): ValidationError {
  return {
    reason: "param_no_value",
    name: param.name,
    message: `<param> ${quote(param.name)} must specify either an expr attribute or a location attribute`,
    location: param.location,
  };
}

// `<datamodel>` and `<data>`: a `<data>` carries at most one of `expr` and
// `src`, no child text beside either, and no id beginning with `_`; a
// `<datamodel>` sits under `<scxml>`, `<state>` or `<parallel>` only.
function checkData(chart: Document, index: Index): ValidationError[] {
  const data: Data[] = [...(chart.datamodelElement?.data ?? [])];
  for (const state of index.all) data.push(...(state.datamodelElement?.data ?? []));

  const errors: ValidationError[] = [];
  for (const entry of data) {
    const { id } = entry;
    const location = spanOf(entry, "id");
    if (entry.expr !== null && entry.src !== null) {
      errors.push({
        reason: "data_expr_and_src",
        id,
        message: `<data> ${quote(id)} must not specify both expr and src`,
        location,
      });
    }
    if ((entry.expr !== null || entry.src !== null) && !isBlank(entry.text)) {
      errors.push({
        reason: "data_value_and_children",
        id,
        message: `<data> ${quote(id)} must not specify expr or src together with child content`,
        location,
      });
    }
    if (id.startsWith("_")) {
      errors.push({
        reason: "data_reserved_id",
        id,
        message: `<data> id ${quote(id)} must not begin with "_" - that prefix is reserved`,
        location,
      });
    }
  }
  for (const state of index.all) {
    const datamodel = state.datamodelElement;
    if (datamodel === null || (state.kind !== "final" && state.kind !== "history")) continue;
    errors.push({
      reason: "datamodel_bad_parent",
      kind: state.kind,
      message: `<datamodel> must not be a child of a ${state.kind} state`,
      location: datamodel.location,
    });
  }
  return errors;
}

// ---------------------------------------------------------------------------
// The root: namespace, version and the enumerated attributes

function checkBoilerplate(chart: Document): ValidationError[] {
  const errors: ValidationError[] = [];
  if (chart.namespace !== SCXML_NAMESPACE) {
    const uri = chart.namespace;
    errors.push({
      reason: "bad_namespace",
      uri,
      message:
        uri === null
          ? `the root element declares no namespace - expected xmlns=${quote(SCXML_NAMESPACE)}`
          : `the root element's namespace ${quote(uri)} is not the SCXML namespace ${quote(SCXML_NAMESPACE)}`,
      location: spanOf(chart, "xmlns"),
    });
  }
  if (chart.version !== "1.0") {
    const version = chart.version;
    errors.push({
      reason: "bad_version",
      version,
      message:
        version === null
          ? 'the root element has no version attribute, expected "1.0"'
          : `the root element's version ${quote(version)} must be "1.0"`,
      location: spanOf(chart, "version"),
    });
  }
  return errors;
}

// An enumerated attribute, where written, holds one of its values as written.
// An absent one is its default, which is always in range.
function checkEnums(chart: Document, index: Index, source: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const outOfRange = (span: Location | undefined, accepts: (raw: string) => boolean) => {
    if (span === undefined) return null;
    const raw = slice(span, source);
    return accepts(raw) ? null : raw;
  };

  for (const transition of index.transitions) {
    const span = transition.attributeLocations.type;
    const raw = outOfRange(span, (value) => value === "internal" || value === "external");
    if (raw !== null && span !== undefined) {
      errors.push({
        reason: "transition_bad_type",
        raw,
        message: `transition type ${quote(raw)} must be "internal" or "external"`,
        location: span,
      });
    }
  }

  const binding = chart.attributeLocations.binding;
  const rawBinding = outOfRange(binding, (value) => value === "early" || value === "late");
  if (rawBinding !== null && binding !== undefined) {
    errors.push({
      reason: "scxml_bad_binding",
      raw: rawBinding,
      message: `binding ${quote(rawBinding)} must be "early" or "late"`,
      location: binding,
    });
  }

  const datamodel = chart.attributeLocations.datamodel;
  const rawDatamodel = outOfRange(datamodel, acceptsDatamodel);
  if (rawDatamodel !== null && datamodel !== undefined) {
    errors.push({
      reason: "scxml_bad_datamodel",
      raw: rawDatamodel,
      message: `datamodel ${quote(rawDatamodel)} must be one of "predicator", "elixir", "null", "ecmascript", or "xpath"`,
      location: datamodel,
    });
  }

  for (const state of index.all) {
    for (const invoke of state.invoke) {
      const span = invoke.attributeLocations.autoforward;
      const raw = outOfRange(span, (value) => value === "true" || value === "false");
      if (raw !== null && span !== undefined) {
        errors.push({
          reason: "invoke_bad_autoforward",
          raw,
          message: `invoke autoforward ${quote(raw)} must be "true" or "false"`,
          location: span,
        });
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Executable content: assign, if, script, invoke, send, cancel

// The executable content a state holds in its `onentry` and `onexit` blocks,
// its own transitions and its `<initial>` element's, in that order; with
// `finalize`, each `<invoke>`'s `<finalize>` block after them.
function stateContent(state: State, finalize: boolean): ContentNode[] {
  const content: ContentNode[] = [];
  const blocks = (list: readonly Block[]) => {
    for (const block of list) content.push(...block.content);
  };
  const transitions = (list: readonly Transition[]) => {
    for (const transition of list) content.push(...transition.content);
  };
  blocks(state.onentry);
  blocks(state.onexit);
  transitions(state.transitions);
  transitions(state.initialElement?.transitions ?? []);
  if (finalize) {
    for (const invoke of state.invoke) if (invoke.finalize !== null) blocks([invoke.finalize]);
  }
  return content;
}

// Every node in `content`, with an `<if>`'s branches and a `<foreach>`'s body
// read in place of the `<if>` and the `<foreach>` themselves.
function descend(content: readonly ContentNode[]): ContentNode[] {
  return content.flatMap((node): ContentNode[] => {
    if (node.kind === "if") return descend(node.branches.flatMap((branch) => branch.content));
    if (node.kind === "foreach") return descend(node.content);
    return [node];
  });
}

function nodesOf<K extends ContentNode["kind"]>(
  index: Index,
  kind: K,
  finalize: boolean,
): Extract<ContentNode, { kind: K }>[] {
  return index.all
    .flatMap((state) => descend(stateContent(state, finalize)))
    .filter((node): node is Extract<ContentNode, { kind: K }> => node.kind === kind);
}

// An `<assign>` carries `expr` or an in-line value, not both.
function checkAssigns(_document: Document, index: Index): ValidationError[] {
  return nodesOf(index, "assign", false).flatMap((assign: Assign): ValidationError[] => {
    if (assign.expr === null || (assign.markup === null && isBlank(assign.text))) return [];
    return [
      {
        reason: "assign_expr_and_text",
        expr: assign.expr,
        message: `<assign> must not specify both an expr attribute (${quote(assign.expr)}) and child content`,
        location: assign.nodeLocation,
      },
    ];
  });
}

// An `<if>`'s `<else>` comes last and at most once. After the first `<else>`,
// each branch is reported at its own span: another `<else>` as a duplicate,
// an `<elseif>` as out of order.
function checkIfs(_document: Document, index: Index): ValidationError[] {
  const ifs: If[] = [];
  const collect = (content: readonly ContentNode[]) => {
    for (const node of content) {
      if (node.kind === "if") {
        ifs.push(node);
        collect(node.branches.flatMap((branch) => branch.content));
      } else if (node.kind === "foreach") {
        collect(node.content);
      }
    }
  };
  for (const state of index.all) collect(stateContent(state, false));

  const errors: ValidationError[] = [];
  for (const node of ifs) {
    let seenElse = false;
    for (const branch of node.branches) {
      if (seenElse) {
        errors.push(
          branch.cond === null
            ? {
                reason: "if_duplicate_else",
                message: "<if> must not carry more than one <else> branch",
                location: branch.location,
              }
            : {
                reason: "if_elseif_after_else",
                message:
                  "<elseif> must not follow <else> - <else> must occur after all <elseif> tags",
                location: branch.location,
              },
        );
      } else if (branch.cond === null) {
        seenElse = true;
      }
    }
  }
  return errors;
}

// A `<script>` carries a program. One with `src` does not lower, so what is
// left to catch is a script with no text.
function checkScripts(chart: Document, index: Index): ValidationError[] {
  const scripts: Script[] = [...nodesOf(index, "script", false), ...chart.scripts];
  return scripts
    .filter((script) => isBlank(script.text))
    .map((script) => ({
      reason: "script_no_src_or_text",
      message: "<script> must specify either the src attribute or child content",
      location: script.location,
    }));
}

// The pairs an `<invoke>` must not write together, each reported at the
// `<invoke>`.
function checkInvokes(_document: Document, index: Index): ValidationError[] {
  const errors: ValidationError[] = [];
  const invokes: Invoke[] = index.all.flatMap((state) => state.invoke);
  for (const invoke of invokes) {
    const at = (reason: InvokeReason, message: string) =>
      errors.push({
        reason,
        message: `<invoke> must not specify ${message}`,
        location: invoke.location,
      });
    if (invoke.type !== null && invoke.typeexpr !== null) {
      at("invoke_type_and_typeexpr", "both type and typeexpr");
    }
    if (invoke.src !== null && invoke.srcexpr !== null) {
      at("invoke_src_and_srcexpr", "both src and srcexpr");
    }
    if (invoke.content !== null && (invoke.src !== null || invoke.srcexpr !== null)) {
      at("invoke_src_and_content", "src or srcexpr together with a <content> child");
    }
    if (invoke.id !== null && invoke.idlocation !== null) {
      at("invoke_id_and_idlocation", "both id and idlocation");
    }
    if (invoke.namelist.length > 0 && invoke.params.length > 0) {
      at("invoke_namelist_and_param", "namelist together with a <param> child");
    }
  }
  return errors;
}

type InvokeReason =
  | "invoke_type_and_typeexpr"
  | "invoke_src_and_srcexpr"
  | "invoke_src_and_content"
  | "invoke_id_and_idlocation"
  | "invoke_namelist_and_param";

// The pairs a `<send>` must not write together, each reported at the
// `<send>`. `delay` beside `target="_internal"` is caught only when the
// target is written literally; a `targetexpr` is not known until it runs.
// That exactly one of `event`, `eventexpr` and `<content>` is written is not
// checked, as the reference does not: the specification's own mandatory tests
// write `event` beside `<content>`.
function checkSends(_document: Document, index: Index): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const send of nodesOf(index, "send", true)) {
    const at = (reason: SendReason, message: string) =>
      errors.push({
        reason,
        message: `<send> must not specify ${message}`,
        location: send.location,
      });
    if (send.event !== null && send.eventexpr !== null) {
      at("send_event_and_eventexpr", "both event and eventexpr");
    }
    if (send.target !== null && send.targetexpr !== null) {
      at("send_target_and_targetexpr", "both target and targetexpr");
    }
    if (send.type !== null && send.typeexpr !== null) {
      at("send_type_and_typeexpr", "both type and typeexpr");
    }
    if (send.id !== null && send.idlocation !== null) {
      at("send_id_and_idlocation", "both id and idlocation");
    }
    if (send.delay !== null && send.delayexpr !== null) {
      at("send_delay_and_delayexpr", "both delay and delayexpr");
    }
    const internal = send.target === "_internal" || send.target === "#_internal";
    if (internal && (send.delay !== null || send.delayexpr !== null)) {
      at("send_delay_and_internal_target", 'delay or delayexpr when target is "_internal"');
    }
    if (send.namelist.length > 0 && send.content !== null) {
      at("send_namelist_and_content", "namelist together with a <content> child");
    }
    if (send.params.length > 0 && send.content !== null) {
      at("send_param_and_content", "a <param> child together with a <content> child");
    }
  }
  return errors;
}

type SendReason =
  | "send_event_and_eventexpr"
  | "send_target_and_targetexpr"
  | "send_type_and_typeexpr"
  | "send_id_and_idlocation"
  | "send_delay_and_delayexpr"
  | "send_delay_and_internal_target"
  | "send_namelist_and_content"
  | "send_param_and_content";

// A `<cancel>` writes exactly one of `sendid` and `sendidexpr`.
function checkCancels(_document: Document, index: Index): ValidationError[] {
  return nodesOf(index, "cancel", true).flatMap((cancel: Cancel): ValidationError[] => {
    if (cancel.sendid === null && cancel.sendidexpr === null) {
      return [
        {
          reason: "cancel_no_sendid",
          message: "<cancel> must specify exactly one of sendid or sendidexpr",
          location: cancel.location,
        },
      ];
    }
    if (cancel.sendid !== null && cancel.sendidexpr !== null) {
      return [
        {
          reason: "cancel_sendid_and_sendidexpr",
          message: "<cancel> must not specify both sendid and sendidexpr",
          location: cancel.location,
        },
      ];
    }
    return [];
  });
}

// ---------------------------------------------------------------------------
// Messages

function quote(text: string): string {
  return JSON.stringify(text);
}

function quoteNullable(text: string | null): string {
  return text === null ? "null" : quote(text);
}
