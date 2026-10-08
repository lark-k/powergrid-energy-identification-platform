package com.sgcc.powergrid.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sgcc.powergrid.integration.modelservice.ModelServiceClient;
import com.sgcc.powergrid.integration.modelservice.ModelServiceDtos;
import com.sgcc.powergrid.measurement.MeasurementRepository;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.simple.JdbcClient;

class InferencePipelineTest {
    @Test
    void normalizesMqttTargetAndJdbcHistoryToTheSameUtcOffset() throws Exception {
        MeasurementRepository measurements = mock(MeasurementRepository.class);
        ModelServiceClient modelService = mock(ModelServiceClient.class);
        JdbcClient jdbc = mock(JdbcClient.class);
        ObjectMapper objectMapper = new ObjectMapper();
        ModelRuntimeState runtimeState = mock(ModelRuntimeState.class);
        ModelRegistryService modelRegistry = mock(ModelRegistryService.class);
        InferenceResultPersistenceService persistence = mock(InferenceResultPersistenceService.class);
        InferencePipeline pipeline = new InferencePipeline(
                measurements, modelService, jdbc, objectMapper, runtimeState, modelRegistry, persistence);

        OffsetDateTime mqttTarget = OffsetDateTime.parse("2026-09-04T17:20:00+08:00");
        Instant targetInstant = mqttTarget.toInstant();
        Map<String, Object> row = Map.of(
                "station_id", "A01",
                "event_time", Timestamp.from(targetInstant),
                "active_power_kw", -0.81,
                "phase_a_power_kw", -0.24,
                "phase_b_power_kw", -0.29,
                "phase_c_power_kw", -0.28,
                "coverage_ratio", 1.0,
                "quality_flag", "good",
                "source_id", "mqtt:test");
        when(measurements.history("A01", mqttTarget, 244)).thenReturn(List.of(row));
        when(modelService.infer(any())).thenAnswer(invocation -> {
            ModelServiceDtos.InferenceRequest request = invocation.getArgument(0);
            return new ModelServiceDtos.InferenceResult(
                    "A01", request.targetTime(), request.requestId(), null, null, null, null,
                    0, "insufficient_history", null, null,
                    new ModelServiceDtos.ResourceInference(null, null),
                    new ModelServiceDtos.ResourceInference(null, null),
                    new ModelServiceDtos.ResourceInference(null, null),
                    null, null, 1.0, List.of("insufficient_history"));
        });
        when(modelService.inferCandidate(any())).thenReturn(Optional.empty());

        pipeline.process("A01", mqttTarget, "req-timezone");

        ArgumentCaptor<ModelServiceDtos.InferenceRequest> requestCaptor =
                ArgumentCaptor.forClass(ModelServiceDtos.InferenceRequest.class);
        verify(modelService).infer(requestCaptor.capture());
        ModelServiceDtos.InferenceRequest request = requestCaptor.getValue();
        assertThat(request.targetTime().getOffset()).isEqualTo(ZoneOffset.UTC);
        assertThat(request.targetTime().toInstant()).isEqualTo(targetInstant);
        assertThat(request.points()).singleElement().satisfies(point -> {
            assertThat(point.eventTime().getOffset()).isEqualTo(ZoneOffset.UTC);
            assertThat(point.eventTime().toInstant()).isEqualTo(targetInstant);
        });
        verify(persistence).save(eq("A01"), eq(mqttTarget), eq("req-timezone"), anyList(), any());
    }
}
