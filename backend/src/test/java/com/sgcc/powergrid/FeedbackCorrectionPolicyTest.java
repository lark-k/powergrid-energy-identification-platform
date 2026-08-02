package com.sgcc.powergrid;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sgcc.powergrid.correction.FeedbackCorrectionPolicy;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

class FeedbackCorrectionPolicyTest {
    private final FeedbackCorrectionPolicy policy = new FeedbackCorrectionPolicy();

    @Test
    void convertsEnergyToTheSameHistoricalPowerPeriod() {
        OffsetDateTime start = OffsetDateTime.parse("2026-08-01T10:00:00+08:00");
        assertThat(policy.toAveragePowerKw("energy", 2.5, start, start.plusMinutes(15)))
                .isEqualTo(10.0);
    }

    @Test
    void correctionPreservesMinuteShapeWithOneScale() {
        double scale = policy.scale(5.0, 7.5).orElseThrow();
        assertThat(policy.corrected(2.0, scale)).isEqualTo(3.0);
        assertThat(policy.corrected(8.0, scale)).isEqualTo(12.0);
    }

    @Test
    void refusesToInventShapeWhenInitialPeriodIsZeroButFeedbackIsPositive() {
        assertThat(policy.scale(0, 5)).isEmpty();
    }

    @Test
    void valueTypeCannotBeImplicit() {
        OffsetDateTime start = OffsetDateTime.parse("2026-08-01T10:00:00+08:00");
        assertThatThrownBy(() -> policy.toAveragePowerKw("unknown", 1, start, start.plusMinutes(15)))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
