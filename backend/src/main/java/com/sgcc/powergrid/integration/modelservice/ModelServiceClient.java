package com.sgcc.powergrid.integration.modelservice;

import com.sgcc.powergrid.common.PlatformProperties;
import com.sgcc.powergrid.integration.modelservice.ModelServiceDtos.InferenceRequest;
import com.sgcc.powergrid.integration.modelservice.ModelServiceDtos.InferenceResult;
import java.time.Instant;
import java.util.Optional;
import java.util.List;
import java.util.Map;
import com.sgcc.powergrid.common.ApiException;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.RestClientResponseException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class ModelServiceClient {
    private final RestClient client;
    private final RestClient candidateClient;
    private final PlatformProperties.ModelService properties;
    private final AtomicInteger consecutiveFailures = new AtomicInteger();
    private final AtomicReference<Instant> circuitOpenedAt = new AtomicReference<>();

    public ModelServiceClient(PlatformProperties platformProperties, RestClient.Builder builder) {
        this.properties = platformProperties.modelService();
        RestClient.Builder candidateBuilder = builder.clone();
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(properties.connectTimeout());
        requestFactory.setReadTimeout(properties.readTimeout());
        RestClient.Builder configured = builder.baseUrl(properties.baseUrl()).requestFactory(requestFactory);
        if (properties.token() != null && !properties.token().isBlank()) {
            configured.defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + properties.token());
        }
        this.client = configured.build();
        if (properties.shadowEnabled() && properties.candidateBaseUrl() != null
                && !properties.candidateBaseUrl().isBlank()) {
            RestClient.Builder candidate = candidateBuilder.baseUrl(properties.candidateBaseUrl()).requestFactory(requestFactory);
            if (properties.token() != null && !properties.token().isBlank()) {
                candidate.defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + properties.token());
            }
            this.candidateClient = candidate.build();
        } else {
            this.candidateClient = null;
        }
    }

    public InferenceResult infer(InferenceRequest request) {
        if (isCircuitOpen()) {
            throw new ModelServiceUnavailableException("model service circuit is open");
        }
        RestClientException last = null;
        for (int attempt = 0; attempt <= properties.maxRetries(); attempt++) {
            try {
                InferenceResult result = client.post()
                        .uri("/internal/v1/inference/minute")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Request-ID", request.requestId())
                        .body(request)
                        .retrieve()
                        .body(InferenceResult.class);
                consecutiveFailures.set(0);
                circuitOpenedAt.set(null);
                if (result == null) {
                    throw new ModelServiceUnavailableException("model service returned an empty body");
                }
                return result;
            } catch (RestClientException exception) {
                last = exception;
            }
        }
        int failures = consecutiveFailures.incrementAndGet();
        if (failures >= properties.circuitFailureThreshold()) {
            circuitOpenedAt.set(Instant.now());
        }
        throw new ModelServiceUnavailableException("model service request failed", last);
    }

    public List<InferenceResult> replay(ModelServiceDtos.BatchInferenceRequest request) {
        if (isCircuitOpen()) {
            throw new ModelServiceUnavailableException("model service circuit is open");
        }
        RestClientException last = null;
        for (int attempt = 0; attempt <= properties.maxRetries(); attempt++) {
            try {
                InferenceResult[] results = client.post()
                        .uri("/internal/v1/inference/replay")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Request-ID", request.requestId())
                        .body(request)
                        .retrieve()
                        .body(InferenceResult[].class);
                consecutiveFailures.set(0);
                circuitOpenedAt.set(null);
                if (results == null) {
                    throw new ModelServiceUnavailableException("model service returned an empty replay body");
                }
                return List.of(results);
            } catch (RestClientException exception) {
                last = exception;
            }
        }
        int failures = consecutiveFailures.incrementAndGet();
        if (failures >= properties.circuitFailureThreshold()) {
            circuitOpenedAt.set(Instant.now());
        }
        throw new ModelServiceUnavailableException("model service replay request failed", last);
    }

    public boolean ready() {
        if (isCircuitOpen()) {
            return false;
        }
        try {
            client.get().uri("/health/ready").retrieve().toBodilessEntity();
            return true;
        } catch (RestClientException exception) {
            return false;
        }
    }

    public Map<String, Object> modelVersions() {
        try {
            var result = client.get().uri("/internal/v1/model-versions").retrieve()
                    .body(new ParameterizedTypeReference<Map<String, Object>>() {});
            if (result == null) throw new IllegalStateException("empty model catalog");
            return result;
        } catch (RestClientException exception) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "MODEL_CATALOG_UNAVAILABLE", "无法读取推理服务的模型版本");
        }
    }

    public Map<String, Object> activateModel(String task, String version, String expectedVersion) {
        try {
            var result = client.post().uri("/internal/v1/model-versions/{task}/activate", task)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("model_version", version, "expected_version", expectedVersion))
                    .retrieve().body(new ParameterizedTypeReference<Map<String, Object>>() {});
            if (result == null) throw new IllegalStateException("empty activation response");
            return result;
        } catch (RestClientResponseException exception) {
            if (exception.getStatusCode().value() == 409) {
                throw new ApiException(HttpStatus.CONFLICT, "MODEL_VERSION_CONFLICT", "当前模型已变化，请刷新版本列表后重试");
            }
            if (exception.getStatusCode().value() == 422) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "MODEL_INCOMPATIBLE", "模型未通过兼容性检查，未执行切换");
            }
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "MODEL_SWITCH_FAILED", "推理服务未确认切换成功，请刷新查看实际生效版本");
        } catch (RestClientException exception) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "MODEL_SWITCH_UNCONFIRMED", "切换响应未收到，请刷新查看实际生效版本后再操作");
        }
    }

    /** Candidate failures never alter the active result or active circuit. */
    public Optional<InferenceResult> inferCandidate(InferenceRequest request) {
        if (candidateClient == null) return Optional.empty();
        try {
            return Optional.ofNullable(candidateClient.post()
                    .uri("/internal/v1/inference/minute")
                    .contentType(MediaType.APPLICATION_JSON)
                    .header("X-Request-ID", request.requestId())
                    .body(request).retrieve().body(InferenceResult.class));
        } catch (RestClientException exception) {
            return Optional.empty();
        }
    }

    private boolean isCircuitOpen() {
        Instant opened = circuitOpenedAt.get();
        if (opened == null) {
            return false;
        }
        if (opened.plus(properties.circuitOpenDuration()).isBefore(Instant.now())) {
            circuitOpenedAt.compareAndSet(opened, null);
            consecutiveFailures.set(0);
            return false;
        }
        return true;
    }

    public static class ModelServiceUnavailableException extends RuntimeException {
        public ModelServiceUnavailableException(String message) { super(message); }
        public ModelServiceUnavailableException(String message, Throwable cause) { super(message, cause); }
    }
}
