// `<send>` and `<cancel>`: the effects they answer, the send ids they mint,
// the refusals the core makes before any effect, and the argument failures
// that discard a send.
//
// The corpus is not vendored yet, so the delayed sends of the reference's
// scion suite are quoted below from its corpus (`conformance/corpus/scion.json`
// in statifier-ex at v2.9.0), each element under the id of the case it comes
// from, byte for byte. Everything else uses the library loan.

import { readFileSync } from "node:fs";
import { compile, parseDuration, Undefined, type Value } from "@riddler/predicator";
import { describe, expect, it } from "vitest";
import {
  type BlockOutcome,
  type ContentNode,
  executeBlock,
  type RaiseSink,
} from "../../src/core/content.js";
import {
  builtInType,
  type CancelNode,
  classifyType,
  INITIAL_SEND_STATE,
  type ParamNode,
  paramsData,
  parseTarget,
  reachable,
  rejectReason,
  type SendNode,
  type SendState,
  textData,
} from "../../src/core/send.js";
import {
  type ActiveStates,
  type Expr,
  evaluationContext,
  SCXML_EVENT_PROCESSOR,
} from "../../src/datamodel.js";
import { type Element, parseXml } from "../../src/xml/parser.js";

const NO_STATES: ActiveStates = { indexOf: () => undefined, configuration: new Set() };

const SINK: RaiseSink = {
  owner: { kind: "transition", tIndex: 0 },
  counters: { macrostep: 1, microstep: 1, round: 0 },
};

function expr(source: string): Expr {
  const compiled = compile(source);
  if (!compiled.ok) throw new Error(`fixture does not compile: ${source}`);
  return { kind: "compiled", program: compiled.instructions, source };
}

function attribute(element: Element, name: string): string | null {
  return element.attributes.find((a) => a.name === name)?.value ?? null;
}

/** An attribute pair folded as the compiler folds it: the literal, or the compiled `expr` twin. */
function pair(element: Element, name: string): Expr | null {
  const literal = attribute(element, name);
  if (literal !== null) return { kind: "static", value: literal };
  const source = attribute(element, `${name}expr`);
  return source === null ? null : expr(source);
}

function children(element: Element, name: string): Element[] {
  return element.children.filter((c): c is Element => c.type === "element" && c.name === name);
}

/** Builds the compiled `<send>` node from the element's source text. */
function sendNode(cIndex: number, source: string): SendNode {
  const parsed = parseXml(source);
  if (!parsed.ok) throw new Error(`fixture does not parse: ${source}`);
  const element = parsed.root;
  const namelist: ParamNode[] = (attribute(element, "namelist") ?? "")
    .split(/\s+/)
    .filter((name) => name !== "")
    .map((name) => ({ name, expr: expr(name) }));
  const params: ParamNode[] = children(element, "param").map((param) => ({
    name: attribute(param, "name") ?? "",
    expr: expr(attribute(param, "expr") ?? attribute(param, "location") ?? ""),
  }));
  const [content] = children(element, "content");
  let contentExpr: Expr | null = null;
  if (content !== undefined) {
    const source = attribute(content, "expr");
    contentExpr =
      source !== null
        ? expr(source)
        : {
            kind: "static",
            value: content.children.map((c) => (c.type === "text" ? c.value : "")).join(""),
          };
  }
  return {
    kind: "send",
    cIndex,
    event: pair(element, "event"),
    target: pair(element, "target"),
    type: pair(element, "type"),
    id: attribute(element, "id"),
    idlocation: attribute(element, "idlocation"),
    delay: pair(element, "delay"),
    namelist,
    params,
    content: contentExpr,
  };
}

function cancelNode(cIndex: number, source: string): CancelNode {
  const parsed = parseXml(source);
  if (!parsed.ok) throw new Error(`fixture does not parse: ${source}`);
  const sendid = pair(parsed.root, "sendid");
  if (sendid === null) throw new Error(`fixture has no sendid: ${source}`);
  return { kind: "cancel", cIndex, sendid };
}

function run(
  block: ContentNode[],
  entries: [string, Value][] = [],
  sends: SendState = INITIAL_SEND_STATE,
): BlockOutcome {
  return executeBlock(evaluationContext(new Map(entries), NO_STATES), block, SINK, sends);
}

