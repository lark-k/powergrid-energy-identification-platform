import type { SeparationResult } from "../types/domain";

export const separationConfidenceLabel = (result: SeparationResult) =>
  result.corrected_pv_kw != null && result.feedback_status === "已反馈"
    ? "校正置信度"
    : "光伏活动概率";

export const separationConfidenceValue = (result: SeparationResult) =>
  result.corrected_pv_kw != null && result.feedback_status === "已反馈"
    ? result.confidence
    : result.pv_activity_probability ?? result.confidence;

export const separationQualityText = (result: SeparationResult) => {
  if (result.interpolated_minutes > 0) return `告警 · 输入插值 ${result.interpolated_minutes} 分钟`;
  if (result.quality_status === "good") return "良好 · 无插值";
  return result.quality_status ? `告警 · ${result.quality_status}` : "后台未返回";
};
