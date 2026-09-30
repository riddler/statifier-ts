// A compiled chart's `<send>` and `<cancel>` nodes, run through the block
// runner: the chart compiles, a block is taken from its Machine, and the
// effects are what executing that block answers.
//
// The library loan fixture is written here. The scion charts are the
// reference's corpus sources (`conformance/corpus/scion.json` in statifier-ex
// at v2.9.0), each quoted from `<scxml` to `</scxml>` byte for byte under the
// id of its case, with the XML declaration and the licence comment before the
// root left out. They are Copyright 2011-2012 Jacob Beard, INFICON, and other
// SCION contributors, under the Apache License, Version 2.0.

import { Undefined, type Value } from "@riddler/predicator";
import { describe, expect, it } from "vitest";
import { compile } from "../../src/compiler.js";
import { type BlockOutcome, type ContentNode, executeBlock } from "../../src/core/content.js";
import { INITIAL_SEND_STATE, type SendState } from "../../src/core/send.js";
import {
  type ActiveStates,
  bind,
  type EvaluationContext,
  evaluate,
  evaluationContext,
  type Owner,
  SCXML_EVENT_PROCESSOR,
} from "../../src/datamodel.js";
import type { Machine } from "../../src/machine.js";

const NO_STATES: ActiveStates = { indexOf: () => undefined, configuration: new Set() };

const COUNTERS = { macrostep: 1, microstep: 1, round: 0 };

function machineOf(source: string): Machine {
  const result = compile(source);
  if (!result.ok) throw new Error(`fixture does not compile: ${JSON.stringify(result.errors)}`);
  return result.chart.machine;
}

/** The chart's `<data>` bound in document order, each to its evaluated value. */
function contextOf(machine: Machine): EvaluationContext {
  let context = evaluationContext(new Map(), NO_STATES);
  for (const data of machine.dataElements) {
    let value: Value = Undefined;
    if (data.value.kind === "static" || data.value.kind === "compiled") {
      const outcome = evaluate(context, data.value);
      if (!outcome.ok) throw new Error(`fixture data ${data.id} does not evaluate`);
      value = outcome.value;
    }
    context = bind(context, data.id, value);
  }
  return context;
}

function stateIndex(machine: Machine, id: string): number {
  const index = machine.idToIndex.get(id);
  if (index === undefined) throw new Error(`no state ${id}`);
  return index;
}

function onentryOf(machine: Machine, id: string): [Owner, readonly ContentNode[]] {
  const index = stateIndex(machine, id);
  const block = machine.states[index]?.onentry[0];
  if (block === undefined) throw new Error(`no onentry on ${id}`);
  return [{ kind: "onentry", stateIndex: index, ordinal: 0 }, block.content];
}

function onexitOf(machine: Machine, id: string): [Owner, readonly ContentNode[]] {
  const index = stateIndex(machine, id);
  const block = machine.states[index]?.onexit[0];
  if (block === undefined) throw new Error(`no onexit on ${id}`);
  return [{ kind: "onexit", stateIndex: index, ordinal: 0 }, block.content];
}

/** The content of the first transition out of `id` on `event`. */
function transitionOf(
  machine: Machine,
  id: string,
  event: string,
): [Owner, readonly ContentNode[]] {
  const source = stateIndex(machine, id);
  const transition = machine.transitions.find(
    (t) => t.source === source && t.events.some((e) => e.join(".") === event),
  );
  if (transition === undefined) throw new Error(`no transition out of ${id} on ${event}`);
  return [{ kind: "transition", tIndex: transition.tIndex }, transition.content];
}

function run(
  machine: Machine,
  [owner, content]: [Owner, readonly ContentNode[]],
  sends: SendState = INITIAL_SEND_STATE,
): BlockOutcome {
  return executeBlock(contextOf(machine), content, { owner, counters: COUNTERS }, sends);
}

// ---------------------------------------------------------------------------
// A compiled block's sends and cancels
// ---------------------------------------------------------------------------

const LOAN = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="onLoan">
  <datamodel>
    <data id="copy" expr="9"/>
    <data id="branch" expr="'central'"/>
    <data id="reminder"/>
  </datamodel>
  <state id="onLoan">
    <onentry>
      <send event="loan.opened" target="#_internal" namelist="copy">
      </send>
      <send eventexpr="'loan.' + 'due'" delayexpr="'14s'" idlocation="reminder">
        <param name="branch" location="branch"/>
      </send>
      <send event="hold.ready" id="notice" delay="2s"><content>copy 9 at the desk</content></send>
      <cancel sendidexpr="reminder"/>
      <cancel sendid="notice"/>
    </onentry>
    <transition event="copy.returned" target="returned"/>
  </state>
  <final id="returned"/>
