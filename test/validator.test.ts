// The validator: one planted failure per rule, each asserted by its reason
// and the exact span it is reported at, then the contracts every call keeps.

import { describe, expect, it } from "vitest";
import type { Document } from "../src/document/scxml.js";
import { lower, SCXML_NAMESPACE } from "../src/lowering.js";
import { type ValidationError, type ValidationErrorReason, validate } from "../src/validator.js";
import { parseXml } from "../src/xml/parser.js";

const NS = SCXML_NAMESPACE;

// `@@` marks where the expected span starts and ends; the markers are removed
// before the chart is parsed.
function plant(template: string): { source: string; start: number; end: number } {
  const start = template.indexOf("@@");
  const end = template.indexOf("@@", start + 2);
  if (start < 0 || end < 0) throw new Error("a planted row needs two @@ markers");
  const source =
    template.slice(0, start) + template.slice(start + 2, end) + template.slice(end + 2);
  return { source, start, end: end - 2 };
}

function lowered(source: string): Document {
  const parsed = parseXml(source);
  if (!parsed.ok) throw new Error(`expected a parse, got ${parsed.error.message}`);
  const result = lower(parsed.root, source);
  if (!result.ok) {
    throw new Error(`expected a chart, got ${result.errors.map((e) => e.message).join("; ")}`);
  }
  return result.document;
}

function errorsOf(source: string): readonly ValidationError[] {
  const result = validate(lowered(source), source);
  return result.ok ? [] : result.errors;
}

// A chart in the SCXML namespace at version 1.0 holding `body`; `root` adds
// attributes to the `<scxml>` start tag.
function scxml(body: string, root = ""): string {
  return `<scxml xmlns="${NS}" version="1.0"${root}>${body}</scxml>`;
}

// A chart whose one state, `lent`, runs `content` on entry.
function onEntry(content: string): string {
  return scxml(`<state id="lent"><onentry>${content}</onentry></state>`);
}

interface Row {
  readonly check: string;
  readonly reason: ValidationErrorReason;
  readonly template: string;
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly message?: string;
}

