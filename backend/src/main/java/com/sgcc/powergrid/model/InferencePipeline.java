package com.sgcc.powergrid.model;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sgcc.powergrid.common.JdbcValues;
import com.sgcc.powergrid.measurement.ElectricalFields;
import com.sgcc.powergrid.measurement.ElectricalFields;
import com.sgcc.powergrid.integration.modelservice.ModelServiceClient;
import com.sgcc.powergrid.integration.modelservice.ModelServiceDtos;
import com.sgcc.powergrid.measurement.IngestionModels.MinutesIngestedEvent;
import com.sgcc.powergrid.measurement.MeasurementRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Service
public class InferencePipeline {
    private static final Logger LOGGER = LoggerFactory.getLogger(InferencePipeline.class);
    private final MeasurementRepository measurements;
    private final ModelServiceClient modelService;
    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;
    private final ModelRuntimeState runtimeState;
    private final ModelRegistryService modelRegistry;
    private final InferenceResultPersistenceService resultPersistence;

    public InferencePipeline(
            MeasurementRepository measurements,
            ModelServiceClient modelService,
            JdbcClient jdbc,
            ObjectMapper objectMapper,
            ModelRuntimeState runtimeState,
            ModelRegistryService modelRegistry,
            InferenceResultPersistenceService resultPersistence) {
        this.measurements = measurements;
        this.modelService = modelService;
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.runtimeState = runtimeState;
        this.modelRegistry = modelRegistry;
        this.resultPersistence = resultPersistence;
    }

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void afterMinutesIngested(MinutesIngestedEvent event) {
        event.eventTimes().stream().sorted().forEach(time -> process(event.stationId(), time, event.requestId()));
    }

    public void process(String stationId, OffsetDateTime targetTime, String requestId) {
        try {
            List<Map<String, Object>> rows = measurements.history(stationId, targetTime, 240);
            List<ModelServiceDtos.MinutePoint> points = rows.stream().map(row -> new ModelServiceDtos.MinutePoint(
                    String.valueOf(row.get("station_id")),
                    modelTime(JdbcValues.offsetDateTime(row.get("event_time"))),
                    number(row, "active_power_kw"),
                    number(row, "phase_a_power_kw"),
                    number(row, "phase_b_power_kw"),
                    number(row, "phase_c_power_kw"),
                    number(row, "coverage_ratio"),
                    String.valueOf(row.get("quality_flag")),
                    String.valueOf(row.get("source_id")), ElectricalFields.values(row.get("electrical_fields_json")),
                    ElectricalFields.validity(row.get("field_validity_json")))).toList();
            ModelServiceDtos.InferenceRequest inferenceRequest =
                    new ModelServiceDtos.InferenceRequest(requestId, stationId, modelTime(targetTime), points);
            ModelServiceDtos.InferenceResult result = modelService.infer(inferenceRequest);
            resultPersistence.save(stationId, targetTime, requestId, rows, result);
            modelService.inferCandidate(inferenceRequest)
                    .ifPresent(candidate -> saveShadowComparisons(stationId, targetTime, requestId, result, candidate));
            runtimeState.success(result.recognitionModelVersion(), result.separationModelVersion(),
                    result.inferenceTimeMs(), OffsetDateTime.now(),
                    result.separationModelVersion() == null ? "warming_up" : "ready");
        } catch (Exception exception) {
            runtimeState.failure();
            recordFailure(stationId, targetTime, requestId, exception);
            LOGGER.warn("Model inference degraded for station={} target={}", stationId, targetTime);
        }
    }

    static OffsetDateTime modelTime(OffsetDateTime value) {
        return value.withOffsetSameInstant(ZoneOffset.UTC);
    }

