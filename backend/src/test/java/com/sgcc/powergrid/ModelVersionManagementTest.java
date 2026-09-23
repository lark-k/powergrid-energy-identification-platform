package com.sgcc.powergrid;

import com.sgcc.powergrid.integration.modelservice.ModelServiceClient;
import java.util.List;
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class ModelVersionManagementTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcClient jdbc;
    @MockBean ModelServiceClient models;
    @Autowired com.sgcc.powergrid.measurement.MeasurementRepository measurements;
    private final AtomicReference<String> active = new AtomicReference<>("version-old");
    private final AtomicReference<String> previous = new AtomicReference<>();

    Map<String, Object> entry(String version, String hash) {
        return Map.of("model_version", version, "task", "resource_identification", "status", "ready",
                "artifact_sha256", hash, "manifest", Map.of("model_id", "test", "model_type", "tcn_lstm"));
    }

    Map<String, Object> catalog() {
        var prior = new LinkedHashMap<String, String>();
        prior.put("resource_identification", previous.get());
        return Map.of("active", Map.of("resource_identification", active.get()), "previous", prior,
                "models", List.of(entry("version-old", "a".repeat(64)), entry("version-new", "b".repeat(64))));
    }

    @BeforeEach void setup() {
        active.set("version-old"); previous.set(null);
        when(models.modelVersions()).thenAnswer(call -> catalog());
        when(models.activateModel(anyString(), anyString(), anyString())).thenAnswer(call -> {
            assertThat(call.<String>getArgument(2)).isEqualTo(active.get());
            previous.set(active.getAndSet(call.getArgument(1)));
            return catalog();
        });
    }

    @Test void readOnlyUsersCanSeeRuntimeButCannotSwitchOrApprove() throws Exception {
        mvc.perform(get("/api/v1/models/available").header("X-Dev-Roles", "VIEWER"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.can_manage").value(false))
                .andExpect(jsonPath("$.active.resource_identification").value("version-old"));
        mvc.perform(post("/api/v1/models/version-new/approve").header("X-Dev-Roles", "VIEWER"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/models/version-new/deploy").header("X-Dev-Roles", "VIEWER")
                .contentType("application/json").content("{\"role\":\"active\",\"expected_version\":\"version-old\"}"))
                .andExpect(status().isForbidden());
        verify(models, never()).activateModel(anyString(), anyString(), anyString());
    }

    @Test void latestTrainingTracksActiveVersionAndImportedEpochsAreBoundToTheirModels() throws Exception {
        active.set("sgcc-identification-f291cfb7f4fc");
        mvc.perform(get("/api/v1/stations/A01/training-runs/latest"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.model_version").value(active.get()))
                .andExpect(jsonPath("$.sample_count").value(21726))
                .andExpect(jsonPath("$.epochs.length()").value(18));
        active.set("version-without-training");
        mvc.perform(get("/api/v1/stations/A01/training-runs/latest")).andExpect(status().isNotFound());
        assertThat(jdbc.sql("select count(*) from training_epoch where run_id='formal-v1-pv-646637f18f09'")
                .query(Long.class).single()).isEqualTo(42);
        assertThat(jdbc.sql("select source_record from training_run where model_version='sgcc-pv-separation-646637f18f09'")
                .query(String.class).single()).contains("user_assigned_date", "2026-09-22", "全部构造数据评估");
    }

    @Test void fullElectricalFieldsPersistAndChangesBeyondFourPowerFieldsAreUpdated() {
        var values = new java.util.TreeMap<String, Double>();
        com.sgcc.powergrid.measurement.ElectricalFields.NAMES.forEach(name -> values.put(name, 1.25));
        var at = java.time.OffsetDateTime.parse("2026-09-22T10:00:00+08:00");
        var point = new com.sgcc.powergrid.measurement.MainSwitchMinutePoint("A01", at, 1, 1, 1, 1,
                null, null, null, null, 1, "good", "mqtt:202601230004", values, Map.of("A_SCC", false));
        assertThat(measurements.insert(point, "formal-input", at.plusMinutes(1))).isEqualTo(1);
        var stored = measurements.history("A01", at, 240).getLast();
        assertThat(com.sgcc.powergrid.measurement.ElectricalFields.values(stored.get("electrical_fields_json"))).hasSize(56);
        assertThat(com.sgcc.powergrid.measurement.ElectricalFields.validity(stored.get("field_validity_json"))).containsEntry("A_SCC", false);
        values.put("PhV_phsA", 230.1);
        var updated = new com.sgcc.powergrid.measurement.MainSwitchMinutePoint("A01", at, 1, 1, 1, 1,
                null, null, null, null, 1, "good", "mqtt:202601230004", values, Map.of("A_SCC", false));
        assertThat(measurements.update(updated, "formal-update", at.plusMinutes(2))).isEqualTo(1);
        assertThat(measurements.latestBefore("A01", at.plusMinutes(1)).orElseThrow().electricalFields()).containsEntry("PhV_phsA", 230.1);
    }

    @Test void approvalSwitchAndRollbackUseActualRuntimeAndRecordDeployment() throws Exception {
        mvc.perform(post("/api/v1/models/version-new/deploy").contentType("application/json")
                .content("{\"role\":\"active\",\"expected_version\":\"version-old\"}"))
                .andExpect(status().isConflict());
        mvc.perform(post("/api/v1/models/version-new/approve")).andExpect(status().isOk());
        mvc.perform(post("/api/v1/models/version-new/deploy").contentType("application/json")
                .content("{\"role\":\"active\",\"expected_version\":\"version-old\"}"))
                .andExpect(status().isOk());
        assertThat(active.get()).isEqualTo("version-new");
        assertThat(jdbc.sql("select previous_model_version from model_deployment where model_version='version-new'")
                .query(String.class).single()).isEqualTo("version-old");
        mvc.perform(get("/api/v1/models/available"))
                .andExpect(jsonPath("$.active.resource_identification").value("version-new"));
        mvc.perform(post("/api/v1/models/resource_identification/rollback").contentType("application/json")
                .content("{\"expected_version\":\"version-new\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.model_version").value("version-old"));
        assertThat(active.get()).isEqualTo("version-old");
    }

    @Test void rejectsStaleExpectedVersionBeforeRuntimeMutation() throws Exception {
        mvc.perform(post("/api/v1/models/version-new/approve")).andExpect(status().isOk());
        mvc.perform(post("/api/v1/models/version-new/deploy").contentType("application/json")
                .content("{\"role\":\"active\",\"expected_version\":\"stale\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("MODEL_VERSION_CONFLICT"));
        verify(models, never()).activateModel(anyString(), anyString(), anyString());
        assertThat(jdbc.sql("select count(*) from model_deployment where model_version='version-new'")
                .query(Long.class).single()).isZero();
    }

    @Test void registeredShadowCandidateDoesNotRequireActiveServiceCatalog() throws Exception {
        mvc.perform(post("/api/v1/models").contentType("application/json")
                .content("{\"model_id\":\"shadow-test\",\"task\":\"resource_identification\",\"model_version\":\"shadow-only\",\"artifact_sha256\":\""
                        + "c".repeat(64) + "\",\"manifest\":{}}"))
                .andExpect(status().isOk());
        doThrow(new IllegalStateException("active service unavailable")).when(models).modelVersions();
        mvc.perform(post("/api/v1/models/shadow-only/approve")).andExpect(status().isOk());
        mvc.perform(post("/api/v1/models/shadow-only/deploy").contentType("application/json")
                .content("{\"role\":\"candidate\"}"))
                .andExpect(status().isOk());
        assertThat(jdbc.sql("select health_status from model_deployment where model_version='shadow-only'")
                .query(String.class).single()).isEqualTo("unknown");
        verify(models, never()).activateModel(anyString(), anyString(), anyString());
    }

    @Test void runtimeRejectionDoesNotCreateSuccessfulDeployment() throws Exception {
        mvc.perform(post("/api/v1/models/version-new/approve")).andExpect(status().isOk());
        doThrow(
                new com.sgcc.powergrid.common.ApiException(org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY,
                        "MODEL_INCOMPATIBLE", "incompatible")).when(models).activateModel(anyString(), anyString(), anyString());
        mvc.perform(post("/api/v1/models/version-new/deploy").contentType("application/json")
                .content("{\"role\":\"active\",\"expected_version\":\"version-old\"}"))
                .andExpect(status().isUnprocessableEntity());
        assertThat(active.get()).isEqualTo("version-old");
        assertThat(jdbc.sql("select count(*) from model_deployment where model_version='version-new'")
                .query(Long.class).single()).isZero();
    }
}
