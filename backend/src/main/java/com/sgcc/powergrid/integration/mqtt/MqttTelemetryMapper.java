package com.sgcc.powergrid.integration.mqtt;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sgcc.powergrid.feedback.FeedbackModels.BatchRequest;
import com.sgcc.powergrid.feedback.FeedbackModels.Point;
import com.sgcc.powergrid.measurement.MainSwitchMinutePoint;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.temporal.ChronoField;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "platform.mqtt", name = "enabled", havingValue = "true")
public class MqttTelemetryMapper {
    private static final List<String> REQUIRED_POWER_NAMES =
            List.of("TotW_MA", "PhW_phsA_MA", "PhW_phsB_MA", "PhW_phsC_MA");
    private static final DateTimeFormatter COMPACT_OFFSET_TIME = new DateTimeFormatterBuilder()
            .appendPattern("uuuu-MM-dd'T'HH:mm:ss")
            .optionalStart()
            .appendFraction(ChronoField.NANO_OF_SECOND, 0, 9, true)
            .optionalEnd()
            .appendOffset("+HHmm", "Z")
            .toFormatter(Locale.ROOT);

    private final ObjectMapper objectMapper;
    private final MqttTelemetryProperties properties;
    private final Map<String, MqttTelemetryProperties.DeviceBinding> bindings;

    public MqttTelemetryMapper(ObjectMapper objectMapper, MqttTelemetryProperties properties) {
        this.objectMapper = objectMapper;
        this.properties = properties;
        this.bindings = properties.deviceBindings();
    }

    public Optional<MappedMinute> map(String topic, byte[] payload) throws IOException {
        String deviceId = deviceId(topic);
        var binding = bindings.get(deviceId);
        // The wildcard also carries other devices; only explicitly enabled meters participate.
        if (binding == null || binding.role().equals("disabled")) return Optional.empty();
        if (payload.length > properties.maxPayloadBytes()) {
            throw new IllegalArgumentException("MQTT payload exceeds configured size limit");
        }
        Notification notification = objectMapper.readValue(payload, Notification.class);
        if (!"0".equals(notification.datatype())) {
            return Optional.empty();
        }
        String stationId = binding.stationId();
        if (notification.body() == null || notification.body().isEmpty()) {
            throw new IllegalArgumentException("MQTT telemetry body is empty");
        }
        if (notification.timestamp() == null || notification.timestamp().isBlank()) {
            throw new IllegalArgumentException("MQTT frame timestamp is missing");
        }

        Map<String, Item> items = new LinkedHashMap<>();
        for (Item item : notification.body()) {
            if (item != null && item.name() != null) {
                items.put(item.name(), item);
            }
        }
        List<String> requiredNames = binding.role().equals("pv") ? List.of("TotW_MA") : REQUIRED_POWER_NAMES;
        List<Item> required = requiredNames.stream().map(name -> required(items, name)).toList();
        OffsetDateTime frameTime = parseTimestamp(notification.timestamp());
        OffsetDateTime dataTime = parseTimestamp(required.getFirst().timestamp());
        OffsetDateTime dataMinute = nearestMinute(dataTime);
        for (Item item : required) {
            if (!dataMinute.isEqual(nearestMinute(parseTimestamp(item.timestamp())))) {
                throw new IllegalArgumentException("Required MQTT power fields span multiple minutes");
            }
        }
        // The protocol defines the frame timestamp as the send time and the item timestamp as the
        // measurement time. Samples can arrive shortly before or after a minute boundary, so map
        // the measurement time to the nearest minute instead of flooring it or using the send time.
        OffsetDateTime eventTime = dataMinute;
        String qualityFlag = required.stream().allMatch(item -> "0".equals(item.quality()))
                ? "good" : "warning";
        if (binding.role().equals("pv")) {
            // This test installation has one reference meter. Capacity is unknown (0), not estimated.
            // Import at a generation-negative meter is consumption, not generation: do not use abs().
            double pvKw = Math.max(0.0, value(required.getFirst()) * binding.powerDirection());
            String batchId = "mqtt-pv-" + UUID.nameUUIDFromBytes(
                    (deviceId + ":" + eventTime.toInstant()).getBytes(StandardCharsets.UTF_8));
            BatchRequest feedback = new BatchRequest(batchId, stationId, OffsetDateTime.now(),
                    eventTime, eventTime.plusMinutes(1), 1, List.of(deviceId), List.of(),
                    1, 0, 1, qualityFlag,
                    List.of(new Point(deviceId, eventTime, eventTime.plusMinutes(1),
                            pvKw, "average_power", 0, qualityFlag)));
            return Optional.of(new MappedMinute(deviceId, requestId(notification, payload),
                    frameTime, dataTime, null, feedback));
        }
        MainSwitchMinutePoint point = new MainSwitchMinutePoint(
                stationId,
                eventTime,
                value(required.get(0)),
                value(required.get(1)),
                value(required.get(2)),
                value(required.get(3)),
                optionalValue(items.get("TotVar_MA")),
                null,
                null,
                optionalValue(items.get("TotPF_AA")),
                1.0,
                qualityFlag,
                "mqtt:" + deviceId);
        return Optional.of(new MappedMinute(
                deviceId, requestId(notification, payload), frameTime, dataTime, point));
    }

