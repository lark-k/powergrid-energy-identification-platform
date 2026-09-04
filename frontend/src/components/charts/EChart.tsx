import { useCallback, useEffect, useRef } from "react";
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
  freezeUpdatesOnHover?: boolean;
  preserveDataZoomOnUpdate?: boolean;
  onDataZoomChange?: () => void;
  ariaLabel: string;
}

type AxisPointerEvent = { axesInfo?: Array<{ axisDim?: string; value?: number | string }> };
type SeriesHoverEvent = { value?: unknown };
type DataZoomState = { start?: number; end?: number; startValue?: number | string; endValue?: number | string };
type TooltipTarget = { seriesIndex: number; dataIndex: number };

const timestampFromValue = (value: unknown) => Array.isArray(value) ? Number(value[0]) : Number.NaN;

export const findTooltipTarget = (option: EChartsOption, timestamp: number): TooltipTarget | null => {
  const series = Array.isArray(option.series) ? option.series : option.series ? [option.series] : [];
  for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex += 1) {
    const data = (series[seriesIndex] as { data?: unknown[] }).data;
    const dataIndex = data?.findIndex((point) => timestampFromValue(point) === timestamp) ?? -1;
    if (dataIndex >= 0) return { seriesIndex, dataIndex };
  }
  return null;
};

export const tooltipRestoreAction = ([x, y]: [number, number], target: TooltipTarget) => ({
  type: "showTip" as const,
  ...target,
  x,
  y,
});

export const shouldFreezeOptionUpdate = (freezeUpdatesOnHover: boolean, pointerInside: boolean, hoveredTimestamp: number | null) =>
  freezeUpdatesOnHover && pointerInside && hoveredTimestamp !== null;

export function EChart({ option, className, onClick, preserveTooltipOnUpdate = false, freezeUpdatesOnHover = false, preserveDataZoomOnUpdate = false, onDataZoomChange, ariaLabel }: EChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);
  const pointerInsideRef = useRef(false);
  const pointerPositionRef = useRef<[number, number] | null>(null);
  const hoveredTimestampRef = useRef<number | null>(null);
  const restoreFrameRef = useRef<number | null>(null);
  const zoomRestoreFrameRef = useRef<number | null>(null);
  const dataZoomStateRef = useRef<DataZoomState | null>(null);
  const pendingOptionRef = useRef<EChartsOption | null>(null);

  const applyOption = useCallback((nextOption: EChartsOption) => {
    const chart = chartRef.current;
    if (!chart || chart.isDisposed()) return;
    const savedZoom = dataZoomStateRef.current;
    chart.setOption(nextOption, { notMerge: true, lazyUpdate: true });
    if (preserveDataZoomOnUpdate && savedZoom) {
      if (zoomRestoreFrameRef.current != null) window.cancelAnimationFrame(zoomRestoreFrameRef.current);
      zoomRestoreFrameRef.current = window.requestAnimationFrame(() => {
        zoomRestoreFrameRef.current = null;
        if (chart.isDisposed()) return;
        const range = savedZoom.startValue != null && savedZoom.endValue != null
          ? { startValue: savedZoom.startValue, endValue: savedZoom.endValue }
          : { start: savedZoom.start, end: savedZoom.end };
        chart.dispatchAction({ type: "dataZoom", dataZoomIndex: 0, ...range });
      });
    }
  }, [preserveDataZoomOnUpdate]);

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
    const rememberDataZoom = () => {
      if (!preserveDataZoomOnUpdate) return;
      const current = chart.getOption().dataZoom;
      const first = (Array.isArray(current) ? current[0] : current) as DataZoomState | undefined;
      if (first) dataZoomStateRef.current = { start: first.start, end: first.end, startValue: first.startValue, endValue: first.endValue };
      onDataZoomChange?.();
    };
    chart.on("updateAxisPointer", rememberAxisPointer);
    chart.on("mouseover", rememberSeriesPoint);
    chart.on("datazoom", rememberDataZoom);
    const resize = new ResizeObserver(() => { if (!chart.isDisposed()) chart.resize(); });
    resize.observe(ref.current);
    return () => {
      resize.disconnect();
      if (restoreFrameRef.current != null) window.cancelAnimationFrame(restoreFrameRef.current);
      if (zoomRestoreFrameRef.current != null) window.cancelAnimationFrame(zoomRestoreFrameRef.current);
      if (!chart.isDisposed()) { chart.off("click"); chart.off("updateAxisPointer", rememberAxisPointer); chart.off("mouseover", rememberSeriesPoint); chart.off("datazoom", rememberDataZoom); chart.dispose(); }
      chartRef.current = null;
    };
  }, [onDataZoomChange, preserveDataZoomOnUpdate]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || chart.isDisposed()) return;
    if (shouldFreezeOptionUpdate(freezeUpdatesOnHover, pointerInsideRef.current, hoveredTimestampRef.current)) {
      pendingOptionRef.current = option;
      return;
    }
    pendingOptionRef.current = null;
    applyOption(option);
    if (!preserveTooltipOnUpdate || !pointerInsideRef.current || hoveredTimestampRef.current == null) return;
    const position = pointerPositionRef.current;
    const target = findTooltipTarget(option, hoveredTimestampRef.current);
    if (!position || !target) return;
    if (restoreFrameRef.current != null) window.cancelAnimationFrame(restoreFrameRef.current);
    restoreFrameRef.current = window.requestAnimationFrame(() => {
      restoreFrameRef.current = null;
      if (!chart.isDisposed() && pointerInsideRef.current) chart.dispatchAction(tooltipRestoreAction(position, target));
    });
  }, [applyOption, freezeUpdatesOnHover, option, preserveTooltipOnUpdate]);
  useEffect(() => {
    const chart = chartRef.current; if (!chart || !onClick) return;
    chart.on("click", onClick);
    return () => { if (!chart.isDisposed()) chart.off("click", onClick); };
  }, [onClick]);

  return <div ref={ref} className={className} role="img" aria-label={ariaLabel}
    onPointerEnter={() => { pointerInsideRef.current = true; }}
    onPointerMove={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      pointerPositionRef.current = [event.clientX - rect.left, event.clientY - rect.top];
    }}
    onPointerLeave={() => {
      pointerInsideRef.current = false;
      pointerPositionRef.current = null;
      hoveredTimestampRef.current = null;
      const pendingOption = pendingOptionRef.current;
      pendingOptionRef.current = null;
      if (pendingOption) applyOption(pendingOption);
    }} />;
}
