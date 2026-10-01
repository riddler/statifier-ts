// Lowering: the parser's element tree to the typed chart, one family of
// elements at a time, then the refusals.

import { describe, expect, it } from "vitest";
import type { Content, Datamodel } from "../src/document/data.js";
import type {
  Assign,
  Cancel,
  Foreach,
  If,
  Log,
  Raise,
  Script,
  Send,
} from "../src/document/executable.js";
import type { ContentNode, Document } from "../src/document/scxml.js";
import type { Block, State, Transition } from "../src/document/states.js";
import { type LoweringError, lower, SCXML_NAMESPACE } from "../src/lowering.js";
import { type Location, parseXml } from "../src/xml/parser.js";

function lowerSource(source: string) {
  const parsed = parseXml(source);
  if (!parsed.ok) throw new Error(`expected a parse, got ${parsed.error.message}`);
  return lower(parsed.root, source);
}

function chart(source: string): Document {
  const result = lowerSource(source);
  if (!result.ok) {
    throw new Error(`expected a chart, got ${result.errors.map((e) => e.message).join("; ")}`);
  }
  return result.document;
}

function errors(source: string): readonly LoweringError[] {
  const result = lowerSource(source);
  if (result.ok) throw new Error("expected lowering to refuse the chart");
  return result.errors;
}

// A chart whose one state is `loan`, holding `body`.
function inLoan(body: string): string {
  return `<scxml xmlns="${SCXML_NAMESPACE}" initial="loan"><state id="loan">${body}</state></scxml>`;
}

function loan(source: string): State {
  const state = chart(source).states[0];
  if (state === undefined) throw new Error("expected a state");
  return state;
}

// The executable content of the first `<onentry>` of the `loan` state.
function entry(body: string): readonly ContentNode[] {
  const block = loan(inLoan(`<onentry>${body}</onentry>`)).onentry[0];
  if (block === undefined) throw new Error("expected an onentry block");
  return block.content;
}

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error("expected at least one item");
  return item;
}

function slice(source: string, location: Location | null | undefined): string {
  if (location === null || location === undefined) throw new Error("expected a location");
  return source.slice(location.startOffset, location.endOffset);
}

describe("the <scxml> root", () => {
  const source =
    `<scxml xmlns="${SCXML_NAMESPACE}" name="loan desk" version="1.0" ` +
    `datamodel="predicator" binding="late" initial="on_shelf lent">` +
    `<datamodel><data id="copies" expr="3"/></datamodel>` +
    `<script>copies = 2</script>` +
    `<state id="on_shelf"/><parallel id="lent"/><final id="withdrawn"/>` +
    `</scxml>`;

  // Sabotage: reading `initial` unsplit, or dropping `binding`'s `late`, turns this red.
  it("reads the root's attributes", () => {
    const root = chart(source);
    expect(root.name).toBe("loan desk");
    expect(root.version).toBe("1.0");
    expect(root.datamodel).toBe("predicator");
    expect(root.binding).toBe("late");
    expect(root.initial).toEqual(["on_shelf", "lent"]);
    expect(root.xmlns).toBe(SCXML_NAMESPACE);
    expect(root.namespace).toBe(SCXML_NAMESPACE);
    expect(slice(source, root.location)).toBe(source);
  });

  // Sabotage: placing `<final>` or `<parallel>` anywhere but `states`, or
  // dropping the top-level `<script>`, turns this red.
  it("places states, the datamodel and top-level scripts in their slots", () => {
    const root = chart(source);
    expect(root.states.map((s) => [s.kind, s.id])).toEqual([
      ["state", "on_shelf"],
      ["parallel", "lent"],
      ["final", "withdrawn"],
    ]);
    expect(root.datamodelElement?.data.map((d) => d.id)).toEqual(["copies"]);
    expect(root.scripts.map((s) => s.text)).toEqual(["copies = 2"]);
  });

  // Sabotage: recording a location for an attribute that was not written, or
  // defaulting `binding` to anything but `early`, turns this red.
  it("defaults what was not written and records only what was", () => {
    const bare = '<scxml initial="on_shelf"><state id="on_shelf"/></scxml>';
    const root = chart(bare);
    expect(root.binding).toBe("early");
    expect(root.name).toBeNull();
    expect(root.datamodelElement).toBeNull();
    expect(Object.keys(root.attributeLocations)).toEqual(["initial"]);
    expect(slice(bare, root.attributeLocations.initial)).toBe("on_shelf");
  });

  // Sabotage: dispatching on the name as written instead of the resolved
  // namespace and local name turns the prefixed case red.
  it("lowers a prefixed root and a root with no namespace as SCXML", () => {
    const prefixed = chart(
      `<s:scxml xmlns:s="${SCXML_NAMESPACE}" initial="on_shelf"><s:state id="on_shelf"/></s:scxml>`,
    );
    expect(prefixed.xmlns).toBeNull();
    expect(prefixed.namespace).toBe(SCXML_NAMESPACE);
    expect(first(prefixed.states).id).toBe("on_shelf");

    const undeclared = chart('<scxml><state id="on_shelf"/></scxml>');
    expect(undeclared.namespace).toBeNull();
    expect(first(undeclared.states).id).toBe("on_shelf");
  });

  // Sabotage: letting a later `<datamodel>` be ignored turns this red.
  it("keeps the last <datamodel> written when there are several", () => {
    const root = chart(
      '<scxml><datamodel><data id="a"/></datamodel><datamodel><data id="b"/></datamodel></scxml>',
    );
    expect(root.datamodelElement?.data.map((d) => d.id)).toEqual(["b"]);
  });
});

