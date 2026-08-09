import { create } from "zustand";
import { SYSTEM_CONFIG } from "../config/system";
import { stationAdapter } from "../services/adapter";
import { PlatformApiError } from "../services/http";
import type { ConnectionState, SeparationResult, StationDataRange, StationSnapshot, StationSummary, TimeRange, ViewMode } from "../types/domain";

interface SettingsState { existsThreshold: number; suspectedThreshold: number; reducedEffects: boolean }
interface DemoState {
  now: Date; snapshot: StationSnapshot | null; stations: StationSummary[]; stationId: string;
  viewMode: ViewMode; historyAt: string | null; historyStartAt: string | null; historyCursor: string | null; dataRange: StationDataRange | null;
  range: TimeRange; selected: SeparationResult | null; connection: ConnectionState; error: PlatformApiError | null;
  drawerOpen: boolean; drawerTab: "minutes" | "feedback" | "nodes" | "corrections";
  settingsOpen: boolean; guideOpen: boolean; busy: boolean; historyAdvancing: boolean; toast: string | null; settings: SettingsState;
  load: () => Promise<void>; advance: () => Promise<void>; connect: () => () => void;
  setStation: (stationId: string) => Promise<void>; setRange: (range: TimeRange) => Promise<void>;
  setHistoryAt: (at: string) => Promise<void>; goLive: () => Promise<void>;
  selectResult: (result: SeparationResult) => void; setDrawer: (open: boolean, tab?: DemoState["drawerTab"]) => void;
  setSettingsOpen: (open: boolean) => void; setGuideOpen: (open: boolean) => void;
  updateSettings: (settings: Partial<SettingsState>) => void; importFile: (file: File) => Promise<void>;
  exportData: () => Promise<void>; clearToast: () => void;
}

const asApiError = (error: unknown) => error instanceof PlatformApiError
  ? error
  : new PlatformApiError(0, "UNEXPECTED_CLIENT_ERROR", error instanceof Error ? error.message : "前端请求失败");

const applySnapshot = (snapshot: StationSnapshot) => ({
  now: new Date(snapshot.now),
  snapshot,
  selected: snapshot.separation_results.at(-20) ?? snapshot.separation_results.at(-1) ?? null,
  connection: snapshot.model_health.recognition_status === "degraded" || snapshot.model_health.separation_status === "degraded"
    ? "degraded" as const
    : "online" as const,
  error: null,
});

const minuteMs = SYSTEM_CONFIG.minuteInterval * 60_000;

export const historyReplayBounds = (requestedEnd: Date, range: TimeRange, dataRange: StationDataRange | null) => {
  const requestedEndMs = requestedEnd.getTime();
  const firstEventMs = dataRange?.first_event_time ? new Date(dataRange.first_event_time).getTime() : Number.NaN;
  const lastEventMs = dataRange?.last_event_time ? new Date(dataRange.last_event_time).getTime() : Number.NaN;
  const minimumEndMs = Number.isFinite(firstEventMs) ? firstEventMs + minuteMs : requestedEndMs;
  const maximumEndMs = Number.isFinite(lastEventMs) ? lastEventMs + minuteMs : requestedEndMs;
  const endMs = Math.min(Math.max(requestedEndMs, minimumEndMs), Math.max(minimumEndMs, maximumEndMs));
  const desiredStartMs = endMs - SYSTEM_CONFIG.timeRanges[range] * minuteMs;
  const startMs = Number.isFinite(firstEventMs) ? Math.max(desiredStartMs, firstEventMs) : desiredStartMs;
  return {
    start: new Date(startMs),
    cursor: new Date(Math.min(endMs, startMs + minuteMs)),
    end: new Date(endMs),
  };
};

export const snapshotFromReplayStart = (snapshot: StationSnapshot, start: Date): StationSnapshot => {
  const startMs = start.getTime();
  const onOrAfterStart = (value: string) => new Date(value).getTime() >= startMs;
  return {
    ...snapshot,
    minute_points: snapshot.minute_points.filter((point) => onOrAfterStart(point.event_time)),
    separation_results: snapshot.separation_results.filter((result) => onOrAfterStart(result.event_time)),
    substation_points: snapshot.substation_points.filter((point) => onOrAfterStart(point.period_start)),
    feedback_batches: snapshot.feedback_batches.filter((batch) => onOrAfterStart(batch.arrival_time)),
    recognition: snapshot.recognition && onOrAfterStart(snapshot.recognition.result_time) ? snapshot.recognition : null,
    corrections: snapshot.corrections.filter((record) => onOrAfterStart(record.period_start)),
  };
};

