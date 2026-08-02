import { useCallback, useMemo } from "react";
import type { EChartsOption } from "echarts";
import { COLOR } from "../../config/system";
import type { SeparationResult, StationSnapshot, TimeRange } from "../../types/domain";
import { dateTimeText, percentText, powerText, timeText } from "../../utils/format";
import { EChart } from "../../components/charts/EChart";
import { powerAxisScale, powerAxisTickText, visibleMainSwitchPoints, visibleSeparationResults } from "./chartData";

interface Props { snapshot: StationSnapshot; range: TimeRange; onSelect: (result: SeparationResult) => void }
const line = (name: string, color: string, width = 1.6) => ({ name, type: "line" as const, showSymbol: false, smooth: 0.22,
  itemStyle: { color }, lineStyle: { color, width, shadowBlur: 11, shadowColor: color }, emphasis: { focus: "series" as const, lineStyle: { width: width + .5 } }, animationDuration: 320 });

export function PowerSeparationChart({ snapshot, range, onSelect }: Props) {
  const visible = useMemo(() => {
    return visibleSeparationResults(snapshot, range);
  }, [snapshot, range]);
  const mainSwitch = useMemo(() => {
    return visibleMainSwitchPoints(snapshot, range);
  }, [snapshot, range]);

  const resultMap = useMemo(() => new Map(visible.map((row) => [new Date(row.event_time).getTime(), row])), [visible]);
  const minuteMap = useMemo(() => new Map(mainSwitch.map((point) => [new Date(point.event_time).getTime(), point])), [mainSwitch]);
  const feedback = useMemo(() => {
    const grouped = new Map<string, number>();
    snapshot.substation_points.forEach((point) => grouped.set(point.period_start, (grouped.get(point.period_start) ?? 0) + point.pv_value));
    return [...grouped].map(([time, value]) => [new Date(time).getTime(), value]);
  }, [snapshot.substation_points]);

  const now = new Date(snapshot.now).getTime();
  const latestBatch = snapshot.feedback_batches.at(-1);
  const correctedEnd = latestBatch ? new Date(latestBatch.coverage_end).getTime() : visible[0] ? new Date(visible[0].event_time).getTime() : now;
  const realtimeStart = now - 5 * 60_000;
  const isLongRange = range === "24h" || range === "7d";
  const waitingLabelY = Math.max(1, ...mainSwitch.map((point) => point.active_power_kw), ...visible.map((row) => row.total_power_kw)) * 1.045;
  const yAxisScale = useMemo(() => powerAxisScale([
    ...mainSwitch.map((point) => point.active_power_kw),
    ...visible.flatMap((row) => [row.total_power_kw, row.initial_pv_kw, row.corrected_pv_kw, row.station_feedback_value, row.remaining_load_kw]),
    ...feedback.map((point) => point[1]),
  ]), [mainSwitch, visible, feedback]);
  const axisTimeText = (value: number) => {
    const date = new Date(value);
    if (range !== "7d") return timeText(date);
    return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}\n${timeText(date)}`;
  };
  const sevenDaySampling = range === "7d" ? "lttb" as const : undefined;

  const option = useMemo<EChartsOption>(() => ({
    animation: range !== "7d",
    animationDurationUpdate: range === "7d" ? 0 : 280,
    textStyle: { color: "#dff3fb", fontFamily: "JetBrains Mono, HarmonyOS Sans SC, Microsoft YaHei UI, Microsoft YaHei, sans-serif", fontWeight: 500 },
    grid: { left: 56, right: 294, top: 92, bottom: 52, containLabel: false },
    legend: {
      top: 47, left: 10, itemWidth: 24, itemHeight: 3, icon: "roundRect", selectedMode: true,
      textStyle: { color: "#cce5f0", fontSize: 11, fontWeight: 550, textShadowBlur: 5, textShadowColor: "rgba(0,8,20,.9)" }, itemGap: 22,
      data: ["总开有功", "初始光伏", "校正后光伏", "分站反馈", "剩余负荷"],
    },
    tooltip: {
      trigger: "axis", confine: true, backgroundColor: "rgba(3, 12, 28, .97)", borderColor: "rgba(86, 224, 255, .58)",
      axisPointer: { type: "line", lineStyle: { color: "rgba(111,231,255,.68)", width: 1, type: "dashed", shadowBlur: 8, shadowColor: COLOR.cyan } },
      textStyle: { color: "#f5fbff", fontSize: 12, fontWeight: 550 }, extraCssText: "box-shadow:0 20px 58px rgba(0,0,0,.52),0 0 24px rgba(25,211,255,.09);backdrop-filter:blur(18px);border-radius:8px;",
      formatter: (items: unknown) => {
        const array = items as Array<{ axisValue: number }>;
        const time = array[0]?.axisValue; const row = resultMap.get(Number(time));
        const minute = minuteMap.get(Number(time));
        if (!row) return minute
          ? `<div class="chart-tip"><b>${dateTimeText(minute.event_time)}</b><span>光伏分离结果尚未生成</span></div><div class="tip-grid"><i>总开有功</i><em>${powerText(minute.active_power_kw)} kW</em><i>数据质量</i><em>${minute.quality_flag}</em></div>`
          : "";
        const batch = snapshot.feedback_batches.find((item) => item.batch_id === row.batch_id);
        return `<div class="chart-tip"><b>${dateTimeText(row.event_time)}</b><span>${row.result_status}</span></div>
          <div class="tip-grid"><i>生成时间</i><em>${timeText(row.separation_time, true)}</em><i>到达时间</i><em>${batch ? timeText(batch.arrival_time, true) : "等待回传"}</em>
          <i>台区总功率</i><em>${powerText(row.total_power_kw)} kW</em><i>初始光伏</i><em class="blue">${powerText(row.initial_pv_kw)} kW</em>
          <i>校正后光伏</i><em class="green">${powerText(row.corrected_pv_kw)} kW</em><i>分站参考</i><em class="amber">${powerText(row.station_feedback_value)} kW</em>
          <i>反馈状态</i><em>${row.feedback_status}</em><i>置信度</i><em>${percentText(row.confidence)}</em>
          <i>模型</i><em>${row.model_version}</em><i>批次</i><em>${row.batch_id ?? "—"}</em></div>`;
      },
    },
    xAxis: {
      type: "time", min: mainSwitch[0] ? new Date(mainSwitch[0].event_time).getTime() : visible[0] ? new Date(visible[0].event_time).getTime() : undefined, max: now + 20 * 60_000,
      axisLine: { lineStyle: { color: "rgba(111,186,228,.34)" } }, axisTick: { show: false },
      axisLabel: { color: "#b7d2e0", fontSize: 11, fontWeight: 550, formatter: (value: number) => axisTimeText(value) },
      splitLine: { show: true, lineStyle: { color: "rgba(92,164,205,.105)", type: "dashed" } },
    },
    yAxis: {
      type: "value", name: "功率 (kW)", min: yAxisScale.min, max: yAxisScale.max, interval: yAxisScale.interval,
      nameTextStyle: { color: "#bed6e3", fontSize: 11, fontWeight: 600, padding: [0, 0, 6, 0] },
      axisLabel: { color: "#b7d2e0", fontSize: 11, fontWeight: 550, formatter: powerAxisTickText },
      splitLine: { lineStyle: { color: "rgba(92,164,205,.11)" } }, axisLine: { show: false }, axisTick: { show: false },
    },
    dataZoom: [{ type: "inside", xAxisIndex: 0, filterMode: "none" }, { type: "slider", height: 8, bottom: 8, borderColor: "transparent",
      backgroundColor: "rgba(38,85,120,.22)", fillerColor: "rgba(25,211,255,.2)", dataBackground: { lineStyle: { color: "rgba(121,211,255,.46)" }, areaStyle: { color: "rgba(58,120,255,.16)" } }, selectedDataBackground: { lineStyle: { color: "#70eaff" }, areaStyle: { color: "rgba(36,245,181,.14)" } }, handleStyle: { color: "#77efff", borderColor: "rgba(220,251,255,.8)", shadowBlur: 8, shadowColor: COLOR.cyan }, showDetail: false }],
    graphic: isLongRange ? [{
      type: "text", right: 304, top: 74, z: 20, silent: true,
      style: { text: "等待反馈区", fill: "#ffd584", font: "700 12px HarmonyOS Sans SC, Microsoft YaHei, sans-serif", backgroundColor: "rgba(42,28,9,.86)", borderColor: "rgba(255,193,92,.58)", borderWidth: 1, borderRadius: 3, padding: [4, 7], shadowBlur: 10, shadowColor: "rgba(255,184,77,.28)" },
    }] : [],
    series: [
      { ...line("总开有功", "#e5f6ff", 1.9), data: mainSwitch.map((point) => [new Date(point.event_time).getTime(), point.active_power_kw]),
        sampling: sevenDaySampling,
        areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: "rgba(151,220,255,.34)" }, { offset: .42, color: "rgba(58,120,255,.12)" }, { offset: 1, color: "rgba(15,74,124,.01)" }] } },
        markArea: { silent: true, label: { show: true, position: "insideTop", fontSize: 15, fontWeight: 700, padding: [5, 10], borderRadius: 3, textShadowBlur: 8, textShadowColor: "rgba(0,8,20,.9)" }, data: [
          [{ name: "已校正区", xAxis: visible[0] ? new Date(visible[0].event_time).getTime() : now, itemStyle: { color: "rgba(36,245,181,.095)", borderColor: "rgba(79,246,184,.28)", borderWidth: 1 }, label: { color: "#8affd6", backgroundColor: "rgba(3,31,34,.78)", borderColor: "rgba(79,246,184,.42)", borderWidth: 1, position: "insideTop", textShadowBlur: 12, textShadowColor: "rgba(36,245,181,.34)" } }, { xAxis: correctedEnd }],
          [{ name: "等待反馈区", xAxis: correctedEnd, itemStyle: { color: "rgba(255,184,77,.125)", borderColor: "rgba(255,193,92,.36)", borderWidth: 1, decal: { symbol: "rect", symbolSize: 1, color: "rgba(255,205,119,.12)", dashArrayX: [1, 0], dashArrayY: [4, 7], rotation: -.72 } }, label: { show: range === "1h", color: "#ffd584", backgroundColor: "rgba(42,28,9,.84)", borderColor: "rgba(255,193,92,.58)", borderWidth: 1, position: "insideTop", align: "center", fontSize: 15, padding: [5, 10], textShadowBlur: 12, textShadowColor: "rgba(255,184,77,.3)" } }, { xAxis: realtimeStart }],
          [{ name: "实时初始区", xAxis: realtimeStart, itemStyle: { color: "rgba(58,120,255,.16)", borderColor: "rgba(91,159,255,.58)", borderWidth: 1 }, label: { show: false } }, { xAxis: now }],
        ] },
        markLine: { silent: true, symbol: "none", label: { color: "#d7f7ff", fontSize: 10, fontWeight: 650, padding: [3, 6], backgroundColor: "rgba(3,15,31,.78)", borderRadius: 3, textShadowBlur: 8, textShadowColor: "#020814", rotate: 0 },
          lineStyle: { width: 1, type: "dashed" }, data: [
            { xAxis: correctedEnd, lineStyle: { color: "rgba(73,246,183,.72)", width: 1, shadowBlur: 9, shadowColor: COLOR.green }, label: { show: false } },
            { xAxis: realtimeStart, lineStyle: { color: "rgba(255,193,92,.7)", width: 1, type: "dashed", shadowBlur: 8, shadowColor: COLOR.amber }, label: { show: false } },
            { xAxis: now, lineStyle: { color: "#65eaff", width: 2, shadowBlur: 18, shadowColor: COLOR.cyan }, label: { show: true, formatter: `NOW\n${timeText(snapshot.now)}`, color: "#6decff", fontSize: 12, fontWeight: 750, borderColor: "rgba(101,234,255,.46)", borderWidth: 1, position: "insideEndBottom" } },
          ] } },
      { ...line("初始光伏", "#4d89ff", 1.65), z: 4, sampling: sevenDaySampling, data: visible.map((row) => [new Date(row.event_time).getTime(), row.initial_pv_kw]) },
      { ...line("校正后光伏", "#4ff6b8", 2.2), z: 6, sampling: sevenDaySampling, connectNulls: false, data: visible.map((row) => [new Date(row.event_time).getTime(), row.corrected_pv_kw]),
        areaStyle: { color: "rgba(36,245,181,.065)" } },
      { ...line("剩余负荷", COLOR.violet, 1.2), sampling: sevenDaySampling, lineStyle: { color: COLOR.violet, width: 1.2, type: "dashed", opacity: .74 }, data: visible.map((row) => [new Date(row.event_time).getTime(), row.remaining_load_kw]) },
      { name: "分站反馈", type: "line", step: "end", symbol: "diamond", symbolSize: range === "7d" ? 6 : 9, showSymbol: true,
        itemStyle: { color: "#ffc15c", borderColor: "#ffe2a8", borderWidth: 1, shadowBlur: range === "7d" ? 0 : 14, shadowColor: COLOR.amber }, lineStyle: { color: "#ffc15c", width: 1.3, type: "dashed", shadowBlur: range === "7d" ? 0 : 8, shadowColor: COLOR.amber }, data: feedback },
      ...(range === "6h" ? [{ name: "等待反馈区标注", type: "scatter" as const, silent: true, z: 20, symbolSize: 1,
        itemStyle: { color: "rgba(0,0,0,0)" }, data: [[(correctedEnd + realtimeStart) / 2, waitingLabelY]],
        label: { show: true, formatter: "等待反馈区", position: "bottom" as const, distance: 10, color: "#ffd584", fontSize: 13, fontWeight: 700, backgroundColor: "rgba(42,28,9,.86)", borderColor: "rgba(255,193,92,.58)", borderWidth: 1, borderRadius: 3, padding: [4, 7], textShadowBlur: 10, textShadowColor: "rgba(255,184,77,.3)" } }] : []),
    ],
  }), [visible, mainSwitch, feedback, now, correctedEnd, realtimeStart, isLongRange, waitingLabelY, yAxisScale, resultMap, minuteMap, snapshot, range]);

  const handleClick = useCallback((params: unknown) => {
    const point = params as { data?: [number, number] }; const timestamp = Number(point.data?.[0]);
    const result = resultMap.get(timestamp); if (result) onSelect(result);
  }, [resultMap, onSelect]);

  return <EChart key={range} option={option} onClick={handleClick} className="power-chart" ariaLabel="台区总功率与光伏功率分离核心曲线" />;
}