describe("the state family", () => {
  const source =
    `<scxml initial="loan">` +
    `<state id="loan" initial="lent">` +
    `<initial><transition target="lent"/></initial>` +
    `<state id="lent"/>` +
    `<history id="where_it_was" type="deep"><transition target="lent"/></history>` +
    `<history id="last_shallow"/>` +
    `<history id="odd" type="sideways"/>` +
    `<final id="returned"/>` +
    `</state>` +
    `</scxml>`;

  // Sabotage: giving every node the kind `state`, or reading `initial` from
  // the `<initial>` child instead of the attribute, turns this red.
  it("lowers each kind with its id, initial and children", () => {
    const state = loan(source);
    expect(state.kind).toBe("state");
    expect(state.initial).toEqual(["lent"]);
    expect(state.initialElement?.transitions.map((t) => t.target)).toEqual([["lent"]]);
    expect(state.states.map((s) => [s.kind, s.id])).toEqual([
      ["state", "lent"],
      ["history", "where_it_was"],
      ["history", "last_shallow"],
      ["history", "odd"],
      ["final", "returned"],
    ]);
    expect(state.historyType).toBeNull();
  });

  // Sabotage: defaulting a history's type to `deep`, or dropping the location
  // of an out-of-range value, turns this red.
  it("reads a history's type, shallow by default and for an unknown value", () => {
    const [, deep, shallow, odd] = loan(source).states;
    expect(deep?.historyType).toBe("deep");
    expect(deep?.transitions.map((t) => t.target)).toEqual([["lent"]]);
    expect(shallow?.historyType).toBe("shallow");
    expect(shallow?.attributeLocations.type).toBeUndefined();
    expect(odd?.historyType).toBe("shallow");
    expect(slice(source, odd?.attributeLocations.type)).toBe("sideways");
  });

  // Sabotage: flattening two `<onentry>` elements into one block turns this red.
  it("keeps one block per <onentry> and <onexit> element", () => {
    const state = loan(
      inLoan(
        '<onentry><raise event="a"/></onentry><onentry><raise event="b"/></onentry>' +
          '<onexit><raise event="c"/></onexit>',
      ),
    );
    const events = (blocks: readonly Block[]) =>
      blocks.map((b) => b.content.map((n) => (n as Raise).event));
    expect(events(state.onentry)).toEqual([["a"], ["b"]]);
    expect(events(state.onexit)).toEqual([["c"]]);
  });
});

