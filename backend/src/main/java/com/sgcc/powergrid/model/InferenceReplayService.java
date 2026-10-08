package com.sgcc.powergrid.model;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sgcc.powergrid.common.ApiException;
import com.sgcc.powergrid.common.JdbcValues;
import com.sgcc.powergrid.measurement.ElectricalFields;
import com.sgcc.powergrid.integration.modelservice.ModelServiceClient;
import com.sgcc.powergrid.integration.modelservice.ModelServiceDtos;
import com.sgcc.powergrid.measurement.MeasurementRepository;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Service
public class InferenceReplayService {
    private static final int TARGET_CHUNK_SIZE = 300;
    private static final int REQUIRED_HISTORY_MINUTES = 244;
    private static final long MAX_RANGE_DAYS = 31;

    private final JdbcClient jdbc;
    private final MeasurementRepository measurements;
    private final ModelServiceClient modelService;
    private final InferenceResultPersistenceService resultPersistence;
    private final ModelRuntimeState runtimeState;
    private final ObjectMapper objectMapper;
    private final ApplicationEventPublisher events;

    public InferenceReplayService(
            JdbcClient jdbc,
            MeasurementRepository measurements,
            ModelServiceClient modelService,
            InferenceResultPersistenceService resultPersistence,
            ModelRuntimeState runtimeState,
            ObjectMapper objectMapper,
            ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.measurements = measurements;
        this.modelService = modelService;
        this.resultPersistence = resultPersistence;
        this.runtimeState = runtimeState;
        this.objectMapper = objectMapper;
        this.events = events;
    }

    @Transactional
    public Map<String, Object> start(
            String stationId,
            OffsetDateTime from,
            OffsetDateTime to,
            boolean dryRun,
            String requestId,
            String requestedBy) {
        validateRange(stationId, from, to);
        String jobId = UUID.randomUUID().toString();
        OffsetDateTime now = OffsetDateTime.now();
        jdbc.sql("""
                        insert into inference_replay_job (
                          job_id, station_id, range_start, range_end, status, dry_run,
                          total_targets, processed_targets, recognition_results,
                          separation_results, skipped_targets, failed_targets,
                          error_summary, request_id, requested_by, created_at,
                          started_at, completed_at, updated_at
                        ) values (:jobId, :stationId, :from, :to, 'queued', :dryRun,
                          0, 0, 0, 0, 0, 0, null, :requestId, :requestedBy,
                          :now, null, null, :now)
                        """)
                .param("jobId", jobId).param("stationId", stationId)
                .param("from", from).param("to", to).param("dryRun", dryRun)
                .param("requestId", requestId).param("requestedBy", requestedBy)
                .param("now", now).update();
        appendOutbox(stationId, requestId, "inference.replay.queued",
                Map.of("job_id", jobId, "range_start", from.toString(), "range_end", to.toString()));
        events.publishEvent(new ReplayRequestedEvent(jobId, stationId, from, to, dryRun, requestId));
        return job(stationId, jobId);
    }

