import { snapshotAt } from "../mocks/generator";
import type { StationSnapshot } from "../types/domain";

export interface StationDataAdapter {
  getSnapshot(stationId: string, at: Date): Promise<StationSnapshot>;
  importData(file: File): Promise<{ import_id: string; rows: number }>;
  exportResults(snapshot: StationSnapshot): Promise<Blob>;
  connectStream(stationId: string, onMinute: (snapshot: StationSnapshot) => void): () => void;
}

class MockStationAdapter implements StationDataAdapter {
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
  connectStream(_stationId: string, onMinute: (snapshot: StationSnapshot) => void) {
    const timer = window.setInterval(() => onMinute(snapshotAt(new Date())), 60_000);
    return () => window.clearInterval(timer);
  }
}

export const stationAdapter: StationDataAdapter = new MockStationAdapter();

// Reserved real endpoints; switching adapters does not touch UI components:
// GET /api/v1/stations/{stationId}/snapshot | minute-series | recognition/latest
// GET /api/v1/stations/{stationId}/feedback-batches | corrections | results
// POST /api/v1/imports | /api/v1/exports
// WS /api/v1/stream?stationId=...
