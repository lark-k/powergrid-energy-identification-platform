import { create } from "zustand";
import { SYSTEM_CONFIG } from "../config/system";
import { stationAdapter } from "../services/adapter";
import type { SeparationResult, StationSnapshot, TimeRange } from "../types/domain";

interface SettingsState { existsThreshold: number; suspectedThreshold: number; reducedEffects: boolean }
interface DemoState {
  now: Date; snapshot: StationSnapshot | null; range: TimeRange; selected: SeparationResult | null;
  drawerOpen: boolean; drawerTab: "minutes" | "feedback" | "nodes" | "corrections";
  settingsOpen: boolean; guideOpen: boolean; busy: boolean; toast: string | null; settings: SettingsState;
  load: () => Promise<void>; advance: () => Promise<void>; setRange: (range: TimeRange) => void;
  selectResult: (result: SeparationResult) => void; setDrawer: (open: boolean, tab?: DemoState["drawerTab"]) => void;
  setSettingsOpen: (open: boolean) => void; setGuideOpen: (open: boolean) => void;
  updateSettings: (settings: Partial<SettingsState>) => void; importFile: (file: File) => Promise<void>;
  exportData: () => Promise<void>; clearToast: () => void;
}

export const useDemoStore = create<DemoState>((set, get) => ({
  now: new Date(SYSTEM_CONFIG.demoStart), snapshot: null, range: "6h", selected: null,
  drawerOpen: false, drawerTab: "minutes", settingsOpen: false, guideOpen: false, busy: false, toast: null,
  settings: { existsThreshold: SYSTEM_CONFIG.thresholds.exists, suspectedThreshold: SYSTEM_CONFIG.thresholds.suspected, reducedEffects: false },
  load: async () => {
    const snapshot = await stationAdapter.getSnapshot(SYSTEM_CONFIG.stationId, get().now);
    set({ snapshot, selected: snapshot.separation_results.at(-20) ?? snapshot.separation_results.at(-1) ?? null });
  },
  advance: async () => {
    const previous = get().now;
    const localNow = new Date();
    const sameMinute = previous.getFullYear() === localNow.getFullYear()
      && previous.getMonth() === localNow.getMonth()
      && previous.getDate() === localNow.getDate()
      && previous.getHours() === localNow.getHours()
      && previous.getMinutes() === localNow.getMinutes();
    if (sameMinute) {
      set({ now: localNow });
      return;
    }
    const snapshot = await stationAdapter.getSnapshot(SYSTEM_CONFIG.stationId, localNow);
    set({ now: localNow, snapshot });
  },
  setRange: (range) => set({ range }), selectResult: (selected) => set({ selected }),
  setDrawer: (drawerOpen, drawerTab) => set((state) => ({ drawerOpen, drawerTab: drawerTab ?? state.drawerTab })),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }), setGuideOpen: (guideOpen) => set({ guideOpen }),
  updateSettings: (settings) => set((state) => ({ settings: { ...state.settings, ...settings } })),
  importFile: async (file) => {
    set({ busy: true }); const result = await stationAdapter.importData(file);
    set({ busy: false, toast: `导入完成 · ${result.rows} 行数据` });
  },
  exportData: async () => {
    const snapshot = get().snapshot; if (!snapshot) return; set({ busy: true });
    const blob = await stationAdapter.exportResults(snapshot); const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `pv-separation-${snapshot.now.slice(0, 10)}.csv`; anchor.click();
    URL.revokeObjectURL(url); set({ busy: false, toast: "结果已导出为 CSV" });
  },
  clearToast: () => set({ toast: null }),
}));
