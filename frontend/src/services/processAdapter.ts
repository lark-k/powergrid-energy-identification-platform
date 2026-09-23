import { SYSTEM_CONFIG } from "../config/system";
import { snapshotAt } from "../mocks/generator";
import type { CollectionProcessTelemetry, StationSnapshot, TrainingProcessRun } from "../types/domain";
import { apiRequest, authHeaders } from "./http";
import { modelAdapter } from "./modelAdapter";

export interface ProcessDataAdapter {
  getCollectionProcess(stationId: string, at?: Date): Promise<CollectionProcessTelemetry>;
  getTrainingRuns(stationId: string, scope?: "active" | "all"): Promise<TrainingProcessRun[]>;
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
        source_id: "main_switch",
        name: "总开计量",
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
      { event_id: "main_switch", at: latestMinute?.event_time ?? snapshot.now, label: "总开分钟数据到达", detail: "event_time 已对齐", level: "info" },
    ],
  };
};

export const trainingProcessFromSnapshot = (snapshot: StationSnapshot): TrainingProcessRun => {
  if (!snapshot.training) throw new Error("Mock snapshot must contain a training summary");
  const completedAt = new Date(snapshot.training.completed_at);
  const startedAt = new Date(completedAt.getTime() - 28 * 60_000);
  const target = snapshot.training.validation_score;
  const epochs = Array.from({ length: 12 }, (_, index) => {
    const progress = (1 - Math.exp(-(index + 1) / 3.1)) / (1 - Math.exp(-12 / 3.1));
    return {
      epoch: index + 1,
      training_loss: Number((0.62 * Math.exp(-index / 3.25) + 0.085).toFixed(3)),
      validation_loss: Number((0.48 * Math.exp(-index / 3.4) + 0.075).toFixed(3)),
      validation_score: index === 11 ? target : Number((0.71 + (target - 0.71) * progress).toFixed(3)),
    };
  });
  const stepDuration = 5 * 60_000;
  return {
    source: "mock-api",
    run_id: `TRAIN-${snapshot.station_id}-${completedAt.getTime()}`,
    station_id: snapshot.station_id,
    status: snapshot.training.status === "training" ? "running" : snapshot.training.status,
    model_task: "resource_identification",
    model_version: snapshot.training.model_version,
    dataset_window_days: snapshot.training.dataset_window_days,
    window_size_minutes: 120,
    sample_count: snapshot.training.sample_count,
    started_at: startedAt.toISOString(),
    completed_at: snapshot.training.completed_at,
    validation_score: snapshot.training.validation_score,
    metric_name: "macro_f1",
    metric_value: snapshot.training.validation_score,
    validation_series_name: "验证损失",
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

  async getTrainingRuns(_stationId: string) {
    return [trainingProcessFromSnapshot(snapshotAt(new Date()))];
  }

  connectCollectionStream(stationId: string, onTelemetry: (telemetry: CollectionProcessTelemetry) => void) {
    const timer = window.setInterval(() => onTelemetry(collectionProcessFromSnapshot(snapshotAt(new Date()))), 4_000);
    return () => window.clearInterval(timer);
  }
}

class HttpProcessAdapter implements ProcessDataAdapter {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string): Promise<T> {
    return apiRequest<T>(this.baseUrl, path);
  }

  getCollectionProcess(stationId: string) {
    return this.request<CollectionProcessTelemetry>(`/api/v1/stations/${encodeURIComponent(stationId)}/process/collection`);
  }

  async getTrainingRuns(stationId: string, scope: "active" | "all" = "active") {
    const runs = await this.request<TrainingProcessRun[]>(`/api/v1/stations/${encodeURIComponent(stationId)}/training-runs`);
    if (scope === "all") return runs;
    const catalog = await modelAdapter.list();
    return runs.filter(run => catalog.active[run.model_task] === run.model_version);
  }

  connectCollectionStream(stationId: string, onTelemetry: (telemetry: CollectionProcessTelemetry) => void) {
    const controller = new AbortController();
    let retry = 0;
    let retryTimer: number | null = null;
    const connect = async (): Promise<void> => {
      try {
        const response = await fetch(`${this.baseUrl}/api/v1/stations/${encodeURIComponent(stationId)}/process/collection/stream`, {
          headers: { Accept: "text/event-stream", ...authHeaders() },
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`SSE ${response.status}`);
        retry = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const event = block.match(/^event:\s*(.+)$/m)?.[1];
            const data = block.split("\n").filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart()).join("\n");
            if (event === "telemetry" && data) onTelemetry(JSON.parse(data) as CollectionProcessTelemetry);
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
      }
      if (!controller.signal.aborted) {
        retryTimer = window.setTimeout(() => void connect(), Math.min(30_000, 1_000 * 2 ** Math.min(retry++, 5)));
      }
    };
    void connect();
    return () => { controller.abort(); if (retryTimer != null) window.clearTimeout(retryTimer); };
  }
}

export const processAdapter: ProcessDataAdapter = SYSTEM_CONFIG.sourceMode === "api"
  ? new HttpProcessAdapter(SYSTEM_CONFIG.apiBaseUrl)
  : new MockProcessAdapter();

// Backend contract reserved for direct replacement:
// GET /api/v1/stations/{stationId}/process/collection
// GET /api/v1/stations/{stationId}/training-runs
// SSE /api/v1/stations/{stationId}/process/collection/stream (event: telemetry)
