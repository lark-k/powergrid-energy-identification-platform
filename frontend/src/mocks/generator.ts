import { SYSTEM_CONFIG } from "../config/system";
import type { CorrectionRecord, FeedbackBatch, MainSwitchMinutePoint, NodeStatus, PVSubstationPoint, RecognitionResult, SeparationResult, StationSnapshot } from "../types/domain";

const DAY_START = new Date();
DAY_START.setHours(0, 0, 0, 0);
const minute = 60_000;
const day = 24 * 60 * minute;
const DATA_DAYS = 7;
const DATA_START = new Date(DAY_START.getTime() - (DATA_DAYS - 1) * day);
const DATA_END = new Date(DAY_START.getTime() + day - minute);
const capacityTotal = SYSTEM_CONFIG.nodes.reduce((sum, node) => sum + node.capacity_kw, 0);

const noise = (index: number, amplitude = 1) => {
  const x = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return ((x - Math.floor(x)) - 0.5) * amplitude;
};
const gaussian = (x: number, center: number, width: number) => Math.exp(-Math.pow(x - center, 2) / (2 * width * width));
const truePvAt = (m: number, dayIndex: number) => {
  const solar = Math.max(0, Math.sin(((m - 360) / 780) * Math.PI));
  const dailyScale = 0.91 + 0.07 * Math.sin((dayIndex + 1) * 1.37);
  const cloudShift = (dayIndex % 3) * 11;
  const cloud = 1 - (0.1 + dayIndex * 0.008) * gaussian(m, 645 + cloudShift, 24) - 0.2 * gaussian(m, 805 - cloudShift, 18);
  return Math.max(0, capacityTotal * Math.pow(solar, 1.48) * cloud * dailyScale * (0.975 + noise(dayIndex * 1440 + m, 0.04)));
};

const mainSwitch: MainSwitchMinutePoint[] = [];
const truePv: number[] = [];
const initialPv: number[] = [];

for (let i = 0; i < DATA_DAYS * 1440; i += 1) {
  const dayIndex = Math.floor(i / 1440);
  const minuteOfDay = i % 1440;
  const event = new Date(DATA_START.getTime() + i * minute);
  const weekdayFactor = event.getDay() === 0 || event.getDay() === 6 ? 0.94 : 1;
  const load = (15_200 + 4_800 * gaussian(minuteOfDay, 505, 105) + 7_200 * gaussian(minuteOfDay, 1160, 135)) * weekdayFactor;
  const charger = (minuteOfDay >= 430 && minuteOfDay < 535 ? 2100 : 0) + (minuteOfDay >= 1070 && minuteOfDay < 1310 ? 4200 : 0);
  const energyStationSignal = minuteOfDay >= 90 && minuteOfDay < 270 ? 1600 : minuteOfDay >= 1090 && minuteOfDay < 1260 ? -1800 : 0;
  const pv = truePvAt(minuteOfDay, dayIndex);
  const total = Math.max(2500, load + charger + energyStationSignal + pv * 0.35 + noise(i, 720));
  const initial = Math.max(0, pv * (0.9 + 0.035 * Math.sin(i / 47)) + noise(i + 9, 520));
  truePv.push(pv);
  initialPv.push(initial);
  mainSwitch.push({
    station_id: SYSTEM_CONFIG.stationId,
    event_time: event.toISOString(),
    active_power_kw: Math.round(total),
    reactive_power_kvar: Math.round(total * 0.18),
    voltage: Math.round((231.5 + noise(i, 3.2)) * 10) / 10,
    current: Math.round((total / 0.38) * 10) / 10,
    pf: Math.round((0.965 + noise(i, 0.018)) * 1000) / 1000,
    quality_flag: i === 3 * 1440 + 742 ? "out_of_order" : i === 4 * 1440 + 827 ? "warning" : "good",
  });
}

