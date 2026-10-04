// The accepts check: a declaration of the event names a chart accepts,
// compared with the chart's event vocabulary.
//
// Ported from the reference's `Statifier.Chart.check_accepts/2` and the
// vocabulary it reads, `Statifier.Chart.events/1`, with its private entry
// walk (`entered_states/1`), in `lib/statifier/chart.ex` in statifier-ex at
// v2.10.0. Matching is transition selection's own, `nameMatch` and
// `tokenize` in `core/selection.ts`, the port of the reference's
// `Statifier.Interpreter.NameMatch`.
//
// The vocabulary is every event descriptor on a transition whose source state
// can be active, each returned as authored and a pattern never expanded. "Can
// be active" is a static rule over the chart's structure: a state some path
// enters, its ancestors included, following Appendix D's
// `addDescendantStatesToEnter` and `addAncestorStatesToEnter`. The root is
// entered by its default. Entering a state by its default enters its
// `initial` states as targets (a compound state or the root), every child
// that is not a history by its default (a parallel state), or its history
// default transition's targets as targets (a history pseudo-state). Entering
// a state as a target enters it by its default, enters each of its proper
// ancestors, and, for each parallel ancestor, enters by its default every
// child region that holds none of the transition's targets. Every transition
// of an entered state enters its targets as targets. No `cond` and no `event`
// is read, so the rule over-counts and never under-counts. Descriptors come in
// transition index order (a state's own transitions before its children's,
// as the compiler numbers them), a descriptor equal as a string to one
// already listed dropped.
//
// The vocabulary is not exported: the reference's `events/1` is a public
// function, and here the check is the one public question asked of it. The
// check reads only the chart's compiled Machine, never its identity, and
// runs nothing.

import type { Chart } from "./compiler.js";
import { nameMatch, tokenize } from "./core/selection.js";
import {
  childStates,
  isDescendant,
  isHistory,
  isParallel,
  type Machine,
  properAncestors,
  stateAt,
  transitionAt,
} from "./machine.js";

/**
 * What `checkAccepts` answers: the declared names no descriptor in the
 * chart's vocabulary matches, and the vocabulary's descriptors that match no
 * declared name.
 */
export interface AcceptsCheck {
  readonly unreachable: readonly string[];
  readonly undeclared: readonly string[];
}

/**
 * Compares `declaredEvents`, the event names a chart is declared to accept,
 * with the chart's event vocabulary.
 *
 * A descriptor matches a declared name under the descriptor matching
 * transition selection uses, on token boundaries: a declared `loan.renew` is
 * matched by the descriptor `loan.renew`, by `loan.*`, by `loan.`, by `loan`
 * and by `*`, and not by `loan.renewal` or `loan.renew.late`.
 *
 * - `unreachable`: each declared name no descriptor in the vocabulary
 *   matches, in the declaration's order and without duplicates.
 * - `undeclared`: each descriptor in the vocabulary that matches no declared
 *   name, in the vocabulary's order.
 *
 * A declared entry is a name, not a descriptor: a `*` in it is an ordinary
 * token, so a declared `loan.*` is matched by the descriptor `loan` and not
 * by `loan.renew`. An empty list declares that the chart accepts nothing:
 * `unreachable` is empty and `undeclared` is the whole vocabulary. `null`, no
 * declaration, makes the vocabulary the contract, so both lists are empty;
 * `undefined`, which the type leaves out, is answered as `null` is.
 *
 * It reports and refuses nothing: which list a host refuses a publish on, if
 * either, is the host's decision.
 */
export function checkAccepts(chart: Chart, declaredEvents: readonly string[] | null): AcceptsCheck {
  if (declaredEvents === null || declaredEvents === undefined) {
    return { unreachable: [], undeclared: [] };
  }
  const descriptors = vocabulary(chart.machine).map((descriptor) => ({
    descriptor,
    tokens: tokenize(descriptor),
  }));
  const names = [...new Set(declaredEvents)].map((name) => ({ name, tokens: tokenize(name) }));
  const descriptorTokens = descriptors.map(({ tokens }) => tokens);
  return {
    unreachable: names
      .filter(({ tokens }) => !nameMatch(descriptorTokens, tokens))
      .map(({ name }) => name),
    undeclared: descriptors
      .filter(({ tokens }) => !names.some((name) => nameMatch([tokens], name.tokens)))
      .map(({ descriptor }) => descriptor),
  };
}

