package com.sgcc.powergrid.correction;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.OptionalDouble;
import org.springframework.stereotype.Component;

@Component
public class FeedbackCorrectionPolicy {
    public double confidence(double nodeCoverage, double capacityCoverage, double completeness) {
        return clamp(nodeCoverage) * clamp(capacityCoverage) * clamp(completeness);
    }

    public double toAveragePowerKw(String valueType, double value, OffsetDateTime start, OffsetDateTime end) {
        if ("average_power".equals(valueType)) return value;
        if (!"energy".equals(valueType)) throw new IllegalArgumentException("value_type must be explicit");
        double hours = Duration.between(start, end).toSeconds() / 3600.0;
        if (hours <= 0) throw new IllegalArgumentException("feedback period must be positive");
        return value / hours;
    }

    public OptionalDouble scale(double initialAverageKw, double referenceAverageKw) {
        if (initialAverageKw < 0 || referenceAverageKw < 0) {
            throw new IllegalArgumentException("PV power must be nonnegative");
        }
        if (initialAverageKw == 0 && referenceAverageKw > 0) {
            return OptionalDouble.empty();
        }
        return OptionalDouble.of(initialAverageKw == 0 ? 1.0 : referenceAverageKw / initialAverageKw);
    }

    public double corrected(double initialKw, double scale) {
        return Math.max(0, initialKw * scale);
    }

    private static double clamp(double value) { return Math.max(0, Math.min(1, value)); }
}