const ROWS: readonly Row[] = [
  // Ids
  {
    check: "ids",
    reason: "duplicate_id",
    template: scxml('<state id="lent"/><state id="@@lent@@"/>'),
    detail: { id: "lent" },
  },
  {
    check: "ids: a <data> id and a state id share one set",
    reason: "duplicate_id",
    template: scxml('<state id="copies"/><datamodel><data id="@@copies@@"/></datamodel>'),
    detail: { id: "copies" },
  },
  { check: "ids", reason: "empty_id", template: scxml('<state id="@@@@"/>') },
  // Targets
  {
    check: "targets",
    reason: "unresolved_target",
    template: scxml('<state id="on_shelf"><transition event="lend" target="@@lent@@"/></state>'),
    detail: { id: "lent" },
  },
  // Initial references
  {
    check: "initial targets: the chart's own initial",
    reason: "unresolved_initial",
    template: scxml('<state id="on_shelf"/>', ' initial="@@lent@@"'),
    detail: { id: "lent" },
  },
  {
    check: "initial targets: a state's initial",
    reason: "unresolved_initial",
    template: scxml('<state id="lent" initial="@@renewed@@"><state id="kept"/></state>'),
    detail: { id: "renewed" },
  },
  {
    check: "initial targets",
    reason: "initial_not_descendant",
    template: scxml(
      '<state id="on_shelf"/><state id="lent" initial="@@on_shelf@@"><state id="renewed"/></state>',
    ),
    detail: { id: "on_shelf", parentId: "lent" },
  },
  {
    check: "initial targets",
    reason: "initial_on_atomic_state",
    template: scxml('<state id="lent" initial="@@renewed@@"/>'),
    detail: { id: "lent" },
  },
  {
    check: "initial element",
    reason: "initial_attribute_and_element",
    template: scxml(
      '<state id="lent" initial="renewed">@@<initial><transition target="renewed"/></initial>@@' +
        '<state id="renewed"/></state>',
    ),
    detail: { id: "lent" },
  },
  {
    check: "initial element",
    reason: "transition_count",
    template: scxml('<state id="lent">@@<initial/>@@<state id="renewed"/></state>'),
    detail: { owner: { kind: "initial", id: "lent" }, count: 0 },
  },
  {
    check: "initial element",
    reason: "transition_missing_target",
    template: scxml(
      '<state id="lent"><initial>@@<transition/>@@</initial><state id="renewed"/></state>',
    ),
    detail: { owner: { kind: "initial", id: "lent" } },
  },
  {
    check: "initial element",
    reason: "transition_forbidden_attribute",
    template: scxml(
      '<state id="lent"><initial><transition event="@@renew@@" target="renewed"/></initial>' +
        '<state id="renewed"/></state>',
    ),
    detail: { owner: { kind: "initial", id: "lent" }, attribute: "event" },
  },
  // History
  {
    check: "history",
    reason: "history_bad_parent",
    template: scxml(
      '<state id="on_shelf"/>@@<history id="last"><transition target="on_shelf"/></history>@@',
    ),
    detail: { id: "last", parentKind: "scxml" },
  },
  {
    check: "history",
    reason: "transition_count",
    template: scxml('<state id="lent"><state id="renewed"/>@@<history id="last"/>@@</state>'),
    detail: { owner: { kind: "history", id: "last" }, count: 0 },
  },
  {
    check: "history",
    reason: "transition_forbidden_attribute",
    template: scxml(
      '<state id="lent"><state id="renewed"/><history id="last">' +
        '<transition cond="@@overdue@@" target="renewed"/></history></state>',
    ),
    detail: { owner: { kind: "history", id: "last" }, attribute: "cond" },
  },
  {
    check: "history",
    reason: "initial_not_descendant",
    template: scxml(
      '<state id="on_shelf"/><state id="lent"><state id="renewed"/><history id="last">' +
        '<transition target="@@on_shelf@@"/></history></state>',
    ),
    detail: { id: "on_shelf", parentId: "lent" },
  },
  {
    check: "history",
    reason: "history_bad_type",
    template: scxml(
      '<state id="lent"><state id="renewed"/><history id="last" type="@@sideways@@">' +
        '<transition target="renewed"/></history></state>',
    ),
    detail: { raw: "sideways" },
  },
  // Final
  {
    check: "final",
    reason: "final_has_states",
    template: scxml('<final id="returned">@@<state id="shelved"/>@@</final>'),
    detail: { id: "shelved" },
  },
  {
    check: "final",
    reason: "final_has_transitions",
    template: scxml('<final id="returned">@@<transition target="returned"/>@@</final>'),
    detail: { id: "returned" },
  },
  {
    check: "final parent",
    reason: "final_parent_missing_id",
    template: scxml('@@<state><final id="returned"/></state>@@'),
    detail: { finalId: "returned" },
  },
  // Default entry
  {
    check: "default entry",
    reason: "default_entry_not_enterable",
    template: scxml(
      '<state id="lent">@@<history id="last"><transition target="renewed"/></history>@@' +
        '<state id="renewed"/></state>',
    ),
    detail: { id: "lent", childKind: "history" },
  },
  // Donedata, content, param
  {
    check: "donedata",
    reason: "donedata_not_on_final",
    template: scxml('<state id="lent">@@<donedata/>@@</state>'),
    detail: { id: "lent" },
  },
  {
    check: "donedata",
    reason: "donedata_content_and_params",
    template: scxml(
      '<final id="returned">@@<donedata><content expr="1"/><param name="copies" expr="2"/>' +
        "</donedata>@@</final>",
    ),
    detail: { id: "returned" },
  },
  {
    check: "content: text",
    reason: "content_expr_and_text",
    template: scxml(
      '<final id="returned"><donedata>@@<content expr="1">due</content>@@</donedata></final>',
    ),
    detail: { expr: "1" },
    message: "inline text",
  },
  {
    check: "content: markup, under an <invoke>",
    reason: "content_expr_and_text",
    template: scxml(
      '<state id="lent"><invoke>@@<content expr="1"><loan/></content>@@</invoke></state>',
    ),
    detail: { expr: "1" },
    message: "inline markup",
  },
  {
    check: "param",
    reason: "param_no_value",
    template: scxml('<final id="returned"><donedata>@@<param name="copies"/>@@</donedata></final>'),
    detail: { name: "copies" },
  },
  {
    check: "param: under an <invoke>",
    reason: "param_expr_and_location",
    template: scxml(
      '<state id="lent"><invoke>@@<param name="copies" expr="1" location="count"/>@@</invoke></state>',
    ),
    detail: { name: "copies" },
  },
  // Boilerplate
  {
    check: "boilerplate",
    reason: "bad_namespace",
    template: '@@<scxml version="1.0"><state id="on_shelf"/></scxml>@@',
    detail: { uri: null },
  },
  {
    check: "boilerplate",
    reason: "bad_version",
    template: `<scxml xmlns="${NS}" version="@@2.0@@"><state id="on_shelf"/></scxml>`,
    detail: { version: "2.0" },
  },
  // Enumerated attributes
  {
    check: "enums",
    reason: "transition_bad_type",
    template: scxml('<state id="on_shelf"><transition event="lend" type="@@sideways@@"/></state>'),
    detail: { raw: "sideways" },
  },
  {
    check: "enums",
    reason: "scxml_bad_binding",
    template: scxml('<state id="on_shelf"/>', ' binding="@@whenever@@"'),
    detail: { raw: "whenever" },
  },
  {
    check: "enums",
    reason: "scxml_bad_datamodel",
    template: scxml('<state id="on_shelf"/>', ' datamodel="@@javascript@@"'),
    detail: { raw: "javascript" },
  },
  {
    check: "enums",
    reason: "invoke_bad_autoforward",
    template: scxml('<state id="lent"><invoke autoforward="@@yes@@"/></state>'),
    detail: { raw: "yes" },
  },
  // Data
  {
    check: "data",
    reason: "data_expr_and_src",
    template: scxml('<datamodel><data id="@@copies@@" expr="1" src="copies.json"/></datamodel>'),
    detail: { id: "copies" },
  },
  {
    check: "data",
    reason: "data_value_and_children",
    template: scxml('<datamodel><data id="@@copies@@" expr="1">3</data></datamodel>'),
    detail: { id: "copies" },
  },
  {
    check: "data",
    reason: "data_reserved_id",
    template: scxml('<datamodel><data id="@@_copies@@"/></datamodel>'),
    detail: { id: "_copies" },
  },
  {
    check: "data",
    reason: "datamodel_bad_parent",
    template: scxml('<final id="returned">@@<datamodel/>@@</final>'),
    detail: { kind: "final" },
  },
  // Executable content
  {
    check: "assign",
    reason: "assign_expr_and_text",
    template: onEntry('@@<assign location="copies" expr="1">2</assign>@@'),
    detail: { expr: "1" },
  },
  {
    check: "assign: inside a <foreach> inside an <if>",
    reason: "assign_expr_and_text",
    template: onEntry(
      '<if cond="true"><foreach array="copies" item="copy">' +
        '@@<assign location="copy" expr="1"><loan/></assign>@@</foreach></if>',
    ),
    detail: { expr: "1" },
  },
  {
    check: "if",
    reason: "if_elseif_after_else",
    template: onEntry('<if cond="true"><else/>@@<elseif cond="false"/>@@</if>'),
  },
  {
    check: "if: nested in another <if>'s branch",
    reason: "if_duplicate_else",
    template: onEntry('<if cond="true"><if cond="false"><else/>@@<else/>@@</if></if>'),
  },
  {
    check: "script",
    reason: "script_no_src_or_text",
    template: onEntry("@@<script>  </script>@@"),
  },
  {
    check: "script: a child of the root",
    reason: "script_no_src_or_text",
    template: scxml('<state id="on_shelf"/>@@<script/>@@'),
  },
  {
    check: "invoke",
    reason: "invoke_type_and_typeexpr",
    template: scxml('<state id="lent">@@<invoke type="a" typeexpr="b"/>@@</state>'),
  },
  {
    check: "invoke",
    reason: "invoke_src_and_srcexpr",
    template: scxml('<state id="lent">@@<invoke src="a" srcexpr="b"/>@@</state>'),
  },
  {
    check: "invoke",
    reason: "invoke_src_and_content",
    template: scxml(
      '<state id="lent">@@<invoke srcexpr="a"><content>1</content></invoke>@@</state>',
    ),
  },
  {
    check: "invoke",
    reason: "invoke_id_and_idlocation",
    template: scxml('<state id="lent">@@<invoke id="a" idlocation="b"/>@@</state>'),
  },
  {
    check: "invoke",
    reason: "invoke_namelist_and_param",
    template: scxml(
      '<state id="lent">@@<invoke namelist="copies"><param name="copies" expr="1"/></invoke>@@</state>',
    ),
  },
  {
    check: "send",
    reason: "send_event_and_eventexpr",
    template: onEntry('@@<send event="a" eventexpr="b"/>@@'),
  },
  {
    check: "send",
    reason: "send_target_and_targetexpr",
    template: onEntry('@@<send event="a" target="b" targetexpr="c"/>@@'),
  },
  {
    check: "send",
    reason: "send_type_and_typeexpr",
    template: onEntry('@@<send event="a" type="b" typeexpr="c"/>@@'),
  },
  {
    check: "send",
    reason: "send_id_and_idlocation",
    template: onEntry('@@<send event="a" id="b" idlocation="c"/>@@'),
  },
  {
    check: "send",
    reason: "send_delay_and_delayexpr",
    template: onEntry('@@<send event="a" delay="1s" delayexpr="b"/>@@'),
  },
  {
    check: "send: the internal target, with the hash",
    reason: "send_delay_and_internal_target",
    template: onEntry('@@<send event="a" target="#_internal" delayexpr="b"/>@@'),
  },
  {
    check: "send",
    reason: "send_namelist_and_content",
    template: onEntry('@@<send namelist="copies"><content>1</content></send>@@'),
  },
  {
    check: "send: inside a <finalize>",
    reason: "send_param_and_content",
    template: scxml(
      '<state id="lent"><invoke><finalize>' +
        '@@<send><param name="copies" expr="1"/><content>1</content></send>@@' +
        "</finalize></invoke></state>",
    ),
  },
  {
    check: "cancel",
    reason: "cancel_no_sendid",
    template: onEntry("@@<cancel/>@@"),
  },
  {
    check: "cancel: on a transition",
    reason: "cancel_sendid_and_sendidexpr",
    template: scxml(
      '<state id="lent"><transition event="return">' +
        '@@<cancel sendid="a" sendidexpr="b"/>@@</transition></state>',
    ),
  },
];

