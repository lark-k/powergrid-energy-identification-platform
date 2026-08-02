package com.sgcc.powergrid.integration.modelservice;

import com.sgcc.powergrid.common.PlatformProperties;
import com.sgcc.powergrid.integration.modelservice.ModelServiceDtos.InferenceRequest;
import com.sgcc.powergrid.integration.modelservice.ModelServiceDtos.InferenceResult;
import java.time.Instant;
import java.util.Optional;
import java.util.List;
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
