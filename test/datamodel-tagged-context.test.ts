// The guard on the context a program's tagged run halts with. Predicator
// writes that context as the tagged encoding of a map; anything else is a
// broken invariant in the dependency, not an outcome a chart reaches, so the
// binding throws rather than merging it. The only way to reach the guard is
// a tagged run that answers something other than a map, so this file wraps
// predicator's tagged statement run and, for one test at a time, answers a
// chosen text in its place. Every other call reaches the real run.
//
// The fixtures are the library loan: a patron's loans, a copy, a due date.

import { compileProgram, PDateTime, type Program, type Value } from "@riddler/predicator";
import { encodeTagged } from "@riddler/predicator/tagged";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluationContext, runProgram } from "../src/datamodel.js";

const forged = vi.hoisted(() => ({ answer: undefined as unknown }));

vi.mock("@riddler/predicator/tagged", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@riddler/predicator/tagged")>();
  return {
    ...actual,
    executeTagged: (...args: Parameters<typeof actual.executeTagged>) =>
      forged.answer === undefined ? actual.executeTagged(...args) : forged.answer,
  };
});

afterEach(() => {
  forged.answer = undefined;
});

function program(source: string): { program: Program; source: string } {
  const compiled = compileProgram(source);
  if (!compiled.ok) throw new Error(`fixture does not compile: ${source}`);
  return { program: compiled.instructions, source };
}

function tagged(value: Value): string {
  const encoded = encodeTagged(value);
  if (!encoded.ok) throw new Error("fixture does not encode");
  return encoded.text;
}

const NO_STATES = { indexOf: () => undefined, configuration: new Set<number>() };

function run(): ReturnType<typeof runProgram> {
  const data = new Map<string, Value>([["loans", 0]]);
  return runProgram(evaluationContext(data, NO_STATES), program("loans = 1"));
}

const GUARD = "predicator answered a tagged context that is not a map";

describe("a program's tagged halt context", () => {
  // The control: the wrapped run is the one the binding reads, so a map
  // answered in its place is what merges.
  it("merges a map the tagged run answers", () => {
    forged.answer = { ok: true, context: tagged({ loans: 3 }) };
    const outcome = run();
    expect(outcome.ok).toBe(true);
    expect(outcome.data.get("loans")).toBe(3);
  });

  // Sabotage: dropping the guard's throw in decodedContext (answering
  // whatever decoded) turns the list expectations red: the list's indexes
  // merge as roots. The plain-map test is what refuses a list, so dropping
  // it (`!isPlainMap(value)`) turns the list expectations red as well: an
  // array's prototype is not a plain map's.
  it("throws on a list, on the successful arm and on the failing arm", () => {
    forged.answer = { ok: true, context: tagged(["c-1", "c-2"]) };
    expect(run).toThrow(GUARD);
    forged.answer = {
      ok: false,
      error: { type: "UndefinedVariableError", message: "renewals is not bound" },
      context: tagged(["c-1"]),
    };
    expect(run).toThrow(GUARD);
  });

  // Sabotage: dropping the plain-map test (`!isPlainMap(value)`) in
  // decodedContext turns the date expectation red: the date's fields merge
  // as roots.
  it("throws on a scalar and on a value that is not a plain map", () => {
    forged.answer = { ok: true, context: tagged("c-1") };
    expect(run).toThrow(GUARD);
    forged.answer = { ok: true, context: tagged(new PDateTime(1_790_000_000, 0)) };
    expect(run).toThrow(GUARD);
  });
});
