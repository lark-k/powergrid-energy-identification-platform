package com.sgcc.powergrid.realtime;

import com.sgcc.powergrid.security.StationAccessService;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

@Component
public class StationHandshakeInterceptor implements HandshakeInterceptor {
    private final StationAccessService stationAccess;

    public StationHandshakeInterceptor(StationAccessService stationAccess) { this.stationAccess = stationAccess; }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
            WebSocketHandler wsHandler, Map<String, Object> attributes) {
        String stationId;
        try { stationId = StationWebSocketHandler.stationId(request.getURI()); }
        catch (IllegalArgumentException exception) {
            response.setStatusCode(HttpStatus.UNPROCESSABLE_ENTITY);
            return false;
        }
        if (!(request.getPrincipal() instanceof Authentication authentication)
                || !stationAccess.canAccess(stationId, authentication)) {
            response.setStatusCode(HttpStatus.FORBIDDEN);
            return false;
        }
        attributes.put("stationId", stationId);
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
            WebSocketHandler wsHandler, Exception exception) { }
}
