package com.sgcc.powergrid.integration.mqtt;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "platform.mqtt")
public record MqttTelemetryProperties(
        boolean enabled,
        String brokerUri,
        String topicFilter,
        String clientId,
        int qos,
        int connectionTimeoutSeconds,
        int keepAliveSeconds,
        boolean automaticReconnect,
        boolean cleanSession,
        int reconnectDelayMs,
        int maxPayloadBytes,
        List<String> deviceStationMappings) {

    public MqttTelemetryProperties {
        deviceStationMappings = deviceStationMappings == null ? List.of() : List.copyOf(deviceStationMappings);
        if (qos < 0 || qos > 2) {
            throw new IllegalArgumentException("platform.mqtt.qos must be between 0 and 2");
        }
        if (connectionTimeoutSeconds <= 0 || keepAliveSeconds <= 0 || reconnectDelayMs <= 0) {
            throw new IllegalArgumentException("MQTT timeout and reconnect values must be positive");
        }
        if (maxPayloadBytes <= 0) {
            throw new IllegalArgumentException("platform.mqtt.max-payload-bytes must be positive");
        }
    }

    public Map<String, String> stationByDevice() {
        Map<String, String> mappings = new LinkedHashMap<>();
        for (String entry : deviceStationMappings) {
            String[] parts = entry.split("=", 2);
            if (parts.length != 2 || parts[0].isBlank() || parts[1].isBlank()) {
                throw new IllegalArgumentException(
                        "MQTT device mapping must use device_id=station_id: " + entry);
            }
            String previous = mappings.put(parts[0].trim(), parts[1].trim());
            if (previous != null) {
                throw new IllegalArgumentException("Duplicate MQTT device mapping: " + parts[0].trim());
            }
        }
        return Map.copyOf(mappings);
    }
}