/**
 * The chart's event vocabulary (the reference's `events/1`): every
 * descriptor on a transition of a state that can be active, history
 * pseudo-states left out, in transition index order and without duplicates.
 */
export function vocabulary(machine: Machine): string[] {
  const tIndexes = [...enteredStates(machine)]
    .filter((index) => !isHistory(machine, index))
    .flatMap((index) => stateAt(machine, index).transitions)
    .sort((a, b) => a - b);
  const descriptors = tIndexes.flatMap((tIndex) =>
    transitionAt(machine, tIndex).events.map((tokens) => tokens.join(".")),
  );
  return [...new Set(descriptors)];
}

type Entry =
  | { readonly kind: "default"; readonly index: number }
  | { readonly kind: "targets"; readonly targets: readonly number[] };

// The least set of state indexes closed under the entry rule, as a worklist:
// a `default` entry enters a state by its default and a `targets` entry
// enters one transition's (or one `initial`'s) targets as targets.
// `defaulted` bounds the default expansions and `entered` bounds the
// per-state transition walk, so each state's work is queued once and the walk
// ends on any chart, cycles included.
function enteredStates(machine: Machine): Set<number> {
  const entered = new Set<number>();
  const defaulted = new Set<number>();
  const work: Entry[] = [{ kind: "default", index: 0 }];
  for (let entry = work.pop(); entry !== undefined; entry = work.pop()) {
    if (entry.kind === "default") {
      if (defaulted.has(entry.index)) continue;
      defaulted.add(entry.index);
      work.push(...markEntered(machine, entry.index, entered));
      work.push(...defaultEntry(machine, entry.index));
      continue;
    }
    const { targets } = entry;
    const ancestors = [...new Set(targets.flatMap((target) => properAncestors(machine, target)))];
    for (const ancestor of ancestors) {
      work.push(...markEntered(machine, ancestor, entered));
      work.push(...untargetedRegions(machine, ancestor, targets));
    }
    for (const target of targets) work.push({ kind: "default", index: target });
  }
  return entered;
}

// What entering `index` by its default enters next, by kind: a parallel
// state's regions by their defaults, a history's default transition's
// targets as targets, and otherwise the compiler-resolved `initial` as
// targets - nothing on an atomic state.
function defaultEntry(machine: Machine, index: number): Entry[] {
  const state = stateAt(machine, index);
  if (state.kind === "parallel") {
    return childStates(machine, index).map((child) => ({ kind: "default", index: child }));
  }
  if (state.kind === "history") {
    if (state.historyDefault === null) return [];
    return [{ kind: "targets", targets: transitionAt(machine, state.historyDefault).targets }];
  }
  if (state.initial.length === 0) return [];
  return [{ kind: "targets", targets: state.initial }];
}

// A parallel ancestor's regions that hold none of `targets`, each to be
// entered by its default; nothing for any other ancestor.
function untargetedRegions(
  machine: Machine,
  ancestor: number,
  targets: readonly number[],
): Entry[] {
  if (!isParallel(machine, ancestor)) return [];
  return childStates(machine, ancestor)
    .filter(
      (region) =>
        !targets.some((target) => target === region || isDescendant(machine, target, region)),
    )
    .map((region) => ({ kind: "default", index: region }));
}

// Marks `index` entered. The first time only, answers the work its own
// transitions add: each targeted transition's targets, as targets.
function markEntered(machine: Machine, index: number, entered: Set<number>): Entry[] {
  if (entered.has(index)) return [];
  entered.add(index);
  return stateAt(machine, index)
    .transitions.map((tIndex) => transitionAt(machine, tIndex).targets)
    .filter((targets) => targets.length > 0)
    .map((targets) => ({ kind: "targets", targets }));
}