describe("<transition>", () => {
  const source = inLoan(
    '<transition event="renew  return.*" target="lent overdue" cond="renewals &lt; 3" type="internal">' +
      '<raise event="renewed"/><log expr="renewals"/>' +
      "</transition>" +
      '<transition target="returned"/>',
  );

  // Sabotage: reading `event` or `target` unsplit, or losing the entity in
  // `cond`, turns this red.
  it("reads event and target as lists, cond raw, and type", () => {
    const transition = first(loan(source).transitions);
    expect(transition.event).toEqual(["renew", "return.*"]);
    expect(transition.target).toEqual(["lent", "overdue"]);
    expect(transition.cond).toBe("renewals < 3");
    expect(transition.type).toBe("internal");
    expect(transition.content.map((n) => n.kind)).toEqual(["raise", "log"]);
  });

  // Sabotage: defaulting `type` to `internal` turns this red.
  it("defaults type to external and records no location for it", () => {
    const transition = loan(source).transitions[1] as Transition;
    expect(transition.type).toBe("external");
    expect(transition.event).toEqual([]);
    expect(transition.cond).toBeNull();
    expect(transition.attributeLocations.type).toBeUndefined();
  });
});

describe("<datamodel> and <data>", () => {
  const source = inLoan(
    '<datamodel><data id="renewals" expr="0"/><data id="due" src="loan.json"/>' +
      '<data id="patron">\n  {"name": "Ada"}\n</data></datamodel>',
  );

  // Sabotage: trimming `<data>`'s text, or dropping `src`, turns this red.
  it("reads id, expr, src and the untrimmed in-line value", () => {
    const datamodel = loan(source).datamodelElement as Datamodel;
    const [renewals, due, patron] = datamodel.data;
    expect([renewals?.id, renewals?.expr, renewals?.src]).toEqual(["renewals", "0", null]);
    expect(due?.src).toBe("loan.json");
    expect(patron?.text).toBe('\n  {"name": "Ada"}\n');
  });

  // Sabotage: building a `<data>` with no id, or walking its element child
  // instead of refusing it, turns this red.
  it("refuses a <data> with no id and an element inside a <data>", () => {
    expect(
      errors(inLoan('<datamodel><data expr="1"/><data id="x"><copy/></data></datamodel>')).map(
        (e) => [e.reason, e.message],
      ),
    ).toEqual([
      ["missing_attribute", 'element "data" is missing required attribute "id"'],
      ["misplaced_element", 'element "copy" is not allowed inside "data"'],
    ]);
  });
});

describe("<raise>", () => {
  // Sabotage: splitting `event` on whitespace turns this red.
  it("reads event as one name, never split", () => {
    const raise = first(entry('<raise event="hold placed"/>')) as Raise;
    expect(raise.kind).toBe("raise");
    expect(raise.event).toBe("hold placed");
  });

  // Sabotage: building a `<raise>` with no event turns this red.
  it("refuses a <raise> with no event", () => {
    expect(errors(inLoan("<onentry><raise/></onentry>"))[0]?.reason).toBe("missing_attribute");
  });
});

describe("<assign>", () => {
  const source = inLoan(
    '<onentry><assign location="renewals" expr="renewals + 1"/>' +
      '<assign location="slip">\r\n<copy xmlns="urn:branch">A</copy>\r\n</assign></onentry>',
  );

  // Sabotage: putting the element's span in `location` instead of the path turns this red.
  it("keeps the location attribute apart from the element's span", () => {
    const assign = first(first(loan(source).onentry).content) as Assign;
    expect(assign.location).toBe("renewals");
    expect(assign.expr).toBe("renewals + 1");
    expect(slice(source, assign.nodeLocation)).toBe(
      '<assign location="renewals" expr="renewals + 1"/>',
    );
    expect(assign.markup).toBeNull();
  });

  // Sabotage: walking an `<assign>`'s element children, or folding the CR LF
  // in its markup slice, turns this red.
  it("keeps element children as a verbatim markup slice, foreign namespace included", () => {
    const assign = first(loan(source).onentry).content[1] as Assign;
    expect(assign.markup).toBe('<copy xmlns="urn:branch">A</copy>');
    expect(slice(source, assign.markupLocation)).toBe(assign.markup);
    expect(assign.text).toBe("\n\n");
  });

  // Sabotage: building an `<assign>` with no location turns this red.
  it("refuses an <assign> with no location", () => {
    expect(errors(inLoan('<onentry><assign expr="1"/></onentry>'))[0]?.message).toBe(
      'element "assign" is missing required attribute "location"',
    );
  });

  // Sabotage: letting a misplaced `<assign>` report the path instead of its span turns this red.
  it("reports a misplaced <assign> at its element span", () => {
    const misplacedSource = inLoan('<assign location="renewals" expr="1"/>');
    const [error] = errors(misplacedSource);
    expect(error?.reason).toBe("misplaced_element");
    expect(slice(misplacedSource, error?.location)).toBe('<assign location="renewals" expr="1"/>');
  });
});

