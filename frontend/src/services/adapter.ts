import { SYSTEM_CONFIG } from "../config/system";
import { snapshotAt } from "../mocks/generator";
import type { ConnectionState, StationDataRange, StationSnapshot, StationSummary, TimeRange } from "../types/domain";
import { accessToken, apiRequest, authHeaders } from "./http";

export interface StationDataAdapter {
  listStations(): Promise<StationSummary[]>;
  getDataRange(stationId: string): Promise<StationDataRange>;
  getSnapshot(stationId: string, at: Date, range?: TimeRange): Promise<StationSnapshot>;
  importData(file: File, stationId: string): Promise<{ import_id: string; rows: number }>;
  exportResults(snapshot: StationSnapshot): Promise<Blob>;
  connectStream(
    stationId: string,
    onSnapshot: (snapshot: StationSnapshot) => void,
    onState: (state: ConnectionState) => void,
    query?: () => { at: Date; range: TimeRange },
  ): () => void;
}

export class MockStationAdapter implements StationDataAdapter {
  async listStations() {
    return [{ station_id: SYSTEM_CONFIG.stationId, station_name: SYSTEM_CONFIG.stationName, timezone: "Asia/Shanghai", status: "active" }];
  }
  async getDataRange() {
    const last = new Date();
    return {
      first_event_time: new Date(last.getTime() - 7 * 24 * 60 * 60_000).toISOString(),
      last_event_time: last.toISOString(), minute_count: 7 * 1440,
      recognition_result_count: 7 * 1440 - 119, separation_result_count: 7 * 1440 - 239,
    };
  }
  async getSnapshot(_stationId: string, at: Date) { return snapshotAt(at); }
  async importData(file: File) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    return { import_id: `IMP-${Date.now()}`, rows: Math.max(1, Math.round(file.size / 80)) };
  }
  async exportResults(snapshot: StationSnapshot) {
    const header = ["event_time", "total_power_kw", "initial_pv_kw", "corrected_pv_kw", "result_status", "feedback_status", "confidence", "model_version", "batch_id"];
    const rows = snapshot.separation_results.map((row) =>
      [row.event_time, row.total_power_kw, row.initial_pv_kw, row.corrected_pv_kw ?? "", row.result_status, row.feedback_status, row.confidence, row.model_version, row.batch_id ?? ""].join(","),
    );
    return new Blob([`\uFEFF${header.join(",")}\n${rows.join("\n")}`], { type: "text/csv;charset=utf-8" });
  }
  connectStream(_stationId: string, onSnapshot: (snapshot: StationSnapshot) => void, onState: (state: ConnectionState) => void,
    query?: () => { at: Date; range: TimeRange }) {
    onState("online");
    const timer = window.setInterval(() => onSnapshot(snapshotAt(query?.().at ?? new Date())), 60_000);
    return () => window.clearInterval(timer);
  }
}

type StationApiRow = StationSummary | { stationId: string; stationName: string; timezone: string; status: string };

export class RestStationAdapter implements StationDataAdapter {
  constructor(private readonly baseUrl: string) {}

  async listStations(): Promise<StationSummary[]> {
    const rows = await apiRequest<StationApiRow[]>(this.baseUrl, "/api/v1/stations");
    return rows.map((row) => "station_id" in row ? row : {
      station_id: row.stationId,
      station_name: row.stationName,
      timezone: row.timezone,
      status: row.status,
    });
  }

  getDataRange(stationId: string) {
    return apiRequest<StationDataRange>(this.baseUrl, `/api/v1/stations/${encodeURIComponent(stationId)}/data-range`);
  }

  getSnapshot(stationId: string, at: Date, range: TimeRange = "24h") {
    const query = new URLSearchParams({ at: at.toISOString(), range });
    return apiRequest<StationSnapshot>(this.baseUrl, `/api/v1/stations/${encodeURIComponent(stationId)}/snapshot?${query}`);
  }

  async importData(file: File, stationId: string) {
    const form = new FormData();
    form.set("file", file);
    form.set("station_id", stationId);
    form.set("data_type", file.name.toLowerCase().includes("feedback") ? "pv_feedback" : "main_switch");
    const result = await apiRequest<{ import_id: string; accepted_rows: number }>(this.baseUrl, "/api/v1/imports", { method: "POST", body: form });
    return { import_id: result.import_id, rows: result.accepted_rows };
  }

  exportResults(snapshot: StationSnapshot) {
    const from = snapshot.separation_results.at(0)?.event_time ?? snapshot.now;
    const to = snapshot.now;
    return apiRequest<Blob>(this.baseUrl, "/api/v1/exports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ station_id: snapshot.station_id, from, to, format: "csv", include: ["pv_separation"] }),
    });
  }

  connectStream(stationId: string, onSnapshot: (snapshot: StationSnapshot) => void, onState: (state: ConnectionState) => void,
    query?: () => { at: Date; range: TimeRange }) {
    let socket: WebSocket | null = null;
    let stopped = false;
    let retryTimer: number | null = null;
    let retry = 0;
    let refreshPending = false;
    const refresh = async () => {
      if (refreshPending || stopped) return;
      refreshPending = true;
      try {
        const context = query?.() ?? { at: new Date(), range: "24h" as TimeRange };
        onSnapshot(await this.getSnapshot(stationId, context.at, context.range));
      }
      catch { onState("degraded"); }
      finally { refreshPending = false; }
    };
    const connect = () => {
      if (stopped) return;
      onState(retry ? "offline" : "connecting");
      const wsBase = this.baseUrl
        ? this.baseUrl.replace(/^http/, "ws")
        : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
      const token = accessToken();
      const encodedToken = token ? btoa(token).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") : "";
      socket = encodedToken
        ? new WebSocket(`${wsBase}/api/v1/stream?stationId=${encodeURIComponent(stationId)}`, ["bearer", encodedToken])
        : new WebSocket(`${wsBase}/api/v1/stream?stationId=${encodeURIComponent(stationId)}`);
      socket.onopen = () => { retry = 0; onState("online"); void refresh(); };
      socket.onmessage = () => { void refresh(); };
      socket.onerror = () => onState("degraded");
      socket.onclose = () => {
        if (stopped) return;
        onState("offline");
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(retry++, 5));
        retryTimer = window.setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      stopped = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }
}

export const stationAdapter: StationDataAdapter = SYSTEM_CONFIG.sourceMode === "api"
  ? new RestStationAdapter(SYSTEM_CONFIG.apiBaseUrl)
  : new MockStationAdapter();

export { authHeaders };
