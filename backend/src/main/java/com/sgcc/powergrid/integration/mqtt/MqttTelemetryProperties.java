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
        deviceBindings().forEach((device, binding) -> {
            if (!binding.role().equals("disabled")) mappings.put(device, binding.stationId());
        });
        return Map.copyOf(mappings);
    }

    /** Legacy device=station entries remain main-switch inputs. PV direction is explicit. */
    public Map<String, DeviceBinding> deviceBindings() {
        Map<String, DeviceBinding> mappings = new LinkedHashMap<>();
        Map<String, String> activeRoles = new LinkedHashMap<>();
        for (String entry : deviceStationMappings) {
            String[] parts = entry.split("=", 2);
            if (parts.length != 2 || parts[0].isBlank() || parts[1].isBlank()) {
                throw new IllegalArgumentException(
                        "MQTT device mapping must use device_id=station_id[:main_switch|pv|disabled[:1|-1]]: " + entry);
            }
            String[] target = parts[1].trim().split(":", -1);
            String role = target.length > 1 ? target[1].trim() : "main_switch";
            if (target.length > 3 || target[0].isBlank()
                    || !List.of("main_switch", "pv", "disabled").contains(role)) {
                throw new IllegalArgumentException("Invalid MQTT device role: " + entry);
            }
            double direction = target.length > 2 ? Double.parseDouble(target[2].trim()) : 1;
            if ((direction != 1 && direction != -1) || (!role.equals("pv") && direction != 1)) {
                throw new IllegalArgumentException("Only PV mappings support a power direction of 1 or -1: " + entry);
            }
            DeviceBinding binding = new DeviceBinding(target[0].trim(), role, direction);
            DeviceBinding previous = mappings.put(parts[0].trim(), binding);
            if (previous != null) {
                throw new IllegalArgumentException("Duplicate MQTT device mapping: " + parts[0].trim());
            }
            // A test station currently has one main meter and one PV reference meter.
            // Reject ambiguous multi-meter configurations instead of mixing or double-counting them.
            if (!role.equals("disabled") && activeRoles.putIfAbsent(binding.stationId() + ":" + role, parts[0]) != null) {
                throw new IllegalArgumentException("Only one active MQTT " + role + " device per station is supported: " + entry);
            }
        }
        return Map.copyOf(mappings);
    }

    public record DeviceBinding(String stationId, String role, double powerDirection) {}
}