describe("<log>", () => {
  // Sabotage: swapping `label` and `expr` turns this red.
  it("reads label and expr raw", () => {
    const log = first(entry('<log label="renewal" expr="renewals"/>')) as Log;
    expect([log.kind, log.label, log.expr]).toEqual(["log", "renewal", "renewals"]);
  });
});

describe("<if>, <elseif> and <else>", () => {
  const body =
    '<if cond="renewals &lt; 3"><raise event="renewed"/><log expr="1"/>' +
    '<elseif cond="holds &gt; 0"/><raise event="refused.hold"/>' +
    '<else/><raise event="refused.limit"/></if>';

  // Sabotage: appending content to the first branch always, or keeping `<else>`'s
  // cond non-null, turns this red.
  it("partitions the content into one branch per <if>, <elseif> and <else>", () => {
    const node = first(entry(body)) as If;
    expect(node.kind).toBe("if");
    expect(node.branches.map((b) => [b.cond, b.content.map((n) => n.kind)])).toEqual([
      ["renewals < 3", ["raise", "log"]],
      ["holds > 0", ["raise"]],
      [null, ["raise"]],
    ]);
  });

  // Sabotage: dropping the unexpected-attribute check on `<else>` turns this red.
  it("refuses an attribute on <else> and a missing cond", () => {
    expect(
      errors(inLoan('<onentry><if cond="a"><else cond="b"/></if><if/></onentry>')).map(
        (e) => e.reason,
      ),
    ).toEqual(["unexpected_attribute", "missing_attribute"]);
  });

  // Sabotage: accepting `<elseif>` outside an `<if>` turns this red.
  it("refuses <elseif> outside an <if>", () => {
    expect(errors(inLoan('<onentry><elseif cond="a"/></onentry>'))[0]?.message).toBe(
      'element "elseif" is not allowed inside "onentry"',
    );
  });
});

describe("<foreach>", () => {
  // Sabotage: dropping `index`, or the body, turns this red.
  it("reads array, item, index and the body", () => {
    const node = first(
      entry('<foreach array="holds" item="hold" index="i"><log expr="hold"/></foreach>'),
    ) as Foreach;
    expect([node.kind, node.array, node.item, node.index]).toEqual([
      "foreach",
      "holds",
      "hold",
      "i",
    ]);
    expect(node.content.map((n) => n.kind)).toEqual(["log"]);
  });

  // Sabotage: stopping at the first missing attribute turns this red.
  it("reports both missing attributes", () => {
    expect(errors(inLoan("<onentry><foreach/></onentry>")).map((e) => e.message)).toEqual([
      'element "foreach" is missing required attribute "array"',
      'element "foreach" is missing required attribute "item"',
    ]);
  });
});

describe("<script>", () => {
  // Sabotage: trimming the program text turns this red.
  it("keeps the program text untrimmed", () => {
    const script = first(entry("<script>\n  renewals = 0\n</script>")) as Script;
    expect(script.kind).toBe("script");
    expect(script.text).toBe("\n  renewals = 0\n");
  });

  // Sabotage: building a `<script src>` turns this red.
  it("refuses src, which nothing fetches", () => {
    const [error] = errors(inLoan('<onentry><script src="renew.js"/></onentry>'));
    expect([error?.reason, error?.reason === "unsupported_attribute" && error.attribute]).toEqual([
      "unsupported_attribute",
      "src",
    ]);
  });
});

