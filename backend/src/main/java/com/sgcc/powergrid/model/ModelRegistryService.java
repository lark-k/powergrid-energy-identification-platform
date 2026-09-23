package com.sgcc.powergrid.model;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sgcc.powergrid.common.ApiException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.LinkedHashMap;
import com.sgcc.powergrid.integration.modelservice.ModelServiceClient;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ModelRegistryService {
    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;
    private final ModelServiceClient modelService;

    public ModelRegistryService(JdbcClient jdbc, ObjectMapper objectMapper, ModelServiceClient modelService) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.modelService = modelService;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> available() {
        Map<String, Object> catalog = new LinkedHashMap<>(modelService.modelVersions());
        List<Map<String, Object>> models = (List<Map<String, Object>>) catalog.get("models");
        catalog.put("models", models.stream().map(item -> {
            Map<String, Object> result = new LinkedHashMap<>(item);
            var rows = jdbc.sql("select lifecycle_status from model_registry where model_version=:v")
                    .param("v", item.get("model_version")).query().listOfRows();
            result.put("lifecycle_status", rows.isEmpty() ? "unregistered" : rows.getFirst().get("lifecycle_status"));
            return result;
        }).toList());
        return catalog;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> availableModel(Map<String, Object> catalog, String version) {
        return ((List<Map<String, Object>>) catalog.get("models")).stream()
                .filter(item -> version.equals(item.get("model_version")))
                .filter(item -> "ready".equals(item.get("status")))
                .findFirst().orElseThrow(() -> new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,
                        "MODEL_INCOMPATIBLE", "该版本没有可用且兼容的模型制品"));
    }

    @SuppressWarnings("unchecked")
    private void registerAvailable(Map<String, Object> item, String actor) {
        String version = String.valueOf(item.get("model_version"));
        var rows = jdbc.sql("select artifact_sha256, task from model_registry where model_version=:v")
                .param("v", version).query().listOfRows();
        if (!rows.isEmpty()) {
            if (!item.get("artifact_sha256").equals(rows.getFirst().get("artifact_sha256"))
                    || !item.get("task").equals(rows.getFirst().get("task"))) {
                throw new ApiException(HttpStatus.CONFLICT, "MODEL_DIGEST_MISMATCH", "注册记录与实际模型制品不一致");
            }
            return;
        }
        Map<String, Object> manifest = (Map<String, Object>) item.get("manifest");
        register(new RegisterRequest(String.valueOf(manifest.get("model_id")), String.valueOf(item.get("task")),
                version, String.valueOf(item.get("artifact_sha256")), manifest), actor);
    }

    @Transactional
    public void register(RegisterRequest request, String actor) {
        if (!request.artifactSha256().matches("[a-f0-9]{64}")) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_MODEL_DIGEST", "artifact_sha256 不合法");
        }
        if (!request.task().matches("resource_identification|pv_separation")) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_MODEL_TASK", "模型任务不合法");
        }
        try {
            jdbc.sql("""
                            insert into model_registry (
                              model_version, model_id, task, artifact_sha256, manifest_json,
                              lifecycle_status, registered_by, registered_at, approved_by, approved_at
                            ) values (:version, :modelId, :task, :sha, :manifest,
                              'registered', :actor, :now, null, null)
                            """).param("version", request.modelVersion()).param("modelId", request.modelId())
                    .param("task", request.task()).param("sha", request.artifactSha256())
                    .param("manifest", objectMapper.writeValueAsString(request.manifest()))
                    .param("actor", actor).param("now", OffsetDateTime.now()).update();
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(exception);
        }
    }

    @Transactional
    public void approve(String version, String actor) {
        // Explicitly registered shadow candidates may live in a separate service.
        // Active deployment still verifies their actual artifact against the runtime catalog.
        boolean registered = jdbc.sql("select count(*) from model_registry where model_version=:v")
                .param("v", version).query(Long.class).single() > 0;
        if (!registered) registerAvailable(availableModel(modelService.modelVersions(), version), actor);
        int changed = jdbc.sql("""
                        update model_registry set lifecycle_status = 'approved',
                          approved_by = :actor, approved_at = :now
                        where model_version = :version and lifecycle_status in ('registered', 'approved')
                        """).param("actor", actor).param("now", OffsetDateTime.now())
                .param("version", version).update();
        if (changed != 1) throw new ApiException(HttpStatus.CONFLICT, "MODEL_NOT_REGISTERED", "模型未注册或已审批");
    }

    @Transactional
    public synchronized void deploy(String version, String role, String actor, String expectedVersion) {
        if (!role.matches("active|candidate")) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_DEPLOYMENT_ROLE", "部署角色不合法");
        }
        List<Map<String, Object>> models = jdbc.sql("""
                        select task, lifecycle_status from model_registry where model_version = :version
                        """).param("version", version).query().listOfRows();
        if (models.isEmpty() || !"approved".equals(models.getFirst().get("lifecycle_status"))) {
            throw new ApiException(HttpStatus.CONFLICT, "MODEL_NOT_APPROVED", "模型必须先人工审批");
        }
        String task = String.valueOf(models.getFirst().get("task"));
        String previous = null;
        if ("active".equals(role)) {
            if (expectedVersion == null || expectedVersion.isBlank()) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "EXPECTED_MODEL_REQUIRED", "必须提供当前生效版本，防止覆盖其他切换操作");
            }
            var catalog = modelService.modelVersions();
            registerAvailable(availableModel(catalog, version), actor);
            @SuppressWarnings("unchecked") var active = (Map<String, String>) catalog.get("active");
            previous = active.get(task);
            if (!expectedVersion.equals(previous)) {
                throw new ApiException(HttpStatus.CONFLICT, "MODEL_VERSION_CONFLICT", "当前模型已变化，请刷新后重试");
            }
            if (version.equals(previous)) return;
            // The already-running bootstrap version is retained as an approved rollback target.
            registerAvailable(availableModel(catalog, previous), actor);
            jdbc.sql("update model_registry set lifecycle_status='approved', approved_by=:actor, approved_at=:now where model_version=:v and lifecycle_status='registered'")
                    .param("actor", actor).param("now", OffsetDateTime.now()).param("v", previous).update();
            modelService.activateModel(task, version, expectedVersion);
            String rollbackVersion = previous;
            if (TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override public void afterCompletion(int status) {
                        if (status == STATUS_ROLLED_BACK) {
                            try { modelService.activateModel(task, rollbackVersion, version); }
                            catch (Exception exception) {
                                LoggerFactory.getLogger(ModelRegistryService.class).error(
                                        "Model deployment audit failed; runtime must be reconciled for task={}", task, exception);
                            }
                        }
                    }
                });
            }
            jdbc.sql("""
                            update model_deployment set status = 'retired', retired_at = :now
                            where task = :task and deployment_role = 'active' and status = 'deployed'
                            """).param("now", OffsetDateTime.now()).param("task", task).update();
        }
        jdbc.sql("""
                        insert into model_deployment (
                          deployment_id, station_id, task, model_version, deployment_role,
                          status, previous_model_version, health_status, deployed_by,
                          deployed_at, retired_at
                        ) values (:id, null, :task, :version, :role, 'deployed',
                          :previous, :health, :actor, :now, null)
                        """).param("id", UUID.randomUUID().toString()).param("task", task)
                .param("version", version).param("role", role).param("previous", previous)
                .param("health", "active".equals(role) ? "ready" : "unknown")
                .param("actor", actor).param("now", OffsetDateTime.now()).update();
    }

    @Transactional
    public String rollback(String task, String actor, String expectedVersion) {
        var catalog = modelService.modelVersions();
        @SuppressWarnings("unchecked") var previousVersions = (Map<String, String>) catalog.get("previous");
        String previous = previousVersions.get(task);
        if (previous == null) {
            throw new ApiException(HttpStatus.CONFLICT, "ROLLBACK_TARGET_NOT_FOUND", "没有可回滚的上一版本");
        }
        deploy(previous, "active", actor, expectedVersion);
        return previous;
    }

    public void saveShadowComparison(ShadowComparison request, String requestId) {
        try {
            jdbc.sql("""
                            insert into shadow_inference_comparison (
                              comparison_id, station_id, event_time, task,
                              active_model_version, candidate_model_version,
                              active_result_json, candidate_result_json, difference_json,
                              request_id, created_at
                            ) values (:id, :stationId, :eventTime, :task, :activeVersion,
                              :candidateVersion, :activeResult, :candidateResult, :difference,
                              :requestId, :now)
                            """).param("id", UUID.randomUUID().toString()).param("stationId", request.stationId())
                    .param("eventTime", request.eventTime()).param("task", request.task())
                    .param("activeVersion", request.activeModelVersion()).param("candidateVersion", request.candidateModelVersion())
                    .param("activeResult", objectMapper.writeValueAsString(request.activeResult()))
                    .param("candidateResult", objectMapper.writeValueAsString(request.candidateResult()))
                    .param("difference", objectMapper.writeValueAsString(request.difference()))
                    .param("requestId", requestId).param("now", OffsetDateTime.now()).update();
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(exception);
        }
    }

    public boolean isDeployedCandidate(String task, String version) {
        return jdbc.sql("""
                        select count(*) from model_deployment
                        where task = :task and model_version = :version
                          and deployment_role = 'candidate' and status = 'deployed'
                        """).param("task", task).param("version", version)
                .query(Long.class).single() > 0;
    }

    public record RegisterRequest(String modelId, String task, String modelVersion,
            String artifactSha256, Map<String, Object> manifest) {}
    public record DeployRequest(String role, String expectedVersion) {}
    public record RollbackRequest(String expectedVersion) {}
    public record ShadowComparison(String stationId, OffsetDateTime eventTime, String task,
            String activeModelVersion, String candidateModelVersion, Map<String, Object> activeResult,
            Map<String, Object> candidateResult, Map<String, Object> difference) {}
}
