package com.sgcc.powergrid.integration.mqtt;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;

class MqttTelemetryMapperTest {
    @Test void preservesAll56FieldsAndMasksBadQualityOrWrongMinute() throws Exception {
        var items = new java.util.ArrayList<java.util.Map<String, String>>();
        for (String name : com.sgcc.powergrid.measurement.ElectricalFields.NAMES) {
            items.add(java.util.Map.of("name", name, "val", "1.234567", "quality", name.equals("A_SCC") ? "1" : "0",
                    "timestamp", name.equals("PhV_phsB") ? "2026-09-22T10:05:00+08:00" : "2026-09-22T10:00:00+08:00"));
        }
        byte[] payload = new ObjectMapper().writeValueAsBytes(java.util.Map.of("token", "full56", "datatype", "0",
                "timestamp", "2026-09-22T10:01:00+08:00", "body", items));
        var point = roleMapper(List.of("0004=A01:main_switch", "0001=A01:pv:-1")).map("topic/0004", payload).orElseThrow().point();
        assertThat(point.electricalFields()).hasSize(55).containsEntry("TotW_MA", 1.234567);
        assertThat(point.fieldValidity()).hasSize(56).containsEntry("A_SCC", false).containsEntry("PhV_phsB", false).containsEntry("TotW_MA", true);
    }
    private static final String TOPIC =
            "PAnt/Broadcast/JSON/report/notification/PM201/202606050023";

    private final MqttTelemetryMapper mapper = new MqttTelemetryMapper(
            new ObjectMapper(),
            new MqttTelemetryProperties(
                    true,
                    "tcp://106.14.246.184:50077",
                    "PAnt/Broadcast/JSON/report/notification/PM201/#",
                    "test-client",
                    0,
                    10,
                    45,
                    true,
                    true,
                    10_000,
                    262_144,
                    List.of("202606050023=A01")));

    @Test
    void mapsObservedProtocolFrameToMinutePoint() throws Exception {
        var mapped = mapper.map(TOPIC, payload("0", "0", true));

        assertThat(mapped).isPresent();
        var value = mapped.orElseThrow();
        assertThat(value.deviceId()).isEqualTo("202606050023");
        assertThat(value.requestId()).isEqualTo("mqtt-20260904121517491");
        assertThat(value.point().stationId()).isEqualTo("A01");
        assertThat(value.point().eventTime())
                .isEqualTo(OffsetDateTime.parse("2026-09-04T12:14:00+08:00"));
        assertThat(value.point().measurementTime())
                .isEqualTo(OffsetDateTime.parse("2026-09-04T12:14:57.979+08:00"));
        assertThat(value.point().frameTime())
                .isEqualTo(OffsetDateTime.parse("2026-09-04T12:15:17.491+08:00"));
        assertThat(value.point().activePowerKw()).isEqualTo(-0.789214);
        assertThat(value.point().phaseAPowerKw()).isEqualTo(-0.235295);
        assertThat(value.point().phaseBPowerKw()).isEqualTo(-0.281486);
        assertThat(value.point().phaseCPowerKw()).isEqualTo(-0.272433);
        assertThat(value.point().reactivePowerKvar()).isEqualTo(-0.886098);
        assertThat(value.point().pf()).isEqualTo(-0.0377672);
        assertThat(value.point().coverageRatio()).isEqualTo(1.0);
        assertThat(value.point().qualityFlag()).isEqualTo("good");
        assertThat(value.point().sourceId()).isEqualTo("mqtt:202606050023");
    }

    @Test
    void mapsNonzeroRequiredQualityToWarning() throws Exception {
        var mapped = mapper.map(TOPIC, payload("0", "1", true));

        assertThat(mapped.orElseThrow().point().qualityFlag()).isEqualTo("warning");
    }

    @Test
    void ignoresNonTelemetryDatatypes() throws Exception {
        assertThat(mapper.map(TOPIC, payload("1", "0", true))).isEmpty();
    }

