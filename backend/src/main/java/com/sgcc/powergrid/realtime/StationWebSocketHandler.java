package com.sgcc.powergrid.realtime;

import java.net.URI;
import java.util.List;
import java.util.Arrays;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.SubProtocolCapable;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Component
public class StationWebSocketHandler extends TextWebSocketHandler implements SubProtocolCapable {
    private final RealtimeHub hub;

    public StationWebSocketHandler(RealtimeHub hub) { this.hub = hub; }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String stationId = String.valueOf(session.getAttributes().get("stationId"));
        hub.registerSocket(stationId, session);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Object stationId = session.getAttributes().get("stationId");
        if (stationId != null) hub.removeSocket(String.valueOf(stationId), session);
    }

    static String stationId(URI uri) {
        if (uri == null || uri.getQuery() == null) throw new IllegalArgumentException("stationId is required");
        Map<String, String> query = Arrays.stream(uri.getQuery().split("&"))
                .map(value -> value.split("=", 2))
                .filter(value -> value.length == 2)
                .collect(Collectors.toMap(value -> value[0], value -> value[1], (left, right) -> right));
        String stationId = query.get("stationId");
        if (stationId == null || !stationId.matches("[A-Za-z0-9_-]{1,64}")) {
            throw new IllegalArgumentException("invalid stationId");
        }
        return stationId;
    }

    @Override
    public List<String> getSubProtocols() { return List.of("bearer"); }
}
