// The compiler: states interned in document order, the index spaces, every
// expression compiled once, load-time errors naming where they were written,
// the deferred failures, and the pipeline with the chart identity.
//
// The fixtures are the library loan: a copy on the shelf, on loan, renewed
// and returned, a branch's desk and stacks, and the loan events the chart
// raises about it.

import { describe, expect, it } from "vitest";
import { type CompilerError, compile, SCRIPT_UNSUPPORTED } from "../src/compiler.js";
import type { ContentNode } from "../src/core/content.js";
import type { Expr } from "../src/datamodel.js";
import { compile as publicCompile } from "../src/index.js";
import type { Machine } from "../src/machine.js";

const SCXML = 'xmlns="http://www.w3.org/2005/07/scxml" version="1.0"';

function machineOf(source: string): Machine {
  const result = compile(source);
  if (!result.ok) throw new Error(`fixture does not compile: ${JSON.stringify(result.errors)}`);
  return result.chart.machine;
}

function compilerErrorsOf(source: string): CompilerError[] {
  const result = compile(source);
  if (result.ok) throw new Error("fixture compiled");
  return result.errors as CompilerError[];
}

function stateOf(machine: Machine, id: string) {
  const index = machine.idToIndex.get(id);
  if (index === undefined) throw new Error(`no state ${id}`);
  const state = machine.states[index];
  if (state === undefined) throw new Error(`no state at ${index}`);
  return state;
}

function staticValue(expr: unknown): unknown {
  const e = expr as Expr;
  if (e.kind !== "static") throw new Error(`not a literal: ${JSON.stringify(expr)}`);
  return e.value;
}

const LOAN = `<scxml ${SCXML} name="loan" initial="loan">
  <datamodel>
    <data id="renewals" expr="0"/>
    <data id="limit">3</data>
    <data id="branch">[central]</data>
    <data id="shelves">[1, 2]</data>
    <data id="note">   </data>
    <data id="catalogue" src="catalogue.json"/>
  </datamodel>
  <state id="loan" initial="onShelf">
    <onentry><log label="opened" expr="renewals"/></onentry>
    <state id="onShelf">
      <transition event="copy.borrowed copy.reserved.held" target="onLoan"/>
    </state>
    <state id="onLoan">
      <datamodel><data id="due" expr="14"/></datamodel>
      <onentry><assign location="renewals" expr="renewals + 1"/></onentry>
      <onexit><raise event="loan.closed"/></onexit>
      <transition event="copy.renewed" cond="renewals &lt; limit" target="onLoan" type="internal">
        <raise event="loan.renewed"/>
      </transition>
      <transition event="copy.returned" target="returned"/>
    </state>
    <final id="returned"/>
  </state>
</scxml>`;

