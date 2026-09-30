// Executable content: the block runner and the nodes it runs.
//
// Ported from the reference's block runner and its content nodes (the
// modules `Statifier.Interpreter.Content` and `Statifier.Machine.Content.*`
// in statifier-ex at v2.9.0). A block runs its nodes in document order
// against ONE evaluation context: every write a node makes - an `<assign>`,
// a `<foreach>`'s item and index, a `<script>`'s program - is visible to
// every node after it in the same block. The first node that fails stops the
// block; the nodes that already ran keep what they did, and the failure
// becomes one `error.execution` on the internal queue. Other blocks are not
// affected: each call is independent.
//
// A condition inside an `<if>` that fails or answers something other than a
// boolean does not stop the block. The branch counts as not taken and the
// failure is raised after the `<if>` finishes, so it follows any event the
// taken branch raised - the order the reference takes too.
//
// Nothing here raises onto a queue or logs anywhere. The runner answers the
// context it leaves, the effects the block produced and the events it raised,
// in queue order, and the caller appends them.

import { Undefined, type Value } from "@riddler/predicator";
import {
  bind,
  type CompiledProgram,
  type Counters,
  checkSystemVariable,
  type EvaluationContext,
  type Event,
  type ExecutionReason,
  type Expr,
  evaluate,
  executionError,
  type Owner,
  runProgram,
} from "../datamodel.js";

// ---------------------------------------------------------------------------
// The nodes a block runs
// ---------------------------------------------------------------------------

/**
 * An expression or a program the compiler could not compile. The failure is
 * deferred to the node that carries it, which fails when it runs rather than
 * refusing the whole chart when it loads.
 */
export interface Invalid {
  readonly kind: "invalid";
  readonly source: string;
  readonly message: string;
}

/** A `<raise>`: enqueues `event` on the internal queue. */
export interface RaiseNode {
  readonly kind: "raise";
  readonly cIndex: number;
  readonly event: string;
}

/** A `<log>`: a label and an optional expression, logged as an effect. */
export interface LogNode {
  readonly kind: "log";
  readonly cIndex: number;
  readonly label: string | null;
  readonly expr: Expr | Invalid | null;
}

/** An `<assign>`: `location` is the raw path, `value` what is written there. */
export interface AssignNode {
  readonly kind: "assign";
  readonly cIndex: number;
  readonly location: string;
  readonly value: Expr | Invalid;
}

/** One partition of an `<if>`; `cond` is null for an `<else>`. */
export interface IfBranchNode {
  readonly cond: Expr | Invalid | null;
  readonly content: readonly ContentNode[];
}

/** An `<if>`, as its partitions in document order. */
export interface IfNode {
  readonly kind: "if";
  readonly cIndex: number;
  readonly branches: readonly IfBranchNode[];
}

/** A `<foreach>`: `item` and `index` are bare names, `content` the body. */
export interface ForeachNode {
  readonly kind: "foreach";
  readonly cIndex: number;
  readonly array: Expr | Invalid;
  readonly item: string;
  readonly index: string | null;
  readonly content: readonly ContentNode[];
}

/** A `<script>`: the compiled statement program its body carries. */
export interface ScriptNode {
  readonly kind: "script";
  readonly cIndex: number;
  readonly program: CompiledProgram | Invalid;
}

/** A compiled content node. */
export type ContentNode = RaiseNode | LogNode | AssignNode | IfNode | ForeachNode | ScriptNode;

// ---------------------------------------------------------------------------
// What a block takes and answers
// ---------------------------------------------------------------------------

/**
 * Where a block's raised events are stamped from: the block they came from
 * and the counters as they stand while it runs. No node in a block moves the
 * counters, so one stamp serves the whole block.
 */
export interface RaiseSink {
  readonly owner: Owner;
  readonly counters: Counters;
}

/** A `<log>`'s effect: the label, the evaluated value, and where it ran. */
export interface Log {
  readonly kind: "log";
  readonly label: string | null;
  /** The evaluated `expr`, or null for a `<log>` without one. */
  readonly value: Value;
  readonly cIndex: number;
  readonly owner: Owner;
  readonly macrostep: number;
  readonly microstep: number;
  readonly round: number;
}

