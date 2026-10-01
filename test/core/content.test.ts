// Executable content: one context threaded through a block, each element,
// the first failure stopping the block as error.execution, and the
// non-fatal condition failures an <if> raises after it runs.
//
// The fixtures are the library loan: a copy on loan to a patron, its
// renewals, its holds and the loan events the chart raises about it.
//
// No test here depends on an integral float keeping its float brand through
// the binding's evaluate: every number is an integer.

import { compile, type Program, Undefined, type Value } from "@riddler/predicator";
import { describe, expect, it } from "vitest";
import {
  type ContentNode,
  type Effect,
  executeBlock,
  type Invalid,
  type RaiseSink,
} from "../../src/core/content.js";
import { INITIAL_SEND_STATE } from "../../src/core/send.js";
import {
  type ActiveStates,
  type Datamodel,
  type Expr,
  evaluationContext,
} from "../../src/datamodel.js";

const NO_STATES: ActiveStates = { indexOf: () => undefined, configuration: new Set() };

const SINK: RaiseSink = {
  owner: { kind: "onentry", stateIndex: 2, ordinal: 0 },
  counters: { macrostep: 3, microstep: 1, round: 2 },
};

function expr(source: string): Expr {
  const compiled = compile(source);
  if (!compiled.ok) throw new Error(`fixture does not compile: ${source}`);
  return { kind: "compiled", program: compiled.instructions, source };
}

function data(entries: [string, Value][]): Datamodel {
  return new Map(entries);
}

function run(block: ContentNode[], entries: [string, Value][] = []) {
  return executeBlock(evaluationContext(data(entries), NO_STATES), block, SINK);
}

/** A statement program writing `value` at `root`: the segment, the value, one store. */
function storeAt(root: string, value: Value): Program {
  return [
    ["lit", root],
    ["lit", value],
    ["store", 1],
  ] as unknown as Program;
}

/** A `<log>` effect's value; every effect these tests read is a log. */
function loggedValue(effect: Effect): Value {
  if (effect.kind !== "log") throw new Error(`expected a log effect, got ${effect.kind}`);
  return effect.value;
}

function log(cIndex: number, source: string): ContentNode {
  return { kind: "log", cIndex, label: null, expr: expr(source) };
}

function raise(cIndex: number, event: string): ContentNode {
  return { kind: "raise", cIndex, event };
}

function assign(cIndex: number, location: string, source: string): ContentNode {
  return { kind: "assign", cIndex, location, value: expr(source) };
}

describe("<raise>", () => {
  // Sabotage: stamping the raised event's type "platform" in executeRaise
  // turns this red.
  it("raises the event as written onto the internal queue, stamped with its node and block", () => {
    const outcome = run([raise(4, "loan.renewed")]);
    expect(outcome.raised).toEqual([
      {
        name: "loan.renewed",
        type: "internal",
        data: Undefined,
        cause: {
          origin: { kind: "content", cIndex: 4, owner: SINK.owner },
          macrostep: 3,
          microstep: 1,
          round: 2,
        },
      },
    ]);
    expect(outcome.effects).toEqual([]);
  });
});

describe("<log>", () => {
  // Sabotage: logging null in place of the evaluated expr in executeLog
  // turns the first expectation red.
  it("logs its label and its evaluated expr as an effect", () => {
    const outcome = run(
      [
        { kind: "log", cIndex: 0, label: "renewals", expr: expr("renewals + 1") },
        { kind: "log", cIndex: 1, label: "due", expr: null },
      ],
      [["renewals", 1]],
    );
    expect(outcome.effects).toEqual([
      { kind: "log", label: "renewals", value: 2, cIndex: 0, owner: SINK.owner, ...SINK.counters },
      { kind: "log", label: "due", value: null, cIndex: 1, owner: SINK.owner, ...SINK.counters },
    ]);
    expect(outcome.raised).toEqual([]);
  });
});

