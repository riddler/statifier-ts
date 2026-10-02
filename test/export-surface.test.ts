// The main entry point's export surface.
//
// A runtime name is pinned by listing it: the module's own keys, sorted, must
// be exactly the list below, so a name added or dropped at the entry point
// fails here until the list moves with it. A type-only export leaves no
// runtime name, so it is pinned by a declaration that names it through the
// entry point: `tsc` refuses the file when the type is no longer exported.
// Later changes add their names here.

import { describe, expect, it } from "vitest";
import type {
  CompileError,
  CompilerError,
  DefaultTransitionOwner,
  Empty,
  ErrorOf,
  ExpressionOwner,
  HttpAnswer,
  HttpFailure,
  HttpRequest,
  HttpStatus,
  HttpTransport,
  Location,
  LoweringError,
  LoweringErrorOf,
  ParseError,
  ParseErrorReason,
  StateKind,
  ValidationError,
} from "../src/index.js";
import * as entry from "../src/index.js";

const RUNTIME_NAMES = [
  "advance",
  "compile",
  "configuration",
  "exportPosition",
  "importPosition",
  "isDone",
  "start",
  "step",
  "version",
];

// The transport types, each named through the entry point. Removing one of
// them from `src/index.ts` makes this declaration fail to typecheck.
type TransportTypes = [HttpTransport, HttpRequest, HttpAnswer, HttpStatus, HttpFailure];
const transportTypesNamed: TransportTypes | undefined = undefined;

// The types a compile error reaches, each named through the entry point:
// every type the declarations of `CompileResult`, `CompileError` and
// `CompileOptions` reach, except the opaque `Machine` a `Chart` carries and
// the expression language's own refusal, which its package exports. Removing
// one of them from `src/index.ts` makes this declaration fail to typecheck.
type CompileErrorTypes = [
  ParseError,
  ParseErrorReason,
  Location,
  LoweringError,
  LoweringErrorOf<"stray_text", { readonly text: string }>,
  ValidationError,
  ErrorOf<"empty_id", Empty>,
  DefaultTransitionOwner,
  StateKind,
  CompilerError,
  ExpressionOwner,
];
const compileErrorTypesNamed: CompileErrorTypes | undefined = undefined;

// A compile error is exactly one of the four named stage errors: a member
// added to `CompileError` that is not one of them, or one dropped, makes
// `CompileErrorIsTheNamedUnion` false and this declaration fail to typecheck.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type CompileErrorIsTheNamedUnion = Equal<
  CompileError,
  ParseError | LoweringError | ValidationError | CompilerError
>;
const compileErrorIsTheNamedUnion: CompileErrorIsTheNamedUnion = true;

describe("the main entry point", () => {
  // Sabotage: exporting one more function from `src/index.ts`, or dropping
  // `version`, turns this red.
  it("exports exactly the runtime names listed", () => {
    expect(Object.keys(entry).sort()).toEqual(RUNTIME_NAMES);
  });

  it("exports the HTTP transport types, as types only", () => {
    expect(transportTypesNamed).toBeUndefined();
    expect(Object.keys(entry).filter((name) => name.startsWith("Http"))).toEqual([]);
  });

  // Sabotage: dropping `type Location` (or any other name the tuple above
  // lists) from `src/index.ts` turns the typecheck red.
  it("exports the types a compile error reaches, as types only", () => {
    expect(compileErrorTypesNamed).toBeUndefined();
    expect(compileErrorIsTheNamedUnion).toBe(true);
  });
});
