import { SYSTEM_CONFIG } from "../config/system";
import { snapshotAt } from "../mocks/generator";
import type { CollectionProcessTelemetry, StationSnapshot, TrainingProcessRun } from "../types/domain";

export interface ProcessDataAdapter {
  getCollectionProcess(stationId: string, at?: Date): Promise<CollectionProcessTelemetry>;
  getLatestTrainingRun(stationId: string): Promise<TrainingProcessRun>;
  connectCollectionStream(stationId: string, onTelemetry: (telemetry: CollectionProcessTelemetry) => void): () => void;
}

export const collectionProcessFromSnapshot = (snapshot: StationSnapshot): CollectionProcessTelemetry => {
  const onlineNodes = snapshot.node_statuses.filter((node) => node.communication_status === "online").length;
  const latestMinute = snapshot.minute_points.at(-1);
  const latestNode = snapshot.node_statuses.at(-1);
  return {
    source: "mock-api",
    process_id: `COL-${snapshot.station_id}`,
    station_id: snapshot.station_id,
    status: onlineNodes === snapshot.node_statuses.length ? "running" : "degraded",
    updated_at: snapshot.quality.last_checked_at,
    sources: [
      {
        source_id: "main-station",
        name: "主站计量",
        cadence: "1 min",
        fields: ["功率", "电压", "电流"],
        received_count: snapshot.minute_points.length,
        status: "online",
      },
      {
        source_id: "pv-substations",
        name: "光伏分站",
        cadence: "15 min",
        fields: ["平均功率", "容量"],
        received_count: snapshot.substation_points.length,
        status: onlineNodes === snapshot.node_statuses.length ? "online" : "delayed",
      },
      {
        source_id: "feedback-batches",
        name: "反馈批次",
        cadence: "async",
        fields: ["覆盖区间", "到达时间"],
        received_count: snapshot.feedback_batches.length,
        status: "online",
      },
    ],
    steps: [
      { step_id: "handshake", name: "通信握手", description: "链路状态确认", status: "completed", processed_count: onlineNodes, latency_ms: 18 },
      { step_id: "time-align", name: "时间对齐", description: "事件时间归一", status: "completed", processed_count: snapshot.minute_points.length, latency_ms: 42 },
      { step_id: "quality-gate", name: "质量闸门", description: "缺失 / 重复 / 乱序", status: "completed", processed_count: snapshot.minute_points.length + snapshot.substation_points.length, latency_ms: 63 },
      { step_id: "sequence-store", name: "序列入湖", description: "分钟级数据就绪", status: "running", processed_count: snapshot.minute_points.length + snapshot.substation_points.length, latency_ms: 27 },
    ],
    quality: snapshot.quality,
    signal: snapshot.minute_points.slice(-42).map((point) => ({ at: point.event_time, value: point.active_power_kw })),
    events: [
      { event_id: "quality", at: snapshot.quality.last_checked_at, label: "质量校验完成", detail: `完整率 ${(snapshot.quality.completeness_ratio * 100).toFixed(1)}%`, level: "success" },
      { event_id: "substation", at: latestNode?.latest_arrival_time ?? snapshot.now, label: "分站批次接入", detail: `${snapshot.substation_points.length.toLocaleString()} 条已归档`, level: "info" },
      { event_id: "main-station", at: latestMinute?.event_time ?? snapshot.now, label: "主站分钟数据到达", detail: "event_time 已对齐", level: "info" },
    ],
  };
};

