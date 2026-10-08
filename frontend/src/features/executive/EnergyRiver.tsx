import { useMemo, useRef } from "react";
import type { EChartsOption } from "echarts";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  ArrowRight,
  Brain,
  Broadcast,
  CheckCircle,
  Database,
  Gauge,
  SealCheck,
  SolarPanel,
} from "@phosphor-icons/react";
import { EChart } from "../../components/charts/EChart";
import type { StationSnapshot } from "../../types/domain";
import { percentText } from "../../utils/format";

gsap.registerPlugin(useGSAP);

export type LifecycleStage = "collection" | "training" | "validation" | "management";

interface EnergyRiverProps {
  snapshot: StationSnapshot;
  activeStage: LifecycleStage | null;
  playbackProgress: number;
  reducedMotion: boolean;
  onOpen: (stage: LifecycleStage) => void;
}

const stages = [
  { id: "collection", index: "01", promise: "采得到", title: "数据采集", icon: Broadcast, tone: "cyan" },
  { id: "training", index: "02", promise: "训得准", title: "模型训练", icon: Brain, tone: "violet" },
  { id: "validation", index: "03", promise: "验得过", title: "模型验证", icon: SealCheck, tone: "pink" },
  { id: "management", index: "04", promise: "用得稳", title: "模型应用管理", icon: Database, tone: "amber" },
] as const;

const band = (base: Array<[number, number]>, offsets: number[]) => offsets.map((offset) => ({
  coords: base.map(([x, y]) => [x, y + offset]),
}));

const flowOption = (): EChartsOption => ({
  animation: true,
  grid: { left: 0, right: 0, top: 0, bottom: 0 },
  xAxis: { type: "value", min: 0, max: 100, show: false },
  yAxis: { type: "value", min: 0, max: 100, show: false },
  series: [
    {
      type: "lines", coordinateSystem: "cartesian2d", polyline: true,
      effect: { show: true, period: 3.2, trailLength: 0.42, symbol: "circle", symbolSize: 3.6, color: "#a9f3ff" },
      lineStyle: { color: "#37a8ff", width: 1.1, opacity: 0.28 },
      data: [
        ...band([[0, 64], [15, 64], [28, 59], [36, 58]], [-5, -3, -1, 1, 3, 5]),
        ...band([[0, 36], [15, 36], [28, 42], [36, 43]], [-5, -3, -1, 1, 3, 5]),
      ],
    },
    {
      type: "lines", coordinateSystem: "cartesian2d", polyline: true,
      effect: { show: true, period: 4.1, trailLength: 0.48, symbol: "circle", symbolSize: 3.8, color: "#f2b1ff" },
      lineStyle: { color: "#bb71ff", width: 1.2, opacity: 0.3 },
      data: [
        ...band([[35, 58], [46, 62], [58, 62], [72, 55]], [-4, -2, 0, 2, 4]),
        ...band([[35, 42], [46, 38], [58, 38], [72, 49]], [-4, -2, 0, 2, 4]),
      ],
    },
    {
      type: "lines", coordinateSystem: "cartesian2d", polyline: true,
      effect: { show: true, period: 2.8, trailLength: 0.52, symbol: "circle", symbolSize: 4.2, color: "#fff0a8" },
      lineStyle: { color: "#ffc34e", width: 1.2, opacity: 0.34 },
      data: band([[72, 52], [78, 52], [84.8, 52]], [-3, -1.5, 0, 1.5, 3]),
    },
  ],
});