// Every reason token, as a record so the compiler refuses a reason added to
// the union without a key here, and the test below refuses a key with no row.
const EVERY_REASON: Readonly<Record<ValidationErrorReason, true>> = {
  duplicate_id: true,
  empty_id: true,
  unresolved_target: true,
  unresolved_initial: true,
  initial_not_descendant: true,
  initial_on_atomic_state: true,
  initial_attribute_and_element: true,
  transition_count: true,
  transition_missing_target: true,
  transition_forbidden_attribute: true,
  history_bad_parent: true,
  history_bad_type: true,
  transition_bad_type: true,
  scxml_bad_binding: true,
  final_has_states: true,
  final_has_transitions: true,
  final_parent_missing_id: true,
  default_entry_not_enterable: true,
  donedata_not_on_final: true,
  donedata_content_and_params: true,
  content_expr_and_text: true,
  param_expr_and_location: true,
  param_no_value: true,
  bad_namespace: true,
  bad_version: true,
  scxml_bad_datamodel: true,
  data_expr_and_src: true,
  data_value_and_children: true,
  data_reserved_id: true,
  datamodel_bad_parent: true,
  assign_expr_and_text: true,
  if_elseif_after_else: true,
  if_duplicate_else: true,
  script_no_src_or_text: true,
  invoke_type_and_typeexpr: true,
  invoke_src_and_srcexpr: true,
  invoke_src_and_content: true,
  invoke_id_and_idlocation: true,
  invoke_namelist_and_param: true,
  invoke_bad_autoforward: true,
  send_event_and_eventexpr: true,
  send_target_and_targetexpr: true,
  send_type_and_typeexpr: true,
  send_id_and_idlocation: true,
  send_delay_and_delayexpr: true,
  send_delay_and_internal_target: true,
  send_namelist_and_content: true,
  send_param_and_content: true,
  cancel_sendid_and_sendidexpr: true,
  cancel_no_sendid: true,
};

