import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import type { EChartsOption } from "echarts";
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  Brain,
  Broadcast,
  CheckCircle,
  Database,
  Gauge,
  GitBranch,
  Pulse,
  SealCheck,
  ShieldCheck,
  SolarPanel,
  X,
} from "@phosphor-icons/react";
import { EChart } from "../../components/charts/EChart";
import { processAdapter } from "../../services/processAdapter";
import type { CollectionProcessTelemetry, StationSnapshot, TrainingProcessRun } from "../../types/domain";
import { dateTimeText, percentText } from "../../utils/format";
import { SignalMiniChart } from "./SignalMiniChart";
import type { LifecycleStage } from "./EnergyRiver";

gsap.registerPlugin(useGSAP);

interface LifecycleOverlayProps {
  stage: LifecycleStage;
  snapshot: StationSnapshot;
  reducedMotion: boolean;
  onStageChange: (stage: LifecycleStage) => void;
  onClose: () => void;
}

const stageMeta = {
  collection: { index: "01", promise: "采得到", title: "数据采集", icon: Broadcast },
  training: { index: "02", promise: "训得准", title: "模型训练", icon: Brain },
  validation: { index: "03", promise: "验得过", title: "模型验证", icon: SealCheck },
  management: { index: "04", promise: "用得稳", title: "模型应用管理", icon: Database },
} as const;

const taskName = (task: TrainingProcessRun["model_task"]) => task === "pv_separation" ? "光伏功率分离" : "资源辨识";
const sourceLabel = (source: string | undefined) => source === "rest-api" ? "REST API · 真实业务记录" : source === "sse" ? "SSE · 实时业务流" : "显式演示数据";
const metricName = (name: string) => ({ macro_f1: "Macro F1", activity_f1: "活动 F1" }[name] ?? name);

const parseSource = (run: TrainingProcessRun) => {
  if (!run.source_record) return {} as Record<string, unknown>;
  try { return JSON.parse(run.source_record) as Record<string, unknown>; }
  catch { return {} as Record<string, unknown>; }
};

export function LifecycleOverlay({ stage, snapshot, reducedMotion, onStageChange, onClose }: LifecycleOverlayProps) {
  const root = useRef<HTMLElement>(null);
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const collection = useQuery({
    queryKey: ["collection-process", snapshot.station_id],
    queryFn: () => processAdapter.getCollectionProcess(snapshot.station_id),
    refetchInterval: stage === "collection" ? 4_000 : false,
  });
  const training = useQuery({
    queryKey: ["training-runs", snapshot.station_id],
    queryFn: () => processAdapter.getTrainingRuns(snapshot.station_id),
  });
  const meta = stageMeta[stage];
  const MetaIcon = meta.icon;
  const source = stage === "collection" ? collection.data?.source : training.data?.at(0)?.source;
  const motionReduced = reducedMotion || systemReducedMotion;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystemReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useGSAP(() => {
    const duration = motionReduced ? 0 : 0.55;
    const timeline = gsap.timeline({ defaults: { duration, ease: "power3.out" } });
    const shell = root.current?.querySelector(".lifecycle-shell");
    const panels = root.current ? gsap.utils.toArray<HTMLElement>(".lifecycle-panel", root.current) : [];
    if (shell) timeline.from(shell, { scale: 0.985, autoAlpha: 0 });
    if (panels.length) timeline.from(panels, { y: 18, autoAlpha: 0, stagger: 0.05 }, "<0.12");
  }, { scope: root, dependencies: [stage, motionReduced], revertOnUpdate: true });

  return <section ref={root} className={`lifecycle-overlay ${stage}`} role="dialog" aria-modal="true" aria-label={`${meta.title}详情页面`}>
    <div className="lifecycle-shell">
      <header className="lifecycle-header">
        <div className="lifecycle-heading"><strong>{meta.index}</strong><MetaIcon weight="duotone" /><span><small>{meta.promise}</small><b>{meta.title}</b></span></div>
        <nav aria-label="切换全流程页面">{(Object.keys(stageMeta) as LifecycleStage[]).map((id) => {
          const item = stageMeta[id];
          return <button key={id} className={stage === id ? "active" : ""} onClick={() => onStageChange(id)}><span>{item.index}</span>{item.title}</button>;
        })}</nav>
        <div className="lifecycle-source"><i />{sourceLabel(source)}</div>
        <button className="lifecycle-close" aria-label="关闭详情页面" onClick={onClose}><X /></button>
      </header>
      <main className="lifecycle-content">
        {stage === "collection" && <CollectionPage telemetry={collection.data} snapshot={snapshot} loading={collection.isLoading} reducedMotion={motionReduced} />}
        {stage === "training" && <TrainingPage runs={training.data ?? []} loading={training.isLoading} reducedMotion={motionReduced} />}
        {stage === "validation" && <ValidationPage runs={training.data ?? []} loading={training.isLoading} reducedMotion={motionReduced} />}
        {stage === "management" && <ManagementPage runs={training.data ?? []} snapshot={snapshot} loading={training.isLoading} />}
      </main>
    </div>
  </section>;
}