describe("<send> and <param>", () => {
  const body =
    '<send event="copy.available" target="#_branch" type="scxml" id="notice" ' +
    'delay="2d" namelist="copy  patron">' +
    '<param name="copy" expr="copy_id"/><param name="due" location="due_date"/>' +
    '<content expr="slip"/></send>' +
    '<send eventexpr="next" targetexpr="where" typeexpr="how" idlocation="sent" delayexpr="wait"/>';

  // Sabotage: dropping any attribute, or reading `namelist` unsplit, turns this red.
  it("reads every attribute raw and the params and content", () => {
    const [send, exprs] = entry(body) as Send[];
    expect(send?.kind).toBe("send");
    expect([send?.event, send?.target, send?.type, send?.id, send?.delay]).toEqual([
      "copy.available",
      "#_branch",
      "scxml",
      "notice",
      "2d",
    ]);
    expect(send?.namelist).toEqual(["copy", "patron"]);
    expect(send?.params.map((p) => [p.name, p.expr, p.paramLocation])).toEqual([
      ["copy", "copy_id", null],
      ["due", null, "due_date"],
    ]);
    expect(send?.content?.expr).toBe("slip");
    expect([
      exprs?.eventexpr,
      exprs?.targetexpr,
      exprs?.typeexpr,
      exprs?.idlocation,
      exprs?.delayexpr,
    ]).toEqual(["next", "where", "how", "sent", "wait"]);
    expect(exprs?.event).toBeNull();
    expect(exprs?.content).toBeNull();
  });

  // Sabotage: building a `<param>` with no name turns this red.
  it("refuses a <param> with no name", () => {
    expect(errors(inLoan('<onentry><send><param expr="1"/></send></onentry>'))[0]?.message).toBe(
      'element "param" is missing required attribute "name"',
    );
  });
});

describe("<cancel>", () => {
  // Sabotage: swapping `sendid` and `sendidexpr` turns this red.
  it("reads sendid and sendidexpr", () => {
    const [plain, computed] = entry(
      '<cancel sendid="notice"/><cancel sendidexpr="last_notice"/>',
    ) as Cancel[];
    expect([plain?.kind, plain?.sendid, plain?.sendidexpr]).toEqual(["cancel", "notice", null]);
    expect(computed?.sendidexpr).toBe("last_notice");
  });

  // Sabotage: giving `<cancel>` a slot for children turns this red.
  it("refuses a child", () => {
    expect(
      errors(inLoan('<onentry><cancel sendid="a"><log/></cancel></onentry>'))[0]?.message,
    ).toBe('element "log" is not allowed inside "cancel"');
  });
});

describe("<invoke>, <finalize> and <donedata>", () => {
  const source = inLoan(
    '<invoke type="scxml" src="renewal.scxml" id="renewal" namelist="copy patron" autoforward="true">' +
      '<param name="copy" expr="copy_id"/><content expr="doc"/>' +
      '<finalize><assign location="renewals" expr="_event.data.count"/></finalize>' +
      "</invoke>" +
      '<invoke typeexpr="kind" srcexpr="where" idlocation="invoked"><finalize/></invoke>' +
      '<invoke autoforward="yes"/>' +
      '<final id="done"><donedata><param name="copy" expr="copy_id"/><content expr="slip"/></donedata></final>',
  );

  // Sabotage: dropping any attribute, reading `autoforward` as false, or
  // losing the finalize block, turns this red.
  it("lowers an invocation with its attributes, params, content and finalize", () => {
    const [invoke, computed, other] = loan(source).invoke;
    expect([invoke?.type, invoke?.src, invoke?.id, invoke?.autoforward]).toEqual([
      "scxml",
      "renewal.scxml",
      "renewal",
      true,
    ]);
    expect(invoke?.namelist).toEqual(["copy", "patron"]);
    expect(invoke?.params.map((p) => p.name)).toEqual(["copy"]);
    expect(invoke?.content?.expr).toBe("doc");
    expect(invoke?.finalize?.content.map((n) => n.kind)).toEqual(["assign"]);
    expect([computed?.typeexpr, computed?.srcexpr, computed?.idlocation]).toEqual([
      "kind",
      "where",
      "invoked",
    ]);
    expect(other?.autoforward).toBe(false);
  });

  // Sabotage: collapsing an empty `<finalize/>` to null turns this red.
  it("tells an empty <finalize/> from none", () => {
    const [, computed, other] = loan(source).invoke;
    expect(computed?.finalize?.content).toEqual([]);
    expect(other?.finalize).toBeNull();
  });

  // Sabotage: dropping either `<donedata>` slot turns this red.
  it("lowers <donedata> with its params and content", () => {
    const done = loan(source).states[0];
    expect(done?.kind).toBe("final");
    expect(done?.donedata?.params.map((p) => p.name)).toEqual(["copy"]);
    expect(done?.donedata?.content?.expr).toBe("slip");
  });
});

