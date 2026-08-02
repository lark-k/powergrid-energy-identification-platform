package com.sgcc.powergrid.realtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sgcc.powergrid.station.SnapshotService;
import java.io.IOException;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

@Component
public class RealtimeHub {
    private final Map<String, Set<SseEmitter>> emitters = new ConcurrentHashMap<>();
    private final Map<String, Set<WebSocketSession>> sockets = new ConcurrentHashMap<>();
    private final SnapshotService snapshots;
    private final ObjectMapper objectMapper;

    public RealtimeHub(SnapshotService snapshots, ObjectMapper objectMapper) {
        this.snapshots = snapshots;
        this.objectMapper = objectMapper;
    }

    public SseEmitter subscribe(String stationId) {
        SseEmitter emitter = new SseEmitter(0L);
        emitters.computeIfAbsent(stationId, ignored -> ConcurrentHashMap.newKeySet()).add(emitter);
        Runnable cleanup = () -> {
            Set<SseEmitter> stationEmitters = emitters.get(stationId);
            if (stationEmitters != null) stationEmitters.remove(emitter);
        };
        emitter.onCompletion(cleanup);
        emitter.onTimeout(cleanup);
        emitter.onError(ignored -> cleanup.run());
        try {
            emitter.send(SseEmitter.event().name("telemetry")
                    .id("initial-" + System.nanoTime()).data(snapshots.collectionProcess(stationId)));
        } catch (IOException exception) {
            cleanup.run();
        }
        return emitter;
    }

    public void registerSocket(String stationId, WebSocketSession session) {
        sockets.computeIfAbsent(stationId, ignored -> ConcurrentHashMap.newKeySet()).add(session);
    }

    public void removeSocket(String stationId, WebSocketSession session) {
        Set<WebSocketSession> stationSockets = sockets.get(stationId);
        if (stationSockets != null) stationSockets.remove(session);
    }

    public void publish(String eventId, String requestId, String stationId, String type,
            OffsetDateTime occurredAt, Object payload) {
        Map<String, Object> envelope = Map.of(
                "event_id", eventId,
                "request_id", requestId,
                "station_id", stationId,
                "type", type,
                "occurred_at", occurredAt,
                "data", payload);
        publishSockets(stationId, envelope);
        publishTelemetry(stationId, eventId);
    }

    public void heartbeat() {
        emitters.forEach((stationId, stationEmitters) -> stationEmitters.removeIf(emitter -> {
            try {
                emitter.send(SseEmitter.event().comment("heartbeat"));
                return false;
            } catch (IOException exception) {
                return true;
            }
        }));
    }

    private void publishTelemetry(String stationId, String eventId) {
        Set<SseEmitter> stationEmitters = emitters.get(stationId);
        if (stationEmitters == null || stationEmitters.isEmpty()) return;
        Object telemetry = snapshots.collectionProcess(stationId);
        stationEmitters.removeIf(emitter -> {
            try {
                emitter.send(SseEmitter.event().name("telemetry").id(eventId).data(telemetry));
                return false;
            } catch (IOException exception) {
                return true;
            }
        });
    }

    private void publishSockets(String stationId, Object event) {
        Set<WebSocketSession> stationSockets = sockets.get(stationId);
        if (stationSockets == null || stationSockets.isEmpty()) return;
        try {
            String json = objectMapper.writeValueAsString(event);
            stationSockets.removeIf(session -> {
                try {
                    if (!session.isOpen()) return true;
                    session.sendMessage(new TextMessage(json));
                    return false;
                } catch (IOException exception) {
                    return true;
                }
            });
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to serialize realtime event", exception);
        }
    }
}
