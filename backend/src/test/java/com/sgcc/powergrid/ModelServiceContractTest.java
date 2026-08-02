package com.sgcc.powergrid;

import static org.assertj.core.api.Assertions.assertThat;

import com.sgcc.powergrid.common.PlatformProperties;
import com.sgcc.powergrid.integration.modelservice.ModelServiceClient;
import com.sgcc.powergrid.integration.modelservice.ModelServiceDtos;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

class ModelServiceContractTest {
    @Test
    void mapsTheStablePythonInferenceContractWithoutModelInternals() throws Exception {
        AtomicReference<String> requestBody = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        String response = """
                {
                  "station_id":"A01","target_time":"2026-08-01T10:00:00+08:00","request_id":"req-1",
                  "input_window_start":"2026-08-01T06:01:00+08:00","input_window_end":"2026-08-01T10:00:00+08:00",
                  "recognition_window_start":"2026-08-01T08:01:00+08:00","separation_window_start":"2026-08-01T06:01:00+08:00",
                  "interpolated_minutes":0,"quality_status":"good",
                  "recognition_model_version":"recognition-v1","separation_model_version":"separation-v1",
                  "pv":{"score":0.91,"detected":true},
                  "energy_station":{"score":0.72,"detected":true},
                  "charger":{"score":0.12,"detected":false},
                  "pv_generation_kw":18.4,"pv_activity_probability":0.88,
                  "inference_time_ms":12.5,"warnings":[]
                }
                """;
        server.createContext("/internal/v1/inference/minute", exchange -> {
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        try {
            PlatformProperties properties = new PlatformProperties(
                    new PlatformProperties.Security("dev", List.of()),
                    new PlatformProperties.ModelService("http://127.0.0.1:" + server.getAddress().getPort(),
                            "service-secret", Duration.ofSeconds(1), Duration.ofSeconds(3),
                            0, 3, Duration.ofSeconds(10), false, ""),
                    new PlatformProperties.Imports(List.of("application/json")));
            ModelServiceClient client = new ModelServiceClient(properties, RestClient.builder());
            OffsetDateTime target = OffsetDateTime.parse("2026-08-01T10:00:00+08:00");
            ModelServiceDtos.InferenceResult result = client.infer(new ModelServiceDtos.InferenceRequest(
                    "req-1", "A01", target, List.of(new ModelServiceDtos.MinutePoint(
                            "A01", target, 30, 10, 10, 10, 1, "good", "contract-test"))));

            assertThat(authorization.get()).isEqualTo("Bearer service-secret");
            assertThat(requestBody.get()).contains("\"phase_a_power_kw\"");
            assertThat(result.energyStation().score()).isEqualTo(0.72);
            assertThat(result.pvGenerationKw()).isEqualTo(18.4);
            assertThat(result.recognitionModelVersion()).isEqualTo("recognition-v1");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void mapsReplayTargetsWithoutRequiringTheMinuteOnlyTargetField() throws Exception {
        AtomicReference<String> requestBody = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        String response = """
                [{
                  "station_id":"A01","target_time":"2026-08-01T10:00:00+08:00","request_id":"replay-1",
                  "input_window_start":null,"input_window_end":null,
                  "recognition_window_start":null,"separation_window_start":null,
                  "interpolated_minutes":0,"quality_status":"insufficient_history",
                  "recognition_model_version":null,"separation_model_version":null,
                  "pv":{"score":null,"detected":null},
                  "energy_station":{"score":null,"detected":null},
                  "charger":{"score":null,"detected":null},
                  "pv_generation_kw":null,"pv_activity_probability":null,
                  "inference_time_ms":1.5,"warnings":["pv_separation:insufficient_history"]
                }]
                """;
        server.createContext("/internal/v1/inference/replay", exchange -> {
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        try {
            PlatformProperties properties = new PlatformProperties(
                    new PlatformProperties.Security("dev", List.of()),
                    new PlatformProperties.ModelService("http://127.0.0.1:" + server.getAddress().getPort(),
                            "", Duration.ofSeconds(1), Duration.ofSeconds(3),
                            0, 3, Duration.ofSeconds(10), false, ""),
                    new PlatformProperties.Imports(List.of("application/json")));
            ModelServiceClient client = new ModelServiceClient(properties, RestClient.builder());
            OffsetDateTime target = OffsetDateTime.parse("2026-08-01T10:00:00+08:00");
            List<ModelServiceDtos.InferenceResult> results = client.replay(
                    new ModelServiceDtos.BatchInferenceRequest(
                            "replay-1", "A01", List.of(target), List.of(new ModelServiceDtos.MinutePoint(
                                    "A01", target, 30, 10, 10, 10, 1, "good", "contract-test"))));

            assertThat(requestBody.get()).contains("\"target_times\"").doesNotContain("\"target_time\":");
            assertThat(results).hasSize(1);
            assertThat(results.getFirst().pvGenerationKw()).isNull();
        } finally {
            server.stop(0);
        }
    }
}
