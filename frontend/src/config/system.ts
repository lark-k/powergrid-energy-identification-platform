import type { TimeRange } from "../types/domain";

export const SYSTEM_CONFIG = {
  stationId: "A01",
  stationName: "海滨路台区",
  demoStart: new Date().toISOString(),
  demoTickMs: 1000,
  sourceMode: (import.meta.env.VITE_DATA_SOURCE === "api" ? "api" : "mock") as "api" | "mock",
  apiBaseUrl: String(import.meta.env.VITE_API_BASE_URL ?? ""),
  minuteInterval: 1,
  feedbackPeriodMinutes: 15,
  modelVersion: "PV-Sep v3.2.7",
  recognitionVersion: "LGR-Multi v2.4.1",
  thresholds: { exists: 0.8, suspected: 0.55 },
  timeRanges: { "1h": 60, "6h": 360, "24h": 1440, "7d": 10080 } satisfies Record<TimeRange, number>,
  nodes: [
    { node_id: "PV-01", name: "东港光伏分站", capacity_kw: 3400 },
    { node_id: "PV-02", name: "滨海光伏分站", capacity_kw: 2800 },
    { node_id: "PV-03", name: "科创园分站", capacity_kw: 3600 },
    { node_id: "PV-04", name: "物流园分站", capacity_kw: 3000 },
    { node_id: "PV-05", name: "城南光伏分站", capacity_kw: 3520 },
    { node_id: "PV-06", name: "新港光伏分站", capacity_kw: 2500 },
  ],
};

export const COLOR = {
  bg: "#030816", panel: "rgba(9, 28, 50, .72)", cyan: "#19d3ff", blue: "#3a78ff",
  green: "#24f5b5", violet: "#8b5cff", amber: "#ffb84d", red: "#ff5c7a",
  text: "#f4fbff", muted: "#9ebed2",
};
