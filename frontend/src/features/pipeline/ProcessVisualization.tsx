import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  Brain,
  Broadcast,
  CheckCircle,
  ClockCounterClockwise,
  CloudArrowUp,
  Database,
  Funnel,
  HardDrives,
  Pulse,
  SealCheck,
  ShieldCheck,
  SlidersHorizontal,
  Stack,
  X,
} from "@phosphor-icons/react";
import type { EChartsOption } from "echarts";
import { EChart } from "../../components/charts/EChart";
import { processAdapter } from "../../services/processAdapter";
import type {
  CollectionProcessTelemetry,
  ProcessDataSource,
  ProcessStepStatus,
  StationSnapshot,
  TrainingProcessRun,
} from "../../types/domain";
import { percentText } from "../../utils/format";

export type VisualizedStage = "collection" | "training";

interface ProcessVisualizationProps {
  mode: VisualizedStage;
  snapshot: StationSnapshot;
  onModeChange: (mode: VisualizedStage) => void;
  onClose: () => void;
}

const timeText = (value: string) => new Date(value).toLocaleTimeString("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const dateTimeText = (value: string) => new Date(value).toLocaleString("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const axisLabel = {
  color: "#7897aa",
  fontSize: 9,
  fontFamily: "JetBrains Mono, Consolas, monospace",
};

const stepStateText: Record<ProcessStepStatus, string> = {
  waiting: "等待中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
};

function ProcessSteps({
  mode,
  steps,
}: {
  mode: VisualizedStage;
  steps: Array<{ step_id: string; name: string; description: string; status: ProcessStepStatus }>;
}) {
  const icons = mode === "collection"
    ? [Broadcast, ClockCounterClockwise, ShieldCheck, HardDrives]
    : [Stack, Funnel, SlidersHorizontal, Brain, SealCheck];

  return (
    <div className={`process-steps ${mode}`} aria-label={mode === "collection" ? "采集处理链路" : "离线训练处理链路"}>
      {steps.map((step, index) => {
        const Icon = icons[index] ?? Database;
        return (
        <div className="process-step-slot" key={step.step_id}>
          <div className={`process-step ${step.status}`}>
            <span className="process-step-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="process-step-icon"><Icon weight="duotone" /></span>
            <b>{step.name}</b>
            <small>{step.description}</small>
            <span className="process-step-state">
              <CheckCircle weight="fill" />
              {stepStateText[step.status]}
            </span>
          </div>
          {index < steps.length - 1 && (
            <span className="process-connector" aria-hidden="true">
              <i />
              <ArrowRight weight="bold" />
            </span>
          )}
        </div>
      )})}
    </div>
  );
}

function CollectionView({ telemetry }: { telemetry: CollectionProcessTelemetry }) {
  const onlineSources = telemetry.sources.filter((source) => source.status === "online").length;
  const totalReceived = telemetry.sources.reduce((sum, source) => sum + source.received_count, 0);
  const minuteSource = telemetry.sources.find((source) => source.source_id === "main_switch");
  const feedbackSource = telemetry.sources.find((source) => source.source_id === "pv_feedback" || source.source_id === "pv-substations");
  const signalOption = useMemo<EChartsOption>(() => {
    const points = telemetry.signal;
    return {
      animationDuration: 700,
      grid: { left: 8, right: 12, top: 28, bottom: 4, containLabel: true },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(3, 15, 32, .96)",
        borderColor: "rgba(25, 211, 255, .35)",
        textStyle: { color: "#dff8ff", fontSize: 10 },
        formatter: (items: unknown) => {
          const list = items as Array<{ axisValueLabel: string; value: number }>;
          const item = list[0];
          return item ? `${item.axisValueLabel}<br/>总开功率　${Number(item.value).toLocaleString()} kW` : "";
        },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: points.map((point) => timeText(point.at).slice(0, 5)),
        axisLine: { lineStyle: { color: "rgba(104, 160, 190, .2)" } },
        axisTick: { show: false },
        axisLabel: { ...axisLabel, interval: 6 },
      },
      yAxis: {
        type: "value",
        scale: true,
        splitNumber: 3,
        axisLabel: { ...axisLabel, formatter: (value: number) => `${Math.round(value / 1000)}k` },
        splitLine: { lineStyle: { color: "rgba(103, 158, 190, .1)", type: "dashed" } },
      },
      series: [{
        type: "line",
        data: points.map((point) => point.value),
        showSymbol: false,
        smooth: 0.28,
        lineStyle: { color: "#4be7ff", width: 2, shadowColor: "rgba(25, 211, 255, .5)", shadowBlur: 8 },
        areaStyle: { color: "rgba(25, 211, 255, .08)" },
      }],
    };
  }, [telemetry.signal]);

  return (
    <>
      <div className="process-kpis">
        <div><span>接入源</span><strong>{onlineSources}<small> / {telemetry.sources.length} 在线</small></strong></div>
        <div><span>分钟序列</span><strong>{(minuteSource?.received_count ?? 0).toLocaleString()}<small> 条</small></strong></div>
        <div><span>分站反馈</span><strong>{(feedbackSource?.received_count ?? 0).toLocaleString()}<small> 条</small></strong></div>
        <div className="accent"><span>数据完整率</span><strong>{percentText(telemetry.quality.completeness_ratio)}</strong></div>
      </div>
      <ProcessSteps mode="collection" steps={telemetry.steps} />
      <div className="collection-detail-grid">
        <section className="process-panel source-panel">
          <header><span><Database weight="duotone" />接入源矩阵</span><small>LIVE SOURCES</small></header>
          <div className="source-grid">
            {telemetry.sources.map((source) => (
              <div key={source.source_id}>
                <i className={`source-pulse ${source.status === "online" ? "" : "warning"}`} />
                <span>{source.name}</span>
                <b>{source.cadence}</b>
                <small>{source.fields.join(" / ")}</small>
              </div>
            ))}
          </div>
          <div className="quality-list">
            <span><i />已处理<b>{totalReceived.toLocaleString()}</b></span>
            <span><i className={telemetry.quality.missing_count ? "warning" : ""} />缺失数据<b>{telemetry.quality.missing_count}</b></span>
            <span><i className={telemetry.quality.out_of_order_count ? "warning" : ""} />乱序数据<b>{telemetry.quality.out_of_order_count}</b></span>
          </div>
        </section>
        <section className="process-panel signal-panel">
          <header><span><Pulse weight="duotone" />总开原始信号</span><small>LAST 42 MINUTES</small></header>
          <EChart option={signalOption} className="process-chart" ariaLabel="最近四十二分钟总开原始功率信号" />
        </section>
        <section className="process-panel event-panel">
          <header><span><ClockCounterClockwise weight="duotone" />实时事件流</span><small>EVENT STREAM</small></header>
          <div className="event-stream">
            {telemetry.events.map((event, index) => (
              <div key={event.event_id}>
                <time>{timeText(event.at)}</time>
                <i className={index === 0 ? "active" : event.level === "warning" ? "warning" : ""} />
                <span><b>{event.label}</b><small>{event.detail}</small></span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function TrainingView({ run }: { run: TrainingProcessRun }) {
  const convergenceOption = useMemo<EChartsOption>(() => {
    const epochs = run.epochs.map((point) => `E${point.epoch}`);
    return {
      animationDuration: 1000,
      animationEasing: "cubicOut",
      grid: { left: 10, right: 12, top: 34, bottom: 5, containLabel: true },
      legend: { top: 3, right: 4, itemWidth: 12, itemHeight: 2, textStyle: { color: "#91afc1", fontSize: 9 }, data: ["验证得分", "损失"] },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(3, 15, 32, .96)",
        borderColor: "rgba(168, 121, 255, .38)",
        textStyle: { color: "#e9e0ff", fontSize: 10 },
      },
      xAxis: {
        type: "category",
        data: epochs,
        axisLine: { lineStyle: { color: "rgba(120, 98, 165, .25)" } },
        axisTick: { show: false },
        axisLabel,
      },
      yAxis: [
        { type: "value", min: 0.65, max: 1, splitNumber: 3, axisLabel: { ...axisLabel, formatter: (value: number) => `${Math.round(value * 100)}%` }, splitLine: { lineStyle: { color: "rgba(137, 107, 183, .1)", type: "dashed" } } },
        { type: "value", min: 0, max: 0.75, show: false },
      ],
      series: [
        { name: "验证得分", type: "line", data: run.epochs.map((point) => point.validation_score), smooth: 0.35, showSymbol: false, lineStyle: { color: "#b68aff", width: 2, shadowColor: "rgba(168, 121, 255, .55)", shadowBlur: 9 }, areaStyle: { color: "rgba(139, 92, 255, .08)" } },
        { name: "损失", type: "line", yAxisIndex: 1, data: run.epochs.map((point) => point.training_loss), smooth: 0.35, showSymbol: false, lineStyle: { color: "#4be7ff", width: 1.5, type: "dashed" } },
      ],
    };
  }, [run.epochs]);

  const validationScore = run.validation_score ?? 0;

  return (
    <>
      <div className="process-kpis training-kpis">
        <div><span>模型版本</span><strong>{run.model_version}</strong></div>
        <div><span>训练窗口</span><strong>{run.dataset_window_days}<small> 天</small></strong></div>
        <div><span>有效样本</span><strong>{run.sample_count.toLocaleString()}<small> 条</small></strong></div>
        <div className="accent"><span>最终验证得分</span><strong>{run.validation_score == null ? "等待接口" : percentText(run.validation_score)}</strong></div>
      </div>
      <ProcessSteps mode="training" steps={run.steps} />
      <div className="training-detail-grid">
        <section className="process-panel convergence-panel">
          <header><span><Brain weight="duotone" />训练收敛回放</span><small>OFFLINE RUN REPLAY</small></header>
          {run.epochs.length
            ? <EChart option={convergenceOption} className="process-chart" ariaLabel="最近一次离线训练收敛轨迹" />
            : <div className="process-empty"><Pulse weight="duotone" /><b>等待 epoch 指标</b><span>训练接口返回记录后将在此绘制真实收敛轨迹</span></div>}
          <p>曲线直接读取训练过程接口返回的 epoch 指标。</p>
        </section>
        <section className="process-panel release-panel">
          <header><span><CloudArrowUp weight="duotone" />版本发布清单</span><small>RELEASE GATE</small></header>
          <div className="release-score">
            <span><i style={{ "--score": `${validationScore * 100}%` } as CSSProperties} /></span>
            <strong>{run.validation_score == null ? "--" : percentText(run.validation_score)}<small>验证得分</small></strong>
          </div>
          <div className="release-checks">
            {run.release_checks.map((check) => (
              <span key={check.check_id}>
                <CheckCircle weight="fill" />{check.name}
                <b>{check.status === "passed" ? "通过" : check.status === "failed" ? "失败" : "等待"}</b>
              </span>
            ))}
          </div>
          <footer>
            <span>完成时间<time>{run.completed_at ? dateTimeText(run.completed_at) : "训练进行中"}</time></span>
            <span>发布版本<b>{run.model_version}</b></span>
          </footer>
        </section>
      </div>
    </>
  );
}

export function ProcessVisualization({ mode, snapshot, onModeChange, onClose }: ProcessVisualizationProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [collectionTelemetry, setCollectionTelemetry] = useState<CollectionProcessTelemetry | null>(null);
  const [trainingRun, setTrainingRun] = useState<TrainingProcessRun | null>(null);
  const [trainingLoaded, setTrainingLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let disposed = false;
    setLoadError(null);
    if (mode === "training") setTrainingLoaded(false);

    if (mode === "collection") {
      void processAdapter.getCollectionProcess(snapshot.station_id, new Date(snapshot.now))
        .then((telemetry) => { if (!disposed) setCollectionTelemetry(telemetry); })
        .catch(() => { if (!disposed) setLoadError("采集过程接口暂不可用"); });
      const disconnect = processAdapter.connectCollectionStream(snapshot.station_id, (telemetry) => {
        if (!disposed) setCollectionTelemetry(telemetry);
      });
      return () => {
        disposed = true;
        disconnect();
      };
    }

    void processAdapter.getLatestTrainingRun(snapshot.station_id)
      .then((run) => { if (!disposed) { setTrainingRun(run); setTrainingLoaded(true); } })
      .catch(() => { if (!disposed) setLoadError("训练过程接口暂不可用"); });
    return () => { disposed = true; };
  }, [mode, snapshot.now, snapshot.station_id]);

  const isCollection = mode === "collection";
  const currentData = isCollection ? collectionTelemetry : trainingRun;
  const currentSource: ProcessDataSource | undefined = currentData?.source;
  const sourceLabel = currentSource === "mock-api" ? "MOCK API" : currentSource === "sse" ? "SSE STREAM" : "REST API";
  const runState = isCollection
    ? collectionTelemetry?.status === "degraded" ? "链路降级" : "实时运行"
    : trainingRun?.status === "running" ? "离线训练中" : "最近一次离线训练";

  return (
    <div className={`process-visualization-backdrop ${mode}`} onMouseDown={onClose}>
      <section
        className="process-visualization"
        role="dialog"
        aria-modal="true"
        aria-labelledby="process-visualization-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="process-visualization-header">
          <div className="process-title-mark">{isCollection ? "01" : "02"}</div>
          <div>
            <span>{isCollection ? "DATA ACQUISITION" : "MODEL TRAINING"}</span>
            <h2 id="process-visualization-title">{isCollection ? "数据采集过程驾驶舱" : "模型训练过程驾驶舱"}</h2>
          </div>
          <nav className="process-mode-switch" aria-label="切换过程可视化">
            <button className={isCollection ? "active" : ""} onClick={() => onModeChange("collection")}>数据采集</button>
            <button className={!isCollection ? "active" : ""} onClick={() => onModeChange("training")}>模型训练</button>
          </nav>
          <span className="process-api-source"><CloudArrowUp weight="duotone" />PROCESS API · {sourceLabel}</span>
          <span className={`process-run-state ${isCollection ? "live" : "archived"}`}>
            <i />{runState}
          </span>
          <button ref={closeButtonRef} className="process-close" aria-label="关闭过程可视化" onClick={onClose}><X /></button>
        </header>
        <div className="process-visualization-body">
          {loadError ? (
            <div className="process-load-state error"><ShieldCheck weight="duotone" /><b>{loadError}</b><span>已保留接口容器，后端恢复后可重新打开此页面。</span></div>
          ) : isCollection && collectionTelemetry ? (
            <CollectionView telemetry={collectionTelemetry} />
          ) : !isCollection && trainingRun ? (
            <TrainingView run={trainingRun} />
          ) : !isCollection && trainingLoaded ? (
            <div className="process-load-state"><Pulse weight="duotone" /><b>暂无真实训练运行记录</b><span>training_epoch 为空，因此不绘制或推测训练曲线</span></div>
          ) : (
            <div className="process-load-state"><Pulse weight="duotone" /><b>正在连接过程数据</b><span>{isCollection ? "订阅采集遥测流…" : "读取最近一次训练运行…"}</span></div>
          )}
        </div>
      </section>
    </div>
  );
}