describe("<assign>", () => {
  // Sabotage: dropping the context rebind in executeAssign (so the write is
  // never threaded) turns both expectations red.
  it("writes a bound root, and the rest of the block reads the write", () => {
    const outcome = run(
      [assign(0, "renewals", "renewals + 1"), log(1, "renewals")],
      [["renewals", 1]],
    );
    expect(outcome.effects.map(loggedValue)).toEqual([2]);
    expect(outcome.context.data.get("renewals")).toBe(2);
  });

  // Sabotage: removing the root-existence check in executeAssign (so the
  // write declares the root) turns this red.
  it("refuses a root the datamodel does not hold, as unbound_location", () => {
    const outcome = run([assign(0, "fines", "1")], [["renewals", 1]]);
    expect(outcome.context.data.has("fines")).toBe(false);
    expect(outcome.raised).toMatchObject([
      {
        name: "error.execution",
        type: "platform",
        data: { kind: "unbound_location", location: "fines" },
        reason: { kind: "unbound_location", location: "fines" },
        cause: { origin: { kind: "content", cIndex: 0, owner: SINK.owner } },
      },
    ]);
  });

  // Sabotage: removing the system-variable check in executeAssign turns
  // this red (the bound _event would be overwritten).
  it("refuses a root beginning with an underscore, bound or not", () => {
    const bound = run([assign(0, "_event", '"forged"')], [["_event", Undefined]]);
    expect(bound.context.data.get("_event")).toBe(Undefined);
    expect(bound.raised).toMatchObject([
      { name: "error.execution", reason: { kind: "system_variable", root: "_event" } },
    ]);
    const unbound = run([assign(0, "_x", "1")]);
    expect(unbound.raised).toMatchObject([{ reason: { kind: "system_variable", root: "_x" } }]);
  });

  // Sabotage: treating every location as bare in executeAssign (writing the
  // whole root) turns the first expectation red.
  it("refuses a location beyond a bare root, after the root checks", () => {
    const patron = { name: "Ada", holds: ["c-1"] };
    const nested = run([assign(0, "patron.name", '"Grace"')], [["patron", patron]]);
    expect(nested.context.data.get("patron")).toBe(patron);
    expect(nested.raised).toMatchObject([
      { reason: { kind: "unsupported_location", location: "patron.name" } },
    ]);
    const unbound = run([assign(0, "branch.name", '"north"')]);
    expect(unbound.raised).toMatchObject([
      { reason: { kind: "unbound_location", location: "branch.name" } },
    ]);
    const malformed = run([assign(0, "[0]", "1")], [["patron", patron]]);
    expect(malformed.raised).toMatchObject([
      { reason: { kind: "unsupported_location", location: "[0]" } },
    ]);
  });

  // Sabotage: skipping the value's evaluation failure in executeAssign
  // (writing undefined instead) turns this red.
  it("fails with the evaluator's error when its value does not evaluate", () => {
    const outcome = run([assign(0, "renewals", "renewals + missing")], [["renewals", 1]]);
    expect(outcome.context.data.get("renewals")).toBe(1);
    expect(outcome.raised).toMatchObject([
      {
        reason: {
          kind: "evaluator_error",
          source: "renewals + missing",
          error: { type: "UndefinedVariableError" },
        },
      },
    ]);
  });
});

