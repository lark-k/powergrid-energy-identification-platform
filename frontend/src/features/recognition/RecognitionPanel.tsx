import { BatteryCharging, Lightning, SolarPanel } from "@phosphor-icons/react";
import type { RecognitionResult } from "../../types/domain";

const icons = { pv: SolarPanel, storage: BatteryCharging, charger: Lightning };
const labels = { pv: "光伏", storage: "储能", charger: "充电桩" };
export function RecognitionPanel({ result }: { result: RecognitionResult }) {
  return <section className="glass-panel recognition-panel"><header><b>辨识模块</b><span>独立标签</span></header><div className="recognition-grid">{result.items.map((item) => {
    const Icon = icons[item.kind];
    return <button key={item.kind} title={`${item.label} · ${item.features.join("、")}`}><Icon weight="duotone" /><span>{labels[item.kind]}</span><strong>{item.score.toFixed(3)}</strong><i className="online-dot" /></button>;
  })}</div></section>;
}