export const trainingProcessFromSnapshot = (snapshot: StationSnapshot): TrainingProcessRun => {
  const completedAt = new Date(snapshot.training.completed_at);
  const startedAt = new Date(completedAt.getTime() - 28 * 60_000);
  const target = snapshot.training.validation_score;
  const epochs = Array.from({ length: 12 }, (_, index) => {
    const progress = (1 - Math.exp(-(index + 1) / 3.1)) / (1 - Math.exp(-12 / 3.1));
    return {
      epoch: index + 1,
      training_loss: Number((0.62 * Math.exp(-index / 3.25) + 0.085).toFixed(3)),
      validation_score: index === 11 ? target : Number((0.71 + (target - 0.71) * progress).toFixed(3)),
    };
  });
  const stepDuration = 5 * 60_000;
  return {
    source: "mock-api",
    run_id: `TRAIN-${snapshot.station_id}-${completedAt.getTime()}`,
    station_id: snapshot.station_id,
    status: snapshot.training.status,
    model_version: snapshot.training.model_version,
    dataset_window_days: snapshot.training.dataset_window_days,
    sample_count: snapshot.training.sample_count,
    started_at: startedAt.toISOString(),
    completed_at: snapshot.training.completed_at,
    validation_score: snapshot.training.validation_score,
    steps: [
      ["sample", "样本准备", "训练窗口装载"],
      ["clean", "清洗切片", "异常样本剔除"],
      ["feature", "特征构建", "时序特征对齐"],
      ["fit", "离线拟合", "参数收敛"],
      ["release", "验证发布", "版本归档"],
    ].map(([step_id, name, description], index) => ({
      step_id,
      name,
      description,
      status: "completed" as const,
      progress: 1,
      started_at: new Date(startedAt.getTime() + index * stepDuration).toISOString(),
      completed_at: new Date(startedAt.getTime() + (index + 1) * stepDuration).toISOString(),
    })),
    epochs,
    release_checks: [
      { check_id: "quality", name: "数据质量检查", status: "passed" },
      { check_id: "stability", name: "收敛稳定性检查", status: "passed" },
      { check_id: "regression", name: "离线回归验证", status: "passed" },
    ],
  };
};

class MockProcessAdapter implements ProcessDataAdapter {
  async getCollectionProcess(_stationId: string, at = new Date()) {
    return collectionProcessFromSnapshot(snapshotAt(at));
  }

  async getLatestTrainingRun(_stationId: string) {
    return trainingProcessFromSnapshot(snapshotAt(new Date()));
  }

  connectCollectionStream(stationId: string, onTelemetry: (telemetry: CollectionProcessTelemetry) => void) {
    const timer = window.setInterval(() => onTelemetry(collectionProcessFromSnapshot(snapshotAt(new Date()))), 4_000);
    return () => window.clearInterval(timer);
  }
}

class HttpProcessAdapter implements ProcessDataAdapter {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Process API request failed: ${response.status}`);
    return response.json() as Promise<T>;
  }

  getCollectionProcess(stationId: string) {
    return this.request<CollectionProcessTelemetry>(`/api/v1/stations/${encodeURIComponent(stationId)}/process/collection`);
  }

  getLatestTrainingRun(stationId: string) {
    return this.request<TrainingProcessRun>(`/api/v1/stations/${encodeURIComponent(stationId)}/training-runs/latest`);
  }

  connectCollectionStream(stationId: string, onTelemetry: (telemetry: CollectionProcessTelemetry) => void) {
    const stream = new EventSource(`${this.baseUrl}/api/v1/stations/${encodeURIComponent(stationId)}/process/collection/stream`);
    stream.addEventListener("telemetry", (event) => onTelemetry(JSON.parse((event as MessageEvent<string>).data) as CollectionProcessTelemetry));
    return () => stream.close();
  }
}

export const processAdapter: ProcessDataAdapter = SYSTEM_CONFIG.sourceMode === "api"
  ? new HttpProcessAdapter(SYSTEM_CONFIG.apiBaseUrl)
  : new MockProcessAdapter();

// Backend contract reserved for direct replacement:
// GET /api/v1/stations/{stationId}/process/collection
// GET /api/v1/stations/{stationId}/training-runs/latest
// SSE /api/v1/stations/{stationId}/process/collection/stream (event: telemetry)
