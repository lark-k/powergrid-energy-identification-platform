import type { LineSeriesOption } from "echarts";
import type { SignalPoint } from "./SignalMiniChart";

export const signalColors = {
  cyan: "#62d9ff", green: "#54efad", violet: "#bd7cff", amber: "#ffc45f",
} as const;

/** One data series preserves point selection and tooltip identity during live updates. */
export function signalSeries(data: SignalPoint[], color: string, expanded = false): LineSeriesOption {
  const values = data.map((point) => point.value);
  const top = Math.max(0, ...values);
  const bottom = Math.min(0, ...values);
  const zero = top === bottom ? 1 : top / (top - bottom);
  const latest = data.at(-1);
  return {
    type: "line",
    showSymbol: data.length === 1,
    symbol: "circle",
    symbolSize: 6,
    smooth: false,
    connectNulls: false,
    data: data.map((point) => [new Date(point.at).getTime(), point.value]),
    lineStyle: { color, width: expanded ? 3.8 : 2.8, cap: "round", join: "round", shadowBlur: expanded ? 5 : 3, shadowColor: `${color}50` },
    itemStyle: { color, borderColor: "#e4faff", borderWidth: 1 },
    areaStyle: {
      origin: 0,
      color: {
        type: "linear", x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [
          { offset: 0, color: `${color}${top > 0 ? "2b" : "03"}` },
          ...(zero > 0 && zero < 1 ? [{ offset: zero, color: `${color}03` }] : []),
          { offset: 1, color: `${color}${bottom < 0 ? "1b" : "03"}` },
        ],
      },
    },
    emphasis: { lineStyle: { width: expanded ? 4.2 : 3.2 } },
    markPoint: {
      silent: true, animation: false, symbol: "circle", symbolSize: expanded ? 8 : 5,
      label: { show: false }, tooltip: { show: false },
      itemStyle: { color, borderColor: "#dffaff", borderWidth: 1, shadowBlur: 4, shadowColor: `${color}66` },
      data: latest ? [{ name: "最新值", coord: [new Date(latest.at).getTime(), latest.value] }] : [],
    },
  };
}
