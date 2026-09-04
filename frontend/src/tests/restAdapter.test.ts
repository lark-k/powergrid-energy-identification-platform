import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestStationAdapter } from "../services/adapter";
import { PlatformApiError } from "../services/http";

const snapshot = {
  now: "2026-08-01T08:00:00Z", station_id: "A01", station_name: "海滨路台区",
  minute_points: [], separation_results: [], substation_points: [], feedback_batches: [],
  recognition: null, corrections: [], training: null,
  model_health: { recognition_status: "degraded", separation_status: "degraded", recognition_version: "", separation_version: "", last_inference_ms: 0, last_inference_time: "2026-08-01T08:00:00Z", window_status: "warming" },
  node_statuses: [], quality: { completeness_ratio: 0, duplicate_count: 0, missing_count: 0, out_of_order_count: 0, warning_count: 0, last_checked_at: "2026-08-01T08:00:00Z" },
};

describe("RestStationAdapter", () => {
  beforeEach(() => window.localStorage.setItem("powergrid_access_token", "test-token"));
  afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

  it("normalizes Java station records and injects the bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { stationId: "A01", stationName: "海滨路台区", timezone: "Asia/Shanghai", status: "active" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const stations = await new RestStationAdapter("http://backend").listStations();
    expect(stations[0]).toMatchObject({ station_id: "A01", station_name: "海滨路台区" });
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get("Authorization")).toBe("Bearer test-token");
  });

  it("keeps warming results null instead of replacing them with demo data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(snapshot), { status: 200, headers: { "Content-Type": "application/json" } })));
    const result = await new RestStationAdapter("").getSnapshot("A01", new Date(snapshot.now), "6h");
    expect(result.recognition).toBeNull();
    expect(result.training).toBeNull();
    expect(result.separation_results).toEqual([]);
  });

  it("loads the database time boundary used by historical navigation", async () => {
    const range = {
      first_event_time: "2026-07-01T00:00:00Z", last_event_time: "2026-07-07T23:59:00Z",
      minute_count: 10080, recognition_result_count: 9961, separation_result_count: 9841,
      available_dates: ["2025-01-01", "2025-01-02"],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(range), {
      status: 200, headers: { "Content-Type": "application/json" },
    })));
    await expect(new RestStationAdapter("").getDataRange("A01")).resolves.toEqual(range);
  });

  it.each([401, 403, 404, 422, 500, 503])("maps HTTP %s to a structured error", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: `E${status}`, message: "backend message", request_id: "req-1" }), { status, headers: { "Content-Type": "application/json" } })));
    await expect(new RestStationAdapter("").listStations()).rejects.toMatchObject<Partial<PlatformApiError>>({ status, code: `E${status}`, requestId: "req-1" });
  });
});
