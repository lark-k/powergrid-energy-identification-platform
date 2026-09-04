import { useEffect, useMemo, useState } from "react";
import { ClockCounterClockwise, Database, Info, LockOpen, Rows } from "@phosphor-icons/react";
import type { SeparationResult, StationSnapshot } from "../../types/domain";
import { dateTimeText, percentText, powerText, timeText } from "../../utils/format";
import { separationConfidenceLabel, separationConfidenceValue, separationQualityText } from "../../utils/separation";
import type { HistorySelection } from "./HistoryWindow";

interface MinuteLedgerProps {
  snapshot: StationSnapshot;
  selection: HistorySelection;
  selected: SeparationResult | null;
  onSelect: (result: SeparationResult) => void;
}

export function MinuteLedger({ snapshot, selection, selected, onSelect }: MinuteLedgerProps) {
  const [pinned, setPinned] = useState<SeparationResult | null>(null);
  const rows = useMemo(() => snapshot.separation_results
    .filter((row) => {
      const at = new Date(row.event_time).getTime();
      return at >= selection.start && at <= selection.end;
    })
    .slice(-18)
    .reverse(), [selection.end, selection.start, snapshot.separation_results]);

  useEffect(() => { setPinned(null); }, [snapshot.station_id]);

  const detail = pinned
    ? snapshot.separation_results.find((row) => row.event_time === pinned.event_time) ?? pinned
    : selected;
  const minute = detail ? snapshot.minute_points.find((point) => point.event_time === detail.event_time) : null;
  const detailRows = detail ? [
    ["总开有功", `${powerText(detail.total_power_kw)} kW`],
    ["初始光伏", `${powerText(detail.initial_pv_kw)} kW`],
    ["矫正后光伏", detail.corrected_pv_kw == null ? "等待反馈" : `${powerText(detail.corrected_pv_kw)} kW`],
    ["分站反馈", detail.station_feedback_value == null ? "尚未到达" : `${powerText(detail.station_feedback_value)} kW`],
    ["A / B / C 三相", minute?.phase_a_power_kw == null ? "后台未返回" : `${powerText(minute.phase_a_power_kw)} / ${powerText(minute.phase_b_power_kw)} / ${powerText(minute.phase_c_power_kw)} kW`],
    [separationConfidenceLabel(detail), percentText(separationConfidenceValue(detail))],
    ["反馈批次", detail.batch_id ?? "等待回传"],
    ["结果状态", detail.result_status],
    ["模型版本", detail.model_version],
    ["模型输入窗口", `${timeText(detail.model_window_start)} – ${timeText(detail.model_window_end)}`],
    ["输入数据质量", separationQualityText(detail)],
  ] : [];

  return <section className="minute-ledger" aria-label="时刻详细数据列表">
    <header>
      <div><Rows weight="duotone" /><span><b>分钟详细数据</b><small>点击任意记录查看该时刻的输入、输出、反馈与模型追溯信息</small></span></div>
      <span className="ledger-count"><Database />当前窗口 {rows.length.toLocaleString()} 条可见记录</span>
    </header>
    <div className="ledger-layout">
      <div className="ledger-table" role="table" aria-label="分钟结果记录">
        <div className="ledger-head" role="row">
          <span>时刻</span><span>总开有功</span><span>初始光伏</span><span>矫正后光伏</span><span>分站反馈</span><span>状态</span><span>模型版本</span>
        </div>
        <div className="ledger-scroll">
          {rows.length ? rows.map((row) => <button
            key={row.event_time}
            className={`ledger-row ${detail?.event_time === row.event_time ? "active" : ""}`}
            onClick={() => { setPinned(row); onSelect(row); }}
          >
            <span><ClockCounterClockwise />{timeText(row.event_time)}</span>
            <span>{powerText(row.total_power_kw)} kW</span>
            <span>{powerText(row.initial_pv_kw)} kW</span>
            <span>{row.corrected_pv_kw == null ? "—" : `${powerText(row.corrected_pv_kw)} kW`}</span>
            <span>{row.station_feedback_value == null ? "等待" : `${powerText(row.station_feedback_value)} kW`}</span>
            <span
              className={`status ${row.quality_status !== "good" ? "warning" : row.feedback_status === "已反馈" ? "good" : "waiting"}`}
              title={separationQualityText(row)}
            >{row.result_status}{row.quality_status !== "good" ? " · 告警" : ""}</span>
            <span title={row.model_version}>{row.model_version}</span>
          </button>) : <div className="ledger-empty">该时间段暂无真实分离记录</div>}
        </div>
      </div>

      <aside className="minute-detail">
        <div className="detail-title"><Info weight="duotone" /><span><b>{detail ? dateTimeText(detail.event_time) : "请选择一条记录"}</b><small>event_time 时刻追溯</small></span>{pinned && <button type="button" className="detail-unlock" aria-label="详情已锁定，点击解锁并恢复自动跟随" onClick={() => setPinned(null)}><LockOpen weight="fill" />已锁定 · 解锁</button>}</div>
        {detail ? <dl>{detailRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl> : <div className="detail-empty">从左侧列表或上方曲线选择时刻</div>}
      </aside>
    </div>
  </section>;
}