interface BatchPlan { arrival: string; periodStarts: string[]; missing?: string[]; warning?: boolean }
const batchPlans: BatchPlan[] = [
  { arrival: "00:47", periodStarts: ["00:00", "00:15", "00:30"] },
  { arrival: "01:19", periodStarts: ["00:45", "01:00"] },
  { arrival: "02:07", periodStarts: ["01:15", "01:30", "01:45"] },
  { arrival: "02:39", periodStarts: ["02:00", "02:15"] },
  { arrival: "03:47", periodStarts: ["02:30", "02:45", "03:00", "03:15", "03:30"] },
  { arrival: "04:19", periodStarts: ["03:45", "04:00"] },
  { arrival: "05:06", periodStarts: ["04:15", "04:30", "04:45"] },
  { arrival: "05:38", periodStarts: ["05:00", "05:15"] },
  { arrival: "06:25", periodStarts: ["05:30", "05:45", "06:00"] },
  { arrival: "07:33", periodStarts: ["06:15", "06:30", "06:45", "07:00", "07:15"] },
  { arrival: "08:05", periodStarts: ["07:30", "07:45"] },
  { arrival: "08:52", periodStarts: ["08:00", "08:15"] },
  { arrival: "09:05", periodStarts: ["08:30", "08:45"] },
  { arrival: "09:37", periodStarts: ["09:00", "09:15"] },
  { arrival: "10:24", periodStarts: ["09:30", "09:45", "10:00", "10:15"] },
  { arrival: "11:32", periodStarts: ["10:30", "10:45", "11:00", "11:15"], warning: true },
  { arrival: "12:04", periodStarts: ["11:30", "11:45"] },
  { arrival: "12:51", periodStarts: ["12:00", "12:15", "12:30"] },
  { arrival: "13:23", periodStarts: ["12:45", "13:00"] },
  { arrival: "13:52", periodStarts: ["13:15", "13:30"] },
  { arrival: "14:20:35", periodStarts: ["13:45", "14:00"], missing: ["PV-06"] },
  { arrival: "15:28", periodStarts: ["14:15", "14:30", "14:45", "15:00"] },
  { arrival: "16:15", periodStarts: ["15:15", "15:30", "15:45", "16:00"] },
  { arrival: "17:02", periodStarts: ["16:15", "16:30", "16:45"] },
  { arrival: "17:49", periodStarts: ["17:00", "17:15", "17:30"] },
  { arrival: "18:21", periodStarts: ["17:45", "18:00"] },
  { arrival: "19:29", periodStarts: ["18:15", "18:30", "18:45", "19:00"] },
  { arrival: "20:01", periodStarts: ["19:15", "19:30", "19:45"] },
  { arrival: "20:48", periodStarts: ["20:00", "20:15", "20:30"] },
  { arrival: "21:20", periodStarts: ["20:45", "21:00"] },
  { arrival: "22:07", periodStarts: ["21:15", "21:30", "21:45"] },
  { arrival: "22:39", periodStarts: ["22:00", "22:15"] },
  { arrival: "23:26", periodStarts: ["22:30", "22:45", "23:00"] },
];

const parseClock = (clock: string, baseDate: Date) => {
  const [hour, min, second = 0] = clock.split(":").map(Number);
  const date = new Date(baseDate.getTime());
  date.setHours(hour, min, second, 0);
  return date;
};
const substationPoints: PVSubstationPoint[] = [];
const allBatches: FeedbackBatch[] = [];

let previousArrival: Date | null = null;
let batchSequence = 0;

const appendBatch = (arrival: Date, periods: Date[], plan: Pick<BatchPlan, "missing" | "warning">) => {
  const dateKey = `${arrival.getFullYear()}${String(arrival.getMonth() + 1).padStart(2, "0")}${String(arrival.getDate()).padStart(2, "0")}`;
  const batchId = `B${dateKey}${String(batchSequence + 1).padStart(3, "0")}`;
  const activeNodes = SYSTEM_CONFIG.nodes.filter((node) => !plan.missing?.includes(node.node_id));
  periods.forEach((start, periodIndex) => {
    const startIndex = Math.round((start.getTime() - DATA_START.getTime()) / minute);
    const pv = truePv.slice(startIndex, startIndex + 15).reduce((sum, value) => sum + value, 0) / 15;
    activeNodes.forEach((node, nodeIndex) => substationPoints.push({
      node_id: node.node_id,
      period_start: start.toISOString(),
      period_end: new Date(start.getTime() + 15 * minute).toISOString(),
      arrival_time: arrival.toISOString(),
      batch_id: batchId,
      pv_value: Math.max(0, Math.round(pv * (node.capacity_kw / capacityTotal) * (0.985 + noise(batchSequence * 50 + periodIndex * 7 + nodeIndex, 0.03)))),
      value_type: "average_power",
      capacity_kw: node.capacity_kw,
      quality_flag: plan.warning && nodeIndex === 3 && periodIndex === 1 ? "warning" : "good",
    }));
  });

  const first = periods[0];
  const last = periods.at(-1)!;
  const activeCapacity = activeNodes.reduce((sum, node) => sum + node.capacity_kw, 0);
  allBatches.push({
    batch_id: batchId,
    arrival_time: arrival.toISOString(),
    coverage_start: first.toISOString(),
    coverage_end: new Date(last.getTime() + 15 * minute).toISOString(),
    interval_minutes: previousArrival ? Math.round((arrival.getTime() - previousArrival.getTime()) / minute) : 35,
    point_count: activeNodes.length * periods.length,
    participant_nodes: activeNodes.map((node) => node.node_id),
    missing_nodes: plan.missing ?? [],
    node_coverage_ratio: activeNodes.length / SYSTEM_CONFIG.nodes.length,
    capacity_coverage_ratio: activeCapacity / capacityTotal,
    completeness_ratio: plan.warning ? 0.94 : activeNodes.length / SYSTEM_CONFIG.nodes.length,
    quality_flag: plan.warning ? "warning" : plan.missing?.length ? "missing" : "good",
  });
  previousArrival = arrival;
  batchSequence += 1;
};

