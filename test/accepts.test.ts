// The accepts check: a declaration of accepted event names compared with the
// chart's event vocabulary.
//
// The first block is the reference's own table: its charts and its
// expectations are taken from `test/statifier/chart_accepts_test.exs` in
// statifier-ex at v2.10.0, whose twelve tests make fifteen `check_accepts(`
// calls, and each row names the reference test it is taken from, verbatim.
// Where one reference test makes more than one of the calls, the row also
// names the call, and the case's name is the test's with the call added in
// parentheses. Where the reference reads one list of an answer, the row
// states the other list as well. The loan chart is the corpus's
// `library/loan_dispute_returns_to_history.scxml`, read from the vendored
// copy and never edited, as the reference reads it from its own corpus. The
// second block holds charts written here for the entry walk's branches the
// reference's table does not isolate.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AcceptsCheck, checkAccepts, vocabulary } from "../src/accepts.js";
import { type Chart, compile } from "../src/compiler.js";
import * as entry from "../src/index.js";

const LOAN_PATH = new URL(
  "../conformance/statifier/cases/library/loan_dispute_returns_to_history.scxml",
  import.meta.url,
);

function chart(source: string): Chart {
  const compiled = compile(source);
  if (!compiled.ok)
    throw new Error(`the chart did not compile: ${JSON.stringify(compiled.errors)}`);
  return compiled.chart;
}

const loan = chart(readFileSync(LOAN_PATH, "utf8"));

const PATTERNS = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="on_loan">
    <state id="on_loan">
        <transition event="loan.* hold. patron" target="on_loan"/>
    </state>
</scxml>`;

const ANY = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="on_loan">
    <state id="on_loan">
        <transition event="*" target="on_loan"/>
    </state>
</scxml>`;

const EXACT = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="on_loan">
    <state id="on_loan">
        <transition event="loan.renew" target="on_loan"/>
        <transition event="loan.renewal" target="on_loan"/>
    </state>
</scxml>`;

const MEMBERSHIP = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="on_loan">
    <state id="on_loan">
        <transition event="copy.returned" target="returned"/>
    </state>
    <state id="archived">
        <transition event="loan.archived" target="returned"/>
    </state>
    <final id="returned"/>
</scxml>`;

// `lending` is entered only as the proper ancestor of the transition target
// `on_loan`; its own transition listens for `copy.returned`.
const ANCESTOR_ONLY = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="checkout">
    <state id="checkout">
        <transition event="loan.issued" target="on_loan"/>
    </state>
    <state id="lending">
        <transition event="copy.returned" target="returned"/>
        <state id="on_loan">
            <transition event="loan.renew" target="on_loan"/>
        </state>
    </state>
    <final id="returned"/>
</scxml>`;

// `overdue` is entered only through the history's default transition;
// `on_loan`, `lending`'s own `initial`, is never entered.
const HISTORY_DEFAULT = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="held_for_review">
    <state id="held_for_review">
        <transition event="dispute.resolved" target="h"/>
    </state>
    <state id="lending" initial="on_loan">
        <transition event="copy.returned" target="returned"/>
        <history id="h" type="shallow">
            <transition target="overdue"/>
        </history>
        <state id="on_loan">
            <transition event="loan.due" target="overdue"/>
        </state>
        <state id="overdue">
            <transition event="loan.lost" target="returned"/>
        </state>
    </state>
    <final id="returned"/>
</scxml>`;

interface Row {
  /** The reference test the row is taken from, by its name, verbatim. */
  readonly test: string;
  /** Which of the test's calls, where the test makes more than one. */
  readonly call?: string;
  readonly chart: Chart;
  readonly declared: readonly string[] | null;
  readonly unreachable: readonly string[];
  readonly undeclared: readonly string[];
}

