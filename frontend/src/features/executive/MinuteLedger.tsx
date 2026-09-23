import { useEffect, useMemo, useState } from "react";
import { Circle, ClockCounterClockwise, Database, Info, LockOpen, Rows } from "@phosphor-icons/react";
import type { MainSwitchMinutePoint, PVSubstationPoint, SeparationResult, StationSnapshot } from "../../types/domain";
import { dateTimeText, percentText, powerText, timeText } from "../../utils/format";
import { separationConfidenceLabel, separationConfidenceValue, separationHasAlert, separationQualityText } from "../../utils/separation";
import type { HistorySelection } from "./HistoryWindow";

interface MinuteLedgerProps {
  snapshot: StationSnapshot;
  selection: HistorySelection;
  selected: SeparationResult | null;
  onSelect: (result: SeparationResult) => void;
}

interface LedgerRow {
  at: string;
  minute: MainSwitchMinutePoint | null;
  result: SeparationResult | null;
  feedback: PVSubstationPoint[];
}

const rowTime = (row: LedgerRow) => new Date(row.at).getTime();

const feedbackPowerKw = (point: PVSubstationPoint) => {
  if (point.value_type === "average_power") return point.pv_value;
  const hours = (new Date(point.period_end).getTime() - new Date(point.period_start).getTime()) / 3_600_000;
  return hours > 0 ? point.pv_value / hours : 0;
};

const feedbackValue = (row: LedgerRow) => row.result?.station_feedback_value
  ?? (row.feedback.length ? row.feedback.reduce((sum, point) => sum + feedbackPowerKw(point), 0) : null);

const statusLabel = (row: LedgerRow) => {
  if (row.result) {
    const state = row.result.corrected_pv_kw == null && row.feedback.length ? "等待校正" : row.result.result_status;
    return `${state}${separationHasAlert(row.result) ? " · 告警" : ""}`;
  }
  if (row.minute) return row.feedback.length ? "未生成模型结果" : "未生成模型结果 · 等待反馈";
  return row.feedback.length ? "仅反馈 · 缺总开 · 告警" : "全部缺测 · 告警";
};

const statusTone = (row: LedgerRow) => row.result
  ? separationHasAlert(row.result) ? "warning" : row.result.feedback_status === "已反馈" ? "good" : "waiting"
  : row.minute ? "waiting" : "warning";

