package com.sgcc.powergrid;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sgcc.powergrid.integration.modelservice.ModelServiceClient;
import com.sgcc.powergrid.integration.modelservice.ModelServiceDtos;
import com.sgcc.powergrid.measurement.MainSwitchMinutePoint;
import com.sgcc.powergrid.measurement.MeasurementRepository;
import com.sgcc.powergrid.model.ModelRuntimeState;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PlatformApiTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired JdbcClient jdbc;
    @Autowired MeasurementRepository measurements;
    @Autowired ModelRuntimeState runtimeState;
    @MockBean ModelServiceClient modelService;

    @BeforeEach
    void modelWarmupResponse() {
        runtimeState.success(null, null, 0, null, "warming_up");
        when(modelService.infer(any())).thenAnswer(invocation -> {
            ModelServiceDtos.InferenceRequest request = invocation.getArgument(0);
            return new ModelServiceDtos.InferenceResult(
                    request.stationId(), request.targetTime(), request.requestId(), null, null,
                    null, null, 0, "insufficient_history", null, null,
                    new ModelServiceDtos.ResourceInference(null, null),
                    new ModelServiceDtos.ResourceInference(null, null),
                    new ModelServiceDtos.ResourceInference(null, null),
                    null, null, 1.0, List.of("warming_up"));
        });
        when(modelService.ready()).thenReturn(true);
        when(modelService.inferCandidate(any())).thenReturn(Optional.empty());
        when(modelService.replay(any())).thenAnswer(invocation -> {
            ModelServiceDtos.BatchInferenceRequest request = invocation.getArgument(0);
            return request.targetTimes().stream().map(target -> new ModelServiceDtos.InferenceResult(
                    request.stationId(), target, request.requestId(), target.minusMinutes(239), target,
                    target.minusMinutes(119), target.minusMinutes(239), 0, "good",
                    "recognition-replay-v1", "separation-replay-v1",
                    new ModelServiceDtos.ResourceInference(0.9, true),
                    new ModelServiceDtos.ResourceInference(0.2, false),
                    new ModelServiceDtos.ResourceInference(0.1, false),
                    12.5, 0.88, 3.0, List.of())).toList();
        });
    }

    @Test
    void snapshotUsesRealEmptyStateAndDoesNotInventResults() throws Exception {
        mvc.perform(get("/api/v1/stations/A01/snapshot").param("range", "1h"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.station_id").value("A01"))
                .andExpect(jsonPath("$.minute_points").isArray())
                .andExpect(jsonPath("$.separation_results").isArray())
                .andExpect(jsonPath("$.recognition").doesNotExist());
    }

    @Test
    void stationAccessPreventsHorizontalPrivilegeEscalation() throws Exception {
        mvc.perform(get("/api/v1/stations/A01/snapshot")
                        .header("X-Dev-User", "unassigned-viewer")
                        .header("X-Dev-Roles", "VIEWER"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    @Test
    void ingestionIsIdempotentAndReportsOutOfOrderInput() throws Exception {
        OffsetDateTime first = OffsetDateTime.of(2026, 8, 1, 10, 0, 0, 0, ZoneOffset.ofHours(8));
        String onePoint = ingestionJson(List.of(point(first)));
        mvc.perform(post("/api/v1/ingestion/main-switch/minutes")
                        .contentType("application/json").content(onePoint))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.inserted").value(1))
                .andExpect(header().exists("X-Request-ID"));
        mvc.perform(post("/api/v1/ingestion/main-switch/minutes")
                        .contentType("application/json").content(onePoint))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.inserted").value(0))
                .andExpect(jsonPath("$.duplicates").value(1));

        String reversed = ingestionJson(List.of(point(first.plusMinutes(2)), point(first.plusMinutes(1))));
        mvc.perform(post("/api/v1/ingestion/main-switch/minutes")
                        .contentType("application/json").content(reversed))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.out_of_order").value(1));
        assertThat(jdbc.sql("select count(*) from main_switch_minute where station_id = 'A01'")
                .query(Long.class).single()).isEqualTo(3);
    }

    @Test
    void bulkRepairUpdatesExistingMinuteWithoutSchedulingInference() throws Exception {
        OffsetDateTime time = OffsetDateTime.of(2032, 1, 2, 3, 4, 0, 0, ZoneOffset.ofHours(8));
        mvc.perform(post("/api/v1/ingestion/main-switch/minutes")
                        .contentType("application/json").content(ingestionJson(List.of(point(time)))))
                .andExpect(status().isAccepted());

        java.util.Map<String, Object> repaired = new java.util.LinkedHashMap<>(point(time));
        repaired.put("phase_a_power_kw", 8.25);
        repaired.put("source_id", "sgcc-main-b");
        mvc.perform(post("/api/v1/ingestion/main-switch/minutes")
                        .queryParam("replace_existing", "true")
                        .queryParam("run_inference", "false")
                        .contentType("application/json")
                        .content(ingestionJson(List.of(repaired))))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.inserted").value(0))
                .andExpect(jsonPath("$.updated").value(1))
                .andExpect(jsonPath("$.inference_scheduled").value(false));

        Map<String, Object> repairedRow = jdbc.sql("""
                        select phase_a_power_kw from main_switch_minute
                        where station_id = 'A01' and event_time = :eventTime
                        """).param("eventTime", time).query().singleRow();
        assertThat(((Number) repairedRow.get("phase_a_power_kw")).doubleValue()).isEqualTo(8.25);
    }

    @Test
    void invalidMinuteReturnsUnified422() throws Exception {
        mvc.perform(post("/api/v1/ingestion/main-switch/minutes")
                        .contentType("application/json").content("{\"points\":[]}"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("DATA_VALIDATION_FAILED"))
                .andExpect(jsonPath("$.request_id").isNotEmpty());
    }

    @Test
    void dataRangeReportsPersistedRawAndModelResultCounts() throws Exception {
        mvc.perform(get("/api/v1/stations/A01/data-range"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.minute_count").isNumber())
                .andExpect(jsonPath("$.recognition_result_count").isNumber())
                .andExpect(jsonPath("$.separation_result_count").isNumber());
    }

    @Test
    void historicalSnapshotDoesNotLeakFutureRecognition() throws Exception {
        OffsetDateTime past = OffsetDateTime.parse("2039-01-01T10:00:00+08:00");
        OffsetDateTime future = OffsetDateTime.parse("2041-01-01T10:00:00+08:00");
        insertRecognition("past-v1", past);
        insertRecognition("future-v1", future);

        mvc.perform(get("/api/v1/stations/A01/snapshot")
                        .param("at", "2040-01-01T10:00:00+08:00").param("range", "1h"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recognition.model_version").value("past-v1"));
    }

    @Test
    void replayBackfillsExistingDatabaseMinutesIdempotently() throws Exception {
        OffsetDateTime from = OffsetDateTime.parse("2042-01-01T10:00:00+08:00");
        for (int index = 0; index < 2; index++) {
            OffsetDateTime time = from.plusMinutes(index);
            measurements.insert(new MainSwitchMinutePoint(
                    "A01", time, 30, 10, 10, 10, null, null, null, null,
                    1, "good", "replay-test"), "setup-replay", OffsetDateTime.now());
        }
        String body = objectMapper.writeValueAsString(java.util.Map.of(
                "from", from, "to", from.plusMinutes(2), "dry_run", false));
        String response = mvc.perform(post("/api/v1/stations/A01/inference-replays")
                        .contentType("application/json").content(body))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("queued"))
                .andReturn().getResponse().getContentAsString();
        String jobId = objectMapper.readTree(response).get("job_id").asText();
        String jobStatus = "queued";
        for (int attempt = 0; attempt < 100 && !"completed".equals(jobStatus); attempt++) {
            Thread.sleep(20);
            jobStatus = jdbc.sql("select status from inference_replay_job where job_id = :jobId")
                    .param("jobId", jobId).query(String.class).single();
        }
        assertThat(jobStatus).isEqualTo("completed");
        Map<String, Object> completedJob = jdbc.sql("select * from inference_replay_job where job_id = :jobId")
                .param("jobId", jobId).query().singleRow();
        assertThat(((Number) completedJob.get("failed_targets")).intValue())
                .as(String.valueOf(completedJob.get("error_summary"))).isZero();
        assertThat(jdbc.sql("""
                        select count(*) from pv_separation_result
                        where station_id = 'A01' and event_time >= :from and event_time < :to
                        """).param("from", from).param("to", from.plusMinutes(2))
                .query(Long.class).single()).isEqualTo(2);

        String secondResponse = mvc.perform(post("/api/v1/stations/A01/inference-replays")
                        .contentType("application/json").content(body))
                .andExpect(status().isAccepted()).andReturn().getResponse().getContentAsString();
        String secondJobId = objectMapper.readTree(secondResponse).get("job_id").asText();
        String secondStatus = "queued";
        for (int attempt = 0; attempt < 100 && !"completed".equals(secondStatus); attempt++) {
            Thread.sleep(20);
            secondStatus = jdbc.sql("select status from inference_replay_job where job_id = :jobId")
                    .param("jobId", secondJobId).query(String.class).single();
        }
        assertThat(secondStatus).isEqualTo("completed");
        assertThat(jdbc.sql("""
                        select count(*) from pv_separation_result
                        where station_id = 'A01' and event_time >= :from and event_time < :to
                        """).param("from", from).param("to", from.plusMinutes(2))
                .query(Long.class).single()).isEqualTo(2);
    }

    private void insertRecognition(String version, OffsetDateTime eventTime) {
        String id = UUID.randomUUID().toString();
        jdbc.sql("""
                        insert into recognition_result (
                          recognition_id, station_id, event_time, result_time,
                          input_window_start, input_window_end, interpolated_minutes,
                          quality_status, model_version, model_summary, deployment_role,
                          request_id, created_at
                        ) values (:id, 'A01', :eventTime, :eventTime, :windowStart,
                          :eventTime, 0, 'good', :version, '{}', 'active', :requestId, :eventTime)
                        """).param("id", id).param("eventTime", eventTime)
                .param("windowStart", eventTime.minusMinutes(119)).param("version", version)
                .param("requestId", "test-" + version).update();
        jdbc.sql("""
                        insert into recognition_item (recognition_id, kind, score, detected, feature_summary)
                        values (:id, 'pv', 0.9, true, '[]')
                        """).param("id", id).update();
    }

    private String ingestionJson(List<java.util.Map<String, Object>> points) throws Exception {
        return objectMapper.writeValueAsString(java.util.Map.of("points", points));
    }

    private java.util.Map<String, Object> point(OffsetDateTime time) {
        return java.util.Map.of(
                "station_id", "A01", "event_time", time, "active_power_kw", 20.0,
                "phase_a_power_kw", 6.0, "phase_b_power_kw", 7.0,
                "phase_c_power_kw", 7.0, "coverage_ratio", 1.0,
                "quality_flag", "good", "source_id", "test-source");
    }
}
