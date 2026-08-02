package com.sgcc.powergrid.model;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sgcc.powergrid.common.ApiException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ModelRegistryService {
    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;

    public ModelRegistryService(JdbcClient jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
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

    public void approve(String version, String actor) {
        int changed = jdbc.sql("""
                        update model_registry set lifecycle_status = 'approved',
                          approved_by = :actor, approved_at = :now
                        where model_version = :version and lifecycle_status = 'registered'
                        """).param("actor", actor).param("now", OffsetDateTime.now())
                .param("version", version).update();
        if (changed != 1) throw new ApiException(HttpStatus.CONFLICT, "MODEL_NOT_REGISTERED", "模型未注册或已审批");
    }

    @Transactional
    public void deploy(String version, String role, String actor) {
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
            List<Map<String, Object>> active = jdbc.sql("""
                            select model_version from model_deployment
                            where task = :task and deployment_role = 'active' and status = 'deployed'
                            order by deployed_at desc limit 1
                            """).param("task", task).query().listOfRows();
            previous = active.isEmpty() ? null : String.valueOf(active.getFirst().get("model_version"));
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
                          :previous, 'unknown', :actor, :now, null)
                        """).param("id", UUID.randomUUID().toString()).param("task", task)
                .param("version", version).param("role", role).param("previous", previous)
                .param("actor", actor).param("now", OffsetDateTime.now()).update();
    }

    @Transactional
    public String rollback(String task, String actor) {
        List<Map<String, Object>> current = jdbc.sql("""
                        select previous_model_version from model_deployment
                        where task = :task and deployment_role = 'active' and status = 'deployed'
                        order by deployed_at desc limit 1
                        """).param("task", task).query().listOfRows();
        if (current.isEmpty() || current.getFirst().get("previous_model_version") == null) {
            throw new ApiException(HttpStatus.CONFLICT, "ROLLBACK_TARGET_NOT_FOUND", "没有可回滚的上一版本");
        }
        String previous = String.valueOf(current.getFirst().get("previous_model_version"));
        deploy(previous, "active", actor);
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
    public record DeployRequest(String role) {}
    public record ShadowComparison(String stationId, OffsetDateTime eventTime, String task,
            String activeModelVersion, String candidateModelVersion, Map<String, Object> activeResult,
            Map<String, Object> candidateResult, Map<String, Object> difference) {}
}