describe("the error checks", () => {
  // Sabotage: flipping a check's condition, or reporting it at another span,
  // turns that check's rows red.
  it.each(ROWS)("$check: $reason", ({ reason, template, detail, message }) => {
    const { source, start, end } = plant(template);
    const errors = errorsOf(source);
    expect(errors.map((error) => error.reason)).toEqual([reason]);
    const [error] = errors;
    expect(error?.location.startOffset).toBe(start);
    expect(error?.location.endOffset).toBe(end);
    if (detail !== undefined) expect(error).toMatchObject(detail);
    if (message !== undefined) expect(error?.message).toContain(message);
  });

  // Sabotage: deleting every row of any one reason turns this red.
  it("plants every reason the validator can answer", () => {
    const planted = new Set<string>(ROWS.map((row) => row.reason));
    expect(Object.keys(EVERY_REASON).filter((reason) => !planted.has(reason))).toEqual([]);
  });
});

describe("the contracts", () => {
  const clean = scxml(
    '<datamodel><data id="copies" expr="3"/></datamodel>' +
      '<state id="on_shelf"><transition event="lend" target="lent"/></state>' +
      '<state id="lent" initial="checked_out"><state id="checked_out"/>' +
      '<history id="last" type="deep"><transition target="checked_out"/></history>' +
      '<onentry><send event="due" delay="14d"/>' +
      '<cancel sendid="reminder"/></onentry>' +
      '<transition event="return" target="returned"/></state>' +
      '<final id="returned"><donedata><param name="copies" expr="copies"/></donedata></final>',
    ' initial="on_shelf" datamodel="ecmascript" binding="late"',
  );

  // Sabotage: answering a copy of the chart, or any error on a clean chart,
  // turns this red.
  it("answers the caller's own chart when no rule is broken", () => {
    const document = lowered(clean);
    const result = validate(document, clean);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document).toBe(document);
  });

  // Sabotage: stopping at the first error, or returning the errors in the
  // order the checks ran rather than by source position, turns this red.
  it("collects every error and answers them in source order", () => {
    const source = scxml(
      '<datamodel><data id="_copies"/></datamodel>' +
        '<state id="on_shelf"><transition event="lend" target="lent"/></state>',
    );
    expect(errorsOf(source).map((error) => error.reason)).toEqual([
      "data_reserved_id",
      "unresolved_target",
    ]);
  });

  // Sabotage: reading the root's `xmlns` attribute rather than the namespace
  // its name resolves to turns this red.
  it("accepts a root whose prefix resolves to the SCXML namespace", () => {
    const source = `<s:scxml xmlns:s="${NS}" version="1.0"><s:state id="on_shelf"/></s:scxml>`;
    expect(errorsOf(source)).toEqual([]);
  });

  // Sabotage: reporting an initial that does not resolve as not being a
  // descendant as well turns this red.
  it("reports an unresolved target once, under the check that owns it", () => {
    const source = scxml(
      '<state id="lent"><initial><transition target="renewed"/></initial><state id="kept"/></state>',
    );
    expect(errorsOf(source).map((error) => error.reason)).toEqual(["unresolved_target"]);
  });

  // Sabotage: letting a leading history child of a <parallel> count as a bad
  // default entry turns this red.
  it("lets a <parallel> open with a history child", () => {
    const source = scxml(
      '<parallel id="desk"><history id="last"><transition target="counter"/></history>' +
        '<state id="counter"/></parallel>',
    );
    expect(errorsOf(source)).toEqual([]);
  });
});
