import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { COLOR, SYSTEM_CONFIG } from "../../config/system";
import type { StationSnapshot, TimeRange } from "../../types/domain";
import { timeText } from "../../utils/format";
import { EChart } from "../../components/charts/EChart";

export function FeedbackTimeline({ snapshot, range }: { snapshot: StationSnapshot; range: TimeRange }) {
  const option = useMemo<EChartsOption>(() => {
    const now = new Date(snapshot.now).getTime();
    const start = now - SYSTEM_CONFIG.timeRanges[range] * 60_000;
    const isSevenDays = range === "7d";
    const batches = snapshot.feedback_batches.filter((batch) => new Date(batch.arrival_time).getTime() >= start);
    const eventPoints = batches.map((batch) => [new Date(batch.coverage_end).getTime(), 0, batch.batch_id, batch.coverage_start]);
    const arrivalPoints = batches.map((batch) => [new Date(batch.arrival_time).getTime(), 1, batch.batch_id]);
    const coverageBars = batches.map((batch) => ({ coords: [
      [new Date(batch.coverage_start).getTime(), 0],
      [new Date(batch.coverage_end).getTime(), 0],
    ] }));
    const delayLinks = batches.map((batch) => ({ coords: [
      [new Date(batch.coverage_end).getTime(), 0],
      [new Date(batch.arrival_time).getTime(), 1],
    ] }));
    const latest = batches.at(-1);
    return {
      animation: !isSevenDays,
      animationDuration: isSevenDays ? 0 : 350,
      textStyle: { color: "#dff3fb", fontFamily: "JetBrains Mono, HarmonyOS Sans SC, Microsoft YaHei UI, Microsoft YaHei, sans-serif", fontWeight: 500 },
      grid: { left: 100, right: 16, top: 20, bottom: 4 },
      tooltip: { trigger: "item", confine: true, backgroundColor: "rgba(3,12,28,.98)", borderColor: "rgba(255,194,92,.7)", textStyle: { color: "#f6fbff", fontSize: 11, fontWeight: 550 }, extraCssText: "box-shadow:0 16px 42px rgba(0,0,0,.48),0 0 18px rgba(255,184,77,.08);border-radius:7px;" },
      xAxis: { type: "time", min: start, max: now + 20 * 60_000, axisLabel: { show: false }, axisLine: { lineStyle: { color: "rgba(84,171,220,.36)", shadowBlur: isSevenDays ? 0 : 7, shadowColor: COLOR.cyan } }, splitLine: { show: false }, axisTick: { show: false } },
      yAxis: { type: "category", data: ["事件时间轴", "到达时间轴"], inverse: true, axisLabel: { color: (value?: string | number) => value === "到达时间轴" ? "#ffd078" : "#79efff", fontSize: 11, fontWeight: 650, textShadowBlur: 6, textShadowColor: "rgba(0,8,20,.9)" }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } },
      series: [
        { name: "历史覆盖区间", type: "lines", coordinateSystem: "cartesian2d", polyline: false, data: coverageBars, lineStyle: { color: "#55e6ff", width: isSevenDays ? 1 : 2, opacity: isSevenDays ? .44 : .72, shadowBlur: isSevenDays ? 0 : 8, shadowColor: COLOR.cyan }, silent: true },
        { name: "反馈延迟", type: "lines", coordinateSystem: "cartesian2d", polyline: false, data: delayLinks, lineStyle: { color: "#ffc15c", width: isSevenDays ? .7 : 1.2, opacity: isSevenDays ? .44 : .72, type: "dashed", curveness: 0, shadowBlur: isSevenDays ? 0 : 7, shadowColor: COLOR.amber }, silent: true },
        { name: "event_time", type: "scatter", data: eventPoints, symbol: "diamond", symbolSize: isSevenDays ? 4 : 7, itemStyle: { color: COLOR.cyan, shadowBlur: isSevenDays ? 0 : 8, shadowColor: COLOR.cyan }, tooltip: { formatter: (params: unknown) => { const p = params as { data: [number, number, string, string] }; return `历史覆盖 · ${p.data[2]}<br/>event_time ${timeText(p.data[3])}—${timeText(new Date(p.data[0]))}`; } },
          markArea: latest ? { silent: true, itemStyle: { color: "rgba(255,184,77,.09)", borderColor: "rgba(255,184,77,.55)", borderWidth: 1 }, label: { show: false }, data: [[{ xAxis: new Date(latest.coverage_start).getTime() }, { xAxis: new Date(latest.coverage_end).getTime() }]] } : undefined },
        { name: "arrival_time", type: isSevenDays ? "scatter" : "effectScatter", data: arrivalPoints, symbol: "diamond", symbolSize: isSevenDays ? 4 : 8, rippleEffect: isSevenDays ? undefined : { scale: 2.5, brushType: "stroke" }, itemStyle: { color: "#ffc15c", borderColor: "#ffe3ab", borderWidth: 1, shadowBlur: isSevenDays ? 0 : 14, shadowColor: COLOR.amber },
          tooltip: { formatter: (params: unknown) => { const p = params as { data: [number, number, string] }; return `批次到达 · ${p.data[2]}<br/>arrival_time ${timeText(new Date(p.data[0]), true)}`; } } },
      ],
    };
  }, [snapshot, range]);
  return <EChart key={range} option={option} className="feedback-timeline" ariaLabel="事件时间与反馈到达时间双时间轴" />;
}
