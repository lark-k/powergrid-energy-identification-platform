import { describe, expect, it } from "vitest";
import { DEMO_DATASET, snapshotAt } from "../mocks/generator";
import { historyReplayBounds, snapshotFromReplayStart, useDemoStore } from "../stores/useDemoStore";

describe("history replay", () => {
  it("starts every fresh application session in live mode", () => {
    expect(useDemoStore.getState().viewMode).toBe("live");
  });

  it("starts at the beginning of the selected range and reveals the first minute only", () => {
    const dataRange = {
      first_event_time: "2026-08-01T00:00:00.000Z",
      last_event_time: "2026-08-01T12:59:00.000Z",
      minute_count: 780,
      recognition_result_count: 661,
      separation_result_count: 541,
      available_dates: ["2026-08-01"],
    };

    const replay = historyReplayBounds(new Date("2026-08-01T13:00:00.000Z"), "1h", dataRange);

    expect(replay.start.toISOString()).toBe("2026-08-01T12:00:00.000Z");
    expect(replay.cursor.toISOString()).toBe("2026-08-01T12:01:00.000Z");
    expect(replay.end.toISOString()).toBe("2026-08-01T13:00:00.000Z");
  });

  it("clamps replay to the database boundary", () => {
    const dataRange = {
      first_event_time: "2026-08-01T00:00:00.000Z",
      last_event_time: "2026-08-01T12:59:00.000Z",
      minute_count: 780,
      recognition_result_count: 661,
      separation_result_count: 541,
      available_dates: ["2026-08-01"],
    };

    const replay = historyReplayBounds(new Date("2026-08-03T00:00:00.000Z"), "6h", dataRange);

    expect(replay.end.toISOString()).toBe("2026-08-01T13:00:00.000Z");
    expect(replay.start.toISOString()).toBe("2026-08-01T07:00:00.000Z");
  });

  it("removes records before the replay start instead of showing the full history immediately", () => {
    const end = new Date(DEMO_DATASET.mainSwitch.at(-1)!.event_time);
    end.setHours(21, 30, 0, 0);
    const start = new Date(end.getTime() - 3 * 60 * 60_000);
    const full = snapshotAt(end);
    const visible = snapshotFromReplayStart(full, start);

    expect(visible.minute_points.length).toBeLessThan(full.minute_points.length);
    expect(visible.minute_points.every((point) => new Date(point.event_time) >= start)).toBe(true);
    expect(visible.separation_results.every((result) => new Date(result.event_time) >= start)).toBe(true);
    expect(visible.feedback_batches.every((batch) => new Date(batch.arrival_time) >= start)).toBe(true);
    expect(visible.corrections.every((record) => new Date(record.period_start) >= start)).toBe(true);
  });
});
