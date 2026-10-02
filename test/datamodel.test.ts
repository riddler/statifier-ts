// The predicator binding: In() over the configuration, the unbound policy,
// a failing condition as error.execution, the system variables and the
// roots a write may not reach.
//
// The fixtures are the library loan: a copy that is available, on loan or
// on hold, a patron who borrows it, and the loan events between them.

import {
  compile,
  compileProgram,
  Duration,
  EvaluationError,
  float,
  isFloat,
  isInteger,
  PDateTime,
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
  writeLocation,
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

/** A statement program compiled from source, with the source it came from. */
function program(source: string): { program: Program; source: string } {
  const compiled = compileProgram(source);
  if (!compiled.ok) throw new Error(`fixture does not compile: ${source}`);
  return { program: compiled.instructions, source };
}

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

describe("an evaluated value", () => {
  // The reference hands back predicator's value untouched
  // (lib/statifier/evaluator.ex, evaluate/2, at statifier-ex v2.9.0), so an
  // integral float stays a float.

  // Sabotage: answering `domainValue(toHost(decoded))` (the plain projection
  // over the decoded value) in evaluate turns this red.
  it("keeps an integral float a float", () => {
    const value = evaluated("2.0", new Map());
    expect(isFloat(value)).toBe(true);
    expect(value).toEqual(float(2));
  });

  // Sabotage: decoding only the top level and projecting the members (a
  // `map(domainValue)` over a decoded list) turns this red.
  it("keeps a float nested in a list or a map a float", () => {
    const value = evaluated("[1.0, {fine: 2.0, renewals: 2}]", new Map());
    expect(value).toEqual([float(1), { fine: float(2), renewals: 2 }]);
    const [first, second] = value as Value[];
    expect(isFloat(first)).toBe(true);
    expect(isFloat((second as { fine: Value }).fine)).toBe(true);
    expect(isInteger((second as { renewals: Value }).renewals)).toBe(true);
  });

  // Sabotage: answering `domainValue(toHost(...))` for a root the datamodel
  // holds turns this red.
  it("keeps a float the datamodel holds a float when an expression reads it", () => {
    const data = new Map<string, Value>([["patron", { fine: float(3), holds: [float(0.5)] }]]);
    expect(isFloat(evaluated("patron.fine", data))).toBe(true);
    expect(evaluated("patron", data)).toEqual({ fine: float(3), holds: [float(0.5)] });
  });

  // Sabotage: answering every number as a float in decodedValue turns this
  // red.
  it("keeps an integer an integer", () => {
    const value = evaluated("2", new Map());
    expect(value).toBe(2);
    expect(isInteger(value)).toBe(true);
  });

  // Sabotage: answering the encoding refusal as the evaluation's failure
  // (dropping the plain-projection fallback in evaluate) turns this red.
  it("answers a result the tagged encoding refuses through the plain projection", () => {
    const data = new Map<string, Value>([["slip", { $type: "loan_slip", copy: "c-1" }]]);
    const outcome = evaluate(contextOf(data), expr("slip"));
    expect(outcome).toEqual({ ok: true, value: { $type: "loan_slip", copy: "c-1" } });
  });

  // Sabotage: answering a failed tagged evaluation as a success (`{ ok: true,
  // value: Undefined }` in place of the failure arm) in evaluate turns this
  // red.
  it("still answers an evaluation failure as error.execution's reason", () => {
    const outcome = evaluate(contextOf(new Map()), expr("1 + true"));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toMatchObject({
      kind: "evaluator_error",
      source: "1 + true",
      error: { type: "TypeMismatchError" },
    });
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

  // Sabotage: leaving the registered types out of _ioprocessors (the map
  // built from the SCXML entry alone) turns the first expectation red.
  it("binds _ioprocessors to an entry per registered send type beside the SCXML entry", () => {
    const registered = systemVariables("session-1", "parcel", new Set(["courier", "drone"]));
    expect(registered.get("_ioprocessors")).toEqual({
      courier: {},
      drone: {},
      [SCXML_EVENT_PROCESSOR]: { location: "#_scxml_session-1" },
    });
    expect(evaluated('_ioprocessors["unregistered"]', registered)).toBe(Undefined);
    expect(systemVariables("session-1", "parcel", null).get("_ioprocessors")).toEqual(
      data.get("_ioprocessors"),
    );
  });

  // Sabotage: writing the registered entries over the SCXML entry rather
  // than under it turns this red.
  it("keeps the SCXML entry under its URI when a registered type names it", () => {
    const named = systemVariables("session-1", "parcel", new Set([SCXML_EVENT_PROCESSOR]));
    expect(named.get("_ioprocessors")).toEqual({
      [SCXML_EVENT_PROCESSOR]: { location: "#_scxml_session-1" },
    });
  });

  // Sabotage: assigning each entry onto a plain object (`entries[type] = {}`)
  // sets the prototype for this type rather than an own key and turns this red.
  it("lists a registered type spelled like an object's prototype key as its own entry", () => {
    const listed = systemVariables("session-1", "parcel", new Set(["__proto__"])).get(
      "_ioprocessors",
    ) as Record<string, Value>;
    expect(Object.keys(listed)).toEqual(["__proto__", SCXML_EVENT_PROCESSOR]);
    expect(Object.getPrototypeOf(listed)).toBe(Object.prototype);
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
      due: Undefined,
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

  // The reference merges the values the program bound and diffs them strictly
  // (lib/statifier/evaluator.ex, run_program/2 and partition_changed_roots/2,
  // at statifier-ex v2.9.0), so a float a program writes stays a float.

  // Sabotage: reading the halt context through the plain projection again
  // (`executeProgram` and `domainContext` in place of the tagged run in
  // haltOf) turns this red.
  it("that writes a float root merges a float", () => {
    const outcome = runProgram(
      contextOf(new Map<string, Value>([["fine", 0]])),
      program("fine = 2.0"),
    );
    expect(outcome.ok).toBe(true);
    expect(isFloat(outcome.data.get("fine"))).toBe(true);
    expect(outcome.data.get("fine")).toEqual(float(2));
  });

  // Sabotage: projecting each changed root and normalizing it back
  // (`domainValue(toHost(value))` in partitionChangedRoots) turns this red.
  it("keeps the brand of a float nested beside a member it changed", () => {
    const patron: Value = { name: "Ada", fine: float(3), holds: [float(0.5)], loans: 0 };
    const outcome = runProgram(
      contextOf(new Map<string, Value>([["patron", patron]])),
      program("patron.loans = 1"),
    );
    expect(outcome.ok).toBe(true);
    const merged = outcome.data.get("patron") as { [key: string]: Value };
    expect(merged.loans).toBe(1);
    expect(isFloat(merged.fine)).toBe(true);
    expect(isFloat((merged.holds as Value[])[0])).toBe(true);
    expect(merged).toEqual({ name: "Ada", fine: float(3), holds: [float(0.5)], loans: 1 });
  });

  // Sabotage: comparing a float by its number alone in sameValue (dropping
  // the brand test, so 2.0 and 2 are the same value) turns this red.
  it("sees a root rewritten from a float to the integer of the same magnitude as changed", () => {
    const toInteger = runProgram(
      contextOf(new Map<string, Value>([["fine", float(2)]])),
      program("fine = 2"),
    );
    expect(toInteger.ok).toBe(true);
    expect(toInteger.data.get("fine")).toBe(2);
    expect(isInteger(toInteger.data.get("fine"))).toBe(true);

    const toFloat = runProgram(
      contextOf(new Map<string, Value>([["fine", 2]])),
      program("fine = 2.0"),
    );
    expect(isFloat(toFloat.data.get("fine"))).toBe(true);
  });

  // The sign of zero is this package's rule, not a claim about the
  // reference's: the reference diffs with `!==` (partition_changed_roots/2
  // at statifier-ex v2.10.0), and what that answers for 0.0 and -0.0 is not
  // read here. The tagged encoding carries the sign, so a float root
  // rewritten to the zero of the other sign is a change and merges.
  // Sabotage: comparing two floats by `===` in sameValue (so 0.0 and -0.0
  // are the same value) turns both sign expectations red.
  it("sees a float root rewritten to the zero of the other sign as changed", () => {
    const toNegative = runProgram(
      contextOf(new Map<string, Value>([["fine", float(0)]])),
      program("fine = -0.0"),
    );
    expect(toNegative.ok).toBe(true);
    const negative = toNegative.data.get("fine");
    expect(isFloat(negative)).toBe(true);
    expect(Object.is(negative?.valueOf(), -0)).toBe(true);

    const toPositive = runProgram(
      contextOf(new Map<string, Value>([["fine", float(-0)]])),
      program("fine = 0.0"),
    );
    expect(toPositive.ok).toBe(true);
    const positive = toPositive.data.get("fine");
    expect(isFloat(positive)).toBe(true);
    expect(Object.is(positive?.valueOf(), 0)).toBe(true);

    // A control, not covered by the sabotage above: a -0.0 root the
    // program leaves alone is handed back as the value it held.
    const unchanged = new Map<string, Value>([
      ["fine", float(-0)],
      ["loans", 0],
    ]);
    const untouched = runProgram(contextOf(unchanged), program("loans = 1"));
    expect(untouched.data.get("fine")).toBe(unchanged.get("fine"));
  });

  // Sabotage: dropping the failing arm's context (merging nothing when the
  // run failed) in haltOf turns the `fine` expectation red.
  it("that fails merges a float written before the failing statement as a float", () => {
    const outcome = runProgram(
      contextOf(new Map<string, Value>([["fine", 0]])),
      program("fine = 2.5 - 0.5; renewals"),
    );
    expect(outcome).toMatchObject({
      ok: false,
      reason: { kind: "evaluator_error", error: { type: "UndefinedVariableError" } },
    });
    expect(isFloat(outcome.data.get("fine"))).toBe(true);
    expect(outcome.data.get("fine")).toEqual(float(2));
  });

  // Sabotage: answering any object that is not an array or a plain map as a
  // change in sameValue turns this red: the seeded `_event` would read as a
  // system root the program changed.
  it("leaves an unchanged root holding floats and temporal values as it was", () => {
    const event: Value = {
      name: "copy.returned",
      data: {
        fine: float(1),
        at: new PDateTime(1_790_000_000, 0),
        grace: new Duration({ days: 2 }),
      },
    };
    const seeded = new Map<string, Value>([
      ["_event", event],
      ["fines", [float(1.5), float(2)]],
      ["loans", 0],
    ]);
    const outcome = runProgram(contextOf(seeded), program("loans = 1"));
    expect(outcome).toEqual({ ok: true, data: new Map([...seeded, ["loans", 1]]) });
    expect(outcome.data.get("_event")).toBe(event);
    expect(outcome.data.get("fines")).toBe(seeded.get("fines"));
  });

  // Sabotage: answering two instances of one class as the same value once
  // their prototypes match (skipping the parts in sameValue) turns the
  // `due` and `grace` expectations red; answering a list and a map with the
  // same member count as the same value turns the `holds` and `branches`
  // ones red.
  it("sees a changed temporal value, and a list swapped for a map, as changed", () => {
    const seeded = new Map<string, Value>([
      ["due", new PDateTime(1_790_000_000, 0)],
      ["grace", new Duration({ days: 2 })],
      ["holds", []],
      ["branches", {}],
      ["renewed", new PDateTime(1_790_086_400, 0)],
      ["extended", new Duration({ days: 3 })],
    ]);
    const outcome = runProgram(
      contextOf(seeded),
      program("due = renewed; grace = extended; holds = {}; branches = []"),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.data.get("due")).toEqual(new PDateTime(1_790_086_400, 0));
    expect(outcome.data.get("grace")).toEqual(new Duration({ days: 3 }));
    expect(outcome.data.get("holds")).toEqual({});
    expect(outcome.data.get("branches")).toEqual([]);
  });

  // Sabotage: answering the encoding refusal as the run's failure (dropping
  // the plain fallback in haltOf) turns this red.
  it("runs against a datamodel the tagged encoding refuses through the plain projection", () => {
    const seeded = new Map<string, Value>([
      ["slip", { $type: "loan_slip", copy: "c-1" }],
      ["loans", 0],
    ]);
    const outcome = runProgram(contextOf(seeded), program("loans = 1"));
    expect(outcome.ok).toBe(true);
    expect(outcome.data.get("loans")).toBe(1);
    expect(outcome.data.get("slip")).toBe(seeded.get("slip"));
  });

  // Sabotage: normalizing every root of the plain fallback's context
  // (`domainValue(value)` alone in domainContext) turns this red: the seeded
  // `_event`'s float projects to an integer and reads as a system root the
  // program changed.
  it("leaves a float the fallback run did not touch as it was", () => {
    const event: Value = { name: "copy.returned", data: { fine: float(1) } };
    const seeded = new Map<string, Value>([
      ["slip", { $type: "loan_slip", copy: "c-1" }],
      ["_event", event],
      ["fine", float(2)],
      ["loans", 0],
    ]);
    const outcome = runProgram(contextOf(seeded), program("loans = 1"));
    expect(outcome).toEqual({ ok: true, data: new Map([...seeded, ["loans", 1]]) });
    expect(outcome.data.get("_event")).toBe(event);
    expect(isFloat(outcome.data.get("fine"))).toBe(true);
  });

  // A known limitation, pinned so that lifting it is seen: the plain
  // fallback reads the halt context through the plain projection, which
  // drops a float's brand, so a float the program writes there merges as
  // the integer of the same magnitude; and the fallback runs the program a
  // second time, so a host function it calls is called twice.
  // Sabotage: answering a number in the fallback's changed roots as a float
  // (`float(value)` for a number in domainContext) turns the integer
  // expectations red; skipping the tagged run when a root holds the
  // encoding's reserved key (so the program runs once) turns the call
  // count red.
  it("merges a float written on the plain fallback as an integer, running the program twice", () => {
    let calls = 0;
    const states: ActiveStates = {
      indexOf: (id) => {
        calls += 1;
        return STATE_IDS.indexOf(id);
      },
      configuration: new Set([STATE_IDS.indexOf("on_loan")]),
    };
    const seeded = new Map<string, Value>([
      ["slip", { $type: "loan_slip", copy: "c-1" }],
      ["fine", 0],
      ["lent", false],
    ]);
    const outcome = runProgram(
      evaluationContext(seeded, states),
      program('fine = 2.0; lent = In("on_loan")'),
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.data.get("lent")).toBe(true);
    expect(outcome.data.get("fine")).toBe(2);
    expect(isInteger(outcome.data.get("fine"))).toBe(true);
    expect(isFloat(outcome.data.get("fine"))).toBe(false);
    expect(calls).toBe(2);
  });

  // Sabotage: starting the plain fallback's failing arm from {} (dropping
  // the context the run got to) in haltOf turns the `loans` expectation red.
  it("that fails against a datamodel the tagged encoding refuses keeps its earlier writes", () => {
    const fines: Value = [float(1.5), float(2)];
    const seeded = new Map<string, Value>([
      ["slip", { $type: "loan_slip", copy: "c-1" }],
      ["fines", fines],
      ["loans", 0],
    ]);
    const outcome = runProgram(contextOf(seeded), program("loans = 1; renewals"));
    expect(outcome).toMatchObject({
      ok: false,
      reason: { kind: "evaluator_error", error: { type: "UndefinedVariableError" } },
    });
    expect(outcome.data.get("loans")).toBe(1);
    expect(outcome.data.get("fines")).toBe(fines);
  });

  // Sabotage: reading the root out of the message again turns the first
  // expectation red (the message names another root) and the second (it
  // carries no details); answering details.root without checking the reason
  // turns the last one red.
  it("reads the refused root from the details of predicator's protected-root refusal", () => {
    const refusal = new EvaluationError("protected_root", "_name is a protected root", undefined, {
      root: "_event",
    });
    expect(refusedRoot(refusal)).toBe("_event");
    expect(
      refusedRoot(new EvaluationError("protected_root", "_event is a protected root")),
    ).toBeUndefined();
    expect(
      refusedRoot(
        new EvaluationError("not_assignable", "not assignable", undefined, { root: "_event" }),
      ),
    ).toBeUndefined();
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

describe("a write to a location", () => {
  // The datamodel every row writes into: a patron with a name and holds, two
  // lists of copies, an empty list of loans, the bracket keys `i` and `k`, a
  // float `f`, a hold declared with no value, a copy bound to null, and three
  // roots spelled like words of the expression language.
  const DATAMODEL: Datamodel = new Map<string, Value>([
    ["patron", { name: "Ada", holds: ["c-1"] }],
    ["holds", ["c-1", "c-2"]],
    ["one", ["c-1"]],
    ["loans", []],
    ["i", 1],
    ["k", "name"],
    ["f", float(1)],
    ["hold", Undefined],
    ["copy", null],
    ["renewals", 1],
    ["next", 1],
    ["true", 1],
    ["today", 1],
    ["_event", Undefined],
  ]);

  type Landed = { path: (string | number)[]; prior: Value; root: Value };
  type Refused = { kind: string; type?: string; reason?: string };

  // Each row is the reference's answer to `write_location/4` at statifier-ex
  // v2.10.0, run over the same datamodel with the value "W": the resolved
  // path, the value read at it before the write and the root after it, or the
  // refusal. The reference's integer key against a map writes the integer
  // there; here it writes the key its decimal spelling names, as predicator
  // declares, and the value read before the write is the absence on both.
  const ROWS: [string, Landed | Refused][] = [
    ["patron", { path: ["patron"], prior: { name: "Ada", holds: ["c-1"] }, root: "W" }],
    [
      "patron.name",
      { path: ["patron", "name"], prior: "Ada", root: { name: "W", holds: ["c-1"] } },
    ],
    [
      "patron.address.city",
      {
        path: ["patron", "address", "city"],
        prior: Undefined,
        root: { name: "Ada", holds: ["c-1"], address: { city: "W" } },
      },
    ],
    [
      'patron["name"]',
      { path: ["patron", "name"], prior: "Ada", root: { name: "W", holds: ["c-1"] } },
    ],
    ["patron[k]", { path: ["patron", "name"], prior: "Ada", root: { name: "W", holds: ["c-1"] } }],
    ["holds[0]", { path: ["holds", 0], prior: "c-1", root: ["W", "c-2"] }],
    ["one[2]", { path: ["one", 2], prior: Undefined, root: ["c-1", Undefined, "W"] }],
    ["holds[i]", { path: ["holds", 1], prior: "c-2", root: ["c-1", "W"] }],
    ["holds[j]", { kind: "evaluator_error", type: "LocationError", reason: "undefined_variable" }],
    ["holds[-1]", { kind: "evaluator_error", type: "LocationError", reason: "invalid_index" }],
    ["holds.first", { kind: "evaluator_error", type: "LocationError", reason: "not_a_container" }],
    [
      "patron.name.first",
      { kind: "evaluator_error", type: "LocationError", reason: "not_a_container" },
    ],
    ["loans[0].due", { path: ["loans", 0, "due"], prior: Undefined, root: [{ due: "W" }] }],
    ["hold.branch", { path: ["hold", "branch"], prior: Undefined, root: { branch: "W" } }],
    ["copy.branch", { path: ["copy", "branch"], prior: Undefined, root: { branch: "W" } }],
    [
      "patron[0]",
      { path: ["patron", 0], prior: Undefined, root: { name: "Ada", holds: ["c-1"], 0: "W" } },
    ],
    ["[0]", { kind: "evaluator_error", type: "LocationError", reason: "not_assignable" }],
    ["patron.", { kind: "evaluator_error", type: "ParseError" }],
    ["renewals + 1", { kind: "evaluator_error", type: "LocationError", reason: "not_assignable" }],
    ["_event.name", { kind: "system_variable" }],
    ["_x.y", { kind: "system_variable" }],
    ["branch.name", { kind: "unbound_location" }],
    ["next", { kind: "evaluator_error", type: "ParseError" }],
    ["true", { kind: "evaluator_error", type: "LocationError", reason: "not_assignable" }],
    ["today", { path: ["today"], prior: 1, root: "W" }],
    ["next.x", { kind: "evaluator_error", type: "ParseError" }],
    ["true.x", { kind: "evaluator_error", type: "LocationError", reason: "not_assignable" }],
    ["nope", { kind: "unbound_location" }],
    ["nope.x", { kind: "unbound_location" }],
    ["if", { kind: "evaluator_error", type: "ParseError" }],
    ["holds[f]", { kind: "evaluator_error", type: "LocationError", reason: "invalid_key" }],
    [
      "  patron.name  ",
      { path: ["patron", "name"], prior: "Ada", root: { name: "W", holds: ["c-1"] } },
    ],
  ];

  // Sabotage: reading the prior value after the write in writeLocation
  // (`readPath(written.data, path)`) turns the patron.name and holds rows red.
  it.each(ROWS)("writes %j as the reference does", (source, expected) => {
    const outcome = writeLocation(evaluationContext(DATAMODEL, activeStates()), source, "W");
    if ("path" in expected) {
      expect(outcome).toMatchObject({ ok: true, path: expected.path });
      if (!outcome.ok) return;
      expect(outcome.priorValue).toEqual(expected.prior);
      expect(outcome.context.data.get(expected.path[0] as string)).toEqual(expected.root);
      return;
    }
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason.kind).toBe(expected.kind);
    if (outcome.reason.kind === "evaluator_error") {
      expect(outcome.reason.source).toBe(source);
      expect(outcome.reason.error.type).toBe(expected.type);
      if (expected.reason !== undefined) expect(outcome.reason.error.reason).toBe(expected.reason);
    }
  });

  // statifier-ex v2.10.0, write_location/4 resolves before it checks the
  // root, so a root spelled as a reserved word is refused for its spelling
  // before it is found unbound; a name the language does not reserve is not.
  // Sabotage: checking the root before resolving in writeLocation turns the
  // `next`, `true` and `if` expectations red.
  it("refuses a reserved-word root for its spelling before it finds the root unbound", () => {
    const empty = evaluationContext(new Map(), activeStates());
    const refusal = (source: string) => {
      const outcome = writeLocation(empty, source, "W");
      if (outcome.ok) throw new Error(`${source} was written`);
      return outcome.reason.kind === "evaluator_error"
        ? [outcome.reason.kind, outcome.reason.error.type]
        : [outcome.reason.kind];
    };
    expect(refusal("next")).toEqual(["evaluator_error", "ParseError"]);
    expect(refusal("true")).toEqual(["evaluator_error", "LocationError"]);
    expect(refusal("if")).toEqual(["evaluator_error", "ParseError"]);
    expect(refusal("today")).toEqual(["unbound_location"]);
  });

  // Sabotage: writing the root whole for a nested path in writeLocation
  // (`bind(context, root, value)`) turns this red.
  it("leaves every other member of the root, and every other root, as it stood", () => {
    const outcome = writeLocation(
      evaluationContext(DATAMODEL, activeStates()),
      "patron.holds[1]",
      "c-7",
    );
    if (!outcome.ok) throw new Error("refused");
    expect(outcome.context.data.get("patron")).toEqual({ name: "Ada", holds: ["c-1", "c-7"] });
    expect(DATAMODEL.get("patron")).toEqual({ name: "Ada", holds: ["c-1"] });
    expect(isFloat(outcome.context.data.get("f") as Value)).toBe(true);
    expect(outcome.context.data.get("hold")).toBe(Undefined);
  });

  // A refusal's reason carries predicator's own error, and reads into
  // `_event.data` with its type and reason.
  // Sabotage: answering a resolve refusal as `unbound_location` in
  // writeLocation turns this red.
  it("reads a location refusal into _event.data with its type and reason", () => {
    const outcome = writeLocation(evaluationContext(DATAMODEL, activeStates()), "[0]", "W");
    if (outcome.ok) throw new Error("written");
    expect(reasonValue(outcome.reason)).toMatchObject({
      kind: "evaluator_error",
      source: "[0]",
      type: "LocationError",
      reason: "not_assignable",
    });
  });
});
