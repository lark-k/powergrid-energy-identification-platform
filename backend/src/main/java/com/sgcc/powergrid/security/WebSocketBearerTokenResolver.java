package com.sgcc.powergrid.security;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;

/** Keeps access tokens out of WebSocket URLs by reading a base64url value from a negotiated subprotocol. */
public class WebSocketBearerTokenResolver implements BearerTokenResolver {
    private final DefaultBearerTokenResolver delegate = new DefaultBearerTokenResolver();

    @Override
    public String resolve(HttpServletRequest request) {
        String normal = delegate.resolve(request);
        if (normal != null || !"/api/v1/stream".equals(request.getRequestURI())) return normal;
        String protocols = request.getHeader("Sec-WebSocket-Protocol");
        if (protocols == null) return null;
        String[] values = protocols.split(",");
        if (values.length != 2 || !"bearer".equals(values[0].trim())) return null;
        try {
            return new String(Base64.getUrlDecoder().decode(values[1].trim()), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }
}