function CollectionPage({ telemetry, snapshot, loading, reducedMotion }: { telemetry?: CollectionProcessTelemetry; snapshot: StationSnapshot; loading: boolean; reducedMotion: boolean }) {
  if (loading) return <LoadingState text="正在读取真实采集过程" />;
  const sources = telemetry?.sources ?? [];
  const signal = telemetry?.signal ?? snapshot.minute_points.slice(-42).map((point) => ({ at: point.event_time, value: point.active_power_kw }));
  return <div className="collection-page lifecycle-page">
    <section className="lifecycle-panel source-lanes">
      <PanelTitle icon={Broadcast} title="输入数据源" meta="SOURCE INPUT" />
      <div className="source-lane-list">{sources.length ? sources.map((source) => <article key={source.source_id}>
        {source.source_id.includes("feedback") || source.source_id.includes("pv") ? <SolarPanel /> : <Gauge />}
        <span><b>{source.name}</b><small>{source.cadence} · {source.fields.join(" / ")}</small></span>
        <strong>{source.received_count.toLocaleString()} 条</strong><em className={source.status}>{source.status}</em>
      </article>) : <EmptyState text="后台未返回采集源记录" />}</div>
    </section>

    <section className="lifecycle-panel feature-meaning">
      <PanelTitle icon={GitBranch} title="特征含义" meta="FEATURE MEANING" />
      <div className="feature-grid">
        <Feature name="总开有功" meaning="台区综合功率规模" field="active_power_kw" />
        <Feature name="A / B / C 三相有功" meaning="各相负荷分布与不平衡" field="phase_a/b/c_power_kw" />
        <Feature name="1 分钟变化量" meaning="捕捉短时功率趋势" field="active_power_delta_1m_kw" />
        <Feature name="日内时刻位置" meaning="表达每日周期规律" field="minute_of_day_sin/cos" />
      </div>
    </section>

    <section className="lifecycle-panel collection-topology">
      <PanelTitle icon={Broadcast} title="主站采集传输拓扑" meta="STATION UPLINK" />
      <CollectionTopology stationName={snapshot.station_name} nodes={snapshot.node_statuses} sources={sources} reducedMotion={reducedMotion} />
    </section>

    <section className="lifecycle-panel collection-processing">
      <PanelTitle icon={GitBranch} title="数据处理与训练样本生成" meta="RAW → TRAINING SAMPLE" />
      <CollectionDataFlow steps={telemetry?.steps ?? []} signal={signal} reducedMotion={reducedMotion} />
    </section>

    <section className="lifecycle-panel collection-signal">
      <PanelTitle icon={Pulse} title="总开原始信号" meta="REAL SIGNAL" />
      <SignalMiniChart title="最近 42 分钟" tone="cyan" data={signal} conclusion="曲线直接读取采集过程接口" />
    </section>

    <section className="lifecycle-panel collection-output">
      <PanelTitle icon={CheckCircle} title="输出数据" meta="CAUSAL WINDOWS" />
      <div className="output-window"><b>120 分钟</b><span>资源辨识窗口</span><small>输出光伏、能源站、充电桩概率与状态</small></div>
      <div className="output-window"><b>240 分钟</b><span>光伏功率分离窗口</span><small>输出初始光伏功率与活动概率</small></div>
      <p>仅允许两端有真实锚点且不超过 3 分钟的插值；目标分钟必须为真实数据点。</p>
    </section>
  </div>;
}