/** An effect a block produced. */
export type Effect = Log;

/**
 * What running a block answered: the context it leaves, its effects in
 * document order, and the events it raised in the order they join the
 * internal queue.
 */
export interface BlockOutcome {
  readonly context: EvaluationContext;
  readonly effects: readonly Effect[];
  readonly raised: readonly Event[];
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

/** The state a block threads from node to node. */
interface Run {
  context: EvaluationContext;
  readonly effects: Effect[];
  readonly raised: Event[];
  /** Failures that do not stop the block, raised once the current top-level node finishes. */
  pending: ExecutionReason[];
  readonly sink: RaiseSink;
}

type Step = { readonly ok: true } | { readonly ok: false; readonly reason: ExecutionReason };

const OK: Step = { ok: true };

/** A bare variable name, the only shape a `<foreach>`'s `item` and `index` take. */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Runs a block of content nodes in document order against one context,
 * stopping at the first node that fails and raising `error.execution` for it,
 * its origin the failing node in this block.
 */
export function executeBlock(
  context: EvaluationContext,
  block: readonly ContentNode[],
  sink: RaiseSink,
): BlockOutcome {
  const run: Run = { context, effects: [], raised: [], pending: [], sink };
  for (const node of block) {
    const step = executeNode(run, node);
    drainPending(run, node.cIndex);
    if (!step.ok) {
      raiseError(run, node.cIndex, step.reason);
      break;
    }
  }
  return { context: run.context, effects: run.effects, raised: run.raised };
}

function raiseError(run: Run, cIndex: number, reason: ExecutionReason): void {
  const origin = { kind: "content", cIndex, owner: run.sink.owner } as const;
  run.raised.push(executionError(origin, run.sink.counters, reason));
}

function drainPending(run: Run, cIndex: number): void {
  for (const reason of run.pending) raiseError(run, cIndex, reason);
  run.pending = [];
}

function executeNode(run: Run, node: ContentNode): Step {
  switch (node.kind) {
    case "raise":
      return executeRaise(run, node);
    case "log":
      return executeLog(run, node);
    case "assign":
      return executeAssign(run, node);
    case "if":
      return executeIf(run, node);
    case "foreach":
      return executeForeach(run, node);
    case "script":
      return executeScript(run, node);
  }
}

/** Runs a partition or a loop body, naming the inner node when one fails. */
function executeNested(run: Run, content: readonly ContentNode[]): Step {
  for (const node of content) {
    const step = executeNode(run, node);
    if (!step.ok) {
      return {
        ok: false,
        reason: { kind: "nested_content", cIndex: node.cIndex, reason: step.reason },
      };
    }
  }
  return OK;
}

type Evaluated =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly reason: ExecutionReason };

function evaluateIn(run: Run, expr: Expr | Invalid): Evaluated {
  if (expr.kind === "invalid") return { ok: false, reason: compileError(expr) };
  return evaluate(run.context, expr);
}

function compileError(invalid: Invalid): ExecutionReason {
  return { kind: "compile_error", source: invalid.source, message: invalid.message };
}

// ---------------------------------------------------------------------------
// The nodes
// ---------------------------------------------------------------------------

function executeRaise(run: Run, node: RaiseNode): Step {
  const { counters, owner } = run.sink;
  run.raised.push({
    name: node.event,
    type: "internal",
    data: Undefined,
    cause: { origin: { kind: "content", cIndex: node.cIndex, owner }, ...counters },
  });
  return OK;
}

function executeLog(run: Run, node: LogNode): Step {
  let value: Value = null;
  if (node.expr !== null) {
    const outcome = evaluateIn(run, node.expr);
    if (!outcome.ok) return outcome;
    value = outcome.value;
  }
  const { counters, owner } = run.sink;
  run.effects.push({
    kind: "log",
    label: node.label,
    value,
    cIndex: node.cIndex,
    owner,
    ...counters,
  });
  return OK;
}