    @Test
    void rejectsFrameMissingRequiredPowerField() {
        assertThatThrownBy(() -> mapper.map(TOPIC, payload("0", "0", false)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("PhW_phsC_MA");
    }

    @Test
    void ignoresUnknownDeviceOnSharedWildcard() throws Exception {
        assertThat(mapper.map(
                        "PAnt/Broadcast/JSON/report/notification/PM201/unknown",
                        payload("0", "0", true))).isEmpty();
    }

    @Test
    void routesPvSeparatelyWithExplicitGenerationDirection() throws Exception {
        var routed = roleMapper(List.of("pv=A01:pv:-1", "main=A01:main_switch", "old=A01:disabled"));
        var pv = routed.map("topic/pv", payload("0", "0", false)).orElseThrow();
        assertThat(pv.point()).isNull();
        assertThat(pv.feedback().stationId()).isEqualTo("A01");
        assertThat(pv.feedback().points()).singleElement().satisfies(point -> {
            assertThat(point.nodeId()).isEqualTo("pv");
            assertThat(point.pvValue()).isEqualTo(0.789214);
            assertThat(point.periodEnd()).isEqualTo(point.eventTime().plusMinutes(1));
        });
        assertThat(pv.feedback().capacityCoverageRatio()).isZero();
        assertThat(routed.map("topic/old", new byte[]{1})).isEmpty();
        var main = routed.map("topic/main", payload("0", "0", true)).orElseThrow();
        assertThat(main.feedback()).isNull();
        assertThat(main.point().activePowerKw()).isEqualTo(-0.789214);
        byte[] consuming = new String(payload("0", "0", true), StandardCharsets.UTF_8)
                .replace("-0.789214", "0.789214").getBytes(StandardCharsets.UTF_8);
        assertThat(routed.map("topic/pv", consuming).orElseThrow().feedback().points().getFirst().pvValue()).isZero();
        byte[] retransmitted = new String(payload("0", "0", true), StandardCharsets.UTF_8)
                .replace("20260904121517491", "another-token").getBytes(StandardCharsets.UTF_8);
        assertThat(routed.map("topic/pv", retransmitted).orElseThrow().feedback().batchId())
                .isEqualTo(pv.feedback().batchId());
    }

    @Test
    void rejectsConflictingRolesOrInvalidDirection() {
        assertThatThrownBy(() -> roleMapper(List.of("one=A01:main_switch", "two=A01")))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("Only one active");
        assertThatThrownBy(() -> roleMapper(List.of("one=A01:pv", "two=A01:pv")))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("Only one active");
        assertThatThrownBy(() -> roleMapper(List.of("one=A01:main_switch:-1")))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("power direction");
        assertThatThrownBy(() -> roleMapper(List.of("one=A01:unknown")))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("role");
    }

    static MqttTelemetryMapper roleMapper(List<String> mappings) {
        return new MqttTelemetryMapper(new ObjectMapper(), new MqttTelemetryProperties(
                false, "tcp://localhost:1883", "topic/#", "test", 0, 10, 45,
                true, true, 10000, 262144, mappings));
    }

    @Test
    void usesTheMeasurementMinuteEvenWhenTheFrameIsLater() throws Exception {
        var first = mapper.map(TOPIC, payloadAt(
                "20260904180518778",
                "2026-09-04T18:05:18.227+0800",
                "2026-09-04T18:04:55.530+0800"));
        var second = mapper.map(TOPIC, payloadAt(
                "20260904180618903",
                "2026-09-04T18:06:18.903+0800",
                "2026-09-04T18:06:01.120+0800"));

        assertThat(first.orElseThrow().point().eventTime())
                .isEqualTo(OffsetDateTime.parse("2026-09-04T18:04:00+08:00"));
        assertThat(second.orElseThrow().point().eventTime())
                .isEqualTo(OffsetDateTime.parse("2026-09-04T18:06:00+08:00"));
    }

    @Test
    void assignsDelayedFrameToTheMeasurementMinute() throws Exception {
        var mapped = mapper.map(TOPIC, payloadAt(
                "20260904195019071",
                "2026-09-04T19:50:19.071+0800",
                "2026-09-04T19:49:21.055+0800"));

        var value = mapped.orElseThrow();
        assertThat(value.point().eventTime())
                .isEqualTo(OffsetDateTime.parse("2026-09-04T19:49:00+08:00"));
        assertThat(value.dataTime())
                .isEqualTo(OffsetDateTime.parse("2026-09-04T19:49:21.055+08:00"));
        assertThat(value.frameTime())
                .isEqualTo(OffsetDateTime.parse("2026-09-04T19:50:19.071+08:00"));
    }

    @Test
    void keepsSamplesAfterSecondThirtyInTheirNaturalMinute() throws Exception {
        var main = mapper.map(TOPIC, payloadAt("main-0051",
                "2026-09-24T00:51:56+08:00", "2026-09-24T00:51:30.030+08:00")).orElseThrow();
        assertThat(main.point().eventTime()).isEqualTo(OffsetDateTime.parse("2026-09-24T00:51:00+08:00"));

        var pv = roleMapper(List.of("pv=A01:pv:-1")).map("topic/pv", payloadAt("pv-0057",
                "2026-09-24T00:57:56+08:00", "2026-09-24T00:57:35.199+08:00")).orElseThrow();
        assertThat(pv.feedback().points().getFirst().eventTime())
                .isEqualTo(OffsetDateTime.parse("2026-09-24T00:57:00+08:00"));
        assertThat(pv.feedback().points().getFirst().measurementTime())
                .isEqualTo(OffsetDateTime.parse("2026-09-24T00:57:35.199+08:00"));
    }

    private static byte[] payload(String datatype, String requiredQuality, boolean includePhaseC) {
        return payload(
                datatype,
                requiredQuality,
                includePhaseC,
                "20260904121517491",
                "2026-09-04T12:15:17.491+0800",
                "2026-09-04T12:14:57.979+0800");
    }

    private static byte[] payloadAt(String token, String frameTimestamp, String measurementTimestamp) {
        return payload("0", "0", true, token, frameTimestamp, measurementTimestamp);
    }

    private static byte[] payload(
            String datatype,
            String requiredQuality,
            boolean includePhaseC,
            String token,
            String frameTimestamp,
            String measurementTimestamp) {
        String phaseC = includePhaseC
                ? ",{\"name\":\"PhW_phsC_MA\",\"id\":\"4\",\"val\":\"-0.272433\",\"unit\":\"\",\"quality\":\"0\",\"timestamp\":\"%s\"}".formatted(measurementTimestamp)
                : "";
        String json = """
                {
                  "token":"%s",
                  "timestamp":"%s",
                  "datatype":"%s",
                  "body":[
                    {"name":"TotW_MA","id":"1","val":"-0.789214","unit":"","quality":"%s","timestamp":"%s"},
                    {"name":"PhW_phsA_MA","id":"2","val":"-0.235295","unit":"","quality":"0","timestamp":"%s"},
                    {"name":"PhW_phsB_MA","id":"3","val":"-0.281486","unit":"","quality":"0","timestamp":"%s"}
                    %s,
                    {"name":"TotVar_MA","id":"5","val":"-0.886098","unit":"","quality":"0","timestamp":"%s"},
                    {"name":"TotPF_AA","id":"15","val":"-0.0377672","unit":"","quality":"0","timestamp":"%s"}
                  ]
                }
                """.formatted(
                        token,
                        frameTimestamp,
                        datatype,
                        requiredQuality,
                        measurementTimestamp,
                        measurementTimestamp,
                        measurementTimestamp,
                        phaseC,
                        measurementTimestamp,
                        measurementTimestamp);
        return json.getBytes(StandardCharsets.UTF_8);
    }
}
