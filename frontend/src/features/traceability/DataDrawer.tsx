import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DownloadSimple, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useDemoStore } from "../../stores/useDemoStore";
import type { StationSnapshot } from "../../types/domain";
import { dateTimeText, percentText, powerText, timeText } from "../../utils/format";
import { VirtualDataTable, type DataRow } from "../../components/data-display/VirtualDataTable";

const column = (header: string, accessorKey: string, size: number): ColumnDef<DataRow> => ({ header, accessorKey, size });
export function DataDrawer({ snapshot }: { snapshot: StationSnapshot }) {
  const { drawerOpen, drawerTab, setDrawer, selected, exportData } = useDemoStore();
  const [query, setQuery] = useState("");
  const tabs = { minutes: "分钟级结果", feedback: "分站反馈记录", nodes: "节点记录", corrections: "校正记录" } as const;
  const { data, columns } = useMemo(() => {
    if (drawerTab === "feedback") return {
      columns: [column("批次 ID", "id", 190), column("到达时间", "arrival", 170), column("历史覆盖", "coverage", 170), column("间隔", "interval", 90), column("参与节点", "nodes", 90), column("完整率", "complete", 90), column("质量", "quality", 90)],
      data: snapshot.feedback_batches.map((row) => ({ id: row.batch_id, arrival: dateTimeText(row.arrival_time), coverage: `${timeText(row.coverage_start)}–${timeText(row.coverage_end)}`, interval: `${row.interval_minutes} min`, nodes: `${row.participant_nodes.length}/6`, complete: percentText(row.completeness_ratio), quality: row.quality_flag })),
    };
    if (drawerTab === "nodes") return {
      columns: [column("节点", "id", 100), column("名称", "name", 170), column("容量", "capacity", 110), column("通信", "status", 100), column("最新事件时间", "event", 170), column("最新到达时间", "arrival", 170), column("质量", "quality", 90)],
      data: snapshot.node_statuses.map((row) => ({ id: row.node_id, name: row.name, capacity: `${powerText(row.capacity_kw)} kWp`, status: row.communication_status, event: dateTimeText(row.latest_event_time), arrival: dateTimeText(row.latest_arrival_time), quality: row.quality_flag })),
    };
    if (drawerTab === "corrections") return {
      columns: [column("校正记录", "id", 110), column("批次", "batch", 180), column("历史时段", "period", 150), column("校正前", "before", 100), column("参考值", "reference", 100), column("校正后", "after", 100), column("校正量", "delta", 100), column("置信度", "confidence", 90)],
      data: snapshot.corrections.map((row) => ({ id: row.correction_id, batch: row.batch_id, period: `${timeText(row.period_start)}–${timeText(row.period_end)}`, before: powerText(row.before_kw), reference: powerText(row.reference_kw), after: powerText(row.after_kw), delta: powerText(row.correction_kw), confidence: percentText(row.confidence) })),
    };
    return {
      columns: [column("event_time", "event", 170), column("总功率", "total", 100), column("初始光伏", "initial", 100), column("校正光伏", "corrected", 100), column("校正量", "delta", 90), column("结果状态", "status", 120), column("反馈状态", "feedback", 100), column("批次", "batch", 180)],
      data: snapshot.separation_results.map((row) => ({ event: dateTimeText(row.event_time), total: powerText(row.total_power_kw), initial: powerText(row.initial_pv_kw), corrected: powerText(row.corrected_pv_kw), delta: powerText(row.correction_kw), status: row.result_status, feedback: row.feedback_status, batch: row.batch_id ?? "—" })),
    };
  }, [drawerTab, snapshot]);
  const filtered = query ? data.filter((row) => Object.values(row).some((value) => String(value).toLowerCase().includes(query.toLowerCase()))) : data;
  return <aside className={`data-drawer ${drawerOpen ? "open" : ""}`} aria-hidden={!drawerOpen}>
    <header><div className="drawer-tabs">{Object.entries(tabs).map(([id, label]) => <button className={drawerTab === id ? "active" : ""} key={id} onClick={() => setDrawer(true, id as keyof typeof tabs)}>{label}</button>)}</div>
      <label><MagnifyingGlass /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选当前记录" /></label>
      <button onClick={exportData}><DownloadSimple />导出</button><button aria-label="关闭" onClick={() => setDrawer(false)}><X /></button></header>
    <div className="drawer-content"><VirtualDataTable data={filtered} columns={columns} />
      <section className="trace-card"><b>分钟结果追溯</b>{selected ? <dl>
        <div><dt>原始综合功率</dt><dd>{powerText(selected.total_power_kw)} kW</dd></div><div><dt>初始分离值</dt><dd>{powerText(selected.initial_pv_kw)} kW</dd></div>
        <div><dt>校正后光伏</dt><dd>{powerText(selected.corrected_pv_kw)} kW</dd></div><div><dt>生成时间</dt><dd>{dateTimeText(selected.separation_time)}</dd></div>
        <div><dt>反馈批次</dt><dd>{selected.batch_id ?? "等待回传"}</dd></div><div><dt>参与节点</dt><dd>{selected.participating_nodes.join("、") || "—"}</dd></div>
        <div><dt>模型输入窗口</dt><dd>{timeText(selected.model_window_start)}–{timeText(selected.model_window_end)}</dd></div><div><dt>模型版本</dt><dd>{selected.model_version}</dd></div>
      </dl> : null}</section></div>
  </aside>;
}
