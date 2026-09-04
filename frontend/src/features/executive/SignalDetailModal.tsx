import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { ArrowsOutSimple, ChartLineUp, Clock, Database, LockOpen, X } from "@phosphor-icons/react";
import { EChart } from "../../components/charts/EChart";
import { powerAxisScale, powerAxisTickText } from "../separation/chartData";
import { powerText } from "../../utils/format";
import type { SignalPoint } from "./SignalMiniChart";

export interface SignalDetailSpec {
  title: "总开有功" | "初始光伏" | "矫正后光伏" | "分站反馈";
  tone: "cyan" | "green" | "violet" | "amber";
  data: SignalPoint[];
  conclusion: string;
  unit?: string;
  streamingLabel?: string;
}

interface SignalDetailModalProps {
  spec: SignalDetailSpec;
  onSelect: (at: string) => void;
  onClose: () => void;
}

const toneColor = { cyan: "#62d9ff", green: "#54efad", violet: "#bd7cff", amber: "#ffc45f" } as const;
const processMap = {
  "总开有功": ["总开计量采集", "分钟质量检查", "因果窗口输入"],
  "初始光伏": ["功率分离推理", "初始结果生成", "等待反馈锚点"],
  "矫正后光伏": ["初始光伏结果", "分站反馈对齐", "反馈校正输出"],
  "分站反馈": ["分站异步上送", "event_time 对齐", "校正锚点入库"],
} as const;

const toTime = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });

export function SignalDetailModal({ spec, onSelect, onClose }: SignalDetailModalProps) {
  const [zoomLocked, setZoomLocked] = useState(false);
  const [zoomRevision, setZoomRevision] = useState(0);
  const color = toneColor[spec.tone];
  const unit = spec.unit ?? "kW";
  const values = spec.data.map((point) => point.value);
  const latest = values.at(-1) ?? null;
  const minimum = values.length ? Math.min(...values) : null;
  const maximum = values.length ? Math.max(...values) : null;
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const recent = spec.data.slice(-12).reverse();

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  useEffect(() => { setZoomLocked(false); }, [spec.title]);
  const lockZoom = useCallback(() => setZoomLocked(true), []);
  const unlockZoom = useCallback(() => {
    setZoomLocked(false);
    setZoomRevision((revision) => revision + 1);
  }, []);

  const option = useMemo<EChartsOption>(() => {
    const scale = powerAxisScale(values);
    return {
      animation: true,
      animationDuration: 800,
      animationDurationUpdate: 380,
      animationEasing: "cubicOut",
      animationEasingUpdate: "linear",
      grid: { left: 72, right: 30, top: 38, bottom: 78 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", lineStyle: { color: `${color}99` } },
        backgroundColor: "rgba(3, 14, 27, .98)", borderColor: `${color}88`,
        textStyle: { color: "#effaff", fontSize: 14 },
        formatter: (items: unknown) => {
          const item = (Array.isArray(items) ? items[0] : items) as { value?: unknown } | undefined;
          const value = item?.value;
          return Array.isArray(value) ? `${toTime(new Date(Number(value[0])).toISOString())}<br/><b>${powerText(Number(value[1]))} ${unit}</b>` : "";
        },
      },
      xAxis: { type: "time", axisLine: { lineStyle: { color: "rgba(130, 184, 214, .34)" } }, axisLabel: { color: "#9bb9c7", fontSize: 12, hideOverlap: true }, splitLine: { show: false } },
      yAxis: { type: "value", min: scale.min, max: scale.max, interval: scale.interval, name: unit, nameTextStyle: { color: "#8eabba" }, axisLabel: { color: "#88a8b8", fontSize: 12, formatter: powerAxisTickText }, splitLine: { lineStyle: { color: "rgba(125, 176, 205, .13)" } } },
      dataZoom: [{ type: "inside", start: 0, end: 100 }, { type: "slider", height: 26, bottom: 22, borderColor: "rgba(120,190,220,.22)", backgroundColor: "rgba(5,22,36,.7)", fillerColor: `${color}24`, handleStyle: { color } }],
      series: [{
        type: "line", showSymbol: false, smooth: 0.18, data: spec.data.map((point) => [new Date(point.at).getTime(), point.value]),
        lineStyle: { color, width: 2.8 }, areaStyle: { color: `${color}16` },
      }],
    };
  }, [color, spec.data, unit, values]);

  return <div className="signal-detail-overlay" role="dialog" aria-modal="true" aria-label={`${spec.title}曲线详细分析`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`signal-detail-shell ${spec.tone}`}>
      <header><div><ArrowsOutSimple /><span><small>曲线详细分析</small><b>{spec.title}</b></span></div><div className="signal-detail-stream"><i /><span><b>{spec.streamingLabel ?? "数据持续更新"}</b><small>与首页曲线同步推进</small></span></div><button aria-label="关闭曲线详情" onClick={onClose}><X /></button></header>
      <div className="signal-detail-kpis">
        <article><small>最新值</small><b>{latest == null ? "—" : `${powerText(latest)} ${unit}`}</b></article>
        <article><small>最大值</small><b>{maximum == null ? "—" : `${powerText(maximum)} ${unit}`}</b></article>
        <article><small>最小值</small><b>{minimum == null ? "—" : `${powerText(minimum)} ${unit}`}</b></article>
        <article><small>平均值</small><b>{average == null ? "—" : `${powerText(average)} ${unit}`}</b></article>
        <article><small>真实数据点</small><b>{spec.data.length.toLocaleString()} 条</b></article>
      </div>
      <div className="signal-detail-layout">
        <section className="signal-detail-chart-panel">
          <div className="signal-detail-caption"><ChartLineUp /><span><b>完整时间曲线</b><small>{spec.data.length ? `${toTime(spec.data[0].at)} — ${toTime(spec.data.at(-1)!.at)}` : "当前窗口暂无真实数据"}</small></span>{zoomLocked && <button type="button" className="zoom-unlock" aria-label="滑动窗口已锁定，点击解锁并恢复完整范围" onClick={unlockZoom}><LockOpen />解锁并恢复全窗口</button>}</div>
          {spec.data.length ? <EChart key={`${spec.title}-${zoomRevision}`} option={option} className="signal-detail-chart" ariaLabel={`${spec.title}完整时间曲线`} preserveTooltipOnUpdate freezeUpdatesOnHover preserveDataZoomOnUpdate onDataZoomChange={lockZoom} onClick={(params) => { const value = (params as { value?: unknown })?.value; if (Array.isArray(value)) onSelect(new Date(Number(value[0])).toISOString()); }} /> : <div className="signal-detail-empty">当前时间窗口暂无真实数据，页面不会生成模拟曲线。</div>}
        </section>
        <aside className="signal-detail-side">
          <section><h3><Database />数据处理流程</h3><div className="signal-process">{processMap[spec.title].map((step, index) => <article key={step}><span>{String(index + 1).padStart(2, "0")}</span><b>{step}</b></article>)}</div><p>{spec.conclusion}</p></section>
          <section><h3><Clock />最近数据</h3>{recent.length ? <div className="signal-recent-list">{recent.map((point) => <button key={point.at} onClick={() => onSelect(point.at)}><span>{toTime(point.at)}</span><b>{powerText(point.value)} {unit}</b></button>)}</div> : <div className="signal-detail-empty small">暂无真实记录</div>}</section>
        </aside>
      </div>
    </section>
  </div>;
}
