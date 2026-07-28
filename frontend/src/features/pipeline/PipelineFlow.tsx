import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Brain,
  ChartLineUp,
  CheckCircle,
  Cpu,
  Database,
} from "@phosphor-icons/react";
import type { StationSnapshot } from "../../types/domain";
import { percentText, powerText } from "../../utils/format";
import { ProcessVisualization, type VisualizedStage } from "./ProcessVisualization";

type StageId = "collection" | "training" | "inference" | "result";

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

export function PipelineFlow({ snapshot }: { snapshot: StationSnapshot }) {
  const [activeStage, setActiveStage] = useState<StageId>("inference");
  const [visualizedStage, setVisualizedStage] = useState<VisualizedStage | null>(null);
  const stages = useMemo(() => {
    const latest = snapshot.separation_results.at(-1)!;
    const onlineNodes = snapshot.node_statuses.filter((node) => node.communication_status === "online").length;

    return [
      {
        id: "collection" as const,
        index: "01",
        title: "数据采集",
        status: "持续接入",
        tone: "cyan",
        icon: Database,
        metric: `${onlineNodes}/${snapshot.node_statuses.length} 节点在线`,
        meta: `完整率 ${percentText(snapshot.quality.completeness_ratio)}`,
        detail: `主站分钟数据与光伏分站反馈正在接入，最近质检 ${timeText(snapshot.quality.last_checked_at)}`,
      },
      {
        id: "training" as const,
        index: "02",
        title: "模型训练",
        status: snapshot.training.status === "completed" ? "离线已完成" : "训练中",
        tone: "violet",
        icon: Brain,
        metric: snapshot.training.model_version,
        meta: `验证得分 ${percentText(snapshot.training.validation_score)}`,
        detail: `${snapshot.training.dataset_window_days} 天训练窗口 · ${snapshot.training.sample_count.toLocaleString()} 条样本 · 完成于 ${dateTimeText(snapshot.training.completed_at)}`,
      },
      {
        id: "inference" as const,
        index: "03",
        title: "模型推理",
        status: snapshot.model_health.separation_status === "running" ? "在线运行" : "性能降级",
        tone: "green",
        icon: Cpu,
        metric: `${snapshot.model_health.last_inference_ms} ms`,
        meta: snapshot.model_health.separation_version,
        detail: `最新推理 ${timeText(snapshot.model_health.last_inference_time)} · 输出辨识标签、初始光伏与剩余负荷`,
      },
      {
        id: "result" as const,
        index: "04",
        title: "效果展示",
        status: "结果已同步",
        tone: "amber",
        icon: ChartLineUp,
        metric: `光伏 ${powerText(latest.initial_pv_kw)} kW`,
        meta: `置信度 ${percentText(latest.confidence)}`,
        detail: `当前展示 ${snapshot.separation_results.length.toLocaleString()} 条分钟结果，最近校正覆盖 ${percentText(snapshot.quality.completeness_ratio)}`,
      },
    ];
  }, [snapshot]);
  return (
    <section className="pipeline-flow" aria-label="数据采集、模型训练、模型推理与效果展示流程">
      <div className="pipeline-stages">
        {stages.map(({ icon: Icon, ...stage }, index) => (
          <div className="pipeline-stage-slot" key={stage.id}>
            <button
              type="button"
              className={`pipeline-stage ${stage.tone} ${stage.id === activeStage ? "active" : ""}`}
              aria-pressed={stage.id === activeStage}
              title={stage.detail}
              onClick={() => {
                setActiveStage(stage.id);
                if (stage.id === "collection" || stage.id === "training") setVisualizedStage(stage.id);
              }}
            >
              <span className="stage-icon"><Icon weight="duotone" /></span>
              <span className="stage-copy">
                <span className="stage-heading"><i>{stage.index}</i><b>{stage.title}</b></span>
                <strong>{stage.metric}</strong>
                <small>{stage.meta}</small>
              </span>
              <span className="stage-status"><CheckCircle weight="fill" />{stage.status}</span>
            </button>
            {index < stages.length - 1 && <ArrowRight className="pipeline-arrow" weight="bold" aria-hidden="true" />}
          </div>
        ))}
      </div>
      {visualizedStage && createPortal(
        <ProcessVisualization
          mode={visualizedStage}
          snapshot={snapshot}
          onModeChange={(mode) => {
            setActiveStage(mode);
            setVisualizedStage(mode);
          }}
          onClose={() => setVisualizedStage(null)}
        />,
        document.body,
      )}
    </section>
  );
}
