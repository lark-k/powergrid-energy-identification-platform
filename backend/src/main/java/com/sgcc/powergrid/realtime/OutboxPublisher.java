package com.sgcc.powergrid.realtime;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sgcc.powergrid.common.JdbcValues;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class OutboxPublisher {
    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;
    private final RealtimeHub hub;

    public OutboxPublisher(JdbcClient jdbc, ObjectMapper objectMapper, RealtimeHub hub) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.hub = hub;
    }

    @Scheduled(fixedDelayString = "${platform.outbox.poll-delay-ms:1000}")
    public void publishPending() {
        List<Map<String, Object>> events = jdbc.sql("""
                        select event_id, request_id, station_id, event_type,
                               payload_json, occurred_at
                        from outbox_event where published_at is null and publish_attempts < 10
                        order by occurred_at limit 100
                        """).query().listOfRows();
        events.forEach(this::publish);
    }

    @Scheduled(fixedDelayString = "${platform.realtime.heartbeat-delay-ms:25000}")
    public void heartbeat() {
        hub.heartbeat();
    }

    private void publish(Map<String, Object> event) {
        String eventId = String.valueOf(event.get("event_id"));
        try {
            Object payload = objectMapper.readValue(String.valueOf(event.get("payload_json")), new TypeReference<>() {});
            hub.publish(eventId, String.valueOf(event.get("request_id")), String.valueOf(event.get("station_id")),
                    String.valueOf(event.get("event_type")), JdbcValues.offsetDateTime(event.get("occurred_at")), payload);
            jdbc.sql("update outbox_event set published_at = :now, publish_attempts = publish_attempts + 1 where event_id = :id")
                    .param("now", OffsetDateTime.now()).param("id", eventId).update();
        } catch (Exception exception) {
            jdbc.sql("""
                            update outbox_event set publish_attempts = publish_attempts + 1,
                              last_error = :error where event_id = :id
                            """).param("error", exception.getClass().getSimpleName())
                    .param("id", eventId).update();
        }
    }
}