</scxml>`;

describe("a compiled block", () => {
  // Sabotage: compiling <send> and <cancel> to no node in the compiler
  // (dropping them from the block) turns this red: no effect is produced.
  it("runs its <send> and <cancel> nodes to Send, SendDelayed and Cancel effects", () => {
    const machine = machineOf(LOAN);
    const block = onentryOf(machine, "onLoan");
    const outcome = run(machine, block);
    const stamp = { owner: block[0], ...COUNTERS };
    expect(outcome.raised).toEqual([]);
    expect(outcome.effects).toEqual([
      {
        kind: "send",
        event: "loan.opened",
        target: "#_internal",
        type: null,
        data: { copy: 9 },
        sendId: "send_1",
        idFromAuthor: false,
        cIndex: 0,
        ...stamp,
        ordinal: null,
      },
      {
        kind: "send_delayed",
        event: "loan.due",
        target: null,
        type: null,
        data: { branch: "central" },
        sendId: "send_2",
        idFromAuthor: true,
        cIndex: 1,
        ...stamp,
        delayMs: 14000,
        ordinal: 1,
      },
      {
        kind: "send_delayed",
        event: "hold.ready",
        target: null,
        type: null,
        data: "copy 9 at the desk",
        sendId: "notice",
        idFromAuthor: true,
        cIndex: 2,
        ...stamp,
        delayMs: 2000,
        ordinal: 2,
      },
      { kind: "cancel", sendId: "send_2", cIndex: 3, ...stamp, ordinal: 3 },
      { kind: "cancel", sendId: "notice", cIndex: 4, ...stamp, ordinal: 4 },
    ]);
    expect(outcome.context.data.get("reminder")).toBe("send_2");
    expect(outcome.sends).toEqual({ sendCounter: 2, timerCounter: 4, sendTypes: null });
  });

  // Sabotage: compiling a namelist entry that fails to compile to a literal
  // null instead of an Invalid turns this red: the send would go out.
  it("discards a send whose namelist entry never compiled, raising error.execution", () => {
    const machine = machineOf(`<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0">
  <state id="onLoan"><onentry><send event="loan.opened" namelist="1+"/></onentry></state>
</scxml>`);
    const outcome = run(machine, onentryOf(machine, "onLoan"));
    expect(outcome.effects).toEqual([]);
    expect(outcome.raised).toMatchObject([{ name: "error.execution" }]);
    expect(outcome.sends).toEqual(INITIAL_SEND_STATE);
  });
});

// ---------------------------------------------------------------------------
// The scion suite's delayed sends, compiled
// ---------------------------------------------------------------------------

const SEND1 = `<scxml 
    datamodel="ecmascript"
    xmlns="http://www.w3.org/2005/07/scxml"
    version="1.0">

    <state id="a">
        <transition target="b" event="t1">
            <send event="s" delay="10ms"/>
        </transition>
    </state>

    <state id="b">
        <transition target="c" event="s"/>
    </state>

    <state id="c">
        <transition target="d" event="t2"/>
    </state>

    <state id="d"/>

</scxml>`;

const SEND2 = `<scxml 
    datamodel="ecmascript"
    xmlns="http://www.w3.org/2005/07/scxml"
    version="1.0">

    <state id="a">
        <onexit>
            <send event="s" delay="10ms"/>
        </onexit>

        <transition target="b" event="t1">
        </transition>
    </state>

    <state id="b">
        <transition target="c" event="s"/>
    </state>

    <state id="c">
        <transition target="d" event="t2"/>
    </state>

    <state id="d"/>

</scxml>`;

const SEND3 = `<scxml 
    datamodel="ecmascript"
    xmlns="http://www.w3.org/2005/07/scxml"
    version="1.0">

    <state id="a">
        <transition target="b" event="t1">
        </transition>
    </state>

    <state id="b">
        <onentry>
            <send event="s" delay="10ms"/>
        </onentry>

        <transition target="c" event="s"/>
    </state>

    <state id="c">
        <transition target="d" event="t2"/>
    </state>

    <state id="d"/>

