package com.sgcc.powergrid.feedback;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.List;

public final class FeedbackModels {
    private FeedbackModels() {}

    public record Point(
            @NotBlank String nodeId,
            @NotNull OffsetDateTime eventTime,
            @NotNull OffsetDateTime periodEnd,
            double pvValue,
            @NotBlank String valueType,
            double capacityKw,
            @NotBlank String qualityFlag) {
        public Point {
            if (eventTime != null && periodEnd != null && !periodEnd.isAfter(eventTime)) {
                throw new IllegalArgumentException("period_end 必须晚于 event_time");
            }
            if (valueType != null && !valueType.matches("average_power|energy")) {
                throw new IllegalArgumentException("value_type 必须明确为 average_power 或 energy");
            }
            if (!Double.isFinite(pvValue) || !Double.isFinite(capacityKw)) {
                throw new IllegalArgumentException("反馈功率和容量必须是有限数值");
            }
        }
    }

    public record BatchRequest(
            @NotBlank String batchId,
            @NotBlank String stationId,
            @NotNull OffsetDateTime arrivalTime,
            @NotNull OffsetDateTime coverageStart,
            @NotNull OffsetDateTime coverageEnd,
            int intervalMinutes,
            @NotEmpty List<String> participantNodes,
            List<String> missingNodes,
            @DecimalMin("0") @DecimalMax("1") double nodeCoverageRatio,
            @DecimalMin("0") @DecimalMax("1") double capacityCoverageRatio,
            @DecimalMin("0") @DecimalMax("1") double completenessRatio,
            @NotBlank String qualityFlag,
            @NotEmpty List<@Valid Point> points) {}

    public record BatchReceipt(String batchId, String status, int acceptedPoints, int correctedMinutes) {}
}
