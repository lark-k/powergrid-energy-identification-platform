import { describe, expect, it } from "vitest";
import type { SeparationResult } from "../types/domain";
import { separationConfidenceLabel, separationConfidenceValue, separationQualityText } from "../utils/separation";

const result = {
  corrected_pv_kw: null,
  feedback_status: "等待回传",
  confidence: 0.5,
  pv_activity_probability: 0.996,
  interpolated_minutes: 24,
  quality_status: "warning",
} as SeparationResult;

describe("separation result presentation", () => {
  it("does not present PV activity probability as power accuracy", () => {
    expect(separationConfidenceLabel(result)).toBe("光伏活动概率");
    expect(separationConfidenceValue(result)).toBe(0.996);
  });

  it("surfaces interpolated input minutes as a quality warning", () => {
    expect(separationQualityText(result)).toBe("告警 · 输入插值 24 分钟");
  });

  it("uses correction confidence only after feedback correction", () => {
    const corrected = { ...result, corrected_pv_kw: 2.2, feedback_status: "已反馈", confidence: 0.93 } as SeparationResult;
    expect(separationConfidenceLabel(corrected)).toBe("校正置信度");
    expect(separationConfidenceValue(corrected)).toBe(0.93);
  });
});