    private void saveShadowComparisons(String stationId, OffsetDateTime targetTime, String requestId,
            ModelServiceDtos.InferenceResult active, ModelServiceDtos.InferenceResult candidate) {
        if (candidate.recognitionModelVersion() != null && active.recognitionModelVersion() != null
                && modelRegistry.isDeployedCandidate("resource_identification", candidate.recognitionModelVersion())) {
            modelRegistry.saveShadowComparison(new ModelRegistryService.ShadowComparison(
                    stationId, targetTime, "resource_identification", active.recognitionModelVersion(),
                    candidate.recognitionModelVersion(), recognitionMap(active), recognitionMap(candidate),
                    recognitionDifference(active, candidate)), requestId);
        }
        if (candidate.separationModelVersion() != null && active.separationModelVersion() != null
                && modelRegistry.isDeployedCandidate("pv_separation", candidate.separationModelVersion())) {
            Double activePower = active.pvGenerationKw();
            Double candidatePower = candidate.pvGenerationKw();
            Map<String, Object> difference = new java.util.LinkedHashMap<>();
            difference.put("pv_generation_kw_delta", activePower == null || candidatePower == null
                    ? null : candidatePower - activePower);
            Map<String, Object> activeResult = new java.util.LinkedHashMap<>();
            activeResult.put("pv_generation_kw", activePower);
            Map<String, Object> candidateResult = new java.util.LinkedHashMap<>();
            candidateResult.put("pv_generation_kw", candidatePower);
            modelRegistry.saveShadowComparison(new ModelRegistryService.ShadowComparison(
                    stationId, targetTime, "pv_separation", active.separationModelVersion(),
                    candidate.separationModelVersion(), activeResult, candidateResult, difference), requestId);
        }
    }

    private static Map<String, Object> recognitionMap(ModelServiceDtos.InferenceResult result) {
        return Map.of("pv", resourceMap(result.pv()), "energy_station", resourceMap(result.energyStation()),
                "charger", resourceMap(result.charger()));
    }

    private static Map<String, Object> resourceMap(ModelServiceDtos.ResourceInference resource) {
        Map<String, Object> value = new java.util.LinkedHashMap<>();
        value.put("score", resource == null ? null : resource.score());
        value.put("detected", resource == null ? null : resource.detected());
        return value;
    }

    private static Double delta(ModelServiceDtos.ResourceInference candidate,
            ModelServiceDtos.ResourceInference active) {
        return candidate == null || active == null || candidate.score() == null || active.score() == null
                ? null : candidate.score() - active.score();
    }

    private static Map<String, Object> recognitionDifference(ModelServiceDtos.InferenceResult active,
            ModelServiceDtos.InferenceResult candidate) {
        Map<String, Object> difference = new java.util.LinkedHashMap<>();
        difference.put("pv_score_delta", delta(candidate.pv(), active.pv()));
        difference.put("energy_station_score_delta", delta(candidate.energyStation(), active.energyStation()));
        difference.put("charger_score_delta", delta(candidate.charger(), active.charger()));
        return difference;
    }

    private void recordFailure(String stationId, OffsetDateTime targetTime, String requestId, Exception exception) {
        try {
            appendProcessEvent(stationId, requestId, "inference.failed", "degraded",
                    Map.of("target_time", targetTime.toString(), "error_type", exception.getClass().getSimpleName()));
            appendOutbox(stationId, requestId, "inference.failed",
                    Map.of("target_time", targetTime.toString(), "degraded", true));
        } catch (Exception persistenceFailure) {
            LOGGER.error("Unable to persist inference failure", persistenceFailure);
        }
    }

    private void appendProcessEvent(String stationId, String requestId, String type, String status, Object detail) {
        try {
            jdbc.sql("""
                            insert into collection_process_event (
                              event_id, station_id, request_id, event_type, status, detail_json, occurred_at
                            ) values (:id, :stationId, :requestId, :type, :status, :detail, :now)
                            """)
                    .param("id", UUID.randomUUID().toString()).param("stationId", stationId)
                    .param("requestId", requestId).param("type", type).param("status", status)
                    .param("detail", objectMapper.writeValueAsString(detail)).param("now", OffsetDateTime.now()).update();
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(exception);
        }
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
}
