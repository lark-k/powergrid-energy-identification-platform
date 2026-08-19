import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { ArrowsOut } from "@phosphor-icons/react";
import { EChart } from "../../components/charts/EChart";
import { powerAxisScale, powerAxisTickText } from "../separation/chartData";
import { powerText } from "../../utils/format";

export interface SignalPoint {
  at: string;
  value: number;
}

interface SignalMiniChartProps {
  title: string;
  tone: "cyan" | "green" | "violet" | "amber";
  unit?: string;
  data: SignalPoint[];
  conclusion: string;
  onSelect?: (at: string) => void;
  onOpen?: () => void;
}

const toneColor = {
  cyan: "#62d9ff",
  green: "#54efad",
  violet: "#bd7cff",
  amber: "#ffc45f",
} as const;

const clickTime = (params: unknown) => {
  const value = (params as { value?: unknown })?.value;
  if (!Array.isArray(value)) return null;
  const timestamp = Number(value[0]);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
};

export function SignalMiniChart({ title, tone, unit = "kW", data, conclusion, onSelect, onOpen }: SignalMiniChartProps) {
  const color = toneColor[tone];
  const latest = data.at(-1)?.value ?? null;
  const option = useMemo<EChartsOption>(() => {
    const values = data.map((point) => point.value);
    const scale = powerAxisScale(values);
    return {
      animation: true,
      animationDuration: 800,
      animationDurationUpdate: 380,
      animationEasing: "cubicOut",
      grid: { left: 48, right: 12, top: 10, bottom: 28 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(4, 17, 34, .96)",
        borderColor: `${color}66`,
        textStyle: { color: "#ecf9ff", fontSize: 13 },
        formatter: (items: unknown) => {
          const item = (Array.isArray(items) ? items[0] : items) as { value?: unknown } | undefined;
          const value = item?.value;
          if (!Array.isArray(value)) return "";
          return `${new Date(Number(value[0])).toLocaleString("zh-CN", { hour12: false })}<br/><b>${powerText(Number(value[1]))} ${unit}</b>`;
        },
      },
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: "rgba(130, 184, 214, .28)" } },
        axisTick: { show: false },
        axisLabel: { color: "#85a9bc", fontSize: 11, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        min: scale.min,
        max: scale.max,
        interval: scale.interval,
        axisLabel: { color: "#7898aa", fontSize: 10, formatter: powerAxisTickText },
        splitLine: { lineStyle: { color: "rgba(125, 176, 205, .12)" } },
      },
      series: [{
        type: "line",
        showSymbol: false,
        smooth: 0.22,
        connectNulls: false,
        data: data.map((point) => [new Date(point.at).getTime(), point.value]),
        lineStyle: { color, width: 2 },
        areaStyle: { color: `${color}18` },
        emphasis: { lineStyle: { width: 3 } },
      }],
    };
  }, [color, data, unit]);

  return <article className={`signal-card ${tone} ${onOpen ? "is-openable" : ""}`} role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined}
    onClick={onOpen} onKeyDown={(event) => { if (onOpen && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpen(); } }}>
    <header>
      <div><span>{title}</span><small>单位：{unit}</small></div>
      <strong>{latest == null ? "—" : powerText(latest)}</strong>
    </header>
    {data.length ? <EChart
      option={option}
      className="signal-chart"
      ariaLabel={`${title}历史趋势`}
      preserveTooltipOnUpdate
      onClick={(params) => { const at = clickTime(params); if (at) onSelect?.(at); }}
    /> : <div className="signal-empty">当前时间窗口暂无真实数据</div>}
    <footer><i />{conclusion}{onOpen && <span className="signal-open-hint"><ArrowsOut />查看详情</span>}</footer>
  </article>;
}
