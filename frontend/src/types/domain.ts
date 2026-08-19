export type QualityFlag = "good" | "warning" | "missing" | "out_of_order";
export type ResultStatus = "实时初始" | "等待反馈" | "已反馈校正";
export type FeedbackStatus = "已反馈" | "等待回传";
export type RecognitionLabel = "存在" | "疑似存在" | "未发现明显特征";

export interface MainSwitchMinutePoint {
  station_id: string;
  event_time: string;
  active_power_kw: number;
  phase_a_power_kw?: number;
  phase_b_power_kw?: number;
  phase_c_power_kw?: number;
  reactive_power_kvar: number;
  voltage: number;
  current: number;
  pf: number;
  coverage_ratio?: number;
  quality_flag: QualityFlag;
  source_id?: string;
}

export interface PVSubstationPoint {
  node_id: string;
  period_start: string;
  period_end: string;
  arrival_time: string;
  batch_id: string;
  pv_value: number;
  value_type: "average_power" | "energy";
  capacity_kw: number;
  quality_flag: QualityFlag;
}

export interface FeedbackBatch {
  batch_id: string;
  arrival_time: string;
  coverage_start: string;
  coverage_end: string;
  interval_minutes: number;
  point_count: number;
  participant_nodes: string[];
  missing_nodes: string[];
  node_coverage_ratio: number;
  capacity_coverage_ratio: number;
  completeness_ratio: number;
  quality_flag: QualityFlag;
}

export interface RecognitionItem {
  kind: "pv" | "energy_station" | "charger";
  label: RecognitionLabel;
  score: number;
  features: string[];
}

export interface RecognitionResult {
  result_time: string;
  window_start: string;
  window_end: string;
  model_version: string;
  quality_status?: string;
  items: RecognitionItem[];
}

export interface SeparationResult {
  event_time: string;
  separation_time: string;
  result_status: ResultStatus;
  total_power_kw: number;
  initial_pv_kw: number;
  corrected_pv_kw: number | null;
  station_feedback_value: number | null;
  feedback_status: FeedbackStatus;
  correction_kw: number | null;
  correction_ratio: number | null;
  confidence: number;
  model_version: string;
  batch_id: string | null;
  participating_nodes: string[];
  model_window_start: string;
  model_window_end: string;
  remaining_load_kw: number;
  quality_status?: string;
}

export interface CorrectionRecord {
  correction_id: string;
  batch_id: string;
  period_start: string;
  period_end: string;
  before_kw: number;
  reference_kw: number;
  after_kw: number;
  correction_kw: number;
  confidence: number;
  reason: string;
  updated_at: string;
}

export interface ModelHealth {
  recognition_status: "running" | "degraded";
  separation_status: "running" | "degraded";
  recognition_version: string | null;
  separation_version: string | null;
  last_inference_ms: number | null;
  last_inference_time: string | null;
  window_status?: "warming" | "warming_up" | "ready" | "unavailable";
}

export interface TrainingSummary {
  status: "training" | "completed" | "failed";
  model_version: string;
  dataset_window_days: number;
  sample_count: number;
  validation_score: number;
  completed_at: string;
}

export interface NodeStatus {
  node_id: string;
  name: string;
  capacity_kw: number;
  communication_status: "online" | "delayed" | "offline";
  latest_event_time: string;
  latest_arrival_time: string;
  quality_flag: QualityFlag;
}

export interface DataQualitySummary {
  completeness_ratio: number;
  duplicate_count: number;
  missing_count: number;
  out_of_order_count: number;
  warning_count: number;
  last_checked_at: string;
}

export interface StationSnapshot {
  now: string;
  station_id: string;
  station_name: string;
  minute_points: MainSwitchMinutePoint[];
  separation_results: SeparationResult[];
  substation_points: PVSubstationPoint[];
  feedback_batches: FeedbackBatch[];
  recognition: RecognitionResult | null;
  corrections: CorrectionRecord[];
  training: TrainingSummary | null;
  model_health: ModelHealth;
  node_statuses: NodeStatus[];
  quality: DataQualitySummary;
}

export interface StationSummary {
  station_id: string;
  station_name: string;
  timezone: string;
  status: string;
}

export interface StationDataRange {
  first_event_time: string | null;
  last_event_time: string | null;
  minute_count: number;
  recognition_result_count: number;
  separation_result_count: number;
}

export type ViewMode = "live" | "history";

export type ConnectionState = "connecting" | "online" | "offline" | "degraded";

export type ProcessDataSource = "mock-api" | "rest-api" | "sse";
export type ProcessStepStatus = "waiting" | "running" | "completed" | "failed";

export interface CollectionProcessTelemetry {
  source: ProcessDataSource;
  process_id: string;
  station_id: string;
  status: "running" | "degraded" | "stopped";
  updated_at: string;
  sources: Array<{
    source_id: string;
    name: string;
    cadence: string;
    fields: string[];
    received_count: number;
    status: "online" | "delayed" | "offline";
  }>;
  steps: Array<{
    step_id: string;
    name: string;
    description: string;
    status: ProcessStepStatus;
    processed_count: number;
    latency_ms: number;
  }>;
  quality: DataQualitySummary;
  signal: Array<{ at: string; value: number }>;
  events: Array<{ event_id: string; at: string; label: string; detail: string; level: "info" | "success" | "warning" }>;
}

export interface TrainingProcessRun {
  source: ProcessDataSource;
  run_id: string;
  station_id: string;
  status: "queued" | "running" | "completed" | "failed";
  model_task: "resource_identification" | "pv_separation";
  model_version: string;
  dataset_window_days: number;
  window_size_minutes: number;
  sample_count: number;
  started_at: string;
  completed_at: string | null;
  validation_score: number | null;
  metric_name: "macro_f1" | "activity_f1" | string;
  metric_value: number | null;
  validation_series_name: string;
  source_record?: string;
  steps: Array<{
    step_id: string;
    name: string;
    description: string;
    status: ProcessStepStatus;
    progress: number;
    started_at: string | null;
    completed_at: string | null;
  }>;
  epochs: Array<{
    epoch: number;
    training_loss: number;
    validation_loss: number | null;
    validation_score: number | null;
  }>;
  release_checks: Array<{
    check_id: string;
    name: string;
    status: "passed" | "pending" | "failed";
  }>;
}

export type TimeRange = "1h" | "6h" | "24h" | "7d";