function CollectionTopology({ stationName, nodes, sources, reducedMotion }: {
  stationName: string;
  nodes: StationSnapshot["node_statuses"];
  sources: CollectionProcessTelemetry["sources"];
  reducedMotion: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const endpoints = nodes.length
    ? nodes.slice(0, 4).map((node) => ({ id: node.node_id, name: node.name, detail: `${node.capacity_kw.toLocaleString()} kW · ${node.communication_status === "online" ? "链路在线" : node.communication_status === "delayed" ? "传输延迟" : "链路离线"}`, status: node.communication_status }))
    : sources.slice(0, 4).map((source) => ({ id: source.source_id, name: source.name, detail: `${source.cadence} · ${source.received_count.toLocaleString()} 条`, status: source.status }));

  useGSAP(() => {
    const routes = root.current ? gsap.utils.toArray<HTMLElement>(".topology-route", root.current) : [];
    if (reducedMotion) {
      routes.forEach((route) => {
        const packet = route.querySelector<HTMLElement>(".topology-packet");
        const track = route.querySelector<HTMLElement>(".topology-track");
        if (packet && track) gsap.set(packet, { x: Math.max(8, track.clientWidth * 0.45), autoAlpha: 1 });
      });
      return;
    }
    routes.forEach((route, index) => {
      const packet = route.querySelector<HTMLElement>(".topology-packet");
      const track = route.querySelector<HTMLElement>(".topology-track");
      if (!packet || !track) return;
      gsap.timeline({ repeat: -1, repeatDelay: 0.45, delay: index * 0.28, repeatRefresh: true })
        .set(packet, { x: () => Math.max(12, track.clientWidth - 18), autoAlpha: 0, scale: 0.72 })
        .to(packet, { autoAlpha: 1, scale: 1, duration: 0.16 })
        .to(packet, { x: 4, duration: 1.35, ease: "power1.inOut" }, "<")
        .to(packet, { autoAlpha: 0, scale: 0.72, duration: 0.18 }, "-=0.14");
    });
    gsap.to(".topology-master > svg", { scale: 1.08, duration: 0.85, repeat: -1, yoyo: true, ease: "sine.inOut" });
  }, { scope: root, dependencies: [endpoints.length, reducedMotion], revertOnUpdate: true });

  return <div ref={root} className="topology-body" aria-label="主站从多个分站汇聚数据的动态拓扑">
    <article className="topology-master"><Database weight="duotone" /><span><small>数据汇聚主站</small><b>{stationName}</b><em><i />持续接收</em></span></article>
    <div className="topology-routes">{endpoints.length ? endpoints.map((endpoint) => <div className="topology-route" key={endpoint.id}>
      <div className="topology-track" aria-hidden="true"><ArrowLeft /><span className="topology-packet"><Database weight="fill" /></span></div>
      <article className={endpoint.status}><SolarPanel weight="duotone" /><span><b>{endpoint.name}</b><small>{endpoint.detail}</small></span><em>{endpoint.status === "online" ? "在线" : endpoint.status === "delayed" ? "延迟" : "离线"}</em></article>
    </div>) : <EmptyState text="后台未返回可展示的分站链路" />}</div>
    <p><Broadcast weight="duotone" />分站分钟量测与异步反馈沿业务链路汇聚至主站，光点代表一批正在上送的数据。</p>
  </div>;
}

function CollectionDataFlow({ steps, signal, reducedMotion }: {
  steps: CollectionProcessTelemetry["steps"];
  signal: Array<{ at: string; value: number }>;
  reducedMotion: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const preview = signal.slice(-12);
  const values = preview.map((point) => point.value);
  const minimum = values.length ? Math.min(...values) : 0;
  const span = values.length ? Math.max(1, Math.max(...values) - minimum) : 1;
  const flow = ["原始分钟数据", "质量校验", "缺失值插值", "特征构建", "训练样本"];

  useGSAP(() => {
    if (reducedMotion) {
      gsap.set(".sample-point.gap", { autoAlpha: 1, scaleY: 1 });
      gsap.set(".data-flow-node", { autoAlpha: 1 });
      return;
    }
    const timeline = gsap.timeline({ repeat: -1, repeatDelay: 0.8 });
    timeline
      .set(".data-flow-node", { boxShadow: "0 0 0 rgba(98,217,255,0)" })
      .set(".sample-point.gap", { autoAlpha: 0.18, scaleY: 0.18, transformOrigin: "50% 100%" })
      .to(".data-flow-node", { borderColor: "rgba(98,217,255,.72)", boxShadow: "0 0 20px rgba(98,217,255,.14)", duration: 0.3, stagger: 0.28 })
      .to(".data-flow-arrow", { x: 5, color: "#62d9ff", duration: 0.2, stagger: 0.28 }, 0.18)
      .to(".sample-point.gap", { autoAlpha: 1, scaleY: 1, backgroundColor: "#bd7cff", duration: 0.38, stagger: 0.16 }, 0.72)
      .to(".training-sample-node", { scale: 1.035, boxShadow: "0 0 26px rgba(189,124,255,.26)", duration: 0.38 }, "-=0.12")
      .to(".data-flow-node", { borderColor: "rgba(121,182,208,.2)", boxShadow: "0 0 0 rgba(98,217,255,0)", duration: 0.34 }, "+=0.9")
      .to(".training-sample-node", { scale: 1, boxShadow: "0 0 0 rgba(189,124,255,0)", duration: 0.25 }, "<");
  }, { scope: root, dependencies: [preview.length, reducedMotion], revertOnUpdate: true });

  return <div ref={root} className="collection-data-flow">
    <div className="data-flow-route" aria-label="从原始数据到训练样本的数据处理流程">{flow.map((label, index) => <div className="data-flow-segment" key={label}>
      <article className={`data-flow-node ${index === flow.length - 1 ? "training-sample-node" : ""}`}><span>{String(index + 1).padStart(2, "0")}</span><b>{label}</b><small>{index === 0 ? "event_time 对齐" : index === 1 ? "完整性与异常检查" : index === 2 ? "双锚点 ≤ 3 分钟" : index === 3 ? "变化量与周期特征" : "120 / 240 分钟窗口"}</small></article>
      {index < flow.length - 1 && <ArrowRight className="data-flow-arrow" aria-hidden="true" />}
    </div>)}</div>
    <div className="interpolation-demo">
      <header><span><b>插值补齐动画</b><small>紫色柱演示缺失分钟如何由双侧真实锚点计算补齐</small></span><em>规则示意 · 非当前缺失告警</em></header>
      {preview.length ? <div className="sample-strip" aria-label="分钟数据插值示意">{preview.map((point, index) => {
        const gap = index === 3 || index === 7;
        const height = 28 + ((point.value - minimum) / span) * 58;
        const displayValue = gap && preview[index - 1] && preview[index + 1] ? (preview[index - 1].value + preview[index + 1].value) / 2 : point.value;
        const interpolatedHeight = 28 + ((displayValue - minimum) / span) * 58;
        return <span key={point.at} className={`sample-point ${gap ? "gap" : ""}`} style={{ height: `${gap ? interpolatedHeight : height}%` }} title={gap ? `${point.at} · 相邻真实锚点插值规则示意` : `${point.at} · ${point.value.toFixed(2)} kW`} />;
      })}</div> : <EmptyState text="当前没有可用于处理演示的真实分钟信号" />}
      <div className="processing-statuses">{steps.length ? steps.map((step, index) => <span key={step.step_id} className={step.status}><b>{String(index + 1).padStart(2, "0")}</b>{step.name}<em>{step.status === "completed" ? "完成" : step.status === "running" ? "运行" : "等待"}</em></span>) : <span>后台未返回处理步骤</span>}</div>
    </div>
  </div>;
}

function TrainingPage({ runs, loading, reducedMotion }: { runs: TrainingProcessRun[]; loading: boolean; reducedMotion: boolean }) {
  if (loading) return <LoadingState text="正在读取真实训练归档" />;
  return <div className="training-page lifecycle-page">
    <section className="lifecycle-panel training-runs">
      <PanelTitle icon={Brain} title="真实离线训练任务" meta="TRAINING RUNS" />
      <div className="run-cards">{runs.length ? runs.map((run) => {
        const source = parseSource(run);
        return <article key={run.run_id}>
          <header><span>{taskName(run.model_task)}</span><em>{run.status === "completed" ? "已完成" : run.status}</em></header>
          <b>{run.model_version}</b>
          <div className="run-kpis"><span><small>输入形状</small><strong>{run.window_size_minutes} × {run.model_task === "pv_separation" ? 7 : 4}</strong></span><span><small>训练样本</small><strong>{run.sample_count.toLocaleString()}</strong></span><span><small>{metricName(run.metric_name)}</small><strong>{run.metric_value == null ? "—" : percentText(run.metric_value)}</strong></span></div>
          <footer><span>模型：{String(source.model_name ?? "后台未记录")}</span><span>参数：{typeof source.parameters === "number" ? source.parameters.toLocaleString() : "—"}</span><span>完成：{run.completed_at ? dateTimeText(run.completed_at) : "进行中"}</span></footer>
        </article>;
      }) : <EmptyState text="没有真实 training_run 记录" />}</div>
    </section>
    <section className="lifecycle-panel training-flow">
      <PanelTitle icon={GitBranch} title="训练处理过程" meta="OFFLINE PIPELINE" />
      <TrainingPipeline steps={runs.at(0)?.steps ?? []} task={runs.at(0)?.model_task} reducedMotion={reducedMotion} />
    </section>
    <section className="lifecycle-panel training-curves">
      <PanelTitle icon={Pulse} title="训练收敛曲线" meta="REAL EPOCH HISTORY" />
      {runs.length ? runs.map((run) => <TrainingCurve key={run.run_id} run={run} />) : <EmptyState text="没有真实 epoch 指标" />}
    </section>
  </div>;
}

function TrainingPipeline({ steps, task, reducedMotion }: { steps: TrainingProcessRun["steps"]; task?: TrainingProcessRun["model_task"]; reducedMotion: boolean }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const cards = root.current ? gsap.utils.toArray<HTMLElement>(".training-flow-card", root.current) : [];
    const cursor = root.current?.querySelector<HTMLElement>(".training-flow-cursor");
    if (!cards.length || !cursor) return;
    if (reducedMotion) {
      gsap.set(cursor, { y: cards.at(-1)?.offsetTop ?? 0, autoAlpha: 1 });
      gsap.set(".training-flow-card", { autoAlpha: 1 });
      gsap.set(".training-progress > i", { scaleX: 1, transformOrigin: "0 50%" });
      return;
    }
    const firstTop = cards[0].offsetTop;
    const timeline = gsap.timeline({ repeat: -1, repeatDelay: 0.75 });
    cards.forEach((card, index) => {
      const progress = card.querySelector<HTMLElement>(".training-progress > i");
      timeline
        .to(cursor, { y: card.offsetTop - firstTop + 16, duration: index === 0 ? 0.2 : 0.48, ease: "power2.inOut" })
        .to(card, { borderColor: "rgba(189,124,255,.72)", backgroundColor: "rgba(41,23,61,.78)", duration: 0.24 }, "<")
        .fromTo(progress, { scaleX: 0 }, { scaleX: 1, transformOrigin: "0 50%", duration: 0.5, ease: "power1.out" }, "<0.08")
        .to(card, { borderColor: "rgba(121,182,208,.18)", backgroundColor: "rgba(7,24,39,.74)", duration: 0.24 }, "+=0.28");
    });
  }, { scope: root, dependencies: [steps.map((step) => step.step_id).join("|"), reducedMotion], revertOnUpdate: true });

  if (!steps.length) return <EmptyState text="后台未返回训练处理步骤" />;
  return <div ref={root} className="training-pipeline" aria-label="样本准备到验证发布的动态训练流程">
    <div className="training-flow-track" aria-hidden="true"><span className="training-flow-cursor"><Brain weight="fill" /></span></div>
    <div className="training-flow-cards">{steps.map((step, index) => {
      const rawProgress = step.progress <= 1 ? step.progress * 100 : step.progress;
      const progress = Math.max(0, Math.min(100, rawProgress));
      return <article className={`training-flow-card ${step.status}`} key={step.step_id}>
        <span>{String(index + 1).padStart(2, "0")}</span><div><b>{step.name}</b><small>{step.description}</small><span className="training-progress"><i style={{ width: `${progress}%` }} /></span></div><em>{step.status === "completed" ? "完成" : step.status === "running" ? `${progress.toFixed(0)}%` : step.status === "failed" ? "失败" : "等待"}</em><CheckCircle weight={step.status === "completed" ? "fill" : "regular"} />
      </article>;
    })}</div>
    <p><Pulse weight="duotone" />当前展示{task ? taskName(task) : "训练任务"}流程；光点逐步推进，进度来自真实训练归档。</p>
  </div>;
}

