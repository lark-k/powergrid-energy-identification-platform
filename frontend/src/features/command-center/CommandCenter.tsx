import { useCallback, useEffect, useMemo, useState } from "react";
import { CaretUp } from "@phosphor-icons/react";
import { SYSTEM_CONFIG } from "../../config/system";
import { useDemoStore } from "../../stores/useDemoStore";
import { Header } from "../../components/data-display/Header";
import { MetricStrip } from "../../components/data-display/MetricStrip";
import { PowerSeparationChart } from "../separation/PowerSeparationChart";
import { FeedbackTimeline } from "../feedback/FeedbackTimeline";
import { CorrectionDeltaChart } from "../correction/CorrectionDeltaChart";
import { RecognitionPanel } from "../recognition/RecognitionPanel";
import { FeedbackPanel } from "../feedback/FeedbackPanel";
import { SelectedMinuteBar } from "../traceability/SelectedMinuteBar";
import { DataDrawer } from "../traceability/DataDrawer";
import { Overlays } from "../../components/overlays/Overlays";
import { StartupTransition } from "../../components/overlays/StartupTransition";
import { PipelineFlow } from "../pipeline/PipelineFlow";

export function CommandCenter() {
  const { now, snapshot, range, selected, load, advance, setRange, selectResult, setDrawer, settings } = useDemoStore();
  const [showStartup, setShowStartup] = useState(true);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => void advance(), SYSTEM_CONFIG.demoTickMs); return () => window.clearInterval(timer); }, [advance]);
  const latestCorrected = useMemo(() => snapshot ? [...snapshot.separation_results].reverse().find((result) => result.correction_kw != null) ?? null : null, [snapshot]);
  const finishStartup = useCallback(() => setShowStartup(false), []);

  return <main className={`command-center ${settings.reducedEffects ? "reduced-effects" : ""} ${showStartup ? "startup-active" : ""}`}>
    {snapshot && <>
      <div className="ambient-scan" aria-hidden="true" />
      <Header stationName={snapshot.station_name} now={now.toISOString()} range={range} setRange={setRange} />
      <PipelineFlow snapshot={snapshot} />
      <MetricStrip snapshot={snapshot} />
      <section className="workspace">
        <div className="hero-card">
          <div className="hero-title"><h1>台区总有功功率与光伏功率分离 <small>按分钟</small></h1><span className="sync-badge"><i />主站与分离结果同步</span></div>
          <PowerSeparationChart snapshot={snapshot} range={range} onSelect={selectResult} />
          <div className="right-panels"><RecognitionPanel key={snapshot.recognition.result_time} result={snapshot.recognition} /><FeedbackPanel key={snapshot.feedback_batches.at(-1)?.batch_id ?? "waiting"} batch={snapshot.feedback_batches.at(-1)} /></div>
        </div>
        <section className="timeline-card"><header><b>双时间轴与反馈</b><span>event_time</span><i /> <span className="amber">arrival_time</span></header><FeedbackTimeline snapshot={snapshot} range={range} /></section>
        <section className="correction-card"><CorrectionDeltaChart snapshot={snapshot} range={range} /><span className="latest-delta">最新校正差值 <small>{latestCorrected ? new Date(latestCorrected.event_time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "暂无"}</small><b>{latestCorrected?.correction_kw == null ? "暂无校正" : `${latestCorrected.correction_kw > 0 ? "+" : ""}${latestCorrected.correction_kw.toLocaleString()} kW`}</b></span></section>
        <SelectedMinuteBar result={selected} />
        <button className="drawer-handle" onClick={() => setDrawer(true, "minutes")}><CaretUp />记录与追溯 <span>分钟结果 · 反馈批次 · 节点 · 校正记录</span></button>
      </section>
      <DataDrawer snapshot={snapshot} />
      <Overlays />
    </>}
    {showStartup && <StartupTransition ready={Boolean(snapshot)} reducedEffects={settings.reducedEffects} onComplete={finishStartup} />}
  </main>;
}
