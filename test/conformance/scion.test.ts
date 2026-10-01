// The scion case runner: the active leaf set compared, the settle window and
// the configuration deadline on the virtual clock, a stopped chart compared at
// the configuration it stopped in, and the reasons a case fails with.
//
// The charts are parcel delivery: a parcel scanned from depot to doorstep.

import { describe, expect, it } from "vitest";
import type { CorpusCase, CorpusStep } from "../../scripts/lib/corpus.mjs";
import { type Chart, compile } from "../../src/compiler.js";
import { type DriveResult, type State, start } from "../../src/driver.js";
import {
  activeLeaves,
  awaitConfiguration,
  CONFIGURATION_DEADLINE_MS,
  runScionCase,
  SETTLE_WINDOW_MS,
  settle,
} from "./scion.js";

const SCXML = 'xmlns="http://www.w3.org/2005/07/scxml" version="1.0"';

function scionCase(
  source: string,
  initial: readonly string[],
  steps: readonly CorpusStep[] = [],
  features: readonly string[] = ["basic_states"],
): CorpusCase {
  return {
    id: "scion/parcel/route0",
    suite: "scion",
    spec: "parcel",
    conformance: null,
    description: "",
    required_features: features,
    source,
    initial_configuration: initial,
    steps,
  };
}

function on(name: string, configuration: readonly string[]): CorpusStep {
  return { event: { name }, configuration };
}

function chartOf(source: string): Chart {
  const result = compile(source);
  if (!result.ok) throw new Error(`fixture does not compile: ${JSON.stringify(result.errors)}`);
  return result.chart;
}

function started(chart: Chart): State {
  const result: DriveResult = start(chart, { sessionId: "parcel-1" });
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.state;
}

// A route of two leaves inside a compound parent: the full configuration
// holds `route` too, the leaf set does not.
const ROUTE = `<scxml ${SCXML} initial="route">
  <state id="route" initial="depot">
    <state id="depot"><transition event="parcel.scanned" target="in_transit"/></state>
    <state id="in_transit"><transition event="parcel.delivered" target="doorstep"/></state>
  </state>
  <final id="doorstep"/>
</scxml>`;

describe("the comparison", () => {
  // Sabotage: comparing the full configuration (the driver's `configuration`)
  // instead of the leaf set turns this red - `route` is active and named in no
  // expectation. It was run and reverted.
  it("compares the active leaf set, not the full configuration", () => {
    expect(
      runScionCase(scionCase(ROUTE, ["depot"], [on("parcel.scanned", ["in_transit"])])),
    ).toEqual({ result: "pass" });
  });

  it("fails a step mismatch naming the step, the event and both leaf sets", () => {
    const outcome = runScionCase(scionCase(ROUTE, ["depot"], [on("parcel.scanned", ["doorstep"])]));
    expect(outcome).toEqual({
      result: "fail",
      reason:
        'step 1 (event "parcel.scanned"): expected active leaf states [doorstep], got [in_transit]',
    });
  });

  it("fails an initial mismatch naming both leaf sets", () => {
    expect(runScionCase(scionCase(ROUTE, ["in_transit", "depot"]))).toEqual({
      result: "fail",
      reason:
        "the initial configuration: expected active leaf states [depot, in_transit], got [depot]",
    });
  });

  // Sabotage: reading the driver's configuration of a stopped chart (empty by
  // construction) instead of the configuration it stopped in turns this red.
  // It was run and reverted.
  it("compares a stopped chart at the configuration it stopped in", () => {
    const steps = [on("parcel.scanned", ["in_transit"]), on("parcel.delivered", ["doorstep"])];
    expect(runScionCase(scionCase(ROUTE, ["depot"], steps))).toEqual({ result: "pass" });
  });

  it("fails an event sent to a stopped chart, naming the refusal", () => {
    const steps = [
      on("parcel.scanned", ["in_transit"]),
      on("parcel.delivered", ["doorstep"]),
      on("parcel.scanned", ["doorstep"]),
    ];
    expect(runScionCase(scionCase(ROUTE, ["depot"], steps))).toEqual({
      result: "fail",
      reason: 'step 3 (event "parcel.scanned"): the driver refused the event: not_running',
    });
  });

  // Sabotage: dropping the unnamed-leaf count lets the anonymous leaf pass
  // unobserved beside the named one, and this goes red. It was run and
  // reverted.
  it("fails an active leaf the document gave no id, which no expectation can name", () => {
    const source = `<scxml ${SCXML} initial="hub">
      <parallel id="hub"><state id="sorting"/><state/></parallel>
    </scxml>`;
    expect(runScionCase(scionCase(source, ["sorting"]))).toEqual({
      result: "fail",
      reason:
        "the initial configuration: 1 active leaf state(s) have no id; the expectation [sorting] cannot name them",
    });
    const leaves = activeLeaves(chartOf(source), started(chartOf(source)));
    expect(leaves.ok).toBe(false);
  });
});