function ValidationPage({ runs, loading, reducedMotion }: { runs: TrainingProcessRun[]; loading: boolean; reducedMotion: boolean }) {
  if (loading) return <LoadingState text="正在读取真实验证记录" />;
  return <div className="validation-page lifecycle-page">
    <section className="lifecycle-panel validation-summary">
      <PanelTitle icon={ShieldCheck} title="验证数据与发布结论" meta="VALIDATION DATASET" />
      <div className="validation-cards">{runs.length ? runs.map((run) => <article key={run.run_id}>
        <header><span>{taskName(run.model_task)}</span><em className={run.release_checks.every((check) => check.status === "passed") ? "passed" : "pending"}>{run.release_checks.every((check) => check.status === "passed") ? "建议发布" : "等待验证"}</em></header>
        <div className="validation-score"><SealCheck weight="duotone" /><span><small>{metricName(run.metric_name)}</small><b>{run.metric_value == null ? "后台未记录" : percentText(run.metric_value)}</b></span></div>
        <dl><div><dt>验证序列</dt><dd>{run.validation_series_name}</dd></div><div><dt>因果窗口</dt><dd>{run.window_size_minutes} 分钟</dd></div><div><dt>数据时间范围</dt><dd>{run.dataset_window_days} 天</dd></div><div><dt>训练样本</dt><dd>{run.sample_count.toLocaleString()} 条</dd></div></dl>
        <p>验证集与训练集独立切分；具体数量以后台真实训练归档为准。</p>
      </article>) : <EmptyState text="没有可验证的真实训练运行" />}</div>
    </section>
    <section className="lifecycle-panel release-gates">
      <PanelTitle icon={SealCheck} title="模型发布门禁" meta="RELEASE GATE" />
      <ValidationFlow runs={runs} reducedMotion={reducedMotion} />
      <div className="gate-list">{runs.flatMap((run) => run.release_checks.map((check) => <article key={`${run.run_id}-${check.check_id}`}><CheckCircle weight="fill" /><span><b>{check.name}</b><small>{taskName(run.model_task)}</small></span><em className={check.status}>{check.status === "passed" ? "通过" : check.status === "failed" ? "未通过" : "等待"}</em></article>))}</div>
      <div className="governance-note"><Archive /><span><b>仍需完成的治理环节</b><small>离线回放、候选版本影子比较和人工审批由真实后台记录决定，页面不会自动补造结果。</small></span></div>
    </section>
    <section className="lifecycle-panel validation-curves">
      <PanelTitle icon={Pulse} title="验证轨迹" meta="BACKEND METRICS" />
      {runs.map((run) => <TrainingCurve key={run.run_id} run={run} validationOnly />)}
    </section>
  </div>;
}

