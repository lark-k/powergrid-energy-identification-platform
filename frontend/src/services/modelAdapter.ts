import { SYSTEM_CONFIG } from "../config/system";
import { apiRequest } from "./http";

export type ModelTask = "resource_identification" | "pv_separation";
export interface AvailableModel {
  task: ModelTask;
  model_version: string;
  artifact_sha256: string;
  artifact_name: string;
  status: "ready" | "incompatible";
  reason: string | null;
  lifecycle_status: "unregistered" | "registered" | "approved";
  manifest: { model_type: string; required_history_minutes: number; input_fields: string[] } | null;
}
export interface ModelCatalog {
  active: Record<ModelTask, string>;
  previous: Record<ModelTask, string | null>;
  models: AvailableModel[];
  can_manage: boolean;
}

const post = (path: string, body: object = {}) => apiRequest<Record<string, unknown>>(SYSTEM_CONFIG.apiBaseUrl, path, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
export const modelAdapter = {
  list: () => apiRequest<ModelCatalog>(SYSTEM_CONFIG.apiBaseUrl, "/api/v1/models/available"),
  approve: (version: string) => post(`/api/v1/models/${encodeURIComponent(version)}/approve`),
  activate: (version: string, expected: string) => post(`/api/v1/models/${encodeURIComponent(version)}/deploy`, {
    role: "active", expected_version: expected,
  }),
  rollback: (task: ModelTask, expected: string) => post(`/api/v1/models/${task}/rollback`, { expected_version: expected }),
};
