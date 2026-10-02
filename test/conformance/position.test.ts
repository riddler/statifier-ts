// The position round-trip property: over the vendored scion suite, at every
// point the export can carry, an imported position continues exactly as the
// unbroken drive does; a point it cannot carry is counted with its reason;
// and a position that loses a field on the way out is caught.
//
// The fixture charts are parcel delivery: a parcel scanned from depot to
// doorstep.

import { describe, expect, it } from "vitest";
import type { CorpusCase, CorpusStep } from "../../scripts/lib/corpus.mjs";
import { loadSuites } from "../../scripts/lib/corpus.mjs";
import { compile } from "../../src/compiler.js";
import { type State, start } from "../../src/driver.js";
import { type ExportedPosition, exportPosition } from "../../src/position.js";
import {
  disagreement,
  type ExportPosition,
  positionLines,
  positionRoundTrip,
  runPositionProperty,
  stageFailures,
} from "./position.js";

const SCXML = 'xmlns="http://www.w3.org/2005/07/scxml" version="1.0"';

function parcelCase(
  source: string,
  initial: readonly string[],
  steps: readonly CorpusStep[] = [],
): CorpusCase {
  return {
    id: "scion/parcel/route0",
    suite: "scion",
    spec: "parcel",
    conformance: null,
    description: "",
    required_features: ["basic_states"],
    source,
    initial_configuration: initial,
    steps,
  };
}

function on(name: string, configuration: readonly string[]): CorpusStep {
  return { event: { name }, configuration };
}

/** An export that hands the position through `change` before it travels. */
function planted(change: (position: ExportedPosition) => unknown): ExportPosition {
  return (state) => {
    const exported = exportPosition(state);
    return exported.ok
      ? { ok: true, position: change(exported.position) as ExportedPosition }
      : exported;
  };
}

const scion = loadSuites().find((suite) => suite.suite === "scion")?.cases ?? [];

describe("the property over the vendored scion suite", () => {
  const report = runPositionProperty(scion);

  // The counts move only with the corpus or with what the driver leaves
  // pending at a point; a change in either is read here before it lands.
  // Sabotage: exporting the recorded history as empty in `exportPosition`
  // turns this red (23 carried points disagree), and so does exporting the
  // entered states as empty (all 313). Both were run and reverted.
  it("takes a point after every start and every step, and every carried point agrees", () => {
    expect(report.disagreements).toEqual([]);
    expect(report.cases).toBe(119);
    expect(report.steps).toBe(199);
    expect(report.points).toBe(report.cases + report.steps);
    expect(report.agreeing).toBe(313);
    expect(report.notCarried).toEqual({ pending_timers: 5 });
  });

  it("gives the gate stage nothing else to fail it for", () => {
    expect(stageFailures(report)).toEqual([]);
  });

  it("prints the points, the agreeing round trips and each reason a point was not carried", () => {
    expect(positionLines(report)).toEqual([
      "position: 318 points over 119 scion cases (119 starts and 199 steps)",
      "position: 313 round trips agree, 0 disagree",
      "position: 5 points not carried: pending_timers 5",
    ]);
  });
});

describe("a position that loses a field on the way out", () => {
  // The history a deep or shallow history state recorded is what re-entry
  // restores; emptied, the scion history cases re-enter the default instead.
  it("fails when the recorded history is emptied", () => {
    const report = runPositionProperty(
      scion,
      planted((position) => ({ ...position, historyValues: {} })),
    );
    expect(report.disagreements.length).toBeGreaterThan(0);
    expect(report.disagreements.map((result) => result.caseId)).toContain("scion/history/history0");
  });

  it("fails, refused as malformed, when a required key is dropped", () => {
    const report = runPositionProperty(
      scion,
      planted(({ historyValues: _dropped, ...rest }) => rest),
    );
    expect(report.agreeing).toBe(0);
    const first = report.disagreements[0];
    expect(first?.outcome === "disagree" && first.reason).toBe(
      "the import was refused: malformed_export",
    );
  });

  // The fields no scion chart reads back are caught by the field comparison,
  // not by the configuration alone.
  it("fails when a field the configuration never shows is dropped", () => {
    const report = runPositionProperty(
      scion,
      planted((position) => ({ ...position, enteredStates: [] })),
    );
    expect(report.agreeing).toBe(0);
    const first = report.disagreements[0];
    expect(first?.outcome === "disagree" && first.reason).toMatch(/^at the import: enteredStates /);
  });
});