    private String deviceId(String topic) {
        if (topic == null || topic.isBlank()) {
            throw new IllegalArgumentException("MQTT topic is empty");
        }
        int separator = topic.lastIndexOf('/');
        if (separator < 0 || separator == topic.length() - 1) {
            throw new IllegalArgumentException("MQTT topic does not contain a device identifier");
        }
        return topic.substring(separator + 1);
    }

    private static Item required(Map<String, Item> items, String name) {
        Item item = items.get(name);
        if (item == null || item.val() == null || item.timestamp() == null) {
            throw new IllegalArgumentException("MQTT telemetry is missing required field " + name);
        }
        return item;
    }

    private static double value(Item item) {
        try {
            double value = Double.parseDouble(item.val());
            if (!Double.isFinite(value)) {
                throw new NumberFormatException("non-finite value");
            }
            return value;
        } catch (NumberFormatException exception) {
            throw new IllegalArgumentException("Invalid numeric MQTT value for " + item.name(), exception);
        }
    }

    private static Double optionalValue(Item item) {
        return item == null || item.val() == null || item.val().isBlank() ? null : value(item);
    }

    private static OffsetDateTime parseTimestamp(String value) {
        try {
            return OffsetDateTime.parse(value, DateTimeFormatter.ISO_OFFSET_DATE_TIME);
        } catch (RuntimeException ignored) {
            try {
                return OffsetDateTime.parse(value, COMPACT_OFFSET_TIME);
            } catch (RuntimeException exception) {
                throw new IllegalArgumentException("Invalid MQTT timestamp", exception);
            }
        }
    }

    private static OffsetDateTime minute(OffsetDateTime value) {
        return value.withSecond(0).withNano(0);
    }

    private static OffsetDateTime nearestMinute(OffsetDateTime value) {
        return minute(value.plusSeconds(30));
    }

    private static String requestId(Notification notification, byte[] payload) {
        if (notification.token() != null && !notification.token().isBlank()) {
            String candidate = "mqtt-" + notification.token().trim();
            if (candidate.length() <= 80) {
                return candidate;
            }
        }
        return "mqtt-" + UUID.nameUUIDFromBytes(new String(payload, StandardCharsets.UTF_8)
                .getBytes(StandardCharsets.UTF_8));
    }

    public record MappedMinute(
            String deviceId,
            String requestId,
            OffsetDateTime frameTime,
            OffsetDateTime dataTime,
            MainSwitchMinutePoint point,
            BatchRequest feedback) {
        public MappedMinute {
            if ((point == null) == (feedback == null)) {
                throw new IllegalArgumentException("MQTT minute must contain exactly one device role");
            }
        }

        public MappedMinute(String deviceId, String requestId, OffsetDateTime frameTime,
                OffsetDateTime dataTime, MainSwitchMinutePoint point) {
            this(deviceId, requestId, frameTime, dataTime, point, null);
        }
    }

    public record Notification(String token, String timestamp, String datatype, List<Item> body) {}

    public record Item(String name, String id, String val, String unit, String quality, String timestamp) {}
}
