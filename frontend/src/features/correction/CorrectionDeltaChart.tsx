import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { COLOR, SYSTEM_CONFIG } from "../../config/system";
import type { StationSnapshot, TimeRange } from "../../types/domain";
import { EChart } from "../../components/charts/EChart";

export function CorrectionDeltaChart({ snapshot, range }: { snapshot: StationSnapshot; range: TimeRange }) {
  const option = useMemo<EChartsOption>(() => {
    const now = new Date(snapshot.now).getTime();
    const start = now - SYSTEM_CONFIG.timeRanges[range] * 60_000;
    const rows = snapshot.separation_results.filter((row) => new Date(row.event_time).getTime() >= start && row.correction_kw != null);
    return {
      animation: range !== "7d",
      animationDuration: range === "7d" ? 0 : 420,
      textStyle: { color: "#dff3fb", fontFamily: "JetBrains Mono, HarmonyOS Sans SC, Microsoft YaHei UI, Microsoft YaHei, sans-serif", fontWeight: 500 },
      grid: { left: 92, right: 36, top: 7, bottom: 7 },
      tooltip: { trigger: "axis", confine: true, backgroundColor: "rgba(3,12,28,.98)", borderColor: "rgba(72,255,193,.62)", axisPointer: { type: "line", lineStyle: { color: "rgba(100,255,204,.48)", type: "dashed" } }, textStyle: { color: "#f5fbff", fontSize: 11, fontWeight: 550 }, extraCssText: "box-shadow:0 16px 42px rgba(0,0,0,.48),0 0 18px rgba(36,245,181,.08);border-radius:7px;" },
      xAxis: { type: "time", min: start, max: now + 20 * 60_000, show: false },
      yAxis: { type: "value", min: -2200, max: 2200, interval: 2200, name: "校正差值\n初始−校正", nameLocation: "middle", nameGap: 64, nameTextStyle: { color: "#62f5bb", fontSize: 11, fontWeight: 650, lineHeight: 16 }, axisLabel: { show: true, color: "#a5c2d3", fontSize: 9, fontWeight: 500, formatter: (value: number) => value === 0 ? "0" : `${value > 0 ? "+" : ""}${value.toLocaleString()}` }, axisTick: { show: false }, axisLine: { show: false }, splitLine: { show: false } },
      series: [{ type: "line", data: rows.map((row) => [new Date(row.event_time).getTime(), row.correction_kw]), smooth: .45, showSymbol: false,
        sampling: range === "7d" ? "lttb" : undefined,
        lineStyle: { color: "rgba(116,255,207,.98)", width: 1.7, shadowBlur: range === "7d" ? 0 : 17, shadowColor: COLOR.green },
        areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(70,255,187,.27)" }, { offset: .5, color: "rgba(36,245,181,.055)" }, { offset: 1, color: "rgba(36,245,181,.2)" }] } },
        markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "rgba(119,179,210,.2)" }, data: [{ yAxis: 0 }] } }],
    };
  }, [snapshot, range]);
  return <EChart key={range} option={option} className="correction-chart" ariaLabel="初始光伏与校正后光伏差值曲线" />;
}