const historySnapshotState = (snapshot: StationSnapshot, start: Date) => applySnapshot(snapshotFromReplayStart(snapshot, start));

const latestHistoryEnd = (dataRange: StationDataRange | null) => dataRange?.last_event_time
  ? new Date(new Date(dataRange.last_event_time).getTime() + minuteMs)
  : new Date();

export const useDemoStore = create<DemoState>((set, get) => ({
  now: new Date(SYSTEM_CONFIG.demoStart), snapshot: null, stations: [], stationId: SYSTEM_CONFIG.stationId,
  viewMode: SYSTEM_CONFIG.sourceMode === "api" ? "history" : "live", historyAt: null, historyStartAt: null, historyCursor: null, dataRange: null,
  range: "6h", selected: null, connection: "connecting", error: null,
  drawerOpen: false, drawerTab: "minutes", settingsOpen: false, guideOpen: false, busy: false, historyAdvancing: false, toast: null,
  settings: { existsThreshold: SYSTEM_CONFIG.thresholds.exists, suspectedThreshold: SYSTEM_CONFIG.thresholds.suspected, reducedEffects: false },
  load: async () => {
    set({ connection: "connecting", error: null });
    try {
      const stations = await stationAdapter.listStations();
      const stationId = stations.some((station) => station.station_id === get().stationId)
        ? get().stationId
        : stations.at(0)?.station_id ?? get().stationId;
      const dataRange = await stationAdapter.getDataRange(stationId);
      if (get().viewMode === "history") {
        const replay = historyReplayBounds(get().historyAt ? new Date(get().historyAt!) : latestHistoryEnd(dataRange), get().range, dataRange);
        const snapshot = await stationAdapter.getSnapshot(stationId, replay.cursor, get().range);
        set({ stations, stationId, dataRange, historyAt: replay.end.toISOString(), historyStartAt: replay.start.toISOString(), historyCursor: replay.cursor.toISOString(), ...historySnapshotState(snapshot, replay.start) });
      } else {
        const snapshot = await stationAdapter.getSnapshot(stationId, new Date(), get().range);
        set({ stations, stationId, dataRange, ...applySnapshot(snapshot) });
      }
    } catch (error) {
      const apiError = asApiError(error);
      set({ error: apiError, connection: apiError.status === 503 ? "degraded" : "offline" });
    }
  },
  advance: async () => {
    const state = get();
    if (state.viewMode === "history") {
      if (state.busy || state.historyAdvancing || !state.historyAt || !state.historyStartAt || !state.historyCursor) return;
      const cursor = new Date(state.historyCursor);
      const end = new Date(state.historyAt);
      if (cursor.getTime() >= end.getTime()) return;
      const next = new Date(Math.min(end.getTime(), cursor.getTime() + minuteMs));
      set({ historyAdvancing: true });
      try {
        const snapshot = await stationAdapter.getSnapshot(state.stationId, next, state.range);
        const current = get();
        if (current.viewMode !== "history" || current.stationId !== state.stationId || current.range !== state.range
          || current.historyAt !== state.historyAt || current.historyCursor !== state.historyCursor) return;
        set({ historyCursor: next.toISOString(), ...historySnapshotState(snapshot, new Date(state.historyStartAt)) });
      } catch (error) {
        set({ error: asApiError(error), connection: "offline" });
      } finally {
        set({ historyAdvancing: false });
      }
      return;
    }
    const localNow = new Date();
    if (SYSTEM_CONFIG.sourceMode === "api") { set({ now: localNow }); return; }
    const previous = get().now;
    const sameMinute = previous.getFullYear() === localNow.getFullYear()
      && previous.getMonth() === localNow.getMonth()
      && previous.getDate() === localNow.getDate()
      && previous.getHours() === localNow.getHours()
      && previous.getMinutes() === localNow.getMinutes();
    if (sameMinute) { set({ now: localNow }); return; }
    try {
      const snapshot = await stationAdapter.getSnapshot(get().stationId, localNow, get().range);
      set(applySnapshot(snapshot));
    } catch (error) { set({ error: asApiError(error), connection: "offline" }); }
  },
  connect: () => stationAdapter.connectStream(
    get().stationId,
    (snapshot) => set(applySnapshot(snapshot)),
    (connection) => set({ connection }),
    () => ({
      at: get().viewMode === "history" && get().historyAt ? new Date(get().historyAt!) : new Date(),
      range: get().range,
    }),
  ),
  setStation: async (stationId) => {
    set({ stationId, snapshot: null, selected: null, connection: "connecting", error: null, historyAdvancing: false });
    try {
      const dataRange = await stationAdapter.getDataRange(stationId);
      if (get().viewMode === "history") {
        const replay = historyReplayBounds(get().historyAt ? new Date(get().historyAt!) : latestHistoryEnd(dataRange), get().range, dataRange);
        const snapshot = await stationAdapter.getSnapshot(stationId, replay.cursor, get().range);
        set({ dataRange, historyAt: replay.end.toISOString(), historyStartAt: replay.start.toISOString(), historyCursor: replay.cursor.toISOString(), ...historySnapshotState(snapshot, replay.start) });
      } else {
        const snapshot = await stationAdapter.getSnapshot(stationId, new Date(), get().range);
        set({ dataRange, ...applySnapshot(snapshot) });
      }
    } catch (error) { set({ error: asApiError(error), connection: "offline" }); }
  },
  setRange: async (range) => {
    set({ range, busy: true, historyAdvancing: false });
    try {
      if (get().viewMode === "history") {
        const replay = historyReplayBounds(get().historyAt ? new Date(get().historyAt!) : latestHistoryEnd(get().dataRange), range, get().dataRange);
        const snapshot = await stationAdapter.getSnapshot(get().stationId, replay.cursor, range);
        set({ historyAt: replay.end.toISOString(), historyStartAt: replay.start.toISOString(), historyCursor: replay.cursor.toISOString(), ...historySnapshotState(snapshot, replay.start), busy: false });
      } else {
        const snapshot = await stationAdapter.getSnapshot(get().stationId, new Date(), range);
        set({ ...applySnapshot(snapshot), busy: false });
      }
    } catch (error) { set({ error: asApiError(error), connection: "offline", busy: false }); }
  },
  setHistoryAt: async (at) => {
    const parsed = new Date(at);
    if (Number.isNaN(parsed.getTime())) return;
    const replay = historyReplayBounds(parsed, get().range, get().dataRange);
    set({ viewMode: "history", historyAt: replay.end.toISOString(), historyStartAt: replay.start.toISOString(), historyCursor: replay.cursor.toISOString(), busy: true, historyAdvancing: false });
    try {
      const snapshot = await stationAdapter.getSnapshot(get().stationId, replay.cursor, get().range);
      set({ ...historySnapshotState(snapshot, replay.start), busy: false });
    } catch (error) { set({ error: asApiError(error), connection: "offline", busy: false }); }
  },
  goLive: async () => {
    const at = new Date();
    set({ viewMode: "live", historyAt: null, historyStartAt: null, historyCursor: null, historyAdvancing: false, busy: true });
    try {
      const snapshot = await stationAdapter.getSnapshot(get().stationId, at, get().range);
      set({ ...applySnapshot(snapshot), busy: false });
    } catch (error) { set({ error: asApiError(error), connection: "offline", busy: false }); }
  },
  selectResult: (selected) => set({ selected }),
  setDrawer: (drawerOpen, drawerTab) => set((state) => ({ drawerOpen, drawerTab: drawerTab ?? state.drawerTab })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }), setGuideOpen: (guideOpen) => set({ guideOpen }),
  updateSettings: (settings) => set((state) => ({ settings: { ...state.settings, ...settings } })),
  importFile: async (file) => {
    set({ busy: true, error: null });
    try {
      const result = await stationAdapter.importData(file, get().stationId);
      set({ busy: false, toast: `导入已受理 · ${result.rows} 行数据` });
      await get().load();
    } catch (error) { set({ busy: false, error: asApiError(error) }); }
  },
  exportData: async () => {
    const snapshot = get().snapshot; if (!snapshot) return; set({ busy: true, error: null });
    try {
      const blob = await stationAdapter.exportResults(snapshot); const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `pv-separation-${snapshot.now.slice(0, 10)}.csv`; anchor.click();
      URL.revokeObjectURL(url); set({ busy: false, toast: "结果已导出为 CSV" });
    } catch (error) { set({ busy: false, error: asApiError(error) }); }
  },
  clearToast: () => set({ toast: null }),
}));
