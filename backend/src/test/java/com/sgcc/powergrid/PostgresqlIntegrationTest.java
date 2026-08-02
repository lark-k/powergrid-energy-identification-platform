package com.sgcc.powergrid;

import static org.assertj.core.api.Assertions.assertThat;

import com.sgcc.powergrid.feedback.FeedbackModels;
import com.sgcc.powergrid.feedback.FeedbackService;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(properties = {
        "platform.security.mode=dev",
        "platform.security.cors-allowed-origins=http://localhost:5173",
        "platform.model-service.base-url=http://127.0.0.1:1",
        "platform.model-service.token=",
        "platform.model-service.connect-timeout=10ms",
        "platform.model-service.read-timeout=10ms",
        "platform.model-service.max-retries=0",
        "platform.model-service.circuit-failure-threshold=1",
        "platform.model-service.circuit-open-duration=1s",
        "platform.imports.allowed-content-types=text/csv,application/json"
})
class PostgresqlIntegrationTest {
    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17.6-alpine");
    @Autowired JdbcClient jdbc;
    @Autowired FeedbackService feedbackService;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @Test
    void flywayMigratesProductionPostgresql() {
        assertThat(postgres.isRunning()).isTrue();
    }

    @Test
    void arrivedFeedbackCorrectsHistoricalEventTimeAndRemainsIdempotent() {
        OffsetDateTime now = OffsetDateTime.now();
        OffsetDateTime eventTime = now.minusHours(1).withSecond(0).withNano(0);
        jdbc.sql("""
                insert into station (station_id, station_name, timezone, status, created_at, updated_at)
                values ('PG01', 'PostgreSQL 测试台区', 'Asia/Shanghai', 'active', :now, :now)
                on conflict (station_id) do nothing
                """).param("now", now).update();
        jdbc.sql("""
                insert into pv_separation_result (
                  separation_id, station_id, event_time, separation_time, input_window_start,
                  input_window_end, interpolated_minutes, quality_status, total_power_kw,
                  initial_pv_kw, pv_activity_probability, model_version, model_summary,
                  deployment_role, request_id, created_at, updated_at)
                values ('SEP-PG01', 'PG01', :eventTime, :now, :windowStart, :eventTime,
                  0, 'good', 50, 10, 0.9, 'pv-v1', '{}', 'active', 'req-seed', :now, :now)
                on conflict (separation_id) do nothing
                """).param("eventTime", eventTime).param("windowStart", eventTime.minusMinutes(239))
                .param("now", now).update();
        FeedbackModels.BatchRequest request = new FeedbackModels.BatchRequest(
                "FB-PG01", "PG01", now.minusMinutes(1), eventTime, eventTime.plusMinutes(1),
                1, List.of("PV-N1"), List.of(), 1, 1, 1, "good",
                List.of(new FeedbackModels.Point("PV-N1", eventTime, eventTime.plusMinutes(1),
                        20, "average_power", 100, "good")));

        FeedbackModels.BatchReceipt first = feedbackService.ingest(request, "req-feedback");
        FeedbackModels.BatchReceipt duplicate = feedbackService.ingest(request, "req-feedback-duplicate");

        assertThat(first.correctedMinutes()).isEqualTo(1);
        assertThat(duplicate.status()).isEqualTo("duplicate");
        assertThat(jdbc.sql("select corrected_pv_kw from pv_separation_result where separation_id = 'SEP-PG01'")
                .query(Double.class).single()).isEqualTo(20.0);
        assertThat(jdbc.sql("select count(*) from correction_record where batch_id = 'FB-PG01'")
                .query(Long.class).single()).isEqualTo(1);
    }
}