// A parcel at the depot is sorted 50 ms after it arrives; sorted, it is
// loaded onto the van and then delivered to the doorstep, where it stops.
const DEPOT = `<scxml ${SCXML} initial="depot">
  <datamodel><data id="scans" expr="0"/></datamodel>
  <state id="depot">
    <onentry><send event="parcel.sorted" delay="50ms"/></onentry>
    <transition event="parcel.sorted" target="sorted"/>
  </state>
  <state id="sorted">
    <transition event="parcel.loaded" target="van"><assign location="scans" expr="scans + 1"/></transition>
  </state>
  <state id="van">
    <transition event="parcel.delivered" target="doorstep"/>
  </state>
  <final id="doorstep"/>
</scxml>`;

describe("the points of one case", () => {
  // Sabotage: no longer counting a pending timer as driver state compares the
  // depot's start, where the imported chart has lost its timer, and turns
  // this red. It was run and reverted.
  it("counts a point with a pending timer as not carried, and compares the rest", () => {
    const steps = [on("parcel.loaded", ["van"]), on("parcel.delivered", ["doorstep"])];
    const results = positionRoundTrip(parcelCase(DEPOT, ["depot"], steps));
    expect(results.map((result) => [result.point, result.outcome])).toEqual([
      [0, "not_carried"],
      [1, "agree"],
      [2, "agree"],
    ]);
    expect(results[0]).toMatchObject({ reason: "pending_timers" });
  });

  it("names the point and the field where a carried point disagrees", () => {
    const steps = [on("parcel.loaded", ["van"]), on("parcel.delivered", ["doorstep"])];
    const results = positionRoundTrip(
      parcelCase(DEPOT, ["depot"], steps),
      planted((position) => ({
        ...position,
        datamodel: { ...position.datamodel, scans: '{"$type":"undefined"}' },
      })),
    );
    expect(results[1]).toEqual({
      caseId: "scion/parcel/route0",
      point: 1,
      outcome: "disagree",
      reason: `at the import: datamodel.scans is {"$type":"undefined"}, the unbroken drive's 1`,
    });
  });
});

describe("what else fails the gate stage", () => {
  // Every point refused as the export refuses a non-empty internal queue: an
  // expected reason, but no point is compared, so the property held over
  // nothing. Sabotage: dropping the zero-agreement check from `stageFailures`
  // turns this red. It was run and reverted.
  it("fails a run where no point agrees, though every reason is expected", () => {
    const report = runPositionProperty(scion, () => ({
      ok: false,
      reason: "internal_queue_not_empty",
    }));
    expect(report.agreeing).toBe(0);
    expect(report.disagreements).toEqual([]);
    expect(report.notCarried).toEqual({ internal_queue_not_empty: 318 });
    expect(stageFailures(report)).toEqual([
      "position: no round trip agrees over 318 points, so nothing was compared",
    ]);
  });

  // The van's point is refused for a state with no written id; the depot's
  // start is a pending timer and the doorstep agrees, so only the reason
  // fails it. Sabotage: letting every reason through `stageFailures` turns
  // this red. It was run and reverted.
  it("fails a point not carried for a reason outside the two expected", () => {
    const steps = [on("parcel.loaded", ["van"]), on("parcel.delivered", ["doorstep"])];
    const report = runPositionProperty([parcelCase(DEPOT, ["depot"], steps)], (state) =>
      state.configuration.includes("van")
        ? { ok: false, reason: "unnameable_states", indexes: [] }
        : exportPosition(state),
    );
    expect(report.agreeing).toBe(1);
    expect(report.notCarried).toEqual({ pending_timers: 1, unnameable_states: 1 });
    expect(stageFailures(report)).toEqual([
      "position: 1 points not carried for unnameable_states, outside the expected internal_queue_not_empty and pending_timers",
    ]);
  });
});

describe("the comparison", () => {
  function chartOf(source: string) {
    const compiled = compile(source);
    if (!compiled.ok) throw new Error("the fixture does not compile");
    return compiled.chart;
  }

  const stopped: State = (() => {
    const source = `<scxml ${SCXML} initial="doorstep"><final id="doorstep"/></scxml>`;
    const started = start(chartOf(source), { sessionId: "parcel-1" });
    if (!started.ok) throw new Error("refused");
    return started.state;
  })();

  // Sabotage: comparing the configuration a chart stopped in when it was
  // already stopped at the point turns the first expectation red, since the
  // import answers the position's configuration there. It was run and
  // reverted.
  it("compares a chart stopped at the point by what it holds, not where it stopped", () => {
    expect(stopped.done).not.toBeNull();
    const imported: State = {
      ...stopped,
      done: { donedata: '{"$type":"undefined"}', configuration: stopped.configuration },
    };
    expect(disagreement(stopped, imported, true)).toBeNull();
    expect(disagreement(stopped, imported, false)).toMatch(/^the chart stopped in /);
  });

  it("finds a chart that has stopped against one that has not", () => {
    const running: State = { ...stopped, done: null };
    expect(disagreement(stopped, running, false)).toBe(
      "isDone answers false, the unbroken drive's true",
    );
  });
});
