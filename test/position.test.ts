// Position export and import: a driver state in the string-id vocabulary
// out, and back in over a compiled chart; the reference's two export
// refusals and its two import refusals.
//
// The chart is the library loan of the core contract's worked example (a
// copy on loan, renewable while fewer than two renewals have been taken),
// and a parcel delivery chart with a state the document gave no id.

import { Undefined } from "@riddler/predicator";
import { describe, expect, it } from "vitest";
import { type CorpusCase, type CorpusSuite, loadSuites } from "../scripts/lib/corpus.mjs";
import { type Chart, compile } from "../src/compiler.js";
import {
  advance,
  configuration,
  type DriveResult,
  isDone,
  type State,
  start,
  step,
} from "../src/driver.js";
import * as entry from "../src/index.js";
import { type ExportedPosition, exportPosition, importPosition } from "../src/position.js";

const LOAN_SOURCE = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" name="loan" initial="on_loan">
  <datamodel><data id="renewals" expr="0"/></datamodel>
  <state id="on_loan">
    <onentry><send event="loan.due" delay="14d" id="due"/></onentry>
    <transition event="loan.renew" cond="renewals &lt; 2" target="on_loan">
      <assign location="renewals" expr="renewals + 1"/>
    </transition>
    <transition event="loan.returned" target="returned"/>
    <transition event="loan.due" target="overdue"/>
  </state>
  <state id="overdue"><transition event="loan.returned" target="returned"/></state>
  <final id="returned"/>
</scxml>`;

// The exported position of the core contract's worked example
// (docs/adr/0002-the-core-contract.md, "Worked example"): the loan started
// as `loan-copy-17` and renewed once.
const WORKED_EXAMPLE: ExportedPosition = {
  identity: {
    contentHash: "sha256:19d51572cf92d7bf652b737c9a18862720d2e3a5dc931d559192b19160660b61",
    name: "loan",
    version: "3",
  },
  configuration: ["on_loan"],
  enteredStates: ["on_loan"],
  statesToInvoke: [],
  historyValues: {},
  activeInvocations: [],
  invokeCounter: 0,
  sendCounter: 0,
  timerCounter: 2,
  datamodel: {
    _sessionid: '"loan-copy-17"',
    _name: '"loan"',
    _event:
      '{"name":"loan.renew","type":"external","sendid":{"$type":"undefined"},"origin":{"$type":"undefined"},"origintype":{"$type":"undefined"},"invokeid":{"$type":"undefined"},"data":{"$type":"undefined"}}',
    _ioprocessors:
      '{"http://www.w3.org/TR/scxml/#SCXMLEventProcessor":{"location":"#_scxml_loan-copy-17"}}',
    renewals: "1",
  },
  running: true,
  status: "running",
  macrostep: 2,
  microstep: 1,
  round: 1,
  trace: false,
  maxMacrostepRounds: 10000,
};

// The reference's `@required_export_keys` (`Statifier.Position` at v2.9.0),
// in camel case.
const REQUIRED_KEYS = [
  "configuration",
  "enteredStates",
  "statesToInvoke",
  "historyValues",
  "activeInvocations",
  "invokeCounter",
  "sendCounter",
  "timerCounter",
  "datamodel",
  "running",
  "status",
  "macrostep",
  "microstep",
  "round",
  "trace",
  "maxMacrostepRounds",
];

function chartOf(source: string, options = { chartName: "loan", chartVersion: "3" }): Chart {
  const result = compile(source, options);
  if (!result.ok) throw new Error(`fixture does not compile: ${JSON.stringify(result.errors)}`);
  return result.chart;
}

const LOAN = chartOf(LOAN_SOURCE);

// The loan again, with a patron notice invoked each time the loan opens.
const NOTICE_SOURCE = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" name="loan" initial="on_loan">
  <state id="on_loan">
    <invoke type="scxml"/>
    <transition event="loan.renew" target="on_loan"/>
    <transition event="loan.returned" target="returned"/>
  </state>
  <final id="returned"/>
</scxml>`;

function moved(result: DriveResult): State {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.state;
}

// The worked example's state: started, then renewed once.
function renewed(): State {
  const started = moved(start(LOAN, { sessionId: "loan-copy-17" }));
  return moved(step(LOAN, started, { name: "loan.renew" }));
}

function exported(state: State): ExportedPosition {
  const result = exportPosition(state);
  if (!result.ok) throw new Error(`export refused: ${result.reason}`);
  return result.position;
}

function imported(chart: Chart, position: unknown): State {
  const result = importPosition(chart, position);
  if (!result.ok) throw new Error(`import refused: ${result.reason}`);
  return result.state;
}

