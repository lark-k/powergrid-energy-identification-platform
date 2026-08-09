import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  Brain,
  Broadcast,
  CheckCircle,
  ClockCounterClockwise,
  CloudArrowUp,
  Cpu,
  Database,
  Funnel,
  HardDrives,
  Pulse,
  SealCheck,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
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

const axisLabel = {
  color: "#7897aa",
  fontSize: 9,
  fontFamily: "JetBrains Mono, Consolas, monospace",
};

const trainingTaskText = (task: TrainingProcessRun["model_task"]) => task === "pv_separation" ? "光伏功率分离" : "能源特征辨识";
const trainingTaskShortText = (task: TrainingProcessRun["model_task"]) => task === "pv_separation" ? "光伏分离" : "特征辨识";
const metricText = (name: string) => name === "activity_f1" ? "光伏活动 F1" : name === "macro_f1" ? "验证 Macro F1" : "最终验证指标";

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
  steps: Array<{
    step_id: string;
    name: string;
    description: string;
    status: ProcessStepStatus;
    processed_count?: number;
    latency_ms?: number;
    progress?: number;
  }>;
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
            {step.processed_count != null && step.latency_ms != null && (
              <span className="process-step-metric">{step.processed_count.toLocaleString()} 条 · {step.latency_ms} ms</span>
            )}
            {step.progress != null && (
              <span className="process-step-progress"><i style={{ width: `${Math.round(step.progress * 100)}%` }} /></span>
            )}
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
      animationDurationUpdate: 520,
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
          <header>
            <span><Pulse weight="duotone" />总开原始信号</span>
            <span className="panel-live-tag"><i /> {timeText(telemetry.updated_at)} 更新</span>
            <small>LIVE · LAST 42 MINUTES</small>
          </header>
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

