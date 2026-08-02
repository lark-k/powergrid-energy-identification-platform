package com.sgcc.powergrid.audit;

import com.sgcc.powergrid.common.RequestIdFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(Ordered.LOWEST_PRECEDENCE - 10)
public class AuditFilter extends OncePerRequestFilter {
    private final JdbcClient jdbc;

    public AuditFilter(JdbcClient jdbc) { this.jdbc = jdbc; }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/v1/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        try {
            chain.doFilter(request, response);
        } finally {
            Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
            String actor = authentication == null ? "anonymous" : authentication.getName();
            String stationId = extractStation(request.getRequestURI());
            try {
                jdbc.sql("""
                                insert into audit_log (
                                  audit_id, request_id, actor_id, action, resource_type,
                                  resource_id, station_id, outcome, client_address,
                                  detail_json, occurred_at
                                ) values (:id, :requestId, :actor, :action, 'api', :resourceId,
                                  :stationId, :outcome, :clientAddress, '{}', :now)
                                """).param("id", UUID.randomUUID().toString())
                        .param("requestId", String.valueOf(request.getAttribute(RequestIdFilter.ATTRIBUTE)))
                        .param("actor", actor).param("action", request.getMethod())
                        .param("resourceId", request.getRequestURI())
                        .param("stationId", stationId).param("outcome", response.getStatus() < 400 ? "success" : "failed")
                        .param("clientAddress", request.getRemoteAddr()).param("now", OffsetDateTime.now()).update();
            } catch (RuntimeException ignored) {
                // Audit persistence must not replace the original API response.
            }
        }
    }

    private static String extractStation(String path) {
        String marker = "/api/v1/stations/";
        int start = path.indexOf(marker);
        if (start < 0) return null;
        String tail = path.substring(start + marker.length());
        int slash = tail.indexOf('/');
        return (slash < 0 ? tail : tail.substring(0, slash)).matches("[A-Za-z0-9_-]{1,64}")
                ? (slash < 0 ? tail : tail.substring(0, slash)) : null;
    }
}
