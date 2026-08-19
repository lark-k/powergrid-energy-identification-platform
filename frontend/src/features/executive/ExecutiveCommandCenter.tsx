import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import gsap from "gsap";
import {
  Broadcast,
  Buildings,
  Clock,
  Database,
  Pulse,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import { SYSTEM_CONFIG } from "../../config/system";
import { useDemoStore } from "../../stores/useDemoStore";
import type { SeparationResult, TimeRange } from "../../types/domain";
import { dateTimeText, percentText } from "../../utils/format";
import { EnergyRiver, type LifecycleStage } from "./EnergyRiver";
import { HistoryWindow, type HistorySelection } from "./HistoryWindow";
import { LifecycleOverlay } from "./LifecycleOverlay";
import { MinuteLedger } from "./MinuteLedger";
import { SignalMiniChart, type SignalPoint } from "./SignalMiniChart";
import { SignalDetailModal, type SignalDetailSpec } from "./SignalDetailModal";

const minute = 60_000;

const nearestRange = (durationMinutes: number): TimeRange => {
  if (durationMinutes <= 60) return "1h";
  if (durationMinutes <= 360) return "6h";
  if (durationMinutes <= 1_440) return "24h";
  return "7d";
};

const closestResult = (results: SeparationResult[], at: string) => {
  const target = new Date(at).getTime();
  return results.reduce<SeparationResult | null>((best, row) => {
    if (!best) return row;
    return Math.abs(new Date(row.event_time).getTime() - target) < Math.abs(new Date(best.event_time).getTime() - target) ? row : best;
  }, null);
};

export function ExecutiveCommandCenter() {
  const {
    now, snapshot, stations, stationId, viewMode, historyAt, historyStartAt, historyCursor, dataRange,
    selected, connection, error, busy, settings, load, advance, connect, setStation, setRange,
    setHistoryAt, goLive, selectResult,
  } = useDemoStore();
  const [activeStage, setActiveStage] = useState<LifecycleStage | null>(null);
  const [activeSignal, setActiveSignal] = useState<SignalDetailSpec["title"] | null>(null);
  const [selection, setSelection] = useState<HistorySelection>(() => ({ start: Date.now() - 6 * 60 * minute, end: Date.now() }));

  useEffect(() => { void load(); }, [load]);
  useEffect(() => viewMode === "live" ? connect() : undefined, [connect, stationId, viewMode]);
  useEffect(() => {
    const timer = window.setInterval(() => void advance(), SYSTEM_CONFIG.demoTickMs);
    return () => window.clearInterval(timer);
  }, [advance]);
  useEffect(() => {
    if (!dataRange?.first_event_time || !dataRange.last_event_time) return;
    const minimum = new Date(dataRange.first_event_time).getTime();
    const maximum = new Date(dataRange.last_event_time).getTime() + minute;
    const end = historyAt ? new Date(historyAt).getTime() : maximum;
    const start = historyStartAt ? new Date(historyStartAt).getTime() : Math.max(minimum, end - SYSTEM_CONFIG.timeRanges["6h"] * minute);
    setSelection({ start: gsap.utils.clamp(minimum, maximum - minute, start), end: gsap.utils.clamp(minimum + minute, maximum, end) });
  }, [dataRange?.first_event_time, dataRange?.last_event_time, historyAt, historyStartAt, stationId]);
  useEffect(() => {
    if (!activeStage) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setActiveStage(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [activeStage]);

  const cursorMs = historyCursor ? new Date(historyCursor).getTime() : snapshot ? new Date(snapshot.now).getTime() : null;
  const playbackProgress = cursorMs == null || selection.end === selection.start
    ? 0
    : gsap.utils.clamp(0, 1, gsap.utils.normalize(selection.start, selection.end, cursorMs));

  const visible = useCallback((at: string) => {
    const timestamp = new Date(at).getTime();
    const visibleEnd = viewMode === "history" && cursorMs != null ? cursorMs : selection.end;
    return timestamp >= selection.start && timestamp <= visibleEnd;
  }, [cursorMs, selection.end, selection.start, viewMode]);

  const chartData = useMemo(() => {
    if (!snapshot) return { total: [], initial: [], corrected: [], feedback: [] } as Record<string, SignalPoint[]>;
    const total = snapshot.minute_points.filter((point) => visible(point.event_time)).map((point) => ({ at: point.event_time, value: point.active_power_kw }));
    const separation = snapshot.separation_results.filter((point) => visible(point.event_time));
    return {
      total,
      initial: separation.map((point) => ({ at: point.event_time, value: point.initial_pv_kw })),
      corrected: separation.filter((point) => point.corrected_pv_kw != null).map((point) => ({ at: point.event_time, value: point.corrected_pv_kw! })),
      feedback: snapshot.substation_points.filter((point) => visible(point.period_start)).map((point) => ({ at: point.period_start, value: point.pv_value })),
    };
  }, [snapshot, visible]);

  const pickAt = useCallback((at: string) => {
    if (!snapshot) return;
    const result = closestResult(snapshot.separation_results, at);
    if (result) selectResult(result);
  }, [selectResult, snapshot]);

  const applyHistory = useCallback(async () => {
    const duration = Math.max(1, Math.round((selection.end - selection.start) / minute));
    const range = nearestRange(duration);
    await setRange(range);
    await setHistoryAt(new Date(selection.end).toISOString(), new Date(selection.start).toISOString());
  }, [selection.end, selection.start, setHistoryAt, setRange]);

  if (!snapshot) return <main className="executive-app executive-loading">
    <div className="loading-mark"><Pulse className="spin" /><b>{error ? "业务后台暂不可用" : "正在接入电网业务数据"}</b><span>{error?.message ?? "读取台区分钟数据、分站反馈与模型状态"}</span>{error && <button onClick={() => void load()}>重新连接</button>}</div>
  </main>;

  const correctedCount = snapshot.separation_results.filter((item) => item.corrected_pv_kw != null).length;
  const latestBatch = snapshot.feedback_batches.at(-1);
  const station = stations.find((item) => item.station_id === stationId);
  const signalSpecs: Record<SignalDetailSpec["title"], SignalDetailSpec> = {
    "总开有功": { title: "总开有功", tone: "cyan", data: chartData.total, conclusion: `分钟数据完整率 ${percentText(snapshot.quality.completeness_ratio)}`, streamingLabel: viewMode === "history" ? "历史数据拟实时推进" : "实时接口持续更新" },
    "初始光伏": { title: "初始光伏", tone: "green", data: chartData.initial, conclusion: "模型分离的第一版结果", streamingLabel: viewMode === "history" ? "历史数据拟实时推进" : "实时接口持续更新" },
    "矫正后光伏": { title: "矫正后光伏", tone: "violet", data: chartData.corrected, conclusion: correctedCount ? `已有 ${correctedCount.toLocaleString()} 个时刻完成反馈校正` : "等待真实分站反馈后校正", streamingLabel: viewMode === "history" ? "历史数据拟实时推进" : "实时接口持续更新" },
    "分站反馈": { title: "分站反馈", tone: "amber", data: chartData.feedback, conclusion: latestBatch ? `最新反馈批次 ${latestBatch.batch_id}` : "当前窗口尚无反馈批次", streamingLabel: viewMode === "history" ? "历史数据拟实时推进" : "实时接口持续更新" },
  };

  return <main className={`executive-app ${settings.reducedEffects ? "reduced-effects" : ""}`}>
    <div className="executive-scrim" aria-hidden="true" />
    <header className="executive-header">
      <div className="brand-lockup"><div className="brand-emblem"><Pulse weight="duotone" /></div><span><small>新型能源智能辨识与分离平台</small></span></div>
      <div className="header-center"><ShieldCheck weight="duotone" /><span><strong>仅监测分析，不下发控制</strong><small>数据采集 → 模型训练 → 模型验证 → 模型应用</small></span></div>
      <div className="header-status">
        {stations.length > 1 && <label><Buildings /><select aria-label="选择台区" value={stationId} onChange={(event) => void setStation(event.target.value)}>{stations.map((item) => <option key={item.station_id} value={item.station_id}>{item.station_name}</option>)}</select></label>}
        <HistoryWindow dataRange={dataRange} selection={selection} cursor={cursorMs} viewMode={viewMode} busy={busy} onChange={setSelection} onApply={applyHistory} onGoLive={goLive} />
        <span className={`connection ${connection}`}><i />{connection === "online" ? "业务链路在线" : connection === "connecting" ? "正在连接" : connection === "degraded" ? "降级运行" : "链路离线"}</span>
        <span><Clock />{dateTimeText(viewMode === "history" && historyCursor ? historyCursor : now)}</span>
      </div>
    </header>

    {(error || connection !== "online") && <div className={`executive-alert ${connection}`} role="status"><WarningCircle />{error?.message ?? "部分业务链路处于非正常状态；页面不会以模拟数据替代真实结果。"}</div>}

    <section className="executive-hero">
      <EnergyRiver snapshot={snapshot} activeStage={activeStage} playbackProgress={playbackProgress} reducedMotion={settings.reducedEffects} onOpen={setActiveStage} />
      <div className="signal-stack">
        <SignalMiniChart {...signalSpecs["总开有功"]} onSelect={pickAt} onOpen={() => setActiveSignal("总开有功")} />
        <SignalMiniChart {...signalSpecs["初始光伏"]} onSelect={pickAt} onOpen={() => setActiveSignal("初始光伏")} />
        <SignalMiniChart {...signalSpecs["矫正后光伏"]} onSelect={pickAt} onOpen={() => setActiveSignal("矫正后光伏")} />
        <SignalMiniChart {...signalSpecs["分站反馈"]} onSelect={pickAt} onOpen={() => setActiveSignal("分站反馈")} />
      </div>
    </section>

    <MinuteLedger snapshot={snapshot} selection={selection} selected={selected} onSelect={selectResult} />

    <footer className="executive-footer"><span><Database />数据源：{SYSTEM_CONFIG.sourceMode === "api" ? "实际业务后台" : "显式演示模式"}</span><span><Broadcast />{viewMode === "history" ? "历史数据正在按分钟拟实时播放" : "真实实时接口通道已启用"}</span><span>当前台区 {stationId}</span></footer>
    {activeStage && createPortal(<LifecycleOverlay stage={activeStage} snapshot={snapshot} reducedMotion={settings.reducedEffects} onStageChange={setActiveStage} onClose={() => setActiveStage(null)} />, document.body)}
    {activeSignal && createPortal(<SignalDetailModal spec={signalSpecs[activeSignal]} onSelect={pickAt} onClose={() => setActiveSignal(null)} />, document.body)}
  </main>;
}