describe("interning", () => {
  // Sabotage: skipping one index after each state's subtree turns this red.
  it("numbers states in document order, the root at 0", () => {
    const machine = machineOf(LOAN);
    expect(machine.states.map((s) => s.id)).toEqual([
      null,
      "loan",
      "onShelf",
      "onLoan",
      "returned",
    ]);
    expect(machine.states.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    expect(machine.states.map((s) => s.kind)).toEqual([
      "scxml",
      "state",
      "state",
      "state",
      "final",
    ]);
    expect([...machine.idToIndex]).toEqual([
      ["onShelf", 2],
      ["onLoan", 3],
      ["returned", 4],
      ["loan", 1],
    ]);
  });

  // Sabotage: setting `last` to the state's own index turns this red.
  it("records parents, children and each subtree's last index", () => {
    const machine = machineOf(LOAN);
    expect(machine.states.map((s) => s.parent)).toEqual([null, 0, 1, 1, 1]);
    expect(machine.states.map((s) => s.last)).toEqual([4, 4, 2, 3, 4]);
    expect(machine.states.map((s) => s.children)).toEqual([[1], [2, 3, 4], [], [], []]);
  });

  // Sabotage: dropping the chart's name to null turns this red.
  it("carries the chart's own fields", () => {
    const machine = machineOf(LOAN);
    expect(machine.name).toBe("loan");
    expect(machine.datamodel).toBeNull();
    expect(machine.binding).toBe("early");
    expect(machine.location.startOffset).toBe(0);
    expect(machine.states[0]?.location).toEqual(machine.location);
  });

  const BRANCH = `<scxml ${SCXML}>
    <parallel id="branch">
      <state id="desk">
        <initial><transition target="open"/></initial>
        <history id="deskHistory" type="deep"><transition target="closed"/></history>
        <state id="open"/>
        <state id="closed"/>
      </state>
      <state id="stacks">
        <state id="shelving"/>
        <state id="quiet"/>
      </state>
    </parallel>
  </scxml>`;

  // Sabotage: resolving a state's default from its first child before its
  // <initial> element turns this red (desk would answer its history state).
  it("resolves defaults: the attribute, the <initial> element, the first child", () => {
    const machine = machineOf(BRANCH);
    expect(machine.states[0]?.initial).toEqual([stateOf(machine, "branch").index]);
    expect(stateOf(machine, "branch").initial).toEqual([]);
    expect(stateOf(machine, "desk").initial).toEqual([stateOf(machine, "open").index]);
    expect(stateOf(machine, "stacks").initial).toEqual([stateOf(machine, "shelving").index]);
    expect(stateOf(machine, "open").initial).toEqual([]);
    const loan = machineOf(LOAN);
    expect(loan.states[0]?.initial).toEqual([1]);
    expect(stateOf(loan, "loan").initial).toEqual([2]);
  });

  // Sabotage: treating a history state's transitions as selectable (putting
  // them in `transitions`) turns this red.
  it("keeps the <initial> transition and a history default out of the selectable list", () => {
    const machine = machineOf(BRANCH);
    const desk = stateOf(machine, "desk");
    const history = stateOf(machine, "deskHistory");
    expect(desk.transitions).toEqual([]);
    expect(desk.initialTransition).toBe(0);
    expect(desk.historyChildren).toEqual([history.index]);
    expect(history.kind).toBe("history");
    expect(history.historyType).toBe("deep");
    expect(history.transitions).toEqual([]);
    expect(history.historyDefault).toBe(1);
    expect(history.initialTransition).toBeNull();
    expect(machine.transitions[0]?.targets).toEqual([stateOf(machine, "open").index]);
    expect(machine.transitions[1]?.targets).toEqual([stateOf(machine, "closed").index]);
    expect(machine.transitions[1]?.source).toBe(history.index);
  });

  // Sabotage: setting the root's last to the next unused index turns this red.
  it("interns a chart with no states to the root alone", () => {
    const machine = machineOf(`<scxml ${SCXML}/>`);
    expect(machine.states).toHaveLength(1);
    expect(machine.states[0]?.initial).toEqual([]);
    expect(machine.states[0]?.last).toBe(0);
  });
});

describe("transitions", () => {
  // Sabotage: keeping each event descriptor whole instead of splitting it on
  // its dots turns this red.
  it("numbers transitions in document order and splits each descriptor on dots", () => {
    const machine = machineOf(LOAN);
    expect(machine.transitions.map((t) => t.tIndex)).toEqual([0, 1, 2]);
    expect(machine.transitions.map((t) => t.source)).toEqual([2, 3, 3]);
    expect(machine.transitions.map((t) => t.targets)).toEqual([[3], [3], [4]]);
    expect(machine.transitions[0]?.events).toEqual([
      ["copy", "borrowed"],
      ["copy", "reserved", "held"],
    ]);
    expect(machine.transitions[1]?.type).toBe("internal");
    expect(machine.transitions[2]?.type).toBe("external");
    expect(stateOf(machine, "onLoan").transitions).toEqual([1, 2]);
  });

  // Sabotage: storing the condition's source string instead of compiling it
  // turns this red.
  it("compiles a condition once, keeping its source and where it was written", () => {
    const machine = machineOf(LOAN);
    const renewed = machine.transitions[1];
    expect(renewed?.cond?.kind).toBe("compiled");
    expect(renewed?.cond).toMatchObject({ source: "renewals < limit" });
    expect(renewed?.condLocation?.startOffset).toBe(LOAN.indexOf("renewals &lt; limit"));
    expect(machine.transitions[0]?.cond).toBeNull();
    expect(machine.transitions[0]?.condLocation).toBeNull();
  });
});

describe("executable content", () => {
  // Sabotage: numbering onexit content before onentry content turns this red.
  it("numbers content in document order: onentry, onexit, then transitions", () => {
    const machine = machineOf(LOAN);
    const loan = stateOf(machine, "loan");
    const onLoan = stateOf(machine, "onLoan");
    expect(loan.onentry[0]?.content.map((n) => n.cIndex)).toEqual([0]);
    expect(onLoan.onentry[0]?.content.map((n) => n.cIndex)).toEqual([1]);
    expect(onLoan.onexit[0]?.content.map((n) => n.cIndex)).toEqual([2]);
    expect(machine.transitions[1]?.content.map((n) => n.cIndex)).toEqual([3]);
    expect(onLoan.onexit[0]?.content[0]).toEqual({
      kind: "raise",
      cIndex: 2,
      event: "loan.closed",
    });
  });

  // Sabotage: dropping a compiled <log>'s label to null turns this red.
  it("compiles a <log> expression and keeps its label", () => {
    const machine = machineOf(LOAN);
    const node = stateOf(machine, "loan").onentry[0]?.content[0] as ContentNode & { kind: "log" };
    expect(node.label).toBe("opened");
    expect(node.expr).toMatchObject({ kind: "compiled", source: "renewals" });
  });

  const NESTED = `<scxml ${SCXML}>
    <datamodel><data id="holds" expr="[]"/><data id="hold"/><data id="n"/></datamodel>
    <state id="desk">
      <onentry>
        <if cond="holds == []">
          <raise event="hold.none"/>
        <elseif cond="n > 1"/>
          <foreach array="holds" item="hold" index="n">
            <log label="hold" expr="hold"/>
          </foreach>
        <else/>
          <raise event="hold.one"/>
        </if>
        <log label="done"/>
      </onentry>
      <onentry><raise event="desk.opened"/></onentry>
    </state>
  </scxml>`;

  // Sabotage: giving an <if> the index after its branches' content turns this red.
  it("numbers a container before its children, to any depth", () => {
    const machine = machineOf(NESTED);
    const desk = stateOf(machine, "desk");
    expect(desk.onentry).toHaveLength(2);
    const [ifNode, logDone] = desk.onentry[0]?.content ?? [];
    expect(ifNode?.kind).toBe("if");
    expect(ifNode?.cIndex).toBe(0);
    if (ifNode?.kind !== "if") throw new Error("not an if");
    expect(ifNode.branches.map((b) => b.content.map((n) => n.cIndex))).toEqual([[1], [2], [4]]);
    expect(ifNode.branches[0]?.cond).toMatchObject({ kind: "compiled", source: "holds == []" });
    expect(ifNode.branches[2]?.cond).toBeNull();
    const foreach = ifNode.branches[1]?.content[0];
    if (foreach?.kind !== "foreach") throw new Error("not a foreach");
    expect(foreach.array).toMatchObject({ kind: "compiled", source: "holds" });
    expect(foreach.item).toBe("hold");
    expect(foreach.index).toBe("n");
    expect(foreach.content.map((n) => n.cIndex)).toEqual([3]);
    expect(logDone).toEqual({ kind: "log", cIndex: 5, label: "done", expr: null });
    expect(desk.onentry[1]?.content.map((n) => n.cIndex)).toEqual([6]);
  });

  // Sabotage: answering a literal null for an <assign expr> that does not
  // compile turns this red.
  it("defers an <assign> expression that does not compile to when it runs", () => {
    const machine = machineOf(`<scxml ${SCXML}>
      <datamodel><data id="renewals" expr="0"/></datamodel>
      <state id="onLoan"><onentry><assign location="renewals" expr="renewals +"/></onentry></state>
    </scxml>`);
    const node = stateOf(machine, "onLoan").onentry[0]?.content[0];
    if (node?.kind !== "assign") throw new Error("not an assign");
    expect(node.location).toBe("renewals");
    expect(node.value).toMatchObject({ kind: "invalid", source: "renewals +" });
    expect((node.value as { message: string }).message).toMatch(
      /^failed to compile expression "renewals \+": /,
    );
  });

  // Sabotage: folding an <assign>'s text without trimming it turns this red.
  it("takes an <assign> value from markup, then text, then null", () => {
    const machine = machineOf(`<scxml ${SCXML}>
      <datamodel><data id="v"/></datamodel>
      <state id="s">
        <onentry>
          <assign location="v"><copy barcode="9"/></assign>
          <assign location="v">  [1, 2]  </assign>
          <assign location="v">  north wing  </assign>
          <assign location="v">   </assign>
        </onentry>
      </state>
    </scxml>`);
    const values = (stateOf(machine, "s").onentry[0]?.content ?? []).map((n) =>
      n.kind === "assign" ? staticValue(n.value) : undefined,
    );
    expect(values).toEqual(['<copy barcode="9"/>', [1, 2], "north wing", null]);
  });

  // Sabotage: answering an empty compiled program instead of the placeholder
  // turns this red.
  it("compiles every <script> to the placeholder that fails when it runs", () => {
    const machine = machineOf(`<scxml ${SCXML}>
      <datamodel><data id="renewals" expr="0"/></datamodel>
      <script>renewals = 1</script>
      <state id="s"><onentry><script>renewals = renewals + 1</script></onentry></state>
    </scxml>`);
    expect(machine.globalScripts).toEqual([
      { kind: "invalid", source: "renewals = 1", message: SCRIPT_UNSUPPORTED },
    ]);
    expect(stateOf(machine, "s").onentry[0]?.content[0]).toEqual({
      kind: "script",
      cIndex: 0,
      program: { kind: "invalid", source: "renewals = renewals + 1", message: SCRIPT_UNSUPPORTED },
    });
  });

  // Sabotage: not reserving a content index for <send> turns this red: the
  // <raise> after it would take index 0.
  it("numbers <send> and <cancel> but places no node for them yet", () => {
    const machine = machineOf(`<scxml ${SCXML}>
      <state id="s">
        <onentry>
          <send event="loan.due" delay="1s" id="due"/>
          <cancel sendid="due"/>
          <raise event="loan.opened"/>
        </onentry>
      </state>
    </scxml>`);
    expect(stateOf(machine, "s").onentry[0]?.content).toEqual([
      { kind: "raise", cIndex: 2, event: "loan.opened" },
    ]);
  });
});

describe("data", () => {
  // Sabotage: numbering a state's <data> before the root's turns this red.
  it("numbers the root's <data> first, then each state's, in document order", () => {
    const machine = machineOf(LOAN);
    expect(machine.dataElements.map((d) => [d.dIndex, d.id])).toEqual([
      [0, "renewals"],
      [1, "limit"],
      [2, "branch"],
      [3, "shelves"],
      [4, "note"],
      [5, "catalogue"],
      [6, "due"],
    ]);
    expect(machine.states[0]?.data).toEqual([0, 1, 2, 3, 4, 5]);
    expect(stateOf(machine, "onLoan").data).toEqual([6]);
    expect(stateOf(machine, "loan").data).toEqual([]);
  });

  // Sabotage: folding in-line text under the expression language's default
  // unbound policy turns this red: `[central]` would become a list holding
  // null instead of the string.
  it("folds in-line text to a literal and never reads the datamodel", () => {
    const machine = machineOf(LOAN);
    const byId = new Map(machine.dataElements.map((d) => [d.id, d]));
    expect(byId.get("renewals")?.value).toMatchObject({ kind: "compiled", source: "0" });
    expect(staticValue(byId.get("limit")?.value)).toBe(3);
    expect(staticValue(byId.get("branch")?.value)).toBe("[central]");
    expect(staticValue(byId.get("shelves")?.value)).toEqual([1, 2]);
    expect(staticValue(byId.get("note")?.value)).toBeNull();
    expect(byId.get("catalogue")?.value).toEqual({ kind: "src", src: "catalogue.json" });
  });

  // Sabotage: recording a <data src>'s element span instead of the
  // attribute's turns this red.
  it("records where each value was written", () => {
    const machine = machineOf(LOAN);
    const byId = new Map(machine.dataElements.map((d) => [d.id, d]));
    expect(byId.get("renewals")?.valueLocation.startOffset).toBe(LOAN.indexOf('"0"') + 1);
    expect(byId.get("catalogue")?.valueLocation.startOffset).toBe(LOAN.indexOf("catalogue.json"));
    expect(byId.get("limit")?.valueLocation).toEqual(byId.get("limit")?.location);
  });

  // Sabotage: answering a literal null for a <data expr> that does not compile
  // turns this red.
  it("defers a <data> expression that does not compile", () => {
    const machine = machineOf(`<scxml ${SCXML}>
      <datamodel><data id="due" expr="14 *"/></datamodel>
    </scxml>`);
    expect(machine.dataElements[0]?.value).toMatchObject({ kind: "invalid", source: "14 *" });
  });
});

describe("donedata and invoke", () => {
  // Sabotage: dropping a compiled <donedata> content to null turns this red.
  it("compiles a final state's <donedata> content or params", () => {
    const machine = machineOf(`<scxml ${SCXML}>
      <datamodel><data id="renewals" expr="2"/></datamodel>
      <state id="loan">
        <final id="returned"><donedata><content expr="renewals"/></donedata></final>
        <final id="lost"><donedata><param name="fee" expr="renewals * 5"/><param name="count" location="renewals"/></donedata></final>
        <final id="withdrawn"><donedata><content>withdrawn</content></donedata></final>
      </state>
    </scxml>`);
    expect(stateOf(machine, "returned").donedata).toMatchObject({
      expr: { kind: "compiled", source: "renewals" },
      params: [],
    });
    const lost = stateOf(machine, "lost").donedata;
    expect(lost?.expr).toBeNull();
    expect(lost?.exprLocation).toBeNull();
    expect(
      lost?.params.map((p) => [p.name, p.kind, (p.expr as { source: string }).source]),
    ).toEqual([
      ["fee", "expr", "renewals * 5"],
      ["count", "location", "renewals"],
    ]);
    const withdrawn = stateOf(machine, "withdrawn").donedata;
    expect(staticValue(withdrawn?.expr)).toBe("withdrawn");
    expect(stateOf(machine, "loan").donedata).toBeNull();
  });

  // Sabotage: answering null for a literal `type` turns this red.
  it("compiles an <invoke>, its finalize content taking the next content index", () => {
    const machine = machineOf(`<scxml ${SCXML}>
      <datamodel><data id="copy" expr="1"/></datamodel>
      <state id="loan">
        <onentry><raise event="loan.opened"/></onentry>
        <invoke type="scxml" srcexpr="'catalogue.scxml'" id="lookup">
          <param name="barcode" expr="copy"/>
          <finalize><raise event="lookup.done"/></finalize>
        </invoke>
        <invoke typeexpr="'scxml'"><content>catalogue</content></invoke>
        <invoke type="scxml" src="catalogue.scxml" namelist="copy"/>
      </state>
    </scxml>`);
    const [lookup, second, third] = stateOf(machine, "loan").invoke;
    expect(lookup?.index).toBe(0);
    expect(staticValue(lookup?.type)).toBe("scxml");
    expect(lookup?.src).toMatchObject({ kind: "compiled", source: "'catalogue.scxml'" });
    expect(lookup?.id).toBe("lookup");
    expect(lookup?.namelist).toEqual([]);
    expect(lookup?.params).toMatchObject([{ name: "barcode", kind: "expr" }]);
    expect(lookup?.content).toBeNull();
    expect(lookup?.autoforward).toBe(false);
    expect(lookup?.finalize?.content).toEqual([{ kind: "raise", cIndex: 1, event: "lookup.done" }]);
    expect(second?.index).toBe(1);
    expect(second?.type).toMatchObject({ kind: "compiled", source: "'scxml'" });
    expect(second?.src).toBeNull();
    expect(staticValue(second?.content)).toBe("catalogue");
    expect(second?.finalize).toBeNull();
    expect(staticValue(third?.src)).toBe("catalogue.scxml");
    expect(third?.namelist).toMatchObject([
      { name: "copy", kind: "location", expr: { kind: "compiled", source: "copy" } },
    ]);
  });

  // Sabotage: answering a literal null for a namelist entry that does not
  // compile turns this red.
  it("defers a namelist entry that does not compile", () => {
    const machine = machineOf(`<scxml ${SCXML}>
      <state id="loan"><invoke type="scxml" src="catalogue.scxml" namelist="1+"/></state>
    </scxml>`);
    expect(stateOf(machine, "loan").invoke[0]?.namelist[0]?.expr).toMatchObject({
      kind: "invalid",
      source: "1+",
    });
  });
});

describe("load-time expression errors", () => {
  // Sabotage: reporting the transition element's span instead of the cond
  // attribute's value span turns this red.
  it("names the element, the attribute and where the expression was written", () => {
    const source = `<scxml ${SCXML}>
  <state id="onShelf">
    <transition event="copy.borrowed" cond="renewals &lt;" target="onShelf"/>
  </state>
</scxml>`;
    const [error, ...rest] = compilerErrorsOf(source);
    expect(rest).toEqual([]);
    expect(error?.reason).toBe("expression_compile_error");
    expect(error?.element).toBe("transition");
    expect(error?.attribute).toBe("cond");
    expect(error?.owner).toEqual({ kind: "transition", tIndex: 0 });
    expect(error?.source).toBe("renewals <");
    expect(error?.location).toMatchObject({
      startLine: 3,
      startOffset: source.indexOf("renewals &lt;"),
    });
    expect(error?.location.startColumn).toBe((source.split("\n")[2]?.indexOf("renewals") ?? 0) + 1);
    expect(error?.error.type).toBe("ParseError");
    expect(error?.message).toBe(
      `failed to compile expression "renewals <": ${error?.error.message} ` +
        `(predicator line ${error?.error.position.line}, column ${error?.error.position.column})`,
    );
  });

  // Sabotage: answering only the first error instead of all of them turns
  // this red.
  it("answers every load-time error, in source order", () => {
    const source = `<scxml ${SCXML}>
  <datamodel><data id="holds" expr="[]"/></datamodel>
  <state id="desk">
    <onentry>
      <log expr="holds +"/>
      <if cond="holds =="><raise event="a"/><elseif cond="*"/><raise event="b"/></if>
      <foreach array="[" item="hold"/>
    </onentry>
    <transition event="desk.closed" cond=")" target="desk"/>
    <invoke typeexpr="+" srcexpr="-"><param name="p" expr="(("/></invoke>
    <invoke type="scxml"><content expr="]"/></invoke>
  </state>
  <final id="done"><donedata><param name="fee" expr="1 +"/></donedata></final>
  <final id="gone"><donedata><content expr="2 *"/></donedata></final>
</scxml>`;
    const errors = compilerErrorsOf(source);
    expect(errors.map((e) => [e.element, e.attribute, e.source])).toEqual([
      ["log", "expr", "holds +"],
      ["if", "cond", "holds =="],
      ["elseif", "cond", "*"],
      ["foreach", "array", "["],
      ["transition", "cond", ")"],
      ["invoke", "typeexpr", "+"],
      ["invoke", "srcexpr", "-"],
      ["param", "expr", "(("],
      ["content", "expr", "]"],
      ["param", "expr", "1 +"],
      ["content", "expr", "2 *"],
    ]);
    const offsets = errors.map((e) => e.location.startOffset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    for (const e of errors)
      expect(source.slice(e.location.startOffset).startsWith(e.source)).toBe(true);
    expect(errors[0]?.owner).toEqual({ kind: "content", cIndex: 0 });
    expect(errors[1]?.owner).toEqual({ kind: "content", cIndex: 1 });
    expect(errors[5]?.owner).toEqual({ kind: "invoke", stateIndex: 1, invokeIndex: 0 });
    expect(errors[9]?.owner).toEqual({ kind: "donedata", stateIndex: 2 });
  });
});

describe("compile", () => {
  // The identity fixture's bytes hash, outside this package, to the value
  // pinned below: `shasum -a 256` over the same bytes, and the reference's
  // own expression, `"sha256:" <> Base.encode16(:crypto.hash(:sha256,
  // source), case: :lower)`, run under `elixir -e` - both answer it.
  const IDENTITY_FIXTURE =
    `<scxml ${SCXML} name="Bibliothèque \u{1F4DA}" initial="onShelf">\n` +
    `  <state id="onShelf">\n` +
    `    <transition event="copy.borrowed" target="onLoan"/>\n` +
    `  </state>\n` +
    `  <state id="onLoan"/>\n` +
    `</scxml>\n`;

  // Sabotage: hashing the UTF-16 code units' low bytes instead of the UTF-8
  // encoding turns this red (the fixture has two- and four-byte points).
  it("stamps the identity the reference computes for the same bytes", () => {
    const result = compile(IDENTITY_FIXTURE);
    if (!result.ok) throw new Error("fixture does not compile");
    expect(result.chart.identity).toEqual({
      contentHash: "sha256:a1dd3e78ec313dd50d7341d7aa591dfba2749793a93b04aa58efee03f0035d6b",
      name: null,
      version: null,
    });
    expect(result.chart.machine.name).toBe("Bibliothèque \u{1F4DA}");
  });

  // Sabotage: dropping the host's chart name to null turns this red.
  it("carries the host's chart name and version beside the hash", () => {
    const result = publicCompile(IDENTITY_FIXTURE, {
      chartName: "loan",
      chartVersion: "3",
    });
    if (!result.ok) throw new Error("fixture does not compile");
    expect(result.chart.identity.name).toBe("loan");
    expect(result.chart.identity.version).toBe("3");
    expect(result.chart.identity.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  // Sabotage: answering an empty list for a parse refusal turns this red.
  it("answers the first refusing stage's errors, each in one list shape", () => {
    const parse = compile("<scxml");
    expect(parse.ok).toBe(false);
    if (!parse.ok) expect(parse.errors.map((e) => e.reason)).toEqual(["unexpected_end"]);

    const lowering = compile(`<scxml ${SCXML}><copy/></scxml>`);
    if (lowering.ok) throw new Error("lowered");
    expect(lowering.errors.map((e) => e.reason)).toEqual(["unsupported_element"]);

    const validation = compile(`<scxml ${SCXML} initial="nowhere"><state id="s"/></scxml>`);
    if (validation.ok) throw new Error("validated");
    expect(validation.errors.map((e) => e.reason)).toEqual(["unresolved_initial"]);
  });
});