for (let dayIndex = 0; dayIndex < DATA_DAYS; dayIndex += 1) {
  const currentDay = new Date(DATA_START.getTime() + dayIndex * day);
  if (dayIndex > 0) {
    appendBatch(parseClock("00:32", currentDay), [
      new Date(currentDay.getTime() - 45 * minute),
      new Date(currentDay.getTime() - 30 * minute),
      new Date(currentDay.getTime() - 15 * minute),
    ], {});
  }
  batchPlans.forEach((plan) => appendBatch(
    parseClock(plan.arrival, currentDay),
    plan.periodStarts.map((clock) => parseClock(clock, currentDay)),
    plan,
  ));
}

const recognitionAt = (now: Date): RecognitionResult => ({
  result_time: new Date(now.getTime() - 4_000).toISOString(),
  window_start: new Date(now.getTime() - 6 * 60 * minute).toISOString(),
  window_end: now.toISOString(),
  model_version: SYSTEM_CONFIG.recognitionVersion,
  items: [
    { kind: "pv", label: "存在", score: 0.972, features: ["日照相关性", "午间反向特征"] },
    { kind: "energy_station", label: "存在", score: 0.931, features: ["持续功率特征", "时段性变化"] },
    { kind: "charger", label: "存在", score: 0.956, features: ["阶跃负荷", "持续时长"] },
  ],
});

