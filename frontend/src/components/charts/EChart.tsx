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
  ariaLabel: string;
}

export function EChart({ option, className, onClick, ariaLabel }: EChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = init(ref.current, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const resize = new ResizeObserver(() => { if (!chart.isDisposed()) chart.resize(); });
    resize.observe(ref.current);
    return () => { resize.disconnect(); if (!chart.isDisposed()) { chart.off("click"); chart.dispose(); } chartRef.current = null; };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || chart.isDisposed()) return;
    chart.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);
  useEffect(() => {
    const chart = chartRef.current; if (!chart || !onClick) return;
    chart.on("click", onClick);
    return () => { if (!chart.isDisposed()) chart.off("click", onClick); };
  }, [onClick]);

  return <div ref={ref} className={className} role="img" aria-label={ariaLabel} />;
}
