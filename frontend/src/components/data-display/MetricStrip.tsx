import { BatteryCharging, ChartLineUp, CheckCircle, Gauge, Lightning, SolarPanel, TreeStructure } from "@phosphor-icons/react";
import type { StationSnapshot } from "../../types/domain";
import { percentText, powerText } from "../../utils/format";

export function MetricStrip({ snapshot }: { snapshot: StationSnapshot }) {
  const latest = snapshot.separation_results.at(-1);
  const latestMinute = snapshot.minute_points.at(-1);
  const lastCorrected = [...snapshot.separation_results].reverse().find((row) => row.corrected_pv_kw != null);
  const recognition = Object.fromEntries((snapshot.recognition?.items ?? []).map((item) => [item.kind, item]));
  const score = (kind: "energy_station" | "charger") => recognition[kind]?.score == null ? "--" : recognition[kind].score.toFixed(3);
  const metrics = [
    { label: "台区总开有功", value: latestMinute ? powerText(latestMinute.active_power_kw) : "--", unit: latestMinute ? "kW" : "", tone: "white", icon: Gauge },
    { label: "初始光伏功率", value: latest ? powerText(latest.initial_pv_kw) : "--", unit: latest ? "kW" : "", tone: "blue", icon: ChartLineUp },
    { label: "最近校正光伏", value: lastCorrected ? powerText(lastCorrected.corrected_pv_kw) : "--", unit: lastCorrected ? "kW" : "", tone: "green", icon: SolarPanel },
    { label: "能源站辨识分数", value: score("energy_station"), unit: "", tone: "cyan", icon: BatteryCharging },
    { label: "充电桩辨识分数", value: score("charger"), unit: "", tone: "green", icon: Lightning },
    { label: "剩余负荷", value: latest ? powerText(latest.remaining_load_kw) : "--", unit: latest ? "kW" : "", tone: "violet", icon: TreeStructure },
    { label: "数据完整率", value: percentText(snapshot.quality.completeness_ratio), unit: "", tone: "green", icon: CheckCircle },
  ];
  return <section className="metric-strip" aria-label="实时关键指标">{metrics.map(({ icon: Icon, ...metric }) =>
    <div className={`metric ${metric.tone}`} key={metric.label}><Icon weight="duotone" /><span>{metric.label}<strong>{metric.value}<small>{metric.unit}</small></strong></span></div>)}</section>;
}