function ValidationFlow({ runs, reducedMotion }: { runs: TrainingProcessRun[]; reducedMotion: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const checks = runs.flatMap((run) => run.release_checks);
  const gatesPassed = checks.length > 0 && checks.every((check) => check.status === "passed");
  const stages = [
    { name: "独立验证集", detail: "与训练样本隔离", status: runs.length ? "passed" : "pending" },
    { name: "离线指标回放", detail: "真实 Epoch 轨迹", status: runs.some((run) => run.epochs.length) ? "passed" : "pending" },
    { name: "规则门禁检查", detail: `${checks.filter((check) => check.status === "passed").length}/${checks.length || 0} 项通过`, status: gatesPassed ? "passed" : "pending" },
    { name: "候选影子比较", detail: "等待治理记录", status: "pending" },
    { name: "人工审批发布", detail: "不自动下发", status: "pending" },
  ];

  useGSAP(() => {
    const route = root.current?.querySelector<HTMLElement>(".validation-route");
    const scanner = root.current?.querySelector<HTMLElement>(".validation-scanner");
    if (!route || !scanner) return;
    if (reducedMotion) {
      gsap.set(scanner, { x: Math.max(0, route.clientWidth - scanner.offsetWidth), autoAlpha: 1 });
      return;
    }
    gsap.fromTo(scanner, { x: 0, autoAlpha: 0.45 }, { x: () => Math.max(0, route.clientWidth - scanner.offsetWidth), autoAlpha: 1, duration: 3.2, repeat: -1, repeatDelay: 0.55, ease: "power1.inOut", repeatRefresh: true });
    gsap.to(".validation-stage", { y: -3, duration: 0.32, stagger: 0.34, repeat: -1, repeatDelay: 1.35, yoyo: true, ease: "sine.inOut" });
  }, { scope: root, dependencies: [checks.map((check) => `${check.check_id}:${check.status}`).join("|"), reducedMotion], revertOnUpdate: true });

  return <div ref={root} className="validation-flow" aria-label="从独立验证集到人工审批发布的动态流程">
    <div className="validation-route">{stages.map((stage, index) => <div className="validation-segment" key={stage.name}>
      <article className={`validation-stage ${stage.status}`}><span>{String(index + 1).padStart(2, "0")}</span><b>{stage.name}</b><small>{stage.detail}</small></article>
      {index < stages.length - 1 && <ArrowRight aria-hidden="true" />}
    </div>)}<span className="validation-scanner" aria-hidden="true"><SealCheck weight="fill" /></span></div>
    <p><ShieldCheck weight="duotone" /><span><b>{gatesPassed ? "自动检查已通过，进入治理环节" : "正在等待全部门禁检查完成"}</b><small>候选比较与人工审批必须由后台真实记录确认</small></span></p>
  </div>;
}

function ManagementPage({ runs, snapshot, loading }: { runs: TrainingProcessRun[]; snapshot: StationSnapshot; loading: boolean }) {
  type ModelTask = TrainingProcessRun["model_task"];
  const activeVersions = useMemo<Record<ModelTask, string>>(() => ({
    resource_identification: snapshot.model_health.recognition_version ?? "",
    pv_separation: snapshot.model_health.separation_version ?? "",
  }), [snapshot.model_health.recognition_version, snapshot.model_health.separation_version]);
  const versionsByTask = useMemo<Record<ModelTask, string[]>>(() => ({
    resource_identification: Array.from(new Set([activeVersions.resource_identification, ...runs.filter((run) => run.model_task === "resource_identification").map((run) => run.model_version)].filter((version): version is string => Boolean(version)))),
    pv_separation: Array.from(new Set([activeVersions.pv_separation, ...runs.filter((run) => run.model_task === "pv_separation").map((run) => run.model_version)].filter((version): version is string => Boolean(version)))),
  }), [activeVersions, runs]);
  const [selectedVersions, setSelectedVersions] = useState<Record<ModelTask, string>>(activeVersions);

  useEffect(() => {
    setSelectedVersions((current) => {
      const next = {
        resource_identification: versionsByTask.resource_identification.includes(current.resource_identification) ? current.resource_identification : activeVersions.resource_identification || versionsByTask.resource_identification[0] || "",
        pv_separation: versionsByTask.pv_separation.includes(current.pv_separation) ? current.pv_separation : activeVersions.pv_separation || versionsByTask.pv_separation[0] || "",
      };
      return next.resource_identification === current.resource_identification && next.pv_separation === current.pv_separation ? current : next;
    });
  }, [activeVersions, versionsByTask]);

  if (loading) return <LoadingState text="正在读取模型版本与健康状态" />;
  const models = [
    { task: "resource_identification" as const, name: "资源辨识", version: snapshot.model_health.recognition_version, status: snapshot.model_health.recognition_status },
    { task: "pv_separation" as const, name: "光伏功率分离", version: snapshot.model_health.separation_version, status: snapshot.model_health.separation_status },
  ];
  return <div className="management-page lifecycle-page">
    <section className="lifecycle-panel active-models">
      <PanelTitle icon={Database} title="模型版本选择与运行状态" meta="MODEL VERSION SELECTOR" />
      <div className="active-model-grid">{models.map((model) => {
        const selectedVersion = selectedVersions[model.task] || model.version || "";
        const selectedRun = runs.find((run) => run.model_task === model.task && run.model_version === selectedVersion);
        const active = Boolean(model.version) && selectedVersion === model.version;
        return <article key={model.task}>
          <header>{model.task === "pv_separation" ? <SolarPanel /> : <Brain />}<span><b>{model.name}</b><small>{model.task}</small></span><em className={active ? model.status : "archived"}>{active ? model.status === "running" ? "当前健康" : "当前降级" : "归档查看"}</em></header>
          <label className="model-version-picker"><span>选择{model.name}版本</span><select aria-label={`选择${model.name}模型版本`} value={selectedVersion} onChange={(event) => setSelectedVersions((current) => ({ ...current, [model.task]: event.target.value }))} disabled={!versionsByTask[model.task].length}>
            {versionsByTask[model.task].length ? versionsByTask[model.task].map((version) => <option key={version} value={version}>{version}{version === model.version ? "（当前在用）" : "（训练归档）"}</option>) : <option value="">后台暂无可选版本</option>}
          </select></label>
          <div className="selected-version-summary"><strong>{selectedVersion || "后台未返回可用版本"}</strong><span className={active ? "active" : "archived"}>{active ? "当前在用" : "归档版本"}</span></div>
          <div className="selected-version-kpis"><span><small>验证指标</small><b>{selectedRun?.metric_value == null ? active ? "运行中" : "—" : `${metricName(selectedRun.metric_name)} ${percentText(selectedRun.metric_value)}`}</b></span><span><small>训练样本</small><b>{selectedRun ? `${selectedRun.sample_count.toLocaleString()} 条` : "—"}</b></span><span><small>完成时间</small><b>{selectedRun?.completed_at ? dateTimeText(selectedRun.completed_at) : active ? "已激活" : "—"}</b></span></div>
          <div className="lifecycle-lane"><span>已注册</span><ArrowRight /><span>已审批</span><ArrowRight /><span>候选</span><ArrowRight /><span className={active ? "active" : ""}>已激活</span><ArrowRight /><span className={!active ? "selected" : ""}>归档</span></div>
          <footer><span>最近推理：{active && snapshot.model_health.last_inference_time ? dateTimeText(snapshot.model_health.last_inference_time) : "仅当前版本提供"}</span><span>时延：{active && snapshot.model_health.last_inference_ms != null ? `${snapshot.model_health.last_inference_ms.toFixed(1)} ms` : "—"}</span></footer>
        </article>;
      })}</div>
    </section>
    <section className="lifecycle-panel version-archive">
      <PanelTitle icon={Archive} title="真实训练版本归档" meta="VERSION ARCHIVE" />
      <div className="version-table"><div className="version-head"><span>模型类别</span><span>版本</span><span>运行状态</span><span>验证指标</span><span>完成时间</span></div>
        {runs.length ? runs.map((run) => {
          const activeVersion = run.model_task === "pv_separation" ? snapshot.model_health.separation_version : snapshot.model_health.recognition_version;
          const active = run.model_version === activeVersion;
          const selected = run.model_version === selectedVersions[run.model_task];
          return <div className={`version-row ${selected ? "selected" : ""}`} key={run.run_id}><span>{taskName(run.model_task)}</span><span title={run.model_version}>{run.model_version}</span><span className={active ? "active" : "archived"}>{active ? "当前在用" : selected ? "正在查看" : "训练归档"}</span><span>{run.metric_value == null ? "—" : `${metricName(run.metric_name)} ${percentText(run.metric_value)}`}</span><span>{run.completed_at ? dateTimeText(run.completed_at) : "进行中"}</span></div>;
        }) : <EmptyState text="后台没有训练版本归档" />}
      </div>
      <p className="management-boundary"><ShieldCheck />下拉框用于查看和对比真实训练归档，不会改变后台当前激活模型；平台仅提供模型监测、验证与版本治理，不下发任何设备控制指令。</p>
    </section>
  </div>;
}

function TrainingCurve({ run, validationOnly = false }: { run: TrainingProcessRun; validationOnly?: boolean }) {
  const option = useMemo<EChartsOption>(() => ({
    animationDuration: 800,
    grid: { left: 46, right: 18, top: 32, bottom: 30 },
    legend: { top: 0, right: 8, textStyle: { color: "#91afc0", fontSize: 13 } },
    tooltip: { trigger: "axis", backgroundColor: "rgba(4,17,34,.96)", borderColor: "rgba(174,116,255,.55)", textStyle: { color: "#eefaff" } },
    xAxis: { type: "category", data: run.epochs.map((epoch) => epoch.epoch), axisLabel: { color: "#789aab", fontSize: 12 }, axisLine: { lineStyle: { color: "rgba(121,171,198,.26)" } } },
    yAxis: { type: "value", scale: true, axisLabel: { color: "#789aab", fontSize: 12 }, splitLine: { lineStyle: { color: "rgba(121,171,198,.12)" } } },
    series: [
      ...(!validationOnly ? [{ name: "训练损失", type: "line" as const, showSymbol: false, smooth: true, data: run.epochs.map((epoch) => epoch.training_loss), lineStyle: { color: "#70dfff", width: 2 } }] : []),
      { name: run.validation_series_name, type: "line" as const, showSymbol: false, smooth: true, data: run.epochs.map((epoch) => epoch.validation_loss ?? epoch.validation_score), lineStyle: { color: "#c17cff", width: 2 } },
    ],
  }), [run, validationOnly]);
  return <article className="training-curve"><header><b>{taskName(run.model_task)}</b><small>{run.epochs.length} 个真实 Epoch</small></header><EChart option={option} className="curve-chart" ariaLabel={`${taskName(run.model_task)}训练验证曲线`} /></article>;
}

function Feature({ name, meaning, field }: { name: string; meaning: string; field: string }) {
  return <article><GitBranch weight="duotone" /><span><b>{name}</b><small>{meaning}</small><code>{field}</code></span></article>;
}

function PanelTitle({ icon: Icon, title, meta }: { icon: ComponentType<{ weight?: "duotone" }>; title: string; meta: string }) {
  return <header className="panel-title"><Icon weight="duotone" /><b>{title}</b><small>{meta}</small></header>;
}

function LoadingState({ text }: { text: string }) { return <div className="lifecycle-loading"><Pulse className="spin" />{text}</div>; }
function EmptyState({ text }: { text: string }) { return <div className="lifecycle-empty">{text}</div>; }