export function EnergyRiver({ snapshot, activeStage, playbackProgress, reducedMotion, onOpen }: EnergyRiverProps) {
  const root = useRef<HTMLElement>(null);
  const option = useMemo(flowOption, []);
  const onlineNodes = snapshot.node_statuses.filter((node) => node.communication_status === "online").length;
  const training = snapshot.training;
  const modelReady = snapshot.model_health.separation_status === "running";

  useGSAP(() => {
    const duration = reducedMotion ? 0 : 0.7;
    const timeline = gsap.timeline({ defaults: { duration, ease: "power3.out" } });
    timeline
      .from(".journey-stage", { y: -18, autoAlpha: 0, stagger: 0.08 })
      .from(".river-sources", { x: -24, autoAlpha: 0 }, "<0.08")
      .from(".journey-node", { scale: 0.9, autoAlpha: 0, stagger: 0.08 }, "<0.1");
  }, { scope: root });

  useGSAP(() => {
    const clamped = gsap.utils.clamp(0, 1, playbackProgress);
    gsap.to(".window-progress", {
      scaleX: clamped,
      duration: reducedMotion ? 0 : 0.55,
      ease: "power2.out",
      transformOrigin: "left center",
      overwrite: "auto",
    });
  }, { scope: root, dependencies: [playbackProgress, reducedMotion], revertOnUpdate: true });

  return <section ref={root} className="energy-journey" aria-label="数据采集、模型训练、模型验证与模型应用管理全流程">
    <div className="river-field">
      <nav className="journey-stages" aria-label="全流程下钻页面">
        {stages.map(({ id, index, promise, title, icon: Icon, tone }) => <button
          key={id}
          type="button"
          className={`journey-stage ${tone} ${activeStage === id ? "active" : ""}`}
          onClick={() => onOpen(id)}
        >
          <span>{index}</span><Icon weight="duotone" />
          <b>{promise}</b><small>{title}</small>
        </button>)}
      </nav>
      <EChart option={option} className="river-chart" ariaLabel="业务数据能量河流动路径" />
      <div className="river-layout">
        <div className="river-sources">
          <button className="journey-source" onClick={() => onOpen("collection")}>
            <span className="source-icon-row">{[0, 1, 2, 3].map((item) => <Gauge key={item} weight="duotone" />)}</span>
            <span><b>总开计量 <em>每分钟</em></b><small>总开有功、A/B/C 三相有功</small><strong>{snapshot.minute_points.length.toLocaleString()} 条真实分钟</strong></span>
          </button>
          <button className="journey-source" onClick={() => onOpen("collection")}>
            <span className="source-icon-row solar">{[0, 1, 2].map((item) => <SolarPanel key={item} weight="duotone" />)}</span>
            <span><b>光伏分站反馈 <em>异步</em></b><small>event_time / arrival_time</small><strong>{snapshot.substation_points.length.toLocaleString()} 条真实反馈</strong></span>
          </button>
        </div>

        <button className="journey-node causal-window" onClick={() => onOpen("collection")}>
          <span className="node-kicker">因果窗口</span>
          <b>120 分钟窗口</b>
          <div className="window-track"><i className="window-progress" /></div><span className="window-scale"><i>−120m</i><i>现在</i></span>
          <b>240 分钟窗口</b>
          <div className="window-track secondary"><i className="window-progress" /></div><span className="window-scale"><i>−240m</i><i>现在</i></span>
          <small><CheckCircle weight="fill" />完整率 {percentText(snapshot.quality.completeness_ratio)}</small>
          <small><CheckCircle weight="fill" />目标分钟为真实点</small>
        </button>

        <div className="model-stack journey-node">
          <button onClick={() => onOpen("training")}>
            <Brain weight="duotone" /><span><b>资源辨识</b><small>{snapshot.model_health.recognition_version ?? "等待真实版本"}</small></span>
          </button>
          <button onClick={() => onOpen("training")}>
            <SolarPanel weight="duotone" /><span><b>光伏功率分离</b><small>{snapshot.model_health.separation_version ?? "等待真实版本"}</small></span>
          </button>
        </div>

        <button className="journey-node validation-gate" onClick={() => onOpen("validation")}>
          <span className="hotspot-label"><SealCheck weight="duotone" /><b>{training ? "验证记录就绪" : "等待验证记录"}</b><small>{training ? training.metric_value != null ? `${({ activity_f1: "活动 F1", macro_f1: "Macro F1" } as Record<string, string>)[training.metric_name ?? ""] ?? training.metric_name ?? "得分"} ${training.metric_name?.includes("mae") ? `${training.metric_value.toFixed(4)} kW` : percentText(training.metric_value)}` : `得分 ${percentText(training.validation_score)}` : "不生成缺失指标"}</small></span>
        </button>

        <button className={`journey-node deployment-beacon ${modelReady ? "ready" : "degraded"}`} onClick={() => onOpen("management")}>
          <span className="hotspot-label"><Database weight="duotone" /><b>{modelReady ? "模型稳定运行" : "模型服务降级"}</b><small>{snapshot.model_health.last_inference_ms == null ? "暂无推理时延" : `${snapshot.model_health.last_inference_ms.toFixed(0)} ms`}</small><ArrowRight weight="bold" /></span>
        </button>
      </div>
    </div>
  </section>;
}