const STAMP = { owner: SINK.owner, macrostep: 1, microstep: 1, round: 0 };

// ---------------------------------------------------------------------------
// The scion suite's delayed sends
// ---------------------------------------------------------------------------

describe("the scion suite's delayed sends", () => {
  // The same element in three cases, quoted once per case id.
  const delayedSendCases = [
    "scion/delayedSend/send1",
    "scion/delayedSend/send2",
    "scion/delayedSend/send3",
  ];

  for (const caseId of delayedSendCases) {
    // Sabotage: answering `kind: "send"` for a send with a delay in
    // executeSend turns this red.
    it(`${caseId}: <send event="s" delay="10ms"/> is a SendDelayed of 10 ms`, () => {
      const outcome = run([sendNode(0, `<send event="s" delay="10ms"/>`)]);
      expect(outcome.raised).toEqual([]);
      expect(outcome.effects).toEqual([
        {
          kind: "send_delayed",
          event: "s",
          target: null,
          type: null,
          data: Undefined,
          sendId: "send_1",
          idFromAuthor: false,
          cIndex: 0,
          ...STAMP,
          delayMs: 10,
          ordinal: 1,
        },
      ]);
    });
  }

  // Sabotage: answering paramsData whatever the node carries (dropping the
  // `<content>` branch in executeSend) turns this red.
  it("scion/send-data/send1: both delayed sends carry their data and a 10 ms delay", () => {
    const first = sendNode(
      0,
      `<send delayexpr="'10ms'" eventexpr="'s1'" namelist="foo bar">
                <param name="bif" location="bat"/>
                <param name="belt" expr="4"/>
            </send>`,
    );
    const second = sendNode(
      1,
      `<send delayexpr="'10ms'" eventexpr="'s2'">
                <content>More content.</content>
            </send>`,
    );
    const outcome = run(
      [first, second],
      [
        ["foo", 1],
        ["bar", 2],
        ["bat", 3],
      ],
    );
    expect(outcome.raised).toEqual([]);
    expect(outcome.effects).toMatchObject([
      {
        kind: "send_delayed",
        event: "s1",
        delayMs: 10,
        data: { foo: 1, bar: 2, bif: 3, belt: 4 },
        sendId: "send_1",
        ordinal: 1,
      },
      {
        kind: "send_delayed",
        event: "s2",
        delayMs: 10,
        data: "More content.",
        sendId: "send_2",
        ordinal: 2,
      },
    ]);
  });

  // Sabotage: minting a generated id for an author-written `id` in
  // executeSend turns this red.
  it("scion/send-idlocation/test0: the author's id is kept, idlocation gets the generated one", () => {
    const outcome = run(
      [
        sendNode(
          0,
          `<send id="$scion.sendid0" event="ignore" delay="1ms" type="http://www.w3.org/TR/scxml/#SCXMLEventProcessor"/>`,
        ),
        sendNode(
          1,
          `<send idlocation="httpid" event="ignore" delay="2ms" type="http://www.w3.org/TR/scxml/#SCXMLEventProcessor"/>`,
        ),
      ],
      [["httpid", "foo"]],
    );
    expect(outcome.raised).toEqual([]);
    expect(outcome.effects).toMatchObject([
      {
        kind: "send_delayed",
        type: SCXML_EVENT_PROCESSOR,
        delayMs: 1,
        sendId: "$scion.sendid0",
        idFromAuthor: true,
        ordinal: 1,
      },
      {
        kind: "datamodel_change",
        locationPath: ["httpid"],
        locationSource: "httpid",
        newValue: "send_1",
        priorValue: "foo",
        cIndex: 1,
      },
      {
        kind: "send_delayed",
        type: SCXML_EVENT_PROCESSOR,
        delayMs: 2,
        sendId: "send_1",
        idFromAuthor: true,
        ordinal: 2,
      },
    ]);
    expect(outcome.context.data.get("httpid")).toBe("send_1");
    expect(outcome.sends).toEqual({
      sendCounter: 1,
      timerCounter: 2,
      sendTypes: null,
      routes: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Immediate sends
// ---------------------------------------------------------------------------

describe("an immediate <send>", () => {
  // Sabotage: advancing the timer counter for every send in executeSend
  // turns this red.
  it("scion/send-internal/test0: is a Send with no ordinal, and no timer ordinal is used", () => {
    const outcome = run(
      [
        sendNode(
          0,
          `<send eventexpr="'s1'" namelist="foo bar" target="#_internal">
                <param name="bif" location="bat"/>
                <param name="belt" expr="4"/>
            </send>`,
        ),
      ],
      [
        ["foo", 1],
        ["bar", 2],
        ["bat", 3],
      ],
    );
    expect(outcome.effects).toEqual([
      {
        kind: "send",
        event: "s1",
        target: "#_internal",
        type: null,
        data: { foo: 1, bar: 2, bif: 3, belt: 4 },
        sendId: "send_1",
        idFromAuthor: false,
        cIndex: 0,
        ...STAMP,
        ordinal: null,
      },
    ]);
    expect(outcome.sends).toEqual({
      sendCounter: 1,
      timerCounter: 0,
      sendTypes: null,
      routes: null,
    });
  });

  // Sabotage: reading every `<content>` as literal text in resolveContent
  // turns this red.
  it("carries a <content expr> value as it evaluated", () => {
    const outcome = run([
      sendNode(0, `<send event="loan.due"><content expr="'Hello, world.'"/></send>`),
    ]);
    expect(outcome.effects).toMatchObject([{ kind: "send", data: "Hello, world." }]);
  });

  // Sabotage: parsing a registered type's target in rejectReason (moving the
  // registered check below the target check) turns this red.
  it("of a registered type goes to the host with its target unread and an ordinal", () => {
    const sends: SendState = { ...INITIAL_SEND_STATE, sendTypes: new Set(["branch-mail"]) };
    const outcome = run(
      [sendNode(0, `<send event="hold.ready" type="branch-mail" target="patron 42"/>`)],
      [],
      sends,
    );
    expect(outcome.raised).toEqual([]);
    expect(outcome.effects).toMatchObject([
      { kind: "send", type: "branch-mail", target: "patron 42", ordinal: 1 },
    ]);
    expect(outcome.sends.timerCounter).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Send ids
// ---------------------------------------------------------------------------

describe("send ids", () => {
  // Sabotage: starting the generated id from the counter rather than the
  // counter plus one (`send_${state.sendCounter}`) turns this red.
  it("count from send_1, one per generated id, and carry across blocks", () => {
    const first = run([
      sendNode(0, `<send event="loan.opened"/>`),
      sendNode(1, `<send event="loan.due"/>`),
    ]);
    expect(first.effects.map((e) => ("sendId" in e ? e.sendId : null))).toEqual([
      "send_1",
      "send_2",
    ]);
    const second = run([sendNode(0, `<send event="loan.renewed"/>`)], [], first.sends);
    expect(second.effects).toMatchObject([{ sendId: "send_3" }]);
  });

  // Sabotage: advancing the send counter for an author-written id in
  // executeSend turns this red.
  it("written by the author do not consume the sequence", () => {
    const outcome = run([
      sendNode(0, `<send id="renewal" event="loan.renewed"/>`),
      sendNode(1, `<send event="loan.due"/>`),
    ]);
    expect(outcome.effects).toMatchObject([
      { sendId: "renewal", idFromAuthor: true },
      { sendId: "send_1", idFromAuthor: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The idlocation write's datamodel_change
// ---------------------------------------------------------------------------

/** The fields of a datamodel_change, in the order the reference's effect declares them. */
const CHANGE_FIELDS = [
  "kind",
  "locationPath",
  "locationSource",
  "newValue",
  "priorValue",
  "dIndex",
  "cIndex",
  "owner",
  "macrostep",
  "microstep",
  "round",
];

describe("a <send idlocation> write", () => {
  // statifier-ex v2.10.0, test/statifier/machine/content/send_test.exs: "the
  // :datamodel_change effect precedes :send and names the raw idlocation,
  // c_index, and owner".
  // Sabotage: answering the send's effect before its change in executeSend
  // (`[effect, ...changes]`) turns this red.
  it("answers a datamodel_change just before the send, naming its node and block", () => {
    const outcome = run(
      [sendNode(2, `<send event="loan.due" idlocation="lastSend"/>`)],
      [["lastSend", "renewal"]],
    );
    expect(outcome.raised).toEqual([]);
    expect(outcome.effects).toEqual([
      {
        kind: "datamodel_change",
        locationPath: ["lastSend"],
        locationSource: "lastSend",
        newValue: "send_1",
        priorValue: "renewal",
        dIndex: null,
        cIndex: 2,
        ...STAMP,
      },
      {
        kind: "send",
        event: "loan.due",
        target: null,
        type: null,
        data: Undefined,
        sendId: "send_1",
        idFromAuthor: true,
        cIndex: 2,
        ...STAMP,
        ordinal: null,
      },
    ]);
    expect(Object.keys(outcome.effects[0] ?? {})).toEqual(CHANGE_FIELDS);
  });

  // statifier-ex v2.10.0, lib/statifier/machine/content/send.ex
  // `dispatch_or_reject/8`: a refused send answers no effect, its write
  // standing.
  // Sabotage: refusing only a send that wrote no idlocation in executeSend
  // (`rejected !== null && changes.length === 0`) turns this red.
  it("answers no datamodel_change when the send is refused, though the write stands", () => {
    const desk: SendState = {
      ...INITIAL_SEND_STATE,
      routes: { sessions: new Set(["desk-1"]), parent: false, invokes: new Set() },
    };
    const outcome = run(
      [sendNode(0, `<send event="loan.recall" target="#_scxml_branch-2" idlocation="lastSend"/>`)],
      [["lastSend", null]],
      desk,
    );
    expect(outcome.effects).toEqual([]);
    expect(outcome.raised.map((event) => event.name)).toEqual(["error.communication"]);
    expect(outcome.context.data.get("lastSend")).toBe("send_1");
  });
});

// ---------------------------------------------------------------------------
// Static target and type invalidity
// ---------------------------------------------------------------------------

describe("a statically invalid <send>", () => {
  // Sabotage: returning null from rejectReason for an invalid target turns
  // this red.
  it("with an invalid target rejects before any effect, naming its minted id", () => {
    const outcome = run(
      [
        sendNode(0, `<send event="loan.due" target="front desk" idlocation="lastSend"/>`),
        sendNode(1, `<send event="loan.closed"/>`),
      ],
      [["lastSend", null]],
    );
    expect(outcome.effects).toEqual([]);
    expect(outcome.raised).toEqual([
      {
        name: "error.execution",
        type: "platform",
        sendid: "send_1",
        reason: { kind: "invalid_target", target: "front desk" },
        data: { kind: "invalid_target", target: "front desk" },
        cause: { origin: { kind: "content", cIndex: 0, owner: SINK.owner }, ...SINK.counters },
      },
    ]);
    // The id was minted and idlocation written before the rejection; both stand.
    expect(outcome.sends.sendCounter).toBe(1);
    expect(outcome.context.data.get("lastSend")).toBe("send_1");
  });

  // Sabotage: returning null from rejectReason for an unsupported type turns
  // this red.
  it("with an unsupported type rejects before any effect", () => {
    const outcome = run([sendNode(0, `<send event="loan.due" type="carrier-pigeon"/>`)]);
    expect(outcome.effects).toEqual([]);
    expect(outcome.raised).toMatchObject([
      {
        name: "error.execution",
        sendid: "send_1",
        data: { kind: "unsupported_type", type: "carrier-pigeon" },
      },
    ]);
  });

  // Sabotage: answering only the inner refusal for send_rejected in
  // reasonValue turns this red.
  it("inside an <if> is nested content, without the send id on the event", () => {
    const outcome = run([
      {
        kind: "if",
        cIndex: 0,
        branches: [{ cond: null, content: [sendNode(1, `<send event="x" target="nowhere"/>`)] }],
      },
    ]);
    expect(outcome.raised).toHaveLength(1);
    expect(outcome.raised[0]?.sendid).toBeUndefined();
    expect(outcome.raised[0]?.data).toEqual({
      kind: "nested_content",
      c_index: 1,
      reason: {
        kind: "send_rejected",
        send_id: "send_1",
        error_kind: "execution",
        reason: { kind: "invalid_target", target: "nowhere" },
      },
    });
  });
});

describe("a target the declared routes do not reach", () => {
  // The routes a driver declares for a session that was never invoked and
  // runs no invocation: only its own session id.
  const DESK: SendState = {
    ...INITIAL_SEND_STATE,
    routes: { sessions: new Set(["desk-1"]), parent: false, invokes: new Set() },
  };

  // Sabotage: skipping the reachability check in executeSend turns this red.
  it("refuses an immediate send to another session with error.communication", () => {
    const outcome = run(
      [
        sendNode(0, `<send event="loan.recall" target="#_scxml_branch-2"/>`),
        { kind: "raise", cIndex: 1, event: "loan.after" },
      ],
      [],
      DESK,
    );
    expect(outcome.effects).toEqual([]);
    expect(outcome.raised).toMatchObject([
      {
        name: "error.communication",
        type: "platform",
        sendid: "send_1",
        data: { kind: "unreachable_target", target: "#_scxml_branch-2" },
      },
    ]);
    expect(outcome.sends.sendCounter).toBe(1);
  });

  // Sabotage: answering true for every route in reachable turns this red.
  it("judges the parent, a session and an invocation against the routes", () => {
    const routes = { sessions: new Set(["desk-1"]), parent: true, invokes: new Set(["hold"]) };
    const sends: SendState = { ...INITIAL_SEND_STATE, routes };
    for (const target of ["#_parent", "#_scxml_desk-1", "#_hold", "#_internal"]) {
      const outcome = run([sendNode(0, `<send event="loan.ok" target="${target}"/>`)], [], sends);
      expect(outcome.raised).toEqual([]);
    }
    for (const target of ["#_scxml_branch-2", "#_renewal"]) {
      const outcome = run([sendNode(0, `<send event="loan.no" target="${target}"/>`)], [], sends);
      expect(outcome.raised.map((event) => event.name)).toEqual(["error.communication"]);
    }
    const orphan = run([sendNode(0, `<send event="loan.no" target="#_parent"/>`)], [], DESK);
    expect(orphan.raised.map((event) => event.name)).toEqual(["error.communication"]);
    expect(reachable(routes, parseTarget("front desk"))).toBe(false);
  });

  // Sabotage: carrying "execution" for every refusal in executeSend turns
  // this red.
  it("keeps the communication kind whole when the refused send is nested", () => {
    const outcome = run(
      [
        {
          kind: "if",
          cIndex: 0,
          branches: [
            {
              cond: null,
              content: [sendNode(1, `<send event="loan.recall" target="#_scxml_branch-2"/>`)],
            },
          ],
        },
      ],
      [],
      DESK,
    );
    expect(outcome.raised.map((event) => event.name)).toEqual(["error.execution"]);
    expect(outcome.raised[0]?.sendid).toBeUndefined();
    expect(outcome.raised[0]?.data).toEqual({
      kind: "nested_content",
      c_index: 1,
      reason: {
        kind: "send_rejected",
        send_id: "send_1",
        error_kind: "communication",
        reason: { kind: "unreachable_target", target: "#_scxml_branch-2" },
      },
    });
  });

  // Sabotage: judging a delayed send's route in executeSend turns this red.
  it("leaves a delayed send's route to the timer", () => {
    const outcome = run(
      [sendNode(0, `<send event="loan.recall" target="#_scxml_branch-2" delay="1s"/>`)],
      [],
      DESK,
    );
    expect(outcome.raised).toEqual([]);
    expect(outcome.effects).toMatchObject([{ kind: "send_delayed" }]);
  });

  // Sabotage: judging a registered type's target against the routes turns
  // this red.
  it("never reads a registered type's target", () => {
    const sends: SendState = { ...DESK, sendTypes: new Set(["branch-mail"]) };
    const outcome = run(
      [sendNode(0, `<send event="loan.recall" type="branch-mail" target="#_scxml_branch-2"/>`)],
      [],
      sends,
    );
    expect(outcome.raised).toEqual([]);
    expect(outcome.effects).toMatchObject([{ kind: "send" }]);
  });

  // Sabotage: judging reachability with no routes declared turns this red.
  it("makes no judgement when no routes are declared", () => {
    const outcome = run([sendNode(0, `<send event="loan.recall" target="#_scxml_branch-2"/>`)]);
    expect(outcome.raised).toEqual([]);
    expect(outcome.effects).toMatchObject([{ kind: "send", target: "#_scxml_branch-2" }]);
  });
});

describe("rejectReason, the static check", () => {
  // Sabotage: checking the target before the type in rejectReason turns this
  // red.
  it("judges the type before the target", () => {
    expect(rejectReason("nowhere", "carrier-pigeon", null)).toEqual({
      kind: "unsupported_type",
      type: "carrier-pigeon",
    });
  });

  // Sabotage: treating every string as a valid target in parseTarget turns
  // this red.
  it("accepts every target the SCXML processor names and refuses the rest", () => {
    for (const target of [null, "#_internal", "_internal", "#_parent", "#_scxml_s1", "#_inv"]) {
      expect(rejectReason(target, null, null)).toBeNull();
    }
    expect(rejectReason("front desk", "scxml", null)).toEqual({
      kind: "invalid_target",
      target: "front desk",
    });
    expect(rejectReason(7, null, null)).toEqual({ kind: "invalid_target", target: 7 });
  });

  // Sabotage: dropping the `scxml` short form from builtInType turns this red.
  it("classifies the built-in spellings, a registered type and the rest", () => {
    expect([null, "scxml", SCXML_EVENT_PROCESSOR].map(builtInType)).toEqual([true, true, true]);
    const registered = new Set(["branch-mail", "scxml"]);
    expect(classifyType(registered, "scxml")).toBe("built_in");
    expect(classifyType(registered, "branch-mail")).toBe("registered");
    expect(classifyType(null, "branch-mail")).toBe("unsupported");
    expect(classifyType(registered, 3)).toBe("unsupported");
  });

  // Sabotage: dropping the `_parent` spelling from parseTarget turns this red.
  it("parses each special target into its route", () => {
    expect(
      [
        null,
        "#_internal",
        "_internal",
        "#_parent",
        "_parent",
        "#_scxml_s1",
        "#_inv",
        "#_",
        "x",
      ].map(parseTarget),
    ).toEqual([
      { kind: "self" },
      { kind: "internal" },
      { kind: "internal" },
      { kind: "parent" },
      { kind: "parent" },
      { kind: "session", sessionId: "s1" },
      { kind: "invoke", invokeId: "inv" },
      { kind: "invalid", target: "#_" },
      { kind: "invalid", target: "x" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Argument failures
// ---------------------------------------------------------------------------

describe("an argument failure", () => {
  // Sabotage: keeping a bumped send counter when the event fails to resolve
  // in executeSend turns this red.
  it("discards the send, raises error.execution and mints no id", () => {
    const outcome = run(
      [
        sendNode(0, `<send eventexpr="missingRoot" idlocation="lastSend"/>`),
        sendNode(1, `<send event="loan.closed"/>`),
      ],
      [["lastSend", null]],
    );
    expect(outcome.effects).toEqual([]);
    expect(outcome.raised).toMatchObject([
      {
        name: "error.execution",
        type: "platform",
        data: { kind: "evaluator_error", source: "missingRoot" },
      },
    ]);
    expect(outcome.raised[0]?.sendid).toBeUndefined();
    expect(outcome.sends).toEqual(INITIAL_SEND_STATE);
    expect(outcome.context.data.get("lastSend")).toBeNull();
  });

  // Sabotage: skipping a failed `<param>` in resolveParams instead of
  // stopping turns this red.
  it("in a <param> discards the whole send", () => {
    const outcome = run([
      sendNode(0, `<send event="loan.due"><param name="copy" location="copyId"/></send>`),
    ]);
    expect(outcome.effects).toEqual([]);
    expect(outcome.raised).toMatchObject([{ name: "error.execution" }]);
  });

  // Sabotage: answering a zero delay for text the parser refuses in
  // resolveDelay turns this red.
  it("in the delay discards the send, whatever shape the delay took", () => {
    for (const [source, value] of [
      [`<send event="loan.due" delay="soon"/>`, "soon"],
      [`<send event="loan.due" delayexpr="5"/>`, 5],
    ] as const) {
      const outcome = run([sendNode(0, source)]);
      expect(outcome.effects).toEqual([]);
      expect(outcome.raised).toMatchObject([
        { name: "error.execution", data: { kind: "invalid_delay", value } },
      ]);
    }
  });

  // Sabotage: treating the idlocation write as always succeeding in
  // executeSend turns this red.
  it("in the idlocation write discards the send and mints no id", () => {
    const outcome = run([sendNode(0, `<send event="loan.due" idlocation="undeclared"/>`)]);
    expect(outcome.effects).toEqual([]);
    expect(outcome.raised).toMatchObject([
      { name: "error.execution", data: { kind: "unbound_location", location: "undeclared" } },
    ]);
    expect(outcome.sends).toEqual(INITIAL_SEND_STATE);
  });

  // Sabotage: answering null for an expression that never compiled in
  // resolve turns this red.
  it("in an expression that never compiled discards the send", () => {
    const node: SendNode = {
      ...sendNode(0, `<send event="loan.due"/>`),
      target: { kind: "invalid", source: "branch +", message: "unexpected end" },
    };
    const outcome = run([node]);
    expect(outcome.effects).toEqual([]);
    expect(outcome.raised).toMatchObject([
      { data: { kind: "compile_error", source: "branch +", message: "unexpected end" } },
    ]);
  });
});

describe("a delay", () => {
  // Sabotage: refusing a duration value in resolveDelay turns this red.
  it("may be a duration value, and a leading dot reads as zero", () => {
    const duration = parseDuration("2s");
    if (!duration.ok) throw new Error("fixture duration does not parse");
    const node: SendNode = {
      ...sendNode(0, `<send event="loan.due"/>`),
      delay: { kind: "static", value: duration.value },
    };
    const outcome = run([node, sendNode(1, `<send event="loan.due" delay=".5s"/>`)]);
    expect(outcome.effects).toMatchObject([
      { kind: "send_delayed", delayMs: 2000 },
      { kind: "send_delayed", delayMs: 500 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

describe("a payload", () => {
  // Sabotage: answering the trimmed text without normalizing its whitespace
  // in textData turns this red.
  it("from <content> text is a literal's value, else the text space-normalized", () => {
    expect(textData("  42 ")).toBe(42);
    expect(textData("[1, 2]")).toEqual([1, 2]);
    expect(textData("  More\n   content. ")).toBe("More content.");
    expect(textData(" \n ")).toBe(Undefined);
  });

  // Sabotage: keeping the first of a repeated name in paramsData turns this
  // red.
  it("from params is a map, the last repeated name winning, or no data", () => {
    expect(
      paramsData([
        ["copy", 1],
        ["copy", 2],
      ]),
    ).toEqual({ copy: 2 });
    expect(paramsData([])).toBe(Undefined);
  });
});

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

describe("<cancel>", () => {
  // Sabotage: answering a fixed send id in executeCancel turns this red.
  it("names the send id, from sendid or sendidexpr, with an ordinal each", () => {
    const outcome = run(
      [
        cancelNode(0, `<cancel sendid="renewal"/>`),
        cancelNode(1, `<cancel sendidexpr="lastSend"/>`),
      ],
      [["lastSend", "send_4"]],
    );
    expect(outcome.raised).toEqual([]);
    expect(outcome.effects).toEqual([
      { kind: "cancel", sendId: "renewal", cIndex: 0, ...STAMP, ordinal: 1 },
      { kind: "cancel", sendId: "send_4", cIndex: 1, ...STAMP, ordinal: 2 },
    ]);
    expect(outcome.sends.timerCounter).toBe(2);
  });

  // Sabotage: keeping a bumped timer counter when sendidexpr fails in
  // executeCancel turns this red.
  it("whose sendidexpr fails raises error.execution and cancels nothing", () => {
    const outcome = run([cancelNode(0, `<cancel sendidexpr="missingRoot"/>`)]);
    expect(outcome.effects).toEqual([]);
    expect(outcome.raised).toMatchObject([{ name: "error.execution" }]);
    expect(outcome.sends).toEqual(INITIAL_SEND_STATE);
  });
});

describe("the module graph", () => {
  // Sabotage: importing the Invalid type from ./content.js in send.ts again
  // turns this red.
  it("send.ts imports nothing from content.ts, which imports it", () => {
    const read = (file: string) =>
      readFileSync(new URL(`../../src/core/${file}`, import.meta.url), "utf8");
    expect(read("content.ts")).toMatch(/from "\.\/send\.js"/);
    expect(read("send.ts")).not.toMatch(/from "\.\/content\.js"/);
  });
});