describe("<if>", () => {
  const ladder = (renewals: Value) =>
    run(
      [
        {
          kind: "if",
          cIndex: 0,
          branches: [
            { cond: expr("renewals > 2"), content: [raise(1, "loan.blocked")] },
            { cond: expr("renewals > 0"), content: [raise(2, "loan.renewed")] },
            { cond: null, content: [raise(3, "loan.started")] },
          ],
        },
      ],
      [["renewals", renewals]],
    );

  // Sabotage: continuing to the next branch after a true condition (not
  // returning) in executeIf turns the first expectation red.
  it("runs the first branch whose condition is true, and the else when none is", () => {
    expect(ladder(3).raised.map((event) => event.name)).toEqual(["loan.blocked"]);
    expect(ladder(1).raised.map((event) => event.name)).toEqual(["loan.renewed"]);
    expect(ladder(0).raised.map((event) => event.name)).toEqual(["loan.started"]);
  });

  // Sabotage: returning a failed condition as the <if>'s failure in
  // executeIf (stopping the block) turns this red.
  it("treats a failing condition as false and raises it after the <if>, the block going on", () => {
    const outcome = run(
      [
        {
          kind: "if",
          cIndex: 0,
          branches: [
            { cond: expr("holds > 0"), content: [raise(1, "loan.held")] },
            { cond: null, content: [raise(2, "loan.renewed")] },
          ],
        },
        raise(3, "loan.returned"),
      ],
      [["renewals", 1]],
    );
    expect(outcome.raised.map((event) => event.name)).toEqual([
      "loan.renewed",
      "error.execution",
      "loan.returned",
    ]);
    expect(outcome.raised[1]).toMatchObject({
      reason: { kind: "evaluator_error", source: "holds > 0" },
      cause: { origin: { kind: "content", cIndex: 0 } },
    });
  });

  // Sabotage: treating a non-boolean condition as false without recording
  // it in executeIf turns this red.
  it("treats a non-boolean condition as false and raises non_boolean_cond", () => {
    const outcome = run(
      [{ kind: "if", cIndex: 0, branches: [{ cond: expr("renewals"), content: [] }] }],
      [["renewals", 1]],
    );
    expect(outcome.raised).toMatchObject([
      { name: "error.execution", reason: { kind: "non_boolean_cond", value: 1 } },
    ]);
  });

  // Sabotage: answering the inner failure unwrapped in executeNested turns
  // this red.
  it("that fails inside its branch stops the block, naming the inner node", () => {
    const outcome = run([
      {
        kind: "if",
        cIndex: 0,
        branches: [{ cond: null, content: [raise(1, "loan.renewed"), assign(2, "fines", "1")] }],
      },
      raise(3, "loan.returned"),
    ]);
    expect(outcome.raised.map((event) => event.name)).toEqual(["loan.renewed", "error.execution"]);
    expect(outcome.raised[1]).toMatchObject({
      reason: {
        kind: "nested_content",
        cIndex: 2,
        reason: { kind: "unbound_location", location: "fines" },
      },
      data: { kind: "nested_content", c_index: 2, reason: { kind: "unbound_location" } },
      cause: { origin: { kind: "content", cIndex: 0 } },
    });
  });

  // Sabotage: raising the block's failure before draining the pending
  // condition failures in executeBlock turns this red.
  it("whose taken branch fails raises its condition failures before the branch's failure", () => {
    const outcome = run(
      [
        {
          kind: "if",
          cIndex: 0,
          branches: [
            { cond: expr("holds > 0"), content: [raise(1, "loan.held")] },
            { cond: expr("renewals"), content: [raise(2, "loan.blocked")] },
            { cond: null, content: [raise(3, "loan.renewed"), assign(4, "fines", "1")] },
          ],
        },
        raise(5, "loan.returned"),
      ],
      [["renewals", 1]],
    );
    expect(outcome.raised.map((event) => event.name)).toEqual([
      "loan.renewed",
      "error.execution",
      "error.execution",
      "error.execution",
    ]);
    expect(outcome.raised.slice(1)).toMatchObject([
      { reason: { kind: "evaluator_error", source: "holds > 0" } },
      { reason: { kind: "non_boolean_cond", value: 1 } },
      { reason: { kind: "nested_content", cIndex: 4, reason: { kind: "unbound_location" } } },
    ]);
  });
});

