import { BatteryCharging, ChartLineUp, CheckCircle, Gauge, Lightning, SolarPanel, TreeStructure } from "@phosphor-icons/react";
import type { StationSnapshot } from "../../types/domain";
import { percentText, powerText } from "../../utils/format";

export function MetricStrip({ snapshot }: { snapshot: StationSnapshot }) {
  const latest = snapshot.separation_results.at(-1)!;
  const lastCorrected = [...snapshot.separation_results].reverse().find((row) => row.corrected_pv_kw != null);
  const recognition = Object.fromEntries(snapshot.recognition.items.map((item) => [item.kind, item]));
  const metrics = [
    { label: "台区总有功", value: powerText(latest.total_power_kw), unit: "kW", tone: "white", icon: Gauge },
    { label: "初始光伏功率", value: powerText(latest.initial_pv_kw), unit: "kW", tone: "blue", icon: ChartLineUp },
    { label: "最近校正光伏", value: powerText(lastCorrected?.corrected_pv_kw), unit: "kW", tone: "green", icon: SolarPanel },
    { label: "储能辨识分数", value: recognition.storage.score.toFixed(3), unit: "", tone: "cyan", icon: BatteryCharging },
    { label: "充电桩辨识分数", value: recognition.charger.score.toFixed(3), unit: "", tone: "green", icon: Lightning },
    { label: "剩余负荷", value: powerText(latest.remaining_load_kw), unit: "kW", tone: "violet", icon: TreeStructure },
    { label: "校正覆盖度", value: percentText(snapshot.quality.completeness_ratio), unit: "", tone: "green", icon: CheckCircle },
  ];
  return <section className="metric-strip" aria-label="实时关键指标">{metrics.map(({ icon: Icon, ...metric }) =>
    <div className={`metric ${metric.tone}`} key={metric.label}><Icon weight="duotone" /><span>{metric.label}<strong>{metric.value}<small>{metric.unit}</small></strong></span></div>)}</section>;
}
