import { CaretRight, ClockCounterClockwise } from "@phosphor-icons/react";
import type { SeparationResult } from "../../types/domain";
import { powerText, timeText } from "../../utils/format";
import { useDemoStore } from "../../stores/useDemoStore";

export function SelectedMinuteBar({ result }: { result: SeparationResult | null }) {
  const setDrawer = useDemoStore((state) => state.setDrawer);
  if (!result) return null;
  const rows = [
    ["台区总有功", powerText(result.total_power_kw), "kW"], ["初始光伏", powerText(result.initial_pv_kw), "kW"],
    ["校正后光伏", powerText(result.corrected_pv_kw), "kW"], ["校正差值", result.correction_kw == null ? "—" : `${result.correction_kw > 0 ? "+" : ""}${powerText(result.correction_kw)}`, "kW"],
    ["剩余负荷", powerText(result.remaining_load_kw), "kW"], ["辨识置信度", (result.confidence * 100).toFixed(1), "%"],
    ["到达批次", result.batch_id ?? "等待回传", ""], ["状态", result.result_status, ""],
  ];
  return <button className="selected-minute" onClick={() => setDrawer(true, "minutes")}><span className="selected-time"><ClockCounterClockwise /><b>{timeText(result.event_time)}</b><small>event_time</small></span>
    {rows.map(([label, value, unit]) => <span className="selected-value" key={label}><small>{label}</small><b>{value}<i>{unit}</i></b></span>)}<CaretRight className="open-icon" /></button>;
}