export function snapshotAt(nowInput: Date): StationSnapshot {
  const now = new Date(Math.max(DATA_START.getTime(), Math.min(nowInput.getTime(), DATA_END.getTime())));
  const minutes = mainSwitch.filter((point) => new Date(point.event_time) <= now);
  const batches = allBatches.filter((batch) => new Date(batch.arrival_time) <= now);
  const arrived = substationPoints.filter((point) => new Date(point.arrival_time) <= now);
  const latestBatch = batches.at(-1);
  const arrivedByPeriod = new Map<string, PVSubstationPoint[]>();
  const periodsByBatch = new Map<string, Set<string>>();
  arrived.forEach((point) => {
    const periodRows = arrivedByPeriod.get(point.period_start) ?? [];
    periodRows.push(point);
    arrivedByPeriod.set(point.period_start, periodRows);
    const batchPeriods = periodsByBatch.get(point.batch_id) ?? new Set<string>();
    batchPeriods.add(point.period_start);
    periodsByBatch.set(point.batch_id, batchPeriods);
  });
  const separation: SeparationResult[] = minutes.map((point, index) => {
    const event = new Date(point.event_time);
    const periodStartDate = new Date(event.getTime());
    periodStartDate.setMinutes(Math.floor(event.getMinutes() / 15) * 15, 0, 0);
    const periodStart = periodStartDate.toISOString();
    const matching = arrivedByPeriod.get(periodStart) ?? [];
    const reference = matching.length ? matching.reduce((sum, row) => sum + row.pv_value, 0) : null;
    const hasFeedback = matching.length > 0;
    const corrected = hasFeedback ? Math.max(0, truePv[index] * (0.992 + noise(index + 71, 0.015))) : null;
    const initial = initialPv[index];
    const correction = corrected == null ? null : initial - corrected;
    const ageMinutes = (now.getTime() - event.getTime()) / minute;
    return {
      event_time: point.event_time,
      separation_time: new Date(event.getTime() + 2_100 + Math.abs(noise(index, 1400))).toISOString(),
      result_status: hasFeedback ? "已反馈校正" : ageMinutes <= 5 ? "实时初始" : "等待反馈",
      total_power_kw: point.active_power_kw,
      initial_pv_kw: Math.round(initial),
      corrected_pv_kw: corrected == null ? null : Math.round(corrected),
      station_feedback_value: reference,
      feedback_status: hasFeedback ? "已反馈" : "等待回传",
      correction_kw: correction == null ? null : Math.round(correction),
      correction_ratio: correction == null || initial === 0 ? null : correction / initial,
      confidence: hasFeedback ? 0.936 : 0.872,
      model_version: SYSTEM_CONFIG.modelVersion,
      batch_id: matching[0]?.batch_id ?? null,
      participating_nodes: [...new Set(matching.map((row) => row.node_id))],
      model_window_start: new Date(event.getTime() - 60 * minute).toISOString(),
      model_window_end: point.event_time,
      remaining_load_kw: Math.max(0, Math.round(point.active_power_kw - (corrected ?? initial))),
    };
  });

  const corrections: CorrectionRecord[] = batches.flatMap((batch, batchIndex) => {
    const periods = [...(periodsByBatch.get(batch.batch_id) ?? [])];
    return periods.map((period, periodIndex) => {
      const start = new Date(period);
      const idx = Math.round((start.getTime() - DATA_START.getTime()) / minute);
      const before = initialPv.slice(idx, idx + 15).reduce((sum, value) => sum + value, 0) / 15;
      const referenceRows = arrivedByPeriod.get(period) ?? [];
      const reference = referenceRows.length ? referenceRows.reduce((sum, row) => sum + row.pv_value, 0) : before;
      return { correction_id: `C-${batchIndex + 1}-${periodIndex + 1}`, batch_id: batch.batch_id, period_start: period,
        period_end: new Date(start.getTime() + 15 * minute).toISOString(), before_kw: Math.round(before), reference_kw: Math.round(reference),
        after_kw: Math.round(reference), correction_kw: Math.round(before - reference), confidence: batch.completeness_ratio * 0.97,
        reason: "分站同期反馈约束，保持分钟曲线形状回补", updated_at: batch.arrival_time };
    });
  });

  const nodeStatuses: NodeStatus[] = SYSTEM_CONFIG.nodes.map((node) => {
    const rows = arrived.filter((row) => row.node_id === node.node_id);
    const latest = rows.at(-1);
    const missingLatest = latestBatch?.missing_nodes.includes(node.node_id);
    return { ...node,
      communication_status: missingLatest ? "offline" : latest && now.getTime() - new Date(latest.arrival_time).getTime() > 55 * minute ? "delayed" : "online",
      latest_event_time: latest?.period_end ?? DATA_START.toISOString(), latest_arrival_time: latest?.arrival_time ?? DATA_START.toISOString(),
      quality_flag: missingLatest ? "missing" : latest?.quality_flag ?? "good" };
  });

  return {
    now: now.toISOString(), station_id: SYSTEM_CONFIG.stationId, station_name: SYSTEM_CONFIG.stationName,
    minute_points: minutes, separation_results: separation, substation_points: arrived, feedback_batches: batches,
    recognition: recognitionAt(now), corrections,
    training: {
      status: "completed",
      model_version: SYSTEM_CONFIG.modelVersion,
      dataset_window_days: 30,
      sample_count: 43_200,
      validation_score: 0.947,
      completed_at: new Date(now.getTime() - 38 * 60 * minute).toISOString(),
    },
    model_health: { recognition_status: "running", separation_status: "running", recognition_version: SYSTEM_CONFIG.recognitionVersion,
      separation_version: SYSTEM_CONFIG.modelVersion, last_inference_ms: 246, last_inference_time: new Date(now.getTime() - 1200).toISOString() },
    node_statuses: nodeStatuses,
    quality: { completeness_ratio: 0.968, duplicate_count: 0, missing_count: latestBatch?.missing_nodes.length ?? 0,
      out_of_order_count: 1, warning_count: 1, last_checked_at: now.toISOString() },
  };
}

export const DEMO_DATASET = { mainSwitch, substationPoints, feedbackBatches: allBatches };
