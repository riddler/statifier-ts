// The predicator binding: In() over the configuration, the unbound policy,
// a failing condition as error.execution, the system variables and the
// roots a write may not reach.
//
// The fixtures are the library loan: a copy that is available, on loan or
// on hold, a patron who borrows it, and the loan events between them.

import {
  compile,
  type Program,
  evaluate as predicatorEvaluate,
  Undefined,
  type Value,
} from "@riddler/predicator";
import { describe, expect, it } from "vitest";
import {
  type ActiveStates,
  acceptsDatamodel,
  bind,
  type CondOutcome,
  checkSystemVariable,
  condEnables,
  type Datamodel,
  type Event,
  type Expr,
  evaluate,
  evaluateCond,
  evaluationContext,
  eventValue,
  executionError,
  initialDatamodel,
  inState,
  isSystemRoot,
  ON_UNBOUND,
  partitionChangedRoots,
  protectedRoots,
  putEvent,
  raiseCondErrors,
  reasonValue,
  refusedRoot,
  runProgram,
  SCXML_EVENT_PROCESSOR,
  scxmlLocation,
  systemVariables,
} from "../src/datamodel.js";

/** The copy's chart: three states, indexed in document order. */
const STATE_IDS = ["available", "on_loan", "on_hold"];

function activeStates(...active: string[]): ActiveStates {
  const indexes = new Map(STATE_IDS.map((id, index) => [id, index]));
  return {
    indexOf: (id) => indexes.get(id),
    configuration: new Set(active.map((id) => indexes.get(id) as number)),
  };
}

function expr(source: string): Expr {
  const compiled = compile(source);
  if (!compiled.ok) throw new Error(`fixture does not compile: ${source}`);
  return { kind: "compiled", program: compiled.instructions, source };
}

function contextOf(data: Datamodel, ...active: string[]) {
  return evaluationContext(data, activeStates(...active));
}

function evaluated(source: string, data: Datamodel, ...active: string[]): Value {
  const outcome = evaluate(contextOf(data, ...active), expr(source));
  if (!outcome.ok) throw new Error(`fixture failed: ${source}`);
  return outcome.value;
}

const COUNTERS = { macrostep: 2, microstep: 1, round: 3 };

/** A statement program writing `value` at `root`: the segment, the value, one store. */
function storeAt(root: string, value: Value): Program {
  return [
    ["lit", root],
    ["lit", value],
    ["store", 1],
  ] as unknown as Program;
}