describe("exportPosition", () => {
  // Sabotage: dropping `timerCounter` from the export turns this red.
  it("answers the worked example's position, pinned", () => {
    expect(exportPosition(renewed())).toEqual({ ok: true, position: WORKED_EXAMPLE });
  });

  // Sabotage: dropping `maxMacrostepRounds` from the export turns this red.
  it("writes every one of the reference's required keys, and the identity beside them", () => {
    const keys = Object.keys(exported(renewed())).sort();
    expect(keys).toEqual([...REQUIRED_KEYS, "identity"].sort());
  });

  // Sabotage: copying `timers` into the position turns this red.
  it("writes no pending timer and no other driver field", () => {
    const state = renewed();
    expect(state.timers).toHaveLength(2);
    const position = exported(state) as unknown as Record<string, unknown>;
    for (const field of [
      "sessionId",
      "nowMs",
      "timers",
      "externalQueue",
      "internalQueue",
      "done",
    ]) {
      expect(position).not.toHaveProperty(field);
    }
  });

  // Sabotage: skipping the internal-queue check turns this red.
  it("refuses a state whose internal queue holds an event", () => {
    const state: State = {
      ...renewed(),
      internalQueue: [{ name: "loan.flagged", type: "internal", data: '{"$type":"undefined"}' }],
    };
    expect(exportPosition(state)).toEqual({ ok: false, reason: "internal_queue_not_empty" });
  });

  // Sabotage: filtering the `#` names out of the export instead of refusing
  // turns this red.
  it("refuses a state holding a state the document gave no id, naming every index", () => {
    const parcel = chartOf(
      `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0">
        <state><transition event="scan" target="doorstep"/></state>
        <final id="doorstep"/>
      </scxml>`,
      { chartName: "parcel", chartVersion: "1" },
    );
    const state = moved(start(parcel, { sessionId: "parcel-42" }));
    expect(configuration(state)).toEqual(["#1"]);
    expect(exportPosition(state)).toEqual({ ok: false, reason: "unnameable_states", indexes: [1] });
    const wider: State = { ...state, historyValues: { "#4": ["#3", "#1"] } };
    expect(exportPosition(wider)).toEqual({
      ok: false,
      reason: "unnameable_states",
      indexes: [1, 3, 4],
    });
  });
});

