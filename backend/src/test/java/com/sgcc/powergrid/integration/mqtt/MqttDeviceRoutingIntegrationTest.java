package com.sgcc.powergrid.integration.mqtt;

import static org.assertj.core.api.Assertions.assertThat;

import com.sgcc.powergrid.feedback.FeedbackService;
import com.sgcc.powergrid.measurement.IngestionService;
import com.sgcc.powergrid.measurement.MainSwitchMinutePoint;
import com.sgcc.powergrid.measurement.MeasurementRepository;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@ActiveProfiles("test")
@Transactional
@Testcontainers(disabledWithoutDocker = true)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class MqttDeviceRoutingIntegrationTest {
    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17.6-alpine");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
    }
    @Autowired IngestionService ingestion;
    @Autowired MeasurementRepository measurements;
    @Autowired FeedbackService feedback;
    @Autowired JdbcClient jdbc;

    private MqttTelemetryMessageProcessor processor() {
        return new MqttTelemetryMessageProcessor(MqttTelemetryMapperTest.roleMapper(List.of(
                "202606050023=A01:disabled", "202601230004=A01:main_switch", "202601230001=A01:pv:-1")),
                ingestion, measurements, feedback);
    }

    @Test
    void sameMinuteMetersStaySeparateAndFeedbackArrivingBeforeInferenceIsReconciled() throws Exception {
        var processor = processor();
        OffsetDateTime time = OffsetDateTime.now().minusHours(1).withSecond(0).withNano(0);
        // More than the scheduler's batch limit of earlier feedback minutes without model results.
        for (int i = 1; i <= 55; i++) {
            processor.process("topic/202601230001", payload(time.minusMinutes(i), -9));
        }
        processor.process("topic/202606050023", payload(time, 999));
        processor.process("topic/202601230001", payload(time, -11.4269));
        processor.process("topic/202601230004", payload(time, -10.7517));
        processor.process("topic/202601230001", payload(time, -11.4269));

        assertThat(jdbc.sql("select source_id from main_switch_minute where station_id='A01' and event_time=:t")
                .param("t", time).query(String.class).single()).isEqualTo("mqtt:202601230004");
        assertThat(jdbc.sql("select active_power_kw from main_switch_minute where station_id='A01' and event_time=:t")
                .param("t", time).query(Double.class).single()).isEqualTo(-10.7517);
        assertThat(jdbc.sql("select pv_value from pv_feedback_point where station_id='A01' and event_time=:t")
                .param("t", time).query(Double.class).single()).isEqualTo(11.4269);
        assertThat(jdbc.sql("select count(*) from pv_feedback_point where station_id='A01' and event_time=:t")
                .param("t", time).query(Long.class).single()).isEqualTo(1);

        jdbc.sql("""
                insert into pv_separation_result (
                  separation_id, station_id, event_time, separation_time, input_window_start,
                  input_window_end, interpolated_minutes, quality_status, total_power_kw,
                  initial_pv_kw, pv_activity_probability, model_version, model_summary,
                  deployment_role, request_id, created_at, updated_at)
                values ('SEP-MQTT-TEST', 'A01', :t, :t, :t, :t,
                  0, 'good', -10.7517, 12, 0.9, 'pv-test', '{}', 'active', 'test', :t, :t)
                """).param("t", time).update();
        feedback.reconcileArrivedBatches();
        feedback.reconcileArrivedBatches();
        assertThat(jdbc.sql("select corrected_pv_kw from pv_separation_result where separation_id='SEP-MQTT-TEST'")
                .query(Double.class).single()).isEqualTo(11.4269);
        assertThat(jdbc.sql("select count(*) from correction_record where separation_id='SEP-MQTT-TEST'")
                .query(Long.class).single()).isEqualTo(1);
    }

    @Test
    void newMeterDoesNotInterpolateFromOldMeterOrUseItsModelHistory() throws Exception {
        OffsetDateTime time = OffsetDateTime.now().minusHours(2).withSecond(0).withNano(0);
        measurements.insert(new MainSwitchMinutePoint("A01", time.minusMinutes(2),
                900, 300, 300, 300, null, null, null, null, 1, "good", "mqtt:202606050023"), "test", time);
        measurements.insert(new MainSwitchMinutePoint("A01", time.minusDays(1),
                99, 33, 33, 33, null, null, null, null, 1, "good", "mqtt:202601230004"), "test", time);
        processor().process("topic/202601230004", payload(time, -10));
        assertThat(jdbc.sql("select count(*) from main_switch_minute where station_id='A01' and event_time=:t")
                .param("t", time.minusMinutes(1)).query(Long.class).single()).isZero();
        assertThat(measurements.history("A01", time, 240)).singleElement().satisfies(row ->
                assertThat(row.get("source_id")).isEqualTo("mqtt:202601230004"));
    }

    private static byte[] payload(OffsetDateTime time, double power) {
        return """
                {"token":"test","timestamp":"%s","datatype":"0","body":[
                  {"name":"TotW_MA","val":"%s","unit":"","quality":"0","timestamp":"%s"},
                  {"name":"PhW_phsA_MA","val":"-3","quality":"0","timestamp":"%s"},
                  {"name":"PhW_phsB_MA","val":"-3","quality":"0","timestamp":"%s"},
                  {"name":"PhW_phsC_MA","val":"-4","quality":"0","timestamp":"%s"}]}
                """.formatted(time.plusSeconds(15), power, time, time, time, time).getBytes(StandardCharsets.UTF_8);
    }
}