describe("In()", () => {
  // Sabotage: answering `configuration.has(index)` negated turns this red.
  it("is true inside the state and false outside it", () => {
    expect(evaluated('In("on_loan")', new Map(), "on_loan")).toBe(true);
    expect(evaluated('In("on_loan")', new Map(), "available")).toBe(false);
    expect(evaluated('In("available")', new Map(), "available")).toBe(true);
  });

  // Sabotage: answering `index !== undefined` alone (ignoring the
  // configuration) turns the second expectation red.
  it("reads the configuration the context was built with, not a later one", () => {
    const before = contextOf(new Map(), "available");
    const after = contextOf(new Map(), "on_loan");
    const onLoan = expr('In("on_loan")');
    expect(evaluate(before, onLoan)).toEqual({ ok: true, value: false });
    expect(evaluate(after, onLoan)).toEqual({ ok: true, value: true });
  });

  // Sabotage: returning true for an index lookup that missed turns this red.
  it("answers false for an id the chart never declared, and for a non-string id", () => {
    expect(evaluated('In("returned")', new Map(), "available", "on_loan")).toBe(false);
    expect(inState(activeStates("available"), [0])).toBe(false);
  });

  // Sabotage: dropping the argument-count check (so In() reads its first
  // argument whatever the count) turns this red.
  it("fails the evaluation when called with other than one argument", () => {
    const outcome = evaluate(contextOf(new Map(), "on_loan"), expr('In("on_loan", "available")'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatchObject({
      kind: "evaluator_error",
      source: 'In("on_loan", "available")',
      error: {
        type: "EvaluationError",
        message: "Function In() expects 1 arguments, got 2",
      },
    });
  });
});

describe("the unbound policy", () => {
  // Sabotage: setting the binding's policy to "undefined" turns this red.
  it("is the refusing policy, named rather than inherited", () => {
    expect(ON_UNBOUND).toBe("error");
    const outcome = evaluate(contextOf(new Map()), expr("patron_note || true"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatchObject({
      kind: "evaluator_error",
      error: { type: "UndefinedVariableError", reason: "unbound_variable" },
    });
  });

  // No sabotage: this pins predicator's own default, the policy the binding
  // must override, so a change to that default is seen here.
  it("differs from predicator's default, which answers the absence", () => {
    const answered = predicatorEvaluate("patron_note || true", {});
    expect(answered).toEqual({ ok: true, value: true });
  });

  // Sabotage: seeding `_event` as a missing key (not bound) in
  // systemVariables turns this red.
  it("reads a declared root with no value as undefined, not as an error", () => {
    const data = systemVariables("session-1", "library_loan");
    expect(evaluated("_event || true", data)).toBe(true);
    expect(evaluated("_event", data)).toBe(Undefined);
  });

  // Sabotage: seeding `_x` in systemVariables turns this red.
  it("refuses a platform root nothing seeds", () => {
    const data = systemVariables("session-1", "library_loan");
    expect(data.has("_x")).toBe(false);
    const outcome = evaluate(contextOf(data), expr("_x || true"));
    expect(outcome.ok).toBe(false);
  });
});

describe("a transition's condition", () => {
  // Sabotage: answering `{ ok: true, value: false }` for a failed
  // evaluation in evaluateCond turns the reason expectation red.
  it("that fails to evaluate is not taken and raises error.execution", () => {
    const context = contextOf(new Map([["copies", 2]]), "available");
    const outcome = evaluateCond(context, expr("holds_waiting > copies"));
    expect(condEnables(outcome)).toBe(false);
    expect(outcome.ok).toBe(false);

    const queue = raiseCondErrors([], [{ tIndex: 4, outcome }], COUNTERS);
    expect(queue).toHaveLength(1);
    const [raised] = queue;
    expect(raised).toMatchObject({
      name: "error.execution",
      type: "platform",
      cause: {
        origin: { kind: "transition", tIndex: 4 },
        macrostep: 2,
        microstep: 1,
        round: 3,
      },
      reason: {
        kind: "evaluator_error",
        source: "holds_waiting > copies",
        error: { type: "UndefinedVariableError" },
      },
    });
  });

  // Sabotage: returning a non-boolean value as `{ ok: true }` in evaluateCond
  // turns this red.
  it("that is not a boolean is treated as an evaluation failure", () => {
    const outcome = evaluateCond(contextOf(new Map([["copies", 2]])), expr("copies + 1"));
    expect(outcome).toEqual({ ok: false, reason: { kind: "non_boolean_cond", value: 3 } });
    expect(condEnables(outcome)).toBe(false);
  });

  // Sabotage: making condEnables answer `outcome.ok` alone turns the false
  // expectation red.
  it("enables its transition only when true, and an absent condition always does", () => {
    const context = contextOf(new Map([["copies", 2]]), "available");
    expect(condEnables(evaluateCond(context, expr("copies > 1")))).toBe(true);
    expect(condEnables(evaluateCond(context, expr("copies > 5")))).toBe(false);
    expect(condEnables(evaluateCond(context, undefined))).toBe(true);
    expect(condEnables(evaluateCond(context, { kind: "static", value: true }))).toBe(true);
  });

  // Sabotage: raising nothing for a failed condition in raiseCondErrors turns
  // this red.
  it("raises one event per failed condition, in the order the round evaluated them", () => {
    const context = contextOf(new Map([["copies", 2]]));
    const outcomes: { tIndex: number; outcome: CondOutcome }[] = [
      { tIndex: 7, outcome: evaluateCond(context, expr("copies")) },
      { tIndex: 2, outcome: evaluateCond(context, expr("copies > 1")) },
      { tIndex: 5, outcome: evaluateCond(context, expr("renewals > 0")) },
    ];
    const prior: Event = { name: "loan.renewed", type: "internal", data: Undefined };
    const queue = raiseCondErrors([prior], outcomes, COUNTERS);
    expect(queue.map((event) => event.name)).toEqual([
      "loan.renewed",
      "error.execution",
      "error.execution",
    ]);
    expect(
      queue.map((event) =>
        event.cause?.origin.kind === "transition" ? event.cause.origin.tIndex : undefined,
      ),
    ).toEqual([undefined, 7, 5]);
  });
});

describe("the system variables", () => {
  const data = systemVariables("session-1", "library_loan");

  // Sabotage: binding `_sessionid` to the chart's name turns this red.
  it("binds _sessionid to the id the host minted", () => {
    expect(evaluated('_sessionid == "session-1"', data)).toBe(true);
  });

  // Sabotage: binding `_name` to the absence whatever the name turns the
  // first expectation red.
  it("binds _name to the chart's name, or declares it unbound when there is none", () => {
    expect(evaluated('_name == "library_loan"', data)).toBe(true);
    expect(evaluated("_name", systemVariables("session-1", undefined))).toBe(Undefined);
  });

  // Sabotage: keying the entry by any other string than the processor's URI
  // turns this red.
  it("binds _ioprocessors to the SCXML processor's entry and its location", () => {
    const source = `_ioprocessors["${SCXML_EVENT_PROCESSOR}"].location`;
    expect(evaluated(source, data)).toBe("#_scxml_session-1");
    expect(scxmlLocation("session-1")).toBe("#_scxml_session-1");
  });

  // Sabotage: leaving `origin` out of eventValue turns this red.
  it("binds _event to an event's name, type, optional fields and data", () => {
    const returned: Event = {
      name: "loan.returned",
      type: "external",
      data: { copy: "c-17", branch: "north" },
      origin: "#_scxml_desk",
      origintype: SCXML_EVENT_PROCESSOR,
    };
    const withEvent = putEvent(data, returned);
    expect(evaluated('_event.name == "loan.returned"', withEvent)).toBe(true);
    expect(evaluated('_event.type == "external"', withEvent)).toBe(true);
    expect(evaluated('_event.data.copy == "c-17"', withEvent)).toBe(true);
    expect(evaluated('_event.origin == "#_scxml_desk"', withEvent)).toBe(true);
    expect(eventValue(returned)).toEqual({
      name: "loan.returned",
      type: "external",
      sendid: Undefined,
      origin: "#_scxml_desk",
      origintype: SCXML_EVENT_PROCESSOR,
      invokeid: Undefined,
      data: { copy: "c-17", branch: "north" },
    });
  });

  // Sabotage: letting the host's roots win over the system variables in
  // initialDatamodel turns this red.
  it("overwrite a host root spelled like a system variable", () => {
    const host: Datamodel = new Map<string, Value>([
      ["_sessionid", "forged"],
      ["patron", "p-3"],
    ]);
    const seeded = initialDatamodel(host, "session-1", "library_loan");
    expect(seeded.get("_sessionid")).toBe("session-1");
    expect(seeded.get("patron")).toBe("p-3");
    expect(host.get("_sessionid")).toBe("forged");
  });

  describe("are protected", () => {
    // Sabotage: replacing the prefix test with a membership test on a fixed
    // list without `_x` turns the last expectation red.
    it.each(["_sessionid", "_name", "_event", "_ioprocessors", "_x"])(
      "%s is refused by the assign-path check",
      (root) => {
        expect(isSystemRoot(root)).toBe(true);
        expect(checkSystemVariable([root, "location"])).toEqual({
          ok: false,
          reason: { kind: "system_variable", root },
        });
      },
    );

    // Sabotage: refusing every string root in checkSystemVariable (dropping
    // the prefix test) turns this red.
    it("lets an ordinary root through the assign-path check", () => {
      expect(isSystemRoot("patron")).toBe(false);
      expect(checkSystemVariable(["patron", "name"])).toEqual({ ok: true });
      expect(checkSystemVariable([0])).toEqual({ ok: true });
    });

    // Sabotage: returning [] from protectedRoots turns this red.
    it.each(["_sessionid", "_name", "_event", "_ioprocessors"])(
      "%s cannot be written by a program, which stops at the attempt",
      (root) => {
        const seeded = initialDatamodel(new Map([["loans", 0]]), "session-1", "library_loan");
        expect(protectedRoots(seeded)).toContain(root);
        const program = [
          ...storeAt("loans", 1),
          ...storeAt(root, "forged"),
          ...storeAt("fines", 5),
        ] as unknown as Program;
        const outcome = runProgram(contextOf(seeded), { program, source: `${root} = "forged"` });
        expect(outcome).toMatchObject({ ok: false, reason: { kind: "system_variable", root } });
        expect(outcome.data.get(root)).toEqual(seeded.get(root));
        expect(outcome.data.get("loans")).toBe(1);
        expect(outcome.data.has("fines")).toBe(false);
      },
    );

    // Sabotage: merging system roots along with the others in runProgram
    // turns the `_x` expectation red.
    it("a fresh system root a program creates is caught after the run and never merged", () => {
      const seeded = initialDatamodel(new Map(), "session-1", "library_loan");
      expect(protectedRoots(seeded)).not.toContain("_x");
      const program = [
        ...storeAt("_x", 1),
        ...storeAt("_b", 2),
        ...storeAt("loans", 1),
      ] as unknown as Program;
      const outcome = runProgram(contextOf(seeded), { program, source: "_x = 1" });
      expect(outcome).toMatchObject({ ok: false, reason: { kind: "system_variable", root: "_b" } });
      expect(outcome.data.has("_x")).toBe(false);
      expect(outcome.data.has("_b")).toBe(false);
      expect(outcome.data.get("loans")).toBe(1);
    });
  });
});

describe("a program", () => {
  // Sabotage: merging every root the run handed back, unchanged ones
  // included, in partitionChangedRoots turns the patron expectation red.
  it("merges the roots it changed and leaves the rest as they were", () => {
    const seeded = initialDatamodel(
      new Map<string, Value>([
        ["loans", 0],
        ["patron", { name: "Ada", holds: ["c-1"] }],
      ]),
      "session-1",
      "library_loan",
    );
    const outcome = runProgram(contextOf(seeded), {
      program: storeAt("loans", 2),
      source: "loans = 2",
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.data.get("loans")).toBe(2);
    expect(outcome.data.get("patron")).toBe(seeded.get("patron"));
  });

  // Sabotage: answering the evaluator error without the context the run got
  // to (starting from {} on failure) turns the `loans` expectation red.
  it("that fails keeps the writes made before the failing statement", () => {
    const program = [
      ...storeAt("loans", 1),
      ["load", "renewals"],
      ["lit", "fines"],
      ["lit", 1],
      ["store", 1],
    ] as unknown as Program;
    const outcome = runProgram(contextOf(new Map([["loans", 0]])), {
      program,
      source: "loans = 1; renewals",
    });
    expect(outcome).toMatchObject({
      ok: false,
      reason: {
        kind: "evaluator_error",
        source: "loans = 1; renewals",
        error: { type: "UndefinedVariableError" },
      },
    });
    expect(outcome.data.get("loans")).toBe(1);
  });

  // Sabotage: skipping equal values in partitionChangedRoots by `===` alone
  // turns the unchanged-root expectations red.
  it("compares roots by value, so an unchanged structured root is not a change", () => {
    const before: Datamodel = new Map<string, Value>([
      ["patron", { name: "Ada", holds: ["c-1", "c-2"] }],
      ["branches", ["north", "south"]],
      ["due", Undefined],
    ]);
    const unchanged = partitionChangedRoots(before, {
      patron: { name: "Ada", holds: ["c-1", "c-2"] },
      branches: ["north", "south"],
      due: undefined,
    });
    expect(unchanged.other.size).toBe(0);
    expect(unchanged.system).toEqual([]);

    const changed = partitionChangedRoots(before, {
      patron: { name: "Ada", holds: ["c-1"] },
      branches: ["north", "east"],
      due: null,
      renewals: 1,
    });
    expect([...changed.other.keys()].sort()).toEqual(["branches", "due", "patron", "renewals"]);
    expect(
      partitionChangedRoots(new Map<string, Value>([["patron", { name: "Ada" }]]), {
        patron: { name: "Ada", branch: "north" },
      }).other.size,
    ).toBe(1);
    expect(
      partitionChangedRoots(new Map<string, Value>([["patron", { name: "Ada" }]]), {
        patron: ["Ada"],
      }).other.size,
    ).toBe(1);
    expect(
      partitionChangedRoots(new Map<string, Value>([["patron", { name: "Ada", id: 1 }]]), {
        patron: { name: "Ada", branch: 1 },
      }).other.size,
    ).toBe(1);
  });

  // Sabotage: returning the message whole from refusedRoot turns the first
  // expectation red.
  it("reads the refused root out of predicator's protected-root refusal", () => {
    const refusal = {
      type: "EvaluationError" as const,
      reason: "protected_root",
      message: "_event is a protected root",
    };
    expect(refusedRoot(refusal as never)).toBe("_event");
    expect(refusedRoot({ ...refusal, message: "something else" } as never)).toBeUndefined();
    expect(refusedRoot({ ...refusal, reason: "not_assignable" } as never)).toBeUndefined();
  });
});

describe("the binding's small pieces", () => {
  // Sabotage: mutating the context's own map in bind turns the last
  // expectation red.
  it("binds a root into a copy of the context", () => {
    const context = contextOf(new Map([["loans", 0]]), "on_loan");
    const bound = bind(context, "loans", 3);
    expect(evaluate(bound, expr("loans == 3"))).toEqual({ ok: true, value: true });
    expect(evaluate(bound, expr('In("on_loan")'))).toEqual({ ok: true, value: true });
    expect(context.data.get("loans")).toBe(0);
  });

  // Sabotage: evaluating a static value as source text turns this red.
  it("hands a static value back as the document wrote it", () => {
    expect(evaluate(contextOf(new Map()), { kind: "static", value: "c-17" })).toEqual({
      ok: true,
      value: "c-17",
    });
  });

  // Sabotage: dropping the reason from the raised event turns this red.
  it("renders every failure as a value _event.data can read", () => {
    const failure = executionError({ kind: "transition", tIndex: 1 }, COUNTERS, {
      kind: "system_variable",
      root: "_event",
    });
    expect(failure.data).toEqual({ kind: "system_variable", root: "_event" });
    expect(reasonValue({ kind: "non_boolean_cond", value: 3 })).toEqual({
      kind: "non_boolean_cond",
      value: 3,
    });
    const outcome = evaluate(contextOf(new Map()), expr("fines > 0"));
    if (outcome.ok) throw new Error("fixture evaluated");
    expect(reasonValue(outcome.reason)).toEqual({
      kind: "evaluator_error",
      source: "fines > 0",
      type: "UndefinedVariableError",
      reason: "unbound_variable",
      message: "Undefined variable: fines",
    });
  });

  // Sabotage: removing "ecmascript" from the accepted spellings turns this
  // red.
  it("accepts ecmascript as a datamodel spelling and refuses a misspelling", () => {
    for (const spelling of ["predicator", "elixir", "null", "ecmascript", "xpath"]) {
      expect(acceptsDatamodel(spelling)).toBe(true);
    }
    expect(acceptsDatamodel("javascript")).toBe(false);
    expect(acceptsDatamodel("predicater")).toBe(false);
  });
});
