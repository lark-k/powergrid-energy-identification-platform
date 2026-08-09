import { useEffect, useRef } from "react";
import { init, use, type EChartsType } from "echarts/core";
import { EffectScatterChart, LineChart, LinesChart, ScatterChart } from "echarts/charts";
import { DataZoomComponent, GraphicComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";

use([LineChart, LinesChart, ScatterChart, EffectScatterChart, DataZoomComponent, GraphicComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent, CanvasRenderer]);

interface EChartProps {
  option: EChartsOption;
  className?: string;
  onClick?: (params: unknown) => void;
  preserveTooltipOnUpdate?: boolean;
  ariaLabel: string;
}

type AxisPointerEvent = { axesInfo?: Array<{ axisDim?: string; value?: number | string }> };
type SeriesHoverEvent = { value?: unknown };

const timestampFromValue = (value: unknown) => Array.isArray(value) ? Number(value[0]) : Number.NaN;

const findTimestamp = (option: EChartsOption, timestamp: number) => {
  const series = Array.isArray(option.series) ? option.series : option.series ? [option.series] : [];
  for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex += 1) {
    const data = (series[seriesIndex] as { data?: unknown[] }).data;
    const dataIndex = data?.findIndex((point) => timestampFromValue(point) === timestamp) ?? -1;
    if (dataIndex >= 0) return { seriesIndex, dataIndex };
  }
  return null;
};

export function EChart({ option, className, onClick, preserveTooltipOnUpdate = false, ariaLabel }: EChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const pointerInsideRef = useRef(false);
  const hoveredTimestampRef = useRef<number | null>(null);
  const restoreFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = init(ref.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const rememberAxisPointer = (event: AxisPointerEvent) => {
      if (!pointerInsideRef.current) return;
      const value = event.axesInfo?.find((axis) => axis.axisDim === "x")?.value;
      const timestamp = Number(value);
      if (Number.isFinite(timestamp)) hoveredTimestampRef.current = timestamp;
    };
    const rememberSeriesPoint = (event: SeriesHoverEvent) => {
      if (!pointerInsideRef.current) return;
      const timestamp = timestampFromValue(event.value);
      if (Number.isFinite(timestamp)) hoveredTimestampRef.current = timestamp;
    };
    chart.on("updateAxisPointer", rememberAxisPointer);
    chart.on("mouseover", rememberSeriesPoint);
    const resize = new ResizeObserver(() => { if (!chart.isDisposed()) chart.resize(); });
    resize.observe(ref.current);
    return () => {
      resize.disconnect();
      if (restoreFrameRef.current != null) window.cancelAnimationFrame(restoreFrameRef.current);
      if (!chart.isDisposed()) { chart.off("click"); chart.off("updateAxisPointer", rememberAxisPointer); chart.off("mouseover", rememberSeriesPoint); chart.dispose(); }
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || chart.isDisposed()) return;
    chart.setOption(option, { notMerge: true, lazyUpdate: true });
    if (!preserveTooltipOnUpdate || !pointerInsideRef.current || hoveredTimestampRef.current == null) return;
    const target = findTimestamp(option, hoveredTimestampRef.current);
    if (!target) return;
    if (restoreFrameRef.current != null) window.cancelAnimationFrame(restoreFrameRef.current);
    restoreFrameRef.current = window.requestAnimationFrame(() => {
      restoreFrameRef.current = null;
      if (!chart.isDisposed() && pointerInsideRef.current) chart.dispatchAction({ type: "showTip", ...target });
    });
  }, [option, preserveTooltipOnUpdate]);
  useEffect(() => {
    const chart = chartRef.current; if (!chart || !onClick) return;
    chart.on("click", onClick);
    return () => { if (!chart.isDisposed()) chart.off("click", onClick); };
  }, [onClick]);

  return <div ref={ref} className={className} role="img" aria-label={ariaLabel}
    onPointerEnter={() => { pointerInsideRef.current = true; }}
    onPointerLeave={() => { pointerInsideRef.current = false; hoveredTimestampRef.current = null; }} />;
}