// One row per `check_accepts(` call the reference's test compares with a
// literal answer: eleven of its fifteen calls. The empty declaration and the
// order of `unreachable` are tested below the table, and so is the purity
// test, whose two calls compare one answer with another.
const TABLE: readonly Row[] = [
  {
    test: "the loan chart declaring loan.renew, copy.returned and loan.archived",
    chart: loan,
    declared: ["loan.renew", "copy.returned", "loan.archived"],
    unreachable: ["loan.archived"],
    undeclared: ["copy.disputed", "loan.due_soon", "loan.due", "loan.lost", "dispute.resolved"],
  },
  {
    test: "nil makes the computed vocabulary the contract: both lists are empty",
    chart: loan,
    declared: null,
    unreachable: [],
    undeclared: [],
  },
  {
    test: "a pattern, a trailing dot, a bare prefix and a bare * each match a declared name",
    chart: chart(PATTERNS),
    declared: ["loan.renew", "hold.placed", "patron.blocked"],
    unreachable: [],
    undeclared: [],
  },
  {
    test: "a pattern, a trailing dot, a bare prefix and a bare * each match a declared name",
    call: "the bare *",
    chart: chart(ANY),
    declared: ["branch.closed"],
    unreachable: [],
    undeclared: [],
  },
  {
    test: "a descriptor matches a longer name on token boundaries, never a shorter one",
    chart: chart(EXACT),
    declared: ["loan.renew.late", "loan"],
    unreachable: ["loan"],
    undeclared: ["loan.renewal"],
  },
  {
    test: "a * in a declared entry is an ordinary token, never a pattern",
    chart: chart(EXACT),
    declared: ["loan.*"],
    unreachable: ["loan.*"],
    undeclared: ["loan.renew", "loan.renewal"],
  },
  {
    test: "undeclared follows the vocabulary's order",
    chart: loan,
    declared: ["loan.renew"],
    unreachable: [],
    undeclared: [
      "copy.returned",
      "copy.disputed",
      "loan.due_soon",
      "loan.due",
      "loan.lost",
      "dispute.resolved",
    ],
  },
  {
    test: "a one-name declaration answers [] when a reachable descriptor matches, [n] when none does",
    call: "copy.returned",
    chart: chart(MEMBERSHIP),
    declared: ["copy.returned"],
    unreachable: [],
    undeclared: [],
  },
  {
    test: "a one-name declaration answers [] when a reachable descriptor matches, [n] when none does",
    call: "loan.archived",
    chart: chart(MEMBERSHIP),
    declared: ["loan.archived"],
    unreachable: ["loan.archived"],
    undeclared: ["copy.returned"],
  },
  {
    test: "a name on an ancestor of an entered state is reachable",
    chart: chart(ANCESTOR_ONLY),
    declared: ["copy.returned", "loan.renew"],
    unreachable: [],
    undeclared: ["loan.issued"],
  },
  {
    test: "a name on a history pseudo-state's default target is reachable; one no path enters is not",
    chart: chart(HISTORY_DEFAULT),
    declared: ["loan.lost", "loan.due"],
    unreachable: ["loan.due"],
    undeclared: ["dispute.resolved", "copy.returned"],
  },
];

describe("checkAccepts, against the reference's table", () => {
  // Sabotage, each run and reverted, each turning at least one row red:
  // the `undeclared` filter keeping the descriptors that DO match (its `!`
  // dropped); the declared names compared with `===` in place of `nameMatch`;
  // `nameMatch`'s arguments swapped in the `undeclared` filter; the
  // `markEntered` call on a target's ancestors dropped; the history default
  // answering nothing in `defaultEntry`.
  for (const row of TABLE) {
    it(row.call === undefined ? row.test : `${row.test} (${row.call})`, () => {
      expect(checkAccepts(row.chart, row.declared)).toEqual({
        unreachable: row.unreachable,
        undeclared: row.undeclared,
      });
    });
  }

  // Sabotage: answering an empty list as `null` is answered turns this red.
  // It was run and reverted.
  it("an empty list declares that the chart accepts nothing", () => {
    expect(checkAccepts(loan, [])).toEqual({
      unreachable: [],
      undeclared: vocabulary(loan.machine),
    });
    expect(vocabulary(loan.machine)).toEqual([
      "copy.returned",
      "copy.disputed",
      "loan.renew",
      "loan.due_soon",
      "loan.due",
      "loan.lost",
      "dispute.resolved",
    ]);
  });

  // `undefined` is outside the type, and a JavaScript caller that passes it,
  // or leaves the argument out, is answered as `null` is: no declaration.
  // Sabotage: the guard testing `=== null` alone turns this red (`undeclared`
  // the whole vocabulary). It was run and reverted.
  it("answers undefined, outside the type, as it answers null", () => {
    const loose = checkAccepts as (
      chart: Chart,
      declaredEvents?: readonly string[] | null,
    ) => AcceptsCheck;
    expect(loose(loan, undefined)).toEqual({ unreachable: [], undeclared: [] });
    expect(loose(loan)).toEqual({ unreachable: [], undeclared: [] });
  });

  // Sabotage: dropping the de-duplication of the declared names turns this
  // red (`loan.archived` listed twice). It was run and reverted.
  it("unreachable follows the declaration's order, without duplicates", () => {
    const declared = [
      "patron.blocked",
      "loan.archived",
      "loan.renew",
      "patron.blocked",
      "loan.archived",
    ];
    expect(checkAccepts(loan, declared).unreachable).toEqual(["patron.blocked", "loan.archived"]);
  });

  // The reference's purity test compiles the loan chart without its source or
  // identity and asks for the same answer. Here the identity is on the Chart
  // wrapper, so a chart carrying only its Machine stands in for that.
  it("reads only the chart's Machine", () => {
    const declared = ["loan.renew", "loan.archived"];
    const bare = { machine: loan.machine } as unknown as Chart;
    expect(checkAccepts(bare, declared)).toEqual(checkAccepts(loan, declared));
  });

  it("is exported from the main entry point", () => {
    expect(entry.checkAccepts).toBe(checkAccepts);
  });
});