describe("<foreach>", () => {
  const overHolds = (content: ContentNode[], index: string | null = "position"): ContentNode => ({
    kind: "foreach",
    cIndex: 0,
    array: expr("holds"),
    item: "hold",
    index,
    content,
  });

  // Sabotage: binding the index as i + 1 in executeForeach turns the log
  // expectation red.
  it("binds item and index on each iteration, and the names stay declared after it", () => {
    const outcome = run([overHolds([log(1, "[hold, position]")])], [["holds", ["c-1", "c-2"]]]);
    expect(outcome.effects.map(loggedValue)).toEqual([
      ["c-1", 0],
      ["c-2", 1],
    ]);
    expect(outcome.context.data.get("hold")).toBe("c-2");
    expect(outcome.context.data.get("position")).toBe(1);
  });

  // Sabotage: skipping the declaration in executeForeach turns this red
  // (an empty array leaves the item undeclared).
  it("declares item and index as unbound before any iteration", () => {
    const outcome = run([overHolds([])], [["holds", []]]);
    expect(outcome.context.data.get("hold")).toBe(Undefined);
    expect(outcome.context.data.get("position")).toBe(Undefined);
  });

  // Sabotage: declaring item and index as unbound whether or not they are
  // bound (dropping the has check in declare) turns this red.
  it("keeps the value an item or index is already bound to when the list is empty", () => {
    const outcome = run(
      [overHolds([])],
      [
        ["holds", []],
        ["hold", "c-9"],
        ["position", 4],
      ],
    );
    expect(outcome.context.data.get("hold")).toBe("c-9");
    expect(outcome.context.data.get("position")).toBe(4);
  });

  // Sabotage: removing the list check in executeForeach (so a non-list
  // runs no iterations and succeeds) turns this red.
  it("over a value that is not a list raises not_iterable and stops the block", () => {
    const outcome = run([overHolds([]), raise(1, "loan.returned")], [["holds", 2]]);
    expect(outcome.raised).toMatchObject([
      { name: "error.execution", reason: { kind: "not_iterable", value: 2 } },
    ]);
    expect(outcome.context.data.has("hold")).toBe(false);
  });

  // Sabotage: re-reading the array from the context on each iteration in
  // executeForeach turns this red (the body shrinks the list it iterates).
  it("iterates the list as it stood when the loop began", () => {
    const outcome = run(
      [overHolds([assign(1, "holds", "[]"), log(2, "hold")], null)],
      [["holds", ["c-1", "c-2"]]],
    );
    expect(outcome.effects.map(loggedValue)).toEqual(["c-1", "c-2"]);
  });

  // Sabotage: discarding the context on a body failure in executeForeach
  // turns the renewals expectation red.
  it("that fails in its body keeps what earlier iterations wrote", () => {
    const failing = run(
      [
        {
          kind: "foreach",
          cIndex: 0,
          array: expr("holds"),
          item: "hold",
          index: null,
          content: [assign(1, "renewals", "renewals + hold")],
        },
      ],
      [
        ["holds", [1, true]],
        ["renewals", 0],
      ],
    );
    expect(failing.context.data.get("renewals")).toBe(1);
    expect(failing.raised).toMatchObject([
      { reason: { kind: "nested_content", cIndex: 1, reason: { kind: "evaluator_error" } } },
    ]);
  });

  // Sabotage: dropping the name check in executeForeach turns this red.
  it("refuses an item or index that is not a bare name, and a system name", () => {
    const item = run([{ ...overHolds([]), item: "hold.id" } as ContentNode], [["holds", []]]);
    expect(item.raised).toMatchObject([{ reason: { kind: "illegal_item_name", name: "hold.id" } }]);
    const index = run([overHolds([], "1st")], [["holds", []]]);
    expect(index.raised).toMatchObject([{ reason: { kind: "illegal_index_name", name: "1st" } }]);
    const system = run([{ ...overHolds([]), item: "_event" } as ContentNode], [["holds", []]]);
    expect(system.raised).toMatchObject([{ reason: { kind: "system_variable", root: "_event" } }]);
  });
});