describe("<content>", () => {
  const source = inLoan(
    '<onentry><send event="slip"><content>\n  <slip xmlns="urn:branch"><copy>A</copy></slip>\n  tail\n</content></send>' +
      '<send event="note"><content> due Friday </content></send></onentry>',
  );

  // Sabotage: walking `<content>`'s children (a foreign element would then be
  // refused) or slicing only the element turns this red.
  it("keeps markup children as opaque source, foreign namespace included", () => {
    const [withMarkup] = first(loan(source).onentry).content as Send[];
    const content = withMarkup?.content as Content;
    expect(content.markup).toBe('<slip xmlns="urn:branch"><copy>A</copy></slip>\n  tail\n');
    expect(slice(source, content.markupLocation)).toBe(content.markup);
    expect(content.text).toBe("\n  \n  tail\n");
  });

  // Sabotage: trimming `<content>`'s text, or setting markup with no element child, turns this red.
  it("keeps text-only content untrimmed with no markup", () => {
    const [, textOnly] = first(loan(source).onentry).content as Send[];
    expect(textOnly?.content?.text).toBe(" due Friday ");
    expect(textOnly?.content?.markup).toBeNull();
    expect(textOnly?.content?.markupLocation).toBeNull();
  });
});

describe("refusals", () => {
  // Sabotage: skipping an element with no builder instead of reporting it
  // turns this red.
  it("reports an unknown element in the SCXML namespace by name and location", () => {
    const source = inLoan('\n  <renewal limit="3"/>');
    const [error] = errors(source);
    expect(error?.reason).toBe("unsupported_element");
    expect(error?.reason === "unsupported_element" && error.name).toBe("renewal");
    expect(error?.message).toBe('unsupported element "renewal"');
    expect([error?.location.startLine, error?.location.startColumn]).toEqual([2, 3]);
    expect(slice(source, error?.location)).toBe('<renewal limit="3"/>');
  });

  // Sabotage: treating an element with no namespace as foreign turns this red.
  it("reports an unknown element in a chart that declares no namespace", () => {
    const [error] = errors('<scxml><state id="loan"><renewal/></state></scxml>');
    expect([error?.reason, error?.message]).toEqual([
      "unsupported_element",
      'unsupported element "renewal"',
    ]);
  });

  // Sabotage: naming the element by its local name, prefix dropped, turns this red.
  it("names a prefixed unknown element as written", () => {
    const [error] = errors(
      `<s:scxml xmlns:s="${SCXML_NAMESPACE}"><s:state id="loan"><s:renewal/></s:state></s:scxml>`,
    );
    expect(error?.message).toBe('unsupported element "s:renewal"');
  });

  // Sabotage: dispatching a foreign element by its local name turns this red.
  it("reports an element in a foreign namespace outside <content>", () => {
    const [error] = errors(inLoan('<b:state xmlns:b="urn:branch" id="x"/>'));
    expect(error?.reason).toBe("foreign_element");
    expect(error?.message).toBe(
      'element "b:state" is bound to foreign namespace "urn:branch", not SCXML',
    );
  });

  // The reference at v2.9.0 binds an empty declaration to the empty string
  // (`Statifier.Lowering.Namespace.declare/2`) and reports the element as
  // foreign_element with that URI.
  //
  // Sabotage: reading an empty xmlns or xmlns:p as no namespace turns this
  // red, the state then lowering as SCXML vocabulary.
  it("reports an element under an empty namespace declaration as foreign", () => {
    for (const body of ['<state xmlns="" id="x"/>', '<p:state xmlns:p="" id="x"/>']) {
      const [error] = errors(inLoan(body));
      expect(error?.reason).toBe("foreign_element");
      expect(error && "uri" in error ? error.uri : null).toBe("");
    }
  });

  // Sabotage: accepting any root name turns this red.
  it("refuses a root that is not <scxml>, and a foreign root", () => {
    expect(errors('<state id="loan"/>').map((e) => [e.reason, e.message])).toEqual([
      ["unexpected_root", 'expected the root element to be <scxml>, got "state"'],
    ]);
    expect(errors('<scxml xmlns="urn:branch"/>')[0]?.reason).toBe("foreign_element");
  });

  // Sabotage: skipping non-blank text between elements turns this red.
  it("reports stray text, trimmed, and passes blank text", () => {
    const [error] = errors(inLoan("\n  overdue  \n"));
    expect(error?.reason).toBe("stray_text");
    expect(error?.reason === "stray_text" && error.text).toBe("overdue");
    expect(error?.message).toBe('stray text "overdue" is not allowed here');
  });

  // Sabotage: previewing the whole run instead of forty characters turns this red.
  it("previews long stray text at forty characters", () => {
    const [error] = errors(inLoan("x".repeat(50)));
    expect(error?.message).toBe(`stray text "${"x".repeat(40)}..." is not allowed here`);
  });

  // Sabotage: accepting a child the parent has no slot for turns this red.
  it("reports a misplaced element and names its parent", () => {
    const [error] = errors(inLoan('<raise event="a"/>'));
    expect([error?.reason, error?.message]).toEqual([
      "misplaced_element",
      'element "raise" is not allowed inside "state"',
    ]);
  });

  // Sabotage: stopping at the first error, or not sorting, turns this red.
  it("collects every error in source order", () => {
    // A <raise> reports its own missing event after walking its children, so
    // the child's error is found first and sorted after it.
    const source = inLoan(
      "<onentry><raise><overdue/></raise><foreach/></onentry><renewal/>stray" +
        '<transition><raise event="a"/><held/></transition>',
    );
    expect(errors(source).map((e) => [e.reason, e.message])).toEqual([
      ["missing_attribute", 'element "raise" is missing required attribute "event"'],
      ["unsupported_element", 'unsupported element "overdue"'],
      ["missing_attribute", 'element "foreach" is missing required attribute "array"'],
      ["missing_attribute", 'element "foreach" is missing required attribute "item"'],
      ["unsupported_element", 'unsupported element "renewal"'],
      ["stray_text", 'stray text "stray" is not allowed here'],
      ["unsupported_element", 'unsupported element "held"'],
    ]);
  });
});

describe("whitespace, as the reference reads it", () => {
  const nbsp = String.fromCodePoint(0xa0);
  const emSpace = String.fromCodePoint(0x2003);
  const nextLine = String.fromCodePoint(0x85);
  const bom = String.fromCodePoint(0xfeff);

  // Sabotage: splitting on the no-break space, or not on the em space, turns this red.
  it("splits a list on Unicode whitespace other than the no-break spaces", () => {
    const transition = first(
      loan(inLoan(`<transition event="a${nbsp}b${emSpace}c${nextLine}d"/>`)).transitions,
    );
    expect(transition.event).toEqual([`a${nbsp}b`, "c", "d"]);
  });

  // Sabotage: using the language's own trim, which blanks a byte-order mark, turns this red.
  it("reads text as blank by the reference's set", () => {
    expect(chart(inLoan(`${nbsp}${nextLine}`)).states).toHaveLength(1);
    expect(errors(inLoan(bom))[0]?.reason).toBe("stray_text");
  });
});
