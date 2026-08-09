import { describe, expect, it } from "vitest";
import { powerAxisScale, powerAxisTickText, visibleMainSwitchPoints, visibleSeparationResults } from "../features/separation/chartData";
import type { StationSnapshot } from "../types/domain";

const snapshot = {
  now: "2026-08-01T10:00:00Z",
  minute_points: [
    { station_id: "A01", event_time: "2026-08-01T09:59:00Z", active_power_kw: 32,
      reactive_power_kvar: 0, voltage: 220, current: 10, pf: 1, quality_flag: "good" },
  ],
  separation_results: [],
} as unknown as StationSnapshot;

describe("power separation chart data", () => {
  it("keeps the real main-switch series visible while separation is warming", () => {
    expect(visibleMainSwitchPoints(snapshot, "1h")).toHaveLength(1);
    expect(visibleMainSwitchPoints(snapshot, "1h")[0].active_power_kw).toBe(32);
    expect(visibleSeparationResults(snapshot, "1h")).toEqual([]);
  });

  it("fits the y axis to the visible power range instead of a fixed station-wide scale", () => {
    expect(powerAxisScale([-20.893, 30.529, 0.003])).toEqual({ min: -30, max: 40, interval: 10 });
  });

  it("keeps zero visible and gives flat or tiny series a readable range", () => {
    expect(powerAxisScale([0, 0])).toEqual({ min: -0.6, max: 0.6, interval: 0.2 });
    expect(powerAxisScale([0.0025, 0.01])).toEqual({ min: -0.002, max: 0.012, interval: 0.002 });
  });

  it("ignores absent and invalid values and formats small tick labels", () => {
    expect(powerAxisScale([null, undefined, Number.NaN])).toEqual({ min: -1, max: 1, interval: 0.5 });
    expect(powerAxisTickText(0.025)).toBe("0.025");
    expect(powerAxisTickText(0.0035)).toBe("0.0035");
    expect(powerAxisTickText(0.0005)).toBe("0.0005");
    expect(powerAxisTickText(30)).toBe("30");
  });
});