export function MinuteLedger({ snapshot, selection, selected, onSelect }: MinuteLedgerProps) {
  const [pinned, setPinned] = useState<LedgerRow | null>(null);
  const allRows = useMemo(() => {
    const byTime = new Map<number, LedgerRow>();
    const ensure = (at: string) => {
      const key = new Date(at).getTime();
      let row = byTime.get(key);
      if (!row) {
        row = { at, minute: null, result: null, feedback: [] };
        byTime.set(key, row);
      }
      return row;
    };
    snapshot.minute_points.forEach((minute) => { ensure(minute.event_time).minute = minute; });
    snapshot.separation_results.forEach((result) => { ensure(result.event_time).result = result; });
    snapshot.substation_points.forEach((feedback) => { ensure(feedback.period_start).feedback.push(feedback); });
    return [...byTime.values()].sort((left, right) => rowTime(left) - rowTime(right));
  }, [snapshot.minute_points, snapshot.separation_results, snapshot.substation_points]);
  const rows = useMemo(() => {
    const present = allRows.filter((row) => rowTime(row) >= selection.start && rowTime(row) <= selection.end);
    if (!present.length) return [];
    const indexed = new Map(present.map((row) => [rowTime(row), row]));
    const first = rowTime(present[0]);
    const latest = rowTime(present[present.length - 1]);
    const visible: LedgerRow[] = [];
    for (let at = latest; at >= first && visible.length < 36; at -= 60_000) {
      visible.push(indexed.get(at) ?? { at: new Date(at).toISOString(), minute: null, result: null, feedback: [] });
    }
    return visible;
  }, [allRows, selection.end, selection.start]);

  useEffect(() => { setPinned(null); }, [snapshot.station_id]);

  const detail = pinned
    ? allRows.find((row) => rowTime(row) === rowTime(pinned)) ?? pinned
    : selected ? allRows.find((row) => rowTime(row) === new Date(selected.event_time).getTime())
      ?? { at: selected.event_time, minute: null, result: selected, feedback: [] } : null;
  const result = detail?.result;
  const minute = detail?.minute;
  const feedback = detail ? feedbackValue(detail) : null;
  const detailRows: Array<[string, string]> = detail ? [
    ["总开有功", minute || result ? `${powerText(minute?.active_power_kw ?? result?.total_power_kw)} kW` : "缺测"],
    ["初始光伏", result ? `${powerText(result.initial_pv_kw)} kW` : "未生成"],
    ["矫正后光伏", result?.corrected_pv_kw == null ? "未生成或等待校正" : `${powerText(result.corrected_pv_kw)} kW`],
    ["分站反馈", feedback == null ? "尚未到达" : `${powerText(feedback)} kW`],
    ["A / B / C 三相", minute?.phase_a_power_kw == null ? "缺测" : `${powerText(minute.phase_a_power_kw)} / ${powerText(minute.phase_b_power_kw)} / ${powerText(minute.phase_c_power_kw)} kW`],
    ...(result ? [[separationConfidenceLabel(result), percentText(separationConfidenceValue(result))] as [string, string]] : []),
    ["反馈批次", result?.batch_id ?? detail.feedback[0]?.batch_id ?? "等待回传"],
    ["结果状态", statusLabel(detail)],
    ["模型版本", result?.model_version ?? "未生成"],
    ["模型输入窗口", result ? `${timeText(result.model_window_start)} – ${timeText(result.model_window_end)}` : "未生成"],
    ["输入数据质量", result ? separationQualityText(result) : minute?.quality_flag ?? "缺总开"],
    ["总开测量时间", minute?.measurement_time ? dateTimeText(minute.measurement_time) : "未记录"],
    ["总开发送时间", minute?.frame_time ? dateTimeText(minute.frame_time) : "未记录"],
    ["反馈测量时间", detail.feedback[0]?.measurement_time ? dateTimeText(detail.feedback[0].measurement_time) : "未记录"],
    ["反馈发送时间", detail.feedback[0]?.frame_time ? dateTimeText(detail.feedback[0].frame_time) : "未记录"],
  ] : [];

  return <section className="minute-ledger" aria-label="时刻详细数据列表">
    <header>
      <div><Rows weight="duotone" /><span><b>分钟详细数据</b><small>点击任意记录查看该时刻的输入、输出、反馈与缺测信息</small></span></div>
      <span className="ledger-count"><Database />当前窗口 {rows.length.toLocaleString()} 条可见记录</span>
    </header>
    <div className="ledger-layout">
      <div className="ledger-table" role="table" aria-label="分钟结果记录">
        <div className="ledger-head" role="row">
          <span>时刻</span><span className="ledger-metric cyan"><Circle weight="fill" />总开有功</span><span className="ledger-metric green"><Circle weight="fill" />初始光伏</span><span className="ledger-metric violet"><Circle weight="fill" />矫正后光伏</span><span className="ledger-metric amber"><Circle weight="fill" />分站反馈</span><span>状态</span><span>模型版本</span>
        </div>
        <div className="ledger-scroll">
          {rows.length ? rows.map((row) => <button
            key={rowTime(row)}
            className={`ledger-row ${detail && rowTime(detail) === rowTime(row) ? "active" : ""}`}
            aria-pressed={detail != null && rowTime(detail) === rowTime(row)}
            onClick={() => { setPinned(row); if (row.result) onSelect(row.result); }}
          >
            <span><ClockCounterClockwise />{timeText(row.at)}</span>
            <span>{row.minute || row.result ? `${powerText(row.minute?.active_power_kw ?? row.result?.total_power_kw)} kW` : "缺测"}</span>
            <span>{row.result ? `${powerText(row.result.initial_pv_kw)} kW` : "—"}</span>
            <span>{row.result?.corrected_pv_kw == null ? "—" : `${powerText(row.result.corrected_pv_kw)} kW`}</span>
            <span>{feedbackValue(row) == null ? "等待" : `${powerText(feedbackValue(row))} kW`}</span>
            <span className={`status ${statusTone(row)}`} title={row.result ? separationQualityText(row.result) : statusLabel(row)}><Circle weight="fill" />{statusLabel(row)}</span>
            <span title={row.result?.model_version ?? "未生成"}>{row.result?.model_version ?? "—"}</span>
          </button>) : <div className="ledger-empty">该时间段暂无分钟测量或反馈记录</div>}
        </div>
      </div>

      <aside className="minute-detail">
        <div className="detail-title"><Info weight="duotone" /><span><b>{detail ? dateTimeText(detail.at) : "请选择一条记录"}</b><small>event_time 时刻追溯</small></span>{pinned && <button type="button" className="detail-unlock" aria-label="详情已锁定，点击解锁并恢复自动跟随" onClick={() => setPinned(null)}><LockOpen weight="fill" />已锁定 · 解锁</button>}</div>
        {detail ? <dl>{detailRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{label === "结果状态" ? <span className={`status ${statusTone(detail)}`}><Circle weight="fill" />{value}</span> : value}</dd></div>)}</dl> : <div className="detail-empty">从左侧列表或上方曲线选择时刻</div>}
      </aside>
    </div>
  </section>;
}