</scxml>`;

const SEND_DATA = `<scxml
    datamodel="ecmascript"
    xmlns="http://www.w3.org/2005/07/scxml"
    version="1.0">

    <datamodel>
        <data id="foo" expr="1"/>
        <data id="bar" expr="2"/>
        <data id="bat" expr="3"/>
    </datamodel>

    <state id="a">
        <transition target="b" event="t">
            <send delayexpr="'10ms'" eventexpr="'s1'" namelist="foo bar">
                <param name="bif" location="bat"/>
                <param name="belt" expr="4"/>
            </send>
        </transition>
    </state>

    <state id="b">
        <transition event="s1" target="c"
            cond="_event.data.foo === 1 &amp;&amp;
                _event.data.bar === 2 &amp;&amp;
                _event.data.bif === 3 &amp;&amp;
                _event.data.belt === 4">

            <send delayexpr="'10ms'" eventexpr="'s2'">
                <content>More content.</content>
            </send>

        </transition>

        <transition event="s1" target="f"/>
    </state>


    <state id="c">
        <transition event="s2" target="d"
            cond="_event.data === 'More content.'">
            <send eventexpr="'s3'">
                <content expr="'Hello, world.'"/>
            </send>
        </transition>

        <transition event="s2" target="f">
            <log label="_event" expr="_event"/>
        </transition>
    </state>


    <state id="d">
        <transition event="s3" target="e"
            cond="_event.data === 'Hello, world.'"/>

        <transition event="s3" target="f">
            <log label="_event" expr="_event"/>
        </transition>
    </state>

    <state id="e"/>

    <state id="f"/>
</scxml>`;

const SEND_IDLOCATION = `<scxml xmlns="http://www.w3.org/2005/07/scxml"
  version="1.0"
  initial="uber">

  <datamodel>
    <data id="httpid" expr="'foo'"/>
  </datamodel>


  <state id="uber">

    <state id="s0">
      <onentry>
        <!-- make sure we do not clobber send/@id when id is $scion.sendid* -->
        <send id="$scion.sendid0" event="ignore" delay="1ms" type="http://www.w3.org/TR/scxml/#SCXMLEventProcessor"/>
        <send idlocation="httpid" event="ignore" delay="2ms" type="http://www.w3.org/TR/scxml/#SCXMLEventProcessor"/>
      </onentry>
      <transition event="t1" target="s1"/>
    </state>
    <state id="s1">
      <onentry>
        <log label="httpid" expr="httpid" />
      </onentry>
      <transition event="t2" target="pass" cond="httpid !== 'foo' &amp;&amp; httpid !== '$scion.sendid0'"/>
      <transition event="t2" target="fail"/>
    </state>
    <state id="s2">
      <transition event="t2" target="pass"/>
    </state>
  </state>

  <final id="pass">
    <onentry>
      <log expr="'RESULT: pass'" label="TEST"/>
    </onentry>
  </final>

  <final id="fail">
    <onentry>
      <log expr="'RESULT: fail'" label="TEST"/>
    </onentry>
  </final>

</scxml>`;

describe("the scion suite's delayed sends, compiled", () => {
  const delayedSendCases: [string, string, (m: Machine) => [Owner, readonly ContentNode[]]][] = [
    ["scion/delayedSend/send1", SEND1, (m) => transitionOf(m, "a", "t1")],
    ["scion/delayedSend/send2", SEND2, (m) => onexitOf(m, "a")],
    ["scion/delayedSend/send3", SEND3, (m) => onentryOf(m, "b")],
  ];

  for (const [caseId, source, blockOf] of delayedSendCases) {
    // Sabotage: folding a <send>'s literal `delay` to null in the compiler
    // turns this red: the send would go out at once.
    it(`${caseId}: the block holding <send event="s" delay="10ms"/> answers a SendDelayed of 10 ms`, () => {
      const machine = machineOf(source);
      const block = blockOf(machine);
      const outcome = run(machine, block);
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
          owner: block[0],
          ...COUNTERS,
          delayMs: 10,
          ordinal: 1,
        },
      ]);
    });
  }

  // Sabotage: dropping a <send>'s <param> children in the compiler turns this
  // red: the first send's data would lack `bif` and `belt`.
  it("scion/send-data/send1: both delayed sends carry their data and a 10 ms delay", () => {
    const machine = machineOf(SEND_DATA);
    const first = run(machine, transitionOf(machine, "a", "t"));
    const second = run(machine, transitionOf(machine, "b", "s1"), first.sends);
    expect([...first.raised, ...second.raised]).toEqual([]);
    expect([...first.effects, ...second.effects]).toMatchObject([
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

  // Sabotage: compiling a <send>'s `id` to null in the compiler turns this
  // red: the first send would take a generated id.
  it("scion/send-idlocation/test0: the author's id is kept, idlocation gets the generated one", () => {
    const machine = machineOf(SEND_IDLOCATION);
    const outcome = run(machine, onentryOf(machine, "s0"));
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
        kind: "send_delayed",
        type: SCXML_EVENT_PROCESSOR,
        delayMs: 2,
        sendId: "send_1",
        idFromAuthor: true,
        ordinal: 2,
      },
    ]);
    expect(outcome.context.data.get("httpid")).toBe("send_1");
    expect(outcome.sends).toEqual({ sendCounter: 1, timerCounter: 2, sendTypes: null });
  });
});
