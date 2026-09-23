package com.sgcc.powergrid.measurement;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.Map;

public record MainSwitchMinutePoint(
        @JsonProperty("station_id") @NotBlank String stationId,
        @JsonProperty("event_time") @NotNull OffsetDateTime eventTime,
        @JsonProperty("active_power_kw") double activePowerKw,
        @JsonProperty("phase_a_power_kw") double phaseAPowerKw,
        @JsonProperty("phase_b_power_kw") double phaseBPowerKw,
        @JsonProperty("phase_c_power_kw") double phaseCPowerKw,
        @JsonProperty("reactive_power_kvar") Double reactivePowerKvar,
        Double voltage,
        Double current,
        Double pf,
        @JsonProperty("coverage_ratio") @DecimalMin("0.0") @DecimalMax("1.0") double coverageRatio,
        @JsonProperty("quality_flag") @NotBlank String qualityFlag,
        @JsonProperty("source_id") @NotBlank String sourceId,
        @JsonProperty("electrical_fields") Map<String, Double> electricalFields,
        @JsonProperty("field_validity") Map<String, Boolean> fieldValidity,
        @JsonProperty("measurement_time") OffsetDateTime measurementTime,
        @JsonProperty("frame_time") OffsetDateTime frameTime) {

    public MainSwitchMinutePoint(String stationId, OffsetDateTime eventTime, double activePowerKw,
            double phaseAPowerKw, double phaseBPowerKw, double phaseCPowerKw, Double reactivePowerKvar,
            Double voltage, Double current, Double pf, double coverageRatio, String qualityFlag, String sourceId,
            Map<String, Double> electricalFields, Map<String, Boolean> fieldValidity) {
        this(stationId, eventTime, activePowerKw, phaseAPowerKw, phaseBPowerKw, phaseCPowerKw,
                reactivePowerKvar, voltage, current, pf, coverageRatio, qualityFlag, sourceId,
                electricalFields, fieldValidity, null, null);
    }

    public MainSwitchMinutePoint(String stationId, OffsetDateTime eventTime, double activePowerKw,
            double phaseAPowerKw, double phaseBPowerKw, double phaseCPowerKw, Double reactivePowerKvar,
            Double voltage, Double current, Double pf, double coverageRatio, String qualityFlag, String sourceId) {
        this(stationId, eventTime, activePowerKw, phaseAPowerKw, phaseBPowerKw, phaseCPowerKw,
                reactivePowerKvar, voltage, current, pf, coverageRatio, qualityFlag, sourceId,
                Map.of(), Map.of(), null, null);
    }

    public MainSwitchMinutePoint {
        electricalFields = ElectricalFields.validate(electricalFields);
        fieldValidity = fieldValidity == null ? Map.of() : Map.copyOf(fieldValidity);
        if (eventTime != null && (eventTime.getSecond() != 0 || eventTime.getNano() != 0)) {
            throw new IllegalArgumentException("event_time 必须对齐到整分钟");
        }
        if (qualityFlag != null && !qualityFlag.matches("good|warning|missing|out_of_order")) {
            throw new IllegalArgumentException("quality_flag 不合法");
        }
        double[] required = {activePowerKw, phaseAPowerKw, phaseBPowerKw, phaseCPowerKw, coverageRatio};
        for (double value : required) {
            if (!Double.isFinite(value)) {
                throw new IllegalArgumentException("功率和覆盖率必须是有限数值");
            }
        }
    }
}