describe("importPosition", () => {
  // Sabotage: rebuilding the state with an empty configuration turns this
  // red.
  it("answers a state whose configuration equals the original's, and which steps as it does", () => {
    const original = renewed();
    const state = imported(LOAN, exported(original));
    expect(configuration(state)).toEqual(configuration(original));
    expect(configuration(moved(step(LOAN, state, { name: "loan.returned" })))).toEqual(
      configuration(moved(step(LOAN, original, { name: "loan.returned" }))),
    );
    expect(exportPosition(state)).toEqual({ ok: true, position: WORKED_EXAMPLE });
  });

  // Sabotage: rebuilding the state with an empty datamodel turns this red
  // (the renewal count is lost).
  it("keeps the datamodel: two more renewals reach the limit as they do on the original", () => {
    let state = imported(LOAN, JSON.parse(JSON.stringify(exported(renewed()))));
    state = moved(step(LOAN, state, { name: "loan.renew" }));
    state = moved(step(LOAN, state, { name: "loan.renew" }));
    expect(state.datamodel.renewals).toBe("2");
  });

  // Sabotage: carrying the exported position's identity onto the imported
  // state, in place of the chart's, turns this red.
  it("reads no identity: a changed, removed or stale identity imports the same", () => {
    const position = exported(renewed());
    const { identity: _identity, ...anonymous } = position;
    const stale = {
      ...position,
      identity: { contentHash: "sha256:00", name: "loan", version: "1" },
    };
    const revised = chartOf(LOAN_SOURCE.replace('expr="0"', 'expr="1"'), {
      chartName: "loan",
      chartVersion: "4",
    });
    expect(revised.identity.contentHash).not.toBe(LOAN.identity.contentHash);
    for (const variant of [anonymous, stale, { ...position, identity: 7 }]) {
      const state = imported(revised, variant);
      expect(state.identity).toEqual(revised.identity);
      expect(configuration(moved(step(revised, state, { name: "loan.returned" })))).toEqual([]);
    }
  });

  // Sabotage: refusing a key outside the required set turns this red.
  it("ignores a key that is not required", () => {
    const position = { ...exported(renewed()), shelfMark: "QA76.9" };
    const result = importPosition(LOAN, position);
    expect(result).toMatchObject({ ok: true, state: { configuration: ["on_loan"] } });
  });

  // Sabotage: starting the imported clock anywhere but zero turns this red.
  it("starts the driver's own fields fresh: no pending timer, the clock at zero", () => {
    const state = imported(LOAN, exported(renewed()));
    expect(state.sessionId).toBe("loan-copy-17");
    expect(state.nowMs).toBe(0);
    expect(state.timers).toEqual([]);
    expect(state.externalQueue).toEqual([]);
    expect(state.internalQueue).toEqual([]);
    expect(state.heldSends).toEqual({});
    expect(state.halted).toBeNull();
    expect(state.done).toBeNull();
    expect(configuration(moved(advance(LOAN, state, 15 * 86_400_000)))).toEqual(["on_loan"]);
  });

  // Sabotage: answering `{ ok: true }` for a non-object turns this red.
  it("refuses a value that is not an object as malformed_export", () => {
    for (const value of [null, "on_loan", 3, ["on_loan"]]) {
      expect(importPosition(LOAN, value)).toEqual({
        ok: false,
        reason: "malformed_export",
        detail: { kind: "not_an_object" },
      });
    }
  });

  // Sabotage: reporting only the first missing key turns this red.
  it("refuses an export missing required keys, naming every one, sorted", () => {
    const { timerCounter: _t, configuration: _c, ...partial } = exported(renewed());
    expect(importPosition(LOAN, partial)).toEqual({
      ok: false,
      reason: "malformed_export",
      detail: { kind: "missing_keys", keys: ["configuration", "timerCounter"] },
    });
  });

  // Sabotage: dropping the shape check (so a string configuration is read as
  // a list) turns this red.
  it("refuses a required field of the wrong shape as malformed_export, naming it", () => {
    const position = exported(renewed());
    expect(importPosition(LOAN, { ...position, configuration: "on_loan" })).toEqual({
      ok: false,
      reason: "malformed_export",
      detail: { kind: "bad_shape", field: "configuration" },
    });
    expect(importPosition(LOAN, { ...position, status: "paused" })).toEqual({
      ok: false,
      reason: "malformed_export",
      detail: { kind: "bad_shape", field: "status" },
    });
    expect(importPosition(LOAN, { ...position, maxMacrostepRounds: 0 })).toEqual({
      ok: false,
      reason: "malformed_export",
      detail: { kind: "bad_shape", field: "maxMacrostepRounds" },
    });
  });

  // Sabotage: naming the undecodable value by its root alone, without the
  // `datamodel.` path, turns this red.
  it("refuses a datamodel value whose text does not decode as malformed_export", () => {
    const position = exported(renewed());
    const datamodel = { ...position.datamodel, renewals: "{not tagged" };
    expect(importPosition(LOAN, { ...position, datamodel })).toEqual({
      ok: false,
      reason: "malformed_export",
      detail: { kind: "undecodable_value", field: "datamodel.renewals" },
    });
  });

  // Sabotage: defaulting a missing session id to the empty string turns this
  // red.
  it("refuses a datamodel with no session id as malformed_export", () => {
    const position = exported(renewed());
    const { _sessionid: _s, ...withoutId } = position.datamodel;
    for (const datamodel of [withoutId, { ...position.datamodel, _sessionid: "17" }]) {
      expect(importPosition(LOAN, { ...position, datamodel })).toEqual({
        ok: false,
        reason: "malformed_export",
        detail: { kind: "no_session_id", field: "datamodel._sessionid" },
      });
    }
  });

  // Sabotage: stopping at the first unknown id, or leaving the history and
  // invocation ids unchecked, turns this red.
  it("refuses an export naming states the chart does not hold, naming every one, sorted", () => {
    const position: ExportedPosition = {
      ...exported(renewed()),
      configuration: ["on_loan", "lost"],
      enteredStates: ["on_loan", "damaged"],
      historyValues: { shelved: ["on_loan", "#2"] },
      activeInvocations: [{ state: "repair", invokeIndex: 0, invokeId: "repair.1" }],
    };
    expect(importPosition(LOAN, position)).toEqual({
      ok: false,
      reason: "unknown_state_ids",
      ids: ["#2", "damaged", "lost", "repair", "shelved"],
    });
  });

  // Sabotage: checking unknown ids before the shapes turns this red.
  it("answers malformed_export before unknown_state_ids", () => {
    const position = { ...exported(renewed()), configuration: ["lost"], status: "paused" };
    expect(importPosition(LOAN, position)).toMatchObject({ reason: "malformed_export" });
  });

  // Sabotage: exporting an empty `historyValues` turns this red (the paused
  // registration resumes at its history's default, not where it left off).
  it("carries a history state's recorded states out and back in", () => {
    const patron = chartOf(
      `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" name="patron" initial="registering">
        <state id="registering" initial="details">
          <history id="resume_point" type="shallow"><transition target="details"/></history>
          <state id="details"><transition event="next" target="address"/></state>
          <state id="address"/>
          <transition event="pause" target="paused"/>
        </state>
        <state id="paused"><transition event="resume" target="resume_point"/></state>
      </scxml>`,
      { chartName: "patron", chartVersion: "1" },
    );
    let state = moved(start(patron, { sessionId: "patron-9" }));
    state = moved(step(patron, state, { name: "next" }));
    state = moved(step(patron, state, { name: "pause" }));
    const position = exported(state);
    expect(position.historyValues).toEqual({ resume_point: ["address"] });
    const resumed = moved(step(patron, imported(patron, position), { name: "resume" }));
    expect(configuration(resumed)).toEqual(["address", "registering"]);
  });

  // Sabotage: rebuilding a stopped position as running turns this red.
  it("keeps a stopped position stopped", () => {
    const original = moved(step(LOAN, renewed(), { name: "loan.returned" }));
    const state = imported(LOAN, exported(original));
    expect(state.running).toBe(false);
    expect(state.status).toBe("done");
    expect(step(LOAN, state, { name: "loan.renew" })).toEqual({ ok: false, reason: "not_running" });
  });

  // Sabotage: rebuilding a stopped position with no done record (as the
  // import first did) turns this red: isDone answers that the chart runs.
  it("answers a stopped position as stopped from isDone, with no donedata", () => {
    const original = moved(step(LOAN, renewed(), { name: "loan.returned" }));
    expect(isDone(original)).toMatchObject({ ok: true, done: true });
    const position = exported(original);
    const state = imported(LOAN, position);
    expect(isDone(state)).toEqual({
      ok: true,
      done: true,
      donedata: Undefined,
      configuration: position.configuration,
    });
    expect(step(LOAN, state, { name: "loan.renew" })).toEqual({ ok: false, reason: "not_running" });
    expect(advance(LOAN, state, 1000)).toMatchObject({ ok: true, effects: [] });
  });

  // Sabotage: rebuilding a running position with a done record turns this red.
  it("answers a running position as running from isDone", () => {
    expect(isDone(imported(LOAN, exported(renewed())))).toEqual({ ok: true, done: false });
  });

  // A copy on loan invokes a patron notice each time the loan opens, so the
  // invoke counter is what names the next notice.
  // Sabotage: writing invokeCounter as 0 in encodeState turns this red.
  it("keeps the invoke counter, so the next invocation's id follows the last", () => {
    const chart = chartOf(NOTICE_SOURCE);
    const original = moved(
      step(chart, moved(start(chart, { sessionId: "loan-copy-17" })), { name: "loan.renew" }),
    );
    expect(original.invokeCounter).toBe(2);
    const position = exported(original);
    expect(position.invokeCounter).toBe(2);
    const state = imported(chart, JSON.parse(JSON.stringify(position)));
    expect(state.invokeCounter).toBe(2);
    expect(exportPosition(state)).toEqual({ ok: true, position });
    expect(step(chart, state, { name: "loan.renew" })).toMatchObject({
      ok: true,
      effects: [
        { kind: "cancel_invoke", invokeId: "on_loan.inv_2" },
        { kind: "invoke", invokeId: "on_loan.inv_3" },
      ],
    });
  });

  // Sabotage: writing invokeCounter as 0 in encodeState turns this red.
  it("keeps an invoke counter no drive of this chart wrote", () => {
    const state = imported(LOAN, { ...WORKED_EXAMPLE, invokeCounter: 7 });
    expect(state.invokeCounter).toBe(7);
    expect(exported(state).invokeCounter).toBe(7);
  });

  // Sabotage: rebuilding a stopped position with no done record turns this
  // red: the scion case's chart answers not stopped after the round trip.
  it("round-trips a stopped scion case: stopped before export and after import", () => {
    const corpusCase = loadSuites()
      .flatMap((suite: CorpusSuite) => suite.cases)
      .find((c: CorpusCase) => c.id === "scion/send-idlocation/test0");
    if (corpusCase === undefined) throw new Error("the scion case is not in the corpus");
    const chart = chartOf(corpusCase.source, { chartName: "scion", chartVersion: "1" });
    let state = moved(start(chart, { sessionId: "scion-1" }));
    for (const { event } of corpusCase.steps)
      state = moved(step(chart, state, { name: event.name }));
    expect(isDone(state)).toMatchObject({ ok: true, done: true });
    const position = exported(state);
    const reloaded = imported(chart, JSON.parse(JSON.stringify(position)));
    expect(isDone(reloaded)).toMatchObject({ ok: true, done: true, donedata: Undefined });
    expect(configuration(reloaded)).toEqual(configuration(state));
    expect(exportPosition(reloaded)).toEqual({ ok: true, position });
  });
});

describe("the main entry point", () => {
  it("exports exportPosition and importPosition", () => {
    expect(entry.exportPosition).toBe(exportPosition);
    expect(entry.importPosition).toBe(importPosition);
  });
});
