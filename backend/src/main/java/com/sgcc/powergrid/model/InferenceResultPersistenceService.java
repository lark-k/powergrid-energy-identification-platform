package com.sgcc.powergrid.model;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sgcc.powergrid.common.JdbcValues;
import com.sgcc.powergrid.integration.modelservice.ModelServiceDtos;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InferenceResultPersistenceService {
    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;

    public InferenceResultPersistenceService(JdbcClient jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public SaveOutcome save(
            String stationId,
            OffsetDateTime targetTime,
            String requestId,
            List<Map<String, Object>> rows,
            ModelServiceDtos.InferenceResult result) throws JsonProcessingException {
        OffsetDateTime now = OffsetDateTime.now();
        String summary = objectMapper.writeValueAsString(Map.of(
                "warnings", result.warnings(),
                "inference_time_ms", result.inferenceTimeMs()));
        int recognitionInserted = 0;
        boolean recognitionAvailable = result.recognitionModelVersion() != null
                && result.pv() != null && result.pv().score() != null;
        if (recognitionAvailable) {
            String recognitionId = UUID.randomUUID().toString();
            recognitionInserted = jdbc.sql("""
                            insert into recognition_result (
                              recognition_id, station_id, event_time, result_time,
                              input_window_start, input_window_end, interpolated_minutes,
                              quality_status, model_version, model_summary, deployment_role,
                              request_id, created_at
                            ) select :id, :stationId, :eventTime, :now, :windowStart,
                              :windowEnd, :interpolated, :quality, :version, :summary,
                              'active', :requestId, :now
                            where not exists (
                              select 1 from recognition_result
                              where station_id = :stationId and event_time = :eventTime
                                and model_version = :version and deployment_role = 'active'
                            )
                            """)
                    .param("id", recognitionId).param("stationId", stationId)
                    .param("eventTime", targetTime).param("now", now)
                    .param("windowStart", result.recognitionWindowStart())
                    .param("windowEnd", result.inputWindowEnd())
                    .param("interpolated", result.interpolatedMinutes())
                    .param("quality", result.qualityStatus())
                    .param("version", result.recognitionModelVersion())
                    .param("summary", summary).param("requestId", requestId).update();
            if (recognitionInserted == 1) {
                insertItem(recognitionId, "pv", result.pv());
                insertItem(recognitionId, "energy_station", result.energyStation());
                insertItem(recognitionId, "charger", result.charger());
            }
        }

        int separationInserted = 0;
        boolean separationAvailable = result.separationModelVersion() != null
                && result.pvGenerationKw() != null;
        if (separationAvailable) {
            double totalPower = rows.stream()
                    .filter(row -> targetTime.isEqual(JdbcValues.offsetDateTime(row.get("event_time"))))
                    .map(row -> number(row, "active_power_kw")).findFirst()
                    .orElseThrow(() -> new IllegalStateException("Target total power not found"));
            separationInserted = jdbc.sql("""
                            insert into pv_separation_result (
                              separation_id, station_id, event_time, separation_time,
                              input_window_start, input_window_end, interpolated_minutes,
                              quality_status, total_power_kw, initial_pv_kw,
                              pv_activity_probability, corrected_pv_kw, station_feedback_value,
                              correction_kw, correction_ratio, correction_confidence, batch_id,
                              model_version, model_summary, deployment_role, request_id,
                              created_at, updated_at
                            ) select :id, :stationId, :eventTime, :now, :windowStart,
                              :windowEnd, :interpolated, :quality, :total, :pv, :probability,
                              null, null, null, null, null, null, :version, :summary,
                              'active', :requestId, :now, :now
                            where not exists (
                              select 1 from pv_separation_result
                              where station_id = :stationId and event_time = :eventTime
                                and model_version = :version and deployment_role = 'active'
                            )
                            """)
                    .param("id", UUID.randomUUID().toString()).param("stationId", stationId)
                    .param("eventTime", targetTime).param("now", now)
                    .param("windowStart", result.separationWindowStart())
                    .param("windowEnd", result.inputWindowEnd())
                    .param("interpolated", result.interpolatedMinutes())
                    .param("quality", result.qualityStatus()).param("total", totalPower)
                    .param("pv", result.pvGenerationKw()).param("probability", result.pvActivityProbability())
                    .param("version", result.separationModelVersion()).param("summary", summary)
                    .param("requestId", requestId).update();
        }
        appendProcessEvent(stationId, requestId, "inference.completed", result.qualityStatus(),
                Map.of("target_time", targetTime.toString(), "recognition_model_version",
                        String.valueOf(result.recognitionModelVersion()), "separation_model_version",
                        String.valueOf(result.separationModelVersion())));
        appendOutbox(stationId, requestId, "snapshot.updated", Map.of("target_time", targetTime.toString()));
        return new SaveOutcome(recognitionAvailable, separationAvailable, recognitionInserted, separationInserted);
    }

    private void insertItem(String recognitionId, String kind, ModelServiceDtos.ResourceInference value) {
        jdbc.sql("""
                        insert into recognition_item (
                          recognition_id, kind, score, detected, feature_summary
                        ) values (:id, :kind, :score, :detected, '[]')
                        """)
                .param("id", recognitionId).param("kind", kind)
                .param("score", value == null ? null : value.score())
                .param("detected", value == null ? null : value.detected()).update();
    }

    private void appendProcessEvent(
            String stationId, String requestId, String type, String status, Object detail)
            throws JsonProcessingException {
        jdbc.sql("""
                        insert into collection_process_event (
                          event_id, station_id, request_id, event_type, status, detail_json, occurred_at
                        ) values (:id, :stationId, :requestId, :type, :status, :detail, :now)
                        """)
                .param("id", UUID.randomUUID().toString()).param("stationId", stationId)
                .param("requestId", requestId).param("type", type).param("status", status)
                .param("detail", objectMapper.writeValueAsString(detail)).param("now", OffsetDateTime.now()).update();
    }

    private void appendOutbox(String stationId, String requestId, String type, Object payload)
            throws JsonProcessingException {
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
    }

    private static double number(Map<String, Object> row, String key) {
        return ((Number) row.get(key)).doubleValue();
    }

    public record SaveOutcome(
            boolean recognitionAvailable,
            boolean separationAvailable,
            int recognitionInserted,
            int separationInserted) {}
}
