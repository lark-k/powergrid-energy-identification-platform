package com.sgcc.powergrid.integration.modelservice;

import com.fasterxml.jackson.annotation.JsonFormat;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

public final class ModelServiceDtos {
    private ModelServiceDtos() {}

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record MinutePoint(
            String stationId,
            @JsonFormat(shape = JsonFormat.Shape.STRING) OffsetDateTime eventTime,
            double activePowerKw,
            @JsonProperty("phase_a_power_kw") double phaseAPowerKw,
            @JsonProperty("phase_b_power_kw") double phaseBPowerKw,
            @JsonProperty("phase_c_power_kw") double phaseCPowerKw,
            double coverageRatio,
            String qualityFlag,
            String sourceId,
            Map<String, Double> electricalFields,
            Map<String, Boolean> fieldValidity,
            OffsetDateTime measurementTime,
            OffsetDateTime arrivalTime) {
        public MinutePoint(String stationId, OffsetDateTime eventTime, double activePowerKw,
                double phaseAPowerKw, double phaseBPowerKw, double phaseCPowerKw,
                double coverageRatio, String qualityFlag, String sourceId,
                Map<String, Double> electricalFields, Map<String, Boolean> fieldValidity) {
            this(stationId, eventTime, activePowerKw, phaseAPowerKw, phaseBPowerKw, phaseCPowerKw,
                    coverageRatio, qualityFlag, sourceId, electricalFields, fieldValidity, null, null);
        }
        public MinutePoint(String stationId, OffsetDateTime eventTime, double activePowerKw,
                double phaseAPowerKw, double phaseBPowerKw, double phaseCPowerKw,
                double coverageRatio, String qualityFlag, String sourceId) {
            this(stationId, eventTime, activePowerKw, phaseAPowerKw, phaseBPowerKw, phaseCPowerKw,
                    coverageRatio, qualityFlag, sourceId, Map.of(), Map.of());
        }
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record InferenceRequest(
            String requestId,
            String stationId,
            @JsonFormat(shape = JsonFormat.Shape.STRING) OffsetDateTime targetTime,
            List<MinutePoint> points,
            List<MinutePoint> separationPoints) {
        public InferenceRequest(String requestId, String stationId, OffsetDateTime targetTime, List<MinutePoint> points) {
            this(requestId, stationId, targetTime, points, null);
        }
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record BatchInferenceRequest(
            String requestId,
            String stationId,
            List<OffsetDateTime> targetTimes,
            List<MinutePoint> points,
            List<MinutePoint> separationPoints) {
        public BatchInferenceRequest(String requestId, String stationId, List<OffsetDateTime> targetTimes, List<MinutePoint> points) {
            this(requestId, stationId, targetTimes, points, null);
        }
    }

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ResourceInference(Double score, Boolean detected) {}

    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record InferenceResult(
            String stationId,
            @JsonFormat(shape = JsonFormat.Shape.STRING) OffsetDateTime targetTime,
            String requestId,
            @JsonFormat(shape = JsonFormat.Shape.STRING) OffsetDateTime inputWindowStart,
            @JsonFormat(shape = JsonFormat.Shape.STRING) OffsetDateTime inputWindowEnd,
            @JsonFormat(shape = JsonFormat.Shape.STRING) OffsetDateTime recognitionWindowStart,
            @JsonFormat(shape = JsonFormat.Shape.STRING) OffsetDateTime separationWindowStart,
            int interpolatedMinutes,
            String qualityStatus,
            String recognitionModelVersion,
            String separationModelVersion,
            ResourceInference pv,
            ResourceInference energyStation,
            ResourceInference charger,
            Double pvGenerationKw,
            Double pvActivityProbability,
            double inferenceTimeMs,
            List<String> warnings,
            Double separationInputPowerKw) {
        public InferenceResult(String stationId, OffsetDateTime targetTime, String requestId,
                OffsetDateTime inputWindowStart, OffsetDateTime inputWindowEnd,
                OffsetDateTime recognitionWindowStart, OffsetDateTime separationWindowStart,
                int interpolatedMinutes, String qualityStatus, String recognitionModelVersion, String separationModelVersion,
                ResourceInference pv, ResourceInference energyStation, ResourceInference charger,
                Double pvGenerationKw, Double pvActivityProbability, double inferenceTimeMs, List<String> warnings) {
            this(stationId, targetTime, requestId, inputWindowStart, inputWindowEnd, recognitionWindowStart, separationWindowStart,
                    interpolatedMinutes, qualityStatus, recognitionModelVersion, separationModelVersion, pv, energyStation,
                    charger, pvGenerationKw, pvActivityProbability, inferenceTimeMs, warnings, null);
        }
    }
}