    public Map<String, Object> job(String stationId, String jobId) {
        List<Map<String, Object>> rows = jdbc.sql("""
                        select job_id, station_id, range_start, range_end, status, dry_run,
                               total_targets, processed_targets, recognition_results,
                               separation_results, skipped_targets, failed_targets,
                               error_summary, request_id, requested_by, created_at,
                               started_at, completed_at, updated_at
                        from inference_replay_job
                        where station_id = :stationId and job_id = :jobId
                        """)
                .param("stationId", stationId).param("jobId", jobId).query().listOfRows();
        if (rows.isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "INFERENCE_REPLAY_NOT_FOUND", "历史推理回放任务不存在");
        }
        return rows.getFirst();
    }

    public List<Map<String, Object>> jobs(String stationId) {
        ensureStation(stationId);
        return jdbc.sql("""
                        select job_id, station_id, range_start, range_end, status, dry_run,
                               total_targets, processed_targets, recognition_results,
                               separation_results, skipped_targets, failed_targets,
                               error_summary, request_id, requested_by, created_at,
                               started_at, completed_at, updated_at
                        from inference_replay_job where station_id = :stationId
                        order by created_at desc limit 50
                        """).param("stationId", stationId).query().listOfRows();
    }

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void execute(ReplayRequestedEvent event) {
        OffsetDateTime startedAt = OffsetDateTime.now();
        jdbc.sql("""
                        update inference_replay_job set status = 'running', started_at = :now, updated_at = :now
                        where job_id = :jobId and status = 'queued'
                        """).param("jobId", event.jobId()).param("now", startedAt).update();
        try {
            List<OffsetDateTime> targets = jdbc.sql("""
                            select event_time from main_switch_minute
                            where station_id = :stationId and event_time >= :from and event_time < :to
                            order by event_time
                            """)
                    .param("stationId", event.stationId()).param("from", event.from()).param("to", event.to())
                    .query((rs, row) -> rs.getObject("event_time", OffsetDateTime.class)).list();
            updateTotals(event.jobId(), targets.size());
            if (event.dryRun()) {
                complete(event, targets.size(), 0, 0, targets.size(), 0, null);
                return;
            }

            int processed = 0;
            int recognition = 0;
            int separation = 0;
            int skipped = 0;
            int failed = 0;
            List<String> errors = new ArrayList<>();
            for (int offset = 0; offset < targets.size(); offset += TARGET_CHUNK_SIZE) {
                List<OffsetDateTime> chunk = targets.subList(
                        offset, Math.min(targets.size(), offset + TARGET_CHUNK_SIZE));
                OffsetDateTime historyStart = chunk.getFirst().minusMinutes(REQUIRED_HISTORY_MINUTES - 1L);
                List<Map<String, Object>> rows = measurements.between(
                        event.stationId(), historyStart, chunk.getLast());
                try {
                    List<ModelServiceDtos.InferenceResult> results = modelService.replay(
                            new ModelServiceDtos.BatchInferenceRequest(
                                    event.requestId(), event.stationId(), chunk, toPoints(rows),
                                    InferencePipeline.arrivalPoints(measurements.arrivalBetween(event.stationId(), historyStart, chunk.getLast()))));
                    if (results.size() != chunk.size()) {
                        throw new IllegalStateException("model replay result count does not match target count");
                    }
                    for (ModelServiceDtos.InferenceResult result : results) {
                        InferenceResultPersistenceService.SaveOutcome outcome = resultPersistence.save(
                                event.stationId(), result.targetTime(), event.requestId(), rows, result);
                        recognition += outcome.recognitionAvailable() ? 1 : 0;
                        separation += outcome.separationAvailable() ? 1 : 0;
                        skipped += !outcome.recognitionAvailable() && !outcome.separationAvailable() ? 1 : 0;
                        runtimeState.success(result.recognitionModelVersion(), result.separationModelVersion(),
                                result.inferenceTimeMs(), OffsetDateTime.now(),
                                result.separationModelVersion() == null ? "warming_up" : "ready");
                    }
                } catch (Exception exception) {
                    failed += chunk.size();
                    runtimeState.failure();
                    if (errors.size() < 5) {
                        errors.add(chunk.getFirst() + ".." + chunk.getLast() + ": "
                                + exception.getClass().getSimpleName());
                    }
                }
                processed += chunk.size();
                updateProgress(event.jobId(), processed, recognition, separation, skipped, failed,
                        errors.isEmpty() ? null : String.join("; ", errors));
            }
            complete(event, processed, recognition, separation, skipped, failed,
                    errors.isEmpty() ? null : String.join("; ", errors));
        } catch (Exception exception) {
            fail(event, exception);
        }
    }

    private List<ModelServiceDtos.MinutePoint> toPoints(List<Map<String, Object>> rows) {
        return rows.stream().map(row -> new ModelServiceDtos.MinutePoint(
                String.valueOf(row.get("station_id")), JdbcValues.offsetDateTime(row.get("event_time")),
                number(row, "active_power_kw"), number(row, "phase_a_power_kw"),
                number(row, "phase_b_power_kw"), number(row, "phase_c_power_kw"),
                number(row, "coverage_ratio"), String.valueOf(row.get("quality_flag")),
                String.valueOf(row.get("source_id")), ElectricalFields.values(row.get("electrical_fields_json")),
                    ElectricalFields.validity(row.get("field_validity_json")))).toList();
    }

    private void validateRange(String stationId, OffsetDateTime from, OffsetDateTime to) {
        ensureStation(stationId);
        if (from == null || to == null || !to.isAfter(from)) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_REPLAY_RANGE",
                    "to 必须晚于 from");
        }
        if (ChronoUnit.DAYS.between(from, to) > MAX_RANGE_DAYS) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "REPLAY_RANGE_TOO_LARGE",
                    "单次历史推理回放不得超过 31 天");
        }
    }

    private void ensureStation(String stationId) {
        if (!measurements.stationExists(stationId)) {
            throw new ApiException(HttpStatus.NOT_FOUND, "STATION_NOT_FOUND", "台区不存在");
        }
    }

    private void updateTotals(String jobId, int total) {
        jdbc.sql("update inference_replay_job set total_targets = :total, updated_at = :now where job_id = :jobId")
                .param("total", total).param("now", OffsetDateTime.now()).param("jobId", jobId).update();
    }

    private void updateProgress(
            String jobId, int processed, int recognition, int separation, int skipped, int failed, String error) {
        jdbc.sql("""
                        update inference_replay_job set processed_targets = :processed,
                          recognition_results = :recognition, separation_results = :separation,
                          skipped_targets = :skipped, failed_targets = :failed,
                          error_summary = :error, updated_at = :now where job_id = :jobId
                        """)
                .param("processed", processed).param("recognition", recognition)
                .param("separation", separation).param("skipped", skipped).param("failed", failed)
                .param("error", error).param("now", OffsetDateTime.now()).param("jobId", jobId).update();
    }

    private void complete(
            ReplayRequestedEvent event, int processed, int recognition, int separation,
            int skipped, int failed, String error) {
        OffsetDateTime now = OffsetDateTime.now();
        updateProgress(event.jobId(), processed, recognition, separation, skipped, failed, error);
        jdbc.sql("""
                        update inference_replay_job set status = 'completed', completed_at = :now, updated_at = :now
                        where job_id = :jobId
                        """).param("now", now).param("jobId", event.jobId()).update();
        appendOutbox(event.stationId(), event.requestId(), "inference.replay.completed",
                Map.of("job_id", event.jobId(), "processed_targets", processed,
                        "recognition_results", recognition, "separation_results", separation,
                        "failed_targets", failed));
    }

    private void fail(ReplayRequestedEvent event, Exception exception) {
        OffsetDateTime now = OffsetDateTime.now();
        jdbc.sql("""
                        update inference_replay_job set status = 'failed', error_summary = :error,
                          completed_at = :now, updated_at = :now where job_id = :jobId
                        """)
                .param("error", exception.getClass().getSimpleName())
                .param("now", now).param("jobId", event.jobId()).update();
        runtimeState.failure();
        appendOutbox(event.stationId(), event.requestId(), "inference.replay.failed",
                Map.of("job_id", event.jobId(), "error_type", exception.getClass().getSimpleName()));
    }

    private void appendOutbox(String stationId, String requestId, String type, Object payload) {
        try {
            jdbc.sql("""
                            insert into outbox_event (
                              event_id, request_id, station_id, event_type, payload_json,
                              occurred_at, published_at, publish_attempts, last_error
                            ) values (:id, :requestId, :stationId, :type, :payload, :now, null, 0, null)
                            """)
                    .param("id", UUID.randomUUID().toString()).param("requestId", requestId)
                    .param("stationId", stationId).param("type", type)
                    .param("payload", objectMapper.writeValueAsString(payload))
                    .param("now", OffsetDateTime.now()).update();
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static double number(Map<String, Object> row, String key) {
        return ((Number) row.get(key)).doubleValue();
    }

    public record ReplayRequestedEvent(
            String jobId,
            String stationId,
            OffsetDateTime from,
            OffsetDateTime to,
            boolean dryRun,
            String requestId) {}
}
