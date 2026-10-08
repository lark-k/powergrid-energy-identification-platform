package com.sgcc.powergrid;

import static org.assertj.core.api.Assertions.assertThat;

import com.sgcc.powergrid.common.JdbcValues;
import com.sgcc.powergrid.measurement.MainSwitchMinutePoint;
import com.sgcc.powergrid.measurement.MeasurementRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
class ArrivalSampleTest {
    @Autowired MeasurementRepository measurements;

    private MainSwitchMinutePoint point(String source, OffsetDateTime sample, OffsetDateTime arrival, double total) {
        return new MainSwitchMinutePoint("A01", sample.withSecond(0).withNano(0), total, total/3, total/3, total/3,
                null, null, null, null, 1., "good", source, Map.of("TotW_MA", total), Map.of("TotW_MA", true), sample, arrival);
    }

    @Test
    void retainsFirstArrivalPerExactSampleAndAllSamplesWithinOneSamplingMinute() {
        OffsetDateTime at = OffsetDateTime.parse("2040-01-01T10:00:00+08:00");
        var first = point("v3-main", at.plusSeconds(5), at.plusMinutes(1).plusSeconds(10), 1.);
        measurements.insertArrivalSample(first, first.frameTime());
        var revised = point("v3-main", first.measurementTime(), at.plusMinutes(1).plusSeconds(40), 99.);
        measurements.insertArrivalSample(revised, revised.frameTime());
        var second = point("v3-main", at.plusSeconds(55), at.plusMinutes(1).plusSeconds(30), 2.);
        measurements.insertArrivalSample(second, second.frameTime());
        var future = point("v3-main", at.plusMinutes(1).plusSeconds(55), at.plusMinutes(2), 3.);
        measurements.insertArrivalSample(future, future.frameTime());
        List<Map<String, Object>> rows = measurements.arrivalBetween("A01", at, at.plusMinutes(1));
        assertThat(rows).hasSize(2);
        assertThat(((Number) rows.getFirst().get("active_power_kw")).doubleValue()).isEqualTo(1.);
        assertThat(((Number) rows.getLast().get("active_power_kw")).doubleValue()).isEqualTo(2.);
        assertThat(JdbcValues.offsetDateTime(rows.getFirst().get("measurement_time")).toInstant()).isEqualTo(first.measurementTime().toInstant());
    }

    @Test
    void liveMqttInputCannotBeAvailableBeforeServerReceipt() {
        OffsetDateTime sample = OffsetDateTime.parse("2040-01-02T10:00:05+08:00");
        OffsetDateTime received = sample.withSecond(0).plusMinutes(2).plusSeconds(10);
        var point = point("mqtt:v3-main", sample, sample.plusSeconds(10), 1.);
        measurements.insertArrivalSample(point, received);
        assertThat(measurements.arrivalBetween("A01", sample.withSecond(0), sample.withSecond(0).plusMinutes(1))).isEmpty();
        var rows = measurements.arrivalBetween("A01", sample.withSecond(0), sample.withSecond(0).plusMinutes(2));
        assertThat(rows).singleElement().satisfies(row ->
                assertThat(JdbcValues.offsetDateTime(row.get("arrival_time")).toInstant()).isEqualTo(received.toInstant()));
    }

    @Test
    void historySelectsOneMainSourceAndIgnoresMissingSyntheticRecords() {
        OffsetDateTime at = OffsetDateTime.parse("2040-01-03T10:00:00+08:00");
        measurements.insertArrivalSample(point("v3-old-main", at, at.plusSeconds(10), 1.), at);
        measurements.insertArrivalSample(point("v3-new-main", at.plusMinutes(1), at.plusMinutes(1).plusSeconds(10), 2.), at);
        var missing = new MainSwitchMinutePoint("A01", at.plusMinutes(2), 0., 0., 0., 0., null, null, null, null,
                0., "missing", "v3-synthetic");
        measurements.insertArrivalSample(missing, at);
        var rows = measurements.arrivalBetween("A01", at, at.plusMinutes(2));
        assertThat(rows).singleElement().satisfies(row -> assertThat(row.get("source_id")).isEqualTo("v3-new-main"));
    }
}