describe("<script>", () => {
  // Sabotage: dropping the context rebind in executeScript turns this red.
  it("runs its compiled program, and the rest of the block reads its writes", () => {
    const outcome = run(
      [
        {
          kind: "script",
          cIndex: 0,
          program: { program: storeAt("renewals", 2), source: "renewals = 2" },
        },
        log(1, "renewals"),
      ],
      [["renewals", 0]],
    );
    expect(outcome.effects.map(loggedValue)).toEqual([2]);
    expect(outcome.raised).toEqual([]);
  });

  // Sabotage: rebinding the context only on success in executeScript turns
  // the renewals expectation red.
  it("that fails keeps its earlier writes and stops the block", () => {
    const program = [
      ...storeAt("renewals", 1),
      ["load", "fines"],
      ["lit", "holds"],
      ["lit", 1],
      ["store", 1],
    ] as unknown as Program;
    const outcome = run(
      [
        { kind: "script", cIndex: 0, program: { program, source: "renewals = 1; fines" } },
        raise(1, "loan.renewed"),
      ],
      [["renewals", 0]],
    );
    expect(outcome.context.data.get("renewals")).toBe(1);
    expect(outcome.raised).toMatchObject([
      {
        name: "error.execution",
        reason: { kind: "evaluator_error", source: "renewals = 1; fines" },
      },
    ]);
  });

  // Sabotage: running nothing and answering success for an invalid program
  // in executeScript turns this red.
  it("whose program never compiled raises the compiler's failure", () => {
    const invalid: Invalid = { kind: "invalid", source: "var x = 1;", message: "unexpected token" };
    const outcome = run([{ kind: "script", cIndex: 0, program: invalid }]);
    expect(outcome.raised).toMatchObject([
      {
        name: "error.execution",
        reason: { kind: "compile_error", source: "var x = 1;", message: "unexpected token" },
        cause: { origin: { kind: "content", cIndex: 0, owner: SINK.owner } },
      },
    ]);
  });
});

describe("a block", () => {
  // Sabotage: continuing past a failed node in executeBlock (no break)
  // turns this red.
  it("stops at the first error, keeping what ran before it, and raises error.execution for it", () => {
    const outcome = run(
      [
        raise(0, "loan.renewed"),
        assign(1, "renewals", "renewals + 1"),
        log(2, "renewals"),
        assign(3, "fines", "1"),
        raise(4, "loan.returned"),
        log(5, "renewals"),
      ],
      [["renewals", 1]],
    );
    expect(outcome.raised.map((event) => event.name)).toEqual(["loan.renewed", "error.execution"]);
    expect(outcome.raised[1]).toMatchObject({
      type: "platform",
      cause: { origin: { kind: "content", cIndex: 3, owner: SINK.owner }, ...SINK.counters },
    });
    expect(outcome.effects.map((effect) => effect.cIndex)).toEqual([2]);
    expect(outcome.context.data.get("renewals")).toBe(2);
  });

  // Sabotage: raising an invalid expression's failure without its source
  // (dropping `source` in compileError) turns this red.
  it("answers an expression that never compiled as compile_error when its node runs", () => {
    const bad: Invalid = { kind: "invalid", source: "renewals +", message: "unexpected end" };
    const outcome = run([{ kind: "log", cIndex: 0, label: null, expr: bad }]);
    expect(outcome.raised).toMatchObject([
      {
        reason: { kind: "compile_error", source: "renewals +", message: "unexpected end" },
        data: { kind: "compile_error", source: "renewals +", message: "unexpected end" },
      },
    ]);
  });

  // No sabotage: an empty block has no code path of its own to break.
  it("that is empty answers the context it was given and nothing else", () => {
    const context = evaluationContext(data([["renewals", 1]]), NO_STATES);
    expect(executeBlock(context, [], SINK)).toEqual({
      context,
      effects: [],
      raised: [],
      sends: INITIAL_SEND_STATE,
    });
  });
});