function TrainingView({
  run,
  runs,
  onRunChange,
}: {
  run: TrainingProcessRun;
  runs: TrainingProcessRun[];
  onRunChange: (runId: string) => void;
}) {
  const [visibleEpochs, setVisibleEpochs] = useState(1);

  useEffect(() => {
    setVisibleEpochs(1);
    if (run.epochs.length < 2) return;
    let timer: number | null = null;
    let cancelled = false;
    const advance = (current: number) => {
      if (cancelled) return;
      const next = current >= run.epochs.length ? 1 : current + 1;
      const delay = current >= run.epochs.length ? 3200 : 520;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        setVisibleEpochs(next);
        advance(next);
      }, delay);
    };
    advance(1);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [run.run_id, run.epochs.length]);

  const displayedEpochs = run.epochs.slice(0, visibleEpochs);
  const currentEpoch = displayedEpochs.at(-1);
  const trainingProgress = run.epochs.length ? visibleEpochs / run.epochs.length : 0;
  const activeStepIndex = Math.min(run.steps.length - 1, Math.floor(trainingProgress * run.steps.length));
  const replaySteps = run.steps.map((step, index) => ({
    ...step,
    status: index < activeStepIndex ? "completed" as const : index === activeStepIndex ? "running" as const : "waiting" as const,
    progress: index < activeStepIndex ? 1 : index === activeStepIndex ? Math.min(1, trainingProgress * run.steps.length - index) : 0,
  }));

  const convergenceOption = useMemo<EChartsOption>(() => {
    const epochs = displayedEpochs.map((point) => `E${point.epoch}`);
    const validationSeriesName = run.validation_series_name || "验证损失";
    return {
      animationDuration: 650,
      animationDurationUpdate: 420,
      animationEasing: "cubicOut",
      grid: { left: 12, right: 18, top: 42, bottom: 10, containLabel: true },
      legend: { top: 8, right: 10, itemWidth: 18, itemHeight: 3, textStyle: { color: "#a9bed0", fontSize: 10 }, data: [validationSeriesName, "训练损失"] },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(3, 15, 32, .96)",
        borderColor: "rgba(168, 121, 255, .38)",
        textStyle: { color: "#e9e0ff", fontSize: 11 },
      },
      xAxis: {
        type: "category",
        data: epochs,
        axisLine: { lineStyle: { color: "rgba(120, 98, 165, .25)" } },
        axisTick: { show: false },
        axisLabel,
      },
      yAxis: [
        { type: "value", scale: true, splitNumber: 4, axisLabel: { ...axisLabel, formatter: (value: number) => value.toFixed(value >= 1 ? 1 : 2) }, splitLine: { lineStyle: { color: "rgba(137, 107, 183, .1)", type: "dashed" } } },
        { type: "value", scale: true, show: false },
      ],
      series: [
        { name: validationSeriesName, type: "line", data: displayedEpochs.map((point) => point.validation_loss), smooth: 0.35, showSymbol: false, lineStyle: { color: "#bd8cff", width: 2.4, shadowColor: "rgba(168, 121, 255, .72)", shadowBlur: 12 }, areaStyle: { color: "rgba(139, 92, 255, .12)" } },
        { name: "训练损失", type: "line", yAxisIndex: 1, data: displayedEpochs.map((point) => point.training_loss), smooth: 0.35, showSymbol: false, lineStyle: { color: "#4be7ff", width: 1.8, type: "dashed", shadowColor: "rgba(75,231,255,.4)", shadowBlur: 8 } },
      ],
    };
  }, [displayedEpochs, run.validation_series_name]);

  const metricValue = run.metric_value ?? run.validation_score ?? 0;
  const bestValidationLoss = displayedEpochs.reduce<number | null>((best, epoch) => {
    if (epoch.validation_loss == null) return best;
    return best == null ? epoch.validation_loss : Math.min(best, epoch.validation_loss);
  }, null);

  return (
    <>
      <div className="process-kpis training-kpis">
        <div className="training-model-selector">
          <span>真实训练任务</span>
          <nav aria-label="切换真实训练任务">
            {runs.map((item) => (
              <button key={item.run_id} className={item.run_id === run.run_id ? "active" : ""} onClick={() => onRunChange(item.run_id)}>
                {trainingTaskShortText(item.model_task)}
              </button>
            ))}
          </nav>
        </div>
        <div><span>当前训练轮次</span><strong>{String(currentEpoch?.epoch ?? 0).padStart(2, "0")}<small> / {run.epochs.length} EPOCH</small></strong></div>
        <div><span>当前训练损失</span><strong>{currentEpoch?.training_loss.toFixed(3) ?? "--"}<small> LOSS</small></strong></div>
        <div><span>有效训练样本</span><strong>{run.sample_count.toLocaleString()}<small> 条</small></strong></div>
        <div className="accent"><span>{metricText(run.metric_name)}</span><strong>{percentText(metricValue)}</strong></div>
      </div>
      <ProcessSteps mode="training" steps={replaySteps} />
      <div className="training-detail-grid">
        <section className="process-panel convergence-panel">
          <header>
            <span><Brain weight="duotone" />模型收敛曲线</span>
            <span className="panel-live-tag"><i /> EPOCH {currentEpoch?.epoch ?? 0} / {run.epochs.length}</span>
            <small>REAL TRAINING HISTORY</small>
          </header>
          {run.epochs.length
            ? <EChart option={convergenceOption} className="process-chart" ariaLabel="最近一次离线训练收敛轨迹" />
            : <div className="process-empty"><Pulse weight="duotone" /><b>等待 epoch 指标</b><span>训练接口返回记录后将在此绘制真实收敛轨迹</span></div>}
          <div className="epoch-ticker" aria-live="polite">
            <span>训练进度</span>
            <i><b style={{ width: `${trainingProgress * 100}%` }} /></i>
            <strong>{Math.round(trainingProgress * 100)}%</strong>
            <small>真实训练日志逐 Epoch 回放</small>
          </div>
        </section>
        <div className="training-side-stack">
          <section className="process-panel runtime-panel">
            <header><span><Cpu weight="duotone" />训练运行监控</span><small>RUN TELEMETRY</small></header>
            <div className="runtime-focus">
              <span className="runtime-orbit"><Sparkle weight="fill" /></span>
              <div><small>{trainingTaskText(run.model_task)}</small><strong>{run.model_version}</strong><span>{run.window_size_minutes} 分钟因果窗口 · {run.sample_count.toLocaleString()} 训练样本</span></div>
            </div>
            <div className="runtime-metrics">
              <span><small>最佳验证值</small><b>{bestValidationLoss?.toFixed(3) ?? "--"}</b></span>
              <span><small>最低训练损失</small><b>{displayedEpochs.length ? Math.min(...displayedEpochs.map((item) => item.training_loss)).toFixed(3) : "--"}</b></span>
              <span><small>运行状态</small><b className="good">已完成</b></span>
            </div>
          </section>
          <section className="process-panel release-panel">
            <header><span><CloudArrowUp weight="duotone" />模型发布评估</span><small>RELEASE GATE</small></header>
            <div className="release-score">
              <span><i style={{ "--score": `${metricValue * 100}%` } as CSSProperties} /></span>
              <strong>{percentText(metricValue)}<small>{metricText(run.metric_name)}</small></strong>
            </div>
            <div className="release-checks">
              {run.release_checks.map((check) => (
                <span key={check.check_id}>
                  <CheckCircle weight="fill" />{check.name}
                  <b>{check.status === "passed" ? "通过" : check.status === "failed" ? "失败" : "等待"}</b>
                </span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export function ProcessVisualization({ mode, snapshot, onModeChange, onClose }: ProcessVisualizationProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [collectionTelemetry, setCollectionTelemetry] = useState<CollectionProcessTelemetry | null>(null);
  const [trainingRuns, setTrainingRuns] = useState<TrainingProcessRun[]>([]);
  const [selectedTrainingRunId, setSelectedTrainingRunId] = useState<string | null>(null);
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

    void processAdapter.getTrainingRuns(snapshot.station_id)
      .then((runs) => {
        if (disposed) return;
        setTrainingRuns(runs);
        setSelectedTrainingRunId((current) => runs.some((run) => run.run_id === current) ? current : runs[0]?.run_id ?? null);
        setTrainingLoaded(true);
      })
      .catch(() => { if (!disposed) setLoadError("训练过程接口暂不可用"); });
    return () => { disposed = true; };
  }, [mode, snapshot.now, snapshot.station_id]);

  const isCollection = mode === "collection";
  const trainingRun = trainingRuns.find((run) => run.run_id === selectedTrainingRunId) ?? trainingRuns[0] ?? null;
  const currentData = isCollection ? collectionTelemetry : trainingRun;
  const currentSource: ProcessDataSource | undefined = currentData?.source;
  const sourceLabel = currentSource === "mock-api" ? "MOCK API" : currentSource === "sse" ? "SSE STREAM" : "REST API";
  const runState = isCollection
    ? collectionTelemetry?.status === "degraded" ? "链路降级" : "实时运行"
    : trainingRun?.status === "running" ? "离线训练中" : "真实训练已完成";

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
            <TrainingView run={trainingRun} runs={trainingRuns} onRunChange={setSelectedTrainingRunId} />
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
