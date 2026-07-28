import type { FeedbackBatch } from "../../types/domain";
import { dateTimeText, percentText, timeText } from "../../utils/format";

export function FeedbackPanel({ batch }: { batch?: FeedbackBatch }) {
  if (!batch) return <section className="glass-panel feedback-panel"><header><b>反馈批次</b><span className="waiting">等待回传</span></header></section>;
  return <section className="glass-panel feedback-panel"><header><b>反馈批次</b><span>已到达</span></header>
    <dl><div><dt>批次 ID</dt><dd>{batch.batch_id}</dd></div><div><dt>到达时间</dt><dd>{dateTimeText(batch.arrival_time)}</dd></div>
      <div><dt>历史覆盖</dt><dd>{timeText(batch.coverage_start)} – {timeText(batch.coverage_end)}</dd></div>
      <div className="feedback-stats"><span><small>回传间隔</small><b>{batch.interval_minutes} min</b></span><span><small>节点覆盖</small><b>{percentText(batch.node_coverage_ratio)}</b></span><span><small>置信度</small><b>{percentText(batch.completeness_ratio * .97)}</b></span></div>
      {batch.missing_nodes.length > 0 && <div className="warning-row"><dt>缺失节点</dt><dd>{batch.missing_nodes.join("、")}</dd></div>}
    </dl></section>;
}