describe("a case that requires script elements", () => {
  // Sabotage: compiling every <script> body to an Invalid again turns this
  // red: the scan count stays 0 and the parcel goes to `held`.
  it("runs a case that requires script elements, the script deciding the route", () => {
    const source = `<scxml ${SCXML} initial="depot">
      <datamodel><data id="scans" expr="0"/></datamodel>
      <state id="depot">
        <transition event="parcel.scanned" target="sorting">
          <script>scans = scans + 1; if scans == 1 { lane = "north" }</script>
        </transition>
      </state>
      <state id="sorting">
        <transition cond="lane == 'north'" target="north_van"/>
        <transition target="held"/>
      </state>
      <state id="north_van"/>
      <state id="held"/>
    </scxml>`;
    const features = ["basic_states", "script_elements"];
    expect(
      runScionCase(scionCase(source, ["depot"], [on("parcel.scanned", ["north_van"])], features)),
    ).toEqual({ result: "pass" });
  });
});

describe("the reasons a case fails with before it runs", () => {
  it("names a source that does not compile, with the compiler's reason", () => {
    const outcome = runScionCase(scionCase("<scxml", ["depot"]));
    expect(outcome.result).toBe("fail");
    expect(outcome.result === "fail" && outcome.reason).toMatch(/^the source does not compile: /);
  });
});

// A parcel at the depot is sorted 50 ms after it arrives and, left there,
// misrouted at 150 ms unless it is on the van by then; sorted, it can be
// loaded onto the van, and the van reaches the doorstep after the delay the
// test names.
function depot(arrival: string): string {
  return `<scxml ${SCXML} initial="route">
    <state id="route" initial="depot">
      <state id="depot">
        <onentry>
          <send event="parcel.sorted" delay="50ms"/>
          <send event="parcel.misrouted" delay="150ms"/>
        </onentry>
        <transition event="parcel.sorted" target="sorted"/>
        <transition event="parcel.misrouted" target="misrouted"/>
      </state>
      <state id="sorted">
        <transition event="parcel.loaded" target="van"/>
        <transition event="parcel.misrouted" target="misrouted"/>
      </state>
      <state id="van">
        <onentry><send event="parcel.arrived" delay="${arrival}"/></onentry>
        <transition event="parcel.arrived" target="doorstep"/>
      </state>
      <state id="doorstep"/>
      <state id="misrouted"/>
    </state>
  </scxml>`;
}

describe("the settle window", () => {
  it("is 100 virtual ms, and the configuration deadline 4000", () => {
    expect([SETTLE_WINDOW_MS, CONFIGURATION_DEADLINE_MS]).toEqual([100, 4000]);
  });

  // Sabotage: settling with no window bound fires the 150 ms misroute before
  // the event, and skipping the settle sends `parcel.loaded` to a parcel still
  // at the depot; each turns this red. Both were run and reverted.
  it("fires the timers due within the window before the event, and none after it", () => {
    const steps = [on("parcel.loaded", ["van"])];
    expect(runScionCase(scionCase(depot("1s"), ["depot"], steps))).toEqual({ result: "pass" });
  });

  // Sabotage: ending the window where the last timer fired, though one is
  // still pending, leaves the clock at 50 and turns this red. It was run and
  // reverted.
  it("jumps the clock to each due time and ends at the window's end while a timer is pending", () => {
    const chart = chartOf(depot("1s"));
    const settled = settle(chart, started(chart));
    expect(settled.configuration).toContain("sorted");
    expect(settled.nowMs).toBe(100);
    expect(settled.timers.map((timer) => timer.dueMs)).toEqual([150]);
  });

  it("stops the clock at the last timer it fired when none is left pending", () => {
    const source = `<scxml ${SCXML} initial="depot">
      <state id="depot">
        <onentry><send event="parcel.sorted" delay="40ms"/></onentry>
        <transition event="parcel.sorted" target="sorted"/>
      </state>
      <state id="sorted"/>
    </scxml>`;
    const chart = chartOf(source);
    const settled = settle(chart, started(chart));
    expect(settled.nowMs).toBe(40);
    expect(settled.timers).toEqual([]);
    expect(settle(chart, settled).nowMs).toBe(40);
  });
});

describe("the configuration deadline", () => {
  // Sabotage: comparing straight after the event, with no wait, turns this
  // red: the van has not reached the doorstep yet. It was run and reverted.
  it("fires timers due within 4000 virtual ms of the event until the expectation holds", () => {
    const steps = [on("parcel.loaded", ["doorstep"])];
    expect(runScionCase(scionCase(depot("3900ms"), ["depot"], steps))).toEqual({ result: "pass" });
  });

  // Sabotage: dropping the deadline bound fires the timer due 4001 virtual ms
  // after the event and turns this red. It was run and reverted.
  it("never fires a timer due later than 4000 virtual ms after the event", () => {
    const steps = [on("parcel.loaded", ["doorstep"])];
    expect(runScionCase(scionCase(depot("4001ms"), ["depot"], steps))).toEqual({
      result: "fail",
      reason: 'step 1 (event "parcel.loaded"): expected active leaf states [doorstep], got [van]',
    });
  });

  it("stops at the expectation without firing what is due after it", () => {
    const chart = chartOf(depot("1s"));
    const initial = started(chart);
    const waited = awaitConfiguration(chart, initial, ["sorted"], initial.nowMs);
    expect(waited.nowMs).toBe(50);
    expect(waited.timers.map((timer) => timer.dueMs)).toEqual([150]);
  });

  it("stops when no timer is pending, the clock where it was", () => {
    const chart = chartOf(ROUTE);
    const initial = started(chart);
    expect(awaitConfiguration(chart, initial, ["doorstep"], 0)).toBe(initial);
  });
});
