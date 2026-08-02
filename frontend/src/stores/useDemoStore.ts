import { create } from "zustand";
import { SYSTEM_CONFIG } from "../config/system";
import { stationAdapter } from "../services/adapter";
import { PlatformApiError } from "../services/http";
import type { ConnectionState, SeparationResult, StationDataRange, StationSnapshot, StationSummary, TimeRange, ViewMode } from "../types/domain";

interface SettingsState { existsThreshold: number; suspectedThreshold: number; reducedEffects: boolean }
interface DemoState {
  now: Date; snapshot: StationSnapshot | null; stations: StationSummary[]; stationId: string;
  viewMode: ViewMode; historyAt: string | null; dataRange: StationDataRange | null;
  range: TimeRange; selected: SeparationResult | null; connection: ConnectionState; error: PlatformApiError | null;
  drawerOpen: boolean; drawerTab: "minutes" | "feedback" | "nodes" | "corrections";
  settingsOpen: boolean; guideOpen: boolean; busy: boolean; toast: string | null; settings: SettingsState;
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

export const useDemoStore = create<DemoState>((set, get) => ({
  now: new Date(SYSTEM_CONFIG.demoStart), snapshot: null, stations: [], stationId: SYSTEM_CONFIG.stationId,
  viewMode: "live", historyAt: null, dataRange: null,
  range: "6h", selected: null, connection: "connecting", error: null,
  drawerOpen: false, drawerTab: "minutes", settingsOpen: false, guideOpen: false, busy: false, toast: null,
  settings: { existsThreshold: SYSTEM_CONFIG.thresholds.exists, suspectedThreshold: SYSTEM_CONFIG.thresholds.suspected, reducedEffects: false },
  load: async () => {
    set({ connection: "connecting", error: null });
    try {
      const stations = await stationAdapter.listStations();
      const stationId = stations.some((station) => station.station_id === get().stationId)
        ? get().stationId
        : stations.at(0)?.station_id ?? get().stationId;
      const dataRange = await stationAdapter.getDataRange(stationId);
      const at = get().viewMode === "history" && get().historyAt ? new Date(get().historyAt!) : new Date();
      const snapshot = await stationAdapter.getSnapshot(stationId, at, get().range);
      set({ stations, stationId, dataRange, ...applySnapshot(snapshot) });
    } catch (error) {
      const apiError = asApiError(error);
      set({ error: apiError, connection: apiError.status === 503 ? "degraded" : "offline" });
    }
  },
  advance: async () => {
    if (get().viewMode === "history") return;
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
    set({ stationId, snapshot: null, selected: null, connection: "connecting", error: null });
    try {
      const dataRange = await stationAdapter.getDataRange(stationId);
      const at = get().viewMode === "history" && get().historyAt
        ? new Date(get().historyAt!)
        : new Date();
      const snapshot = await stationAdapter.getSnapshot(stationId, at, get().range);
      set({ dataRange, ...applySnapshot(snapshot) });
    } catch (error) { set({ error: asApiError(error), connection: "offline" }); }
  },
  setRange: async (range) => {
    set({ range, busy: true });
    try {
      const at = get().viewMode === "history" && get().historyAt ? new Date(get().historyAt!) : new Date();
      const snapshot = await stationAdapter.getSnapshot(get().stationId, at, range);
      set({ ...applySnapshot(snapshot), busy: false });
    } catch (error) { set({ error: asApiError(error), connection: "offline", busy: false }); }
  },
  setHistoryAt: async (at) => {
    const parsed = new Date(at);
    if (Number.isNaN(parsed.getTime())) return;
    set({ viewMode: "history", historyAt: parsed.toISOString(), busy: true });
    try {
      const snapshot = await stationAdapter.getSnapshot(get().stationId, parsed, get().range);
      set({ ...applySnapshot(snapshot), busy: false });
    } catch (error) { set({ error: asApiError(error), connection: "offline", busy: false }); }
  },
  goLive: async () => {
    const at = new Date();
    set({ viewMode: "live", historyAt: null, busy: true });
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