/** The root a location names, and whether the location is that root alone. */
function locationRoot(location: string): { root: string; bare: boolean } | undefined {
  const trimmed = location.trim();
  const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(trimmed);
  if (match === null) return undefined;
  return { root: match[0], bare: match[0].length === trimmed.length };
}

/**
 * The value is evaluated first, then the location is checked: a root that
 * begins with an underscore is refused, then a root the datamodel does not
 * hold, then anything but a bare root. A write never declares a root.
 */
function executeAssign(run: Run, node: AssignNode): Step {
  const outcome = evaluateIn(run, node.value);
  if (!outcome.ok) return outcome;

  const unsupported: Step = {
    ok: false,
    reason: { kind: "unsupported_location", location: node.location },
  };
  const parsed = locationRoot(node.location);
  if (parsed === undefined) return unsupported;
  const system = checkSystemVariable([parsed.root]);
  if (!system.ok) return system;
  if (!run.context.data.has(parsed.root)) {
    return { ok: false, reason: { kind: "unbound_location", location: node.location } };
  }
  if (!parsed.bare) return unsupported;

  run.context = bind(run.context, parsed.root, outcome.value);
  return OK;
}

/**
 * The first branch whose condition is true runs; an `<else>` always does. A
 * condition that fails or is not a boolean is treated as false and its
 * failure raised after the `<if>`, without stopping the block.
 */
function executeIf(run: Run, node: IfNode): Step {
  for (const branch of node.branches) {
    if (branch.cond === null) return executeNested(run, branch.content);
    const outcome = evaluateIn(run, branch.cond);
    if (!outcome.ok) {
      run.pending.push(outcome.reason);
    } else if (outcome.value === true) {
      return executeNested(run, branch.content);
    } else if (outcome.value !== false) {
      run.pending.push({ kind: "non_boolean_cond", value: outcome.value });
    }
  }
  return OK;
}

function checkName(name: string, illegal: ExecutionReason): Step {
  if (name.startsWith("_")) return checkSystemVariable([name]);
  return NAME.test(name) ? OK : { ok: false, reason: illegal };
}

/**
 * `array` is evaluated once, before the first iteration, so the body cannot
 * change what it iterates. `item` and `index` are declared when the loop
 * starts and written on every iteration, directly: unlike an `<assign>`, a
 * `<foreach>` may bind a name the datamodel does not yet hold. A body failure
 * keeps what earlier iterations wrote.
 */
function executeForeach(run: Run, node: ForeachNode): Step {
  const itemCheck = checkName(node.item, { kind: "illegal_item_name", name: node.item });
  if (!itemCheck.ok) return itemCheck;
  if (node.index !== null) {
    const indexCheck = checkName(node.index, { kind: "illegal_index_name", name: node.index });
    if (!indexCheck.ok) return indexCheck;
  }
  const outcome = evaluateIn(run, node.array);
  if (!outcome.ok) return outcome;
  const collection = outcome.value;
  if (!Array.isArray(collection)) {
    return { ok: false, reason: { kind: "not_iterable", value: collection } };
  }

  declare(run, node.item);
  if (node.index !== null) declare(run, node.index);

  for (let i = 0; i < collection.length; i++) {
    run.context = bind(run.context, node.item, collection[i] as Value);
    if (node.index !== null) run.context = bind(run.context, node.index, i);
    const step = executeNested(run, node.content);
    if (!step.ok) return step;
  }
  return OK;
}

function declare(run: Run, name: string): void {
  if (!run.context.data.has(name)) run.context = bind(run.context, name, Undefined);
}

/**
 * Runs the compiled statement program. What it wrote before a failure is
 * kept; a program that never compiled fails with the compiler's message.
 */
function executeScript(run: Run, node: ScriptNode): Step {
  if ("kind" in node.program) return { ok: false, reason: compileError(node.program) };
  const outcome = runProgram(run.context, node.program);
  run.context = { data: outcome.data, states: run.context.states };
  return outcome.ok ? OK : { ok: false, reason: outcome.reason };
}