describe("the vocabulary's entry walk", () => {
  // The walk enters `on_loan` before `overdue`, which the document writes
  // first: the vocabulary is in transition index order, not entry order.
  const ENTRY_ORDER = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="on_loan">
    <state id="overdue">
        <transition event="copy.returned" target="on_loan"/>
    </state>
    <state id="on_loan">
        <transition event="loan.due" target="overdue"/>
    </state>
</scxml>`;

  // Sabotage: dropping the sort by transition index turns this red. It was
  // run and reverted.
  it("lists the descriptors in transition index order, not in the order states are entered", () => {
    expect(vocabulary(chart(ENTRY_ORDER).machine)).toEqual(["copy.returned", "loan.due"]);
  });

  // A parallel state entered by its default enters every region by its
  // default.
  const PARALLEL_DEFAULT = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="lending">
    <parallel id="lending">
        <state id="copy">
            <transition event="loan.renew"/>
        </state>
        <state id="fines">
            <transition event="patron.paid"/>
        </state>
    </parallel>
</scxml>`;

  // Sabotage: a parallel state's default entering nothing turns this red. It
  // was run and reverted.
  it("enters every region of a parallel state entered by its default", () => {
    expect(vocabulary(chart(PARALLEL_DEFAULT).machine)).toEqual(["loan.renew", "patron.paid"]);
  });

  // A parallel state entered as an ancestor of a target enters its other
  // regions by their defaults, and a region holding the target is not
  // entered by its default: `reading` is the default of the targeted region
  // and is never entered, `renewing`'s sibling region `fines` is. The
  // transition in `fines` has no target, so it enters nothing: had it
  // targeted `fines`, entering `fines` as a target would enter `copy` by its
  // default, and `reading` with it.
  const PARALLEL = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="checkout">
    <state id="checkout">
        <transition event="loan.issued" target="renewing"/>
    </state>
    <parallel id="lending">
        <state id="copy" initial="reading">
            <state id="reading">
                <transition event="copy.returned" target="checkout"/>
            </state>
            <state id="renewing">
                <transition event="loan.renew" target="renewing"/>
            </state>
        </state>
        <state id="fines">
            <transition event="patron.paid"/>
        </state>
    </parallel>
</scxml>`;

  // Sabotage: `untargetedRegions` answering every region, the targeted one
  // included, turns this red (`copy.returned` joins). It was run and reverted.
  it("enters a parallel ancestor's untargeted regions by their defaults", () => {
    expect(vocabulary(chart(PARALLEL).machine)).toEqual([
      "loan.issued",
      "loan.renew",
      "patron.paid",
    ]);
  });

  // A history with no default transition enters nothing by its default, as
  // the reference's `default_entry/2` answers for `history_default: nil`. The
  // validator refuses such a history, so the history-default chart above
  // stands in with its history's default removed: `overdue` is then entered
  // by no path, and `loan.lost` with it.
  // Sabotage: such a history entering its parent by its default turns this
  // red. It was run and reverted.
  it("enters nothing by the default of a history with no default transition", () => {
    const { machine } = chart(HISTORY_DEFAULT);
    const states = machine.states.map((state) =>
      state.kind === "history" ? { ...state, historyDefault: null } : state,
    );
    expect(vocabulary(machine)).toEqual(["dispute.resolved", "copy.returned", "loan.lost"]);
    expect(vocabulary({ ...machine, states })).toEqual(["dispute.resolved", "copy.returned"]);
  });
});
