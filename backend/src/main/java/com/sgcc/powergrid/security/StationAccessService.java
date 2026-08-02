package com.sgcc.powergrid.security;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

@Service("stationAccess")
public class StationAccessService {
    private final JdbcClient jdbc;

    public StationAccessService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public boolean canAccess(String stationId, Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) {
            return false;
        }
        boolean admin = authentication.getAuthorities().stream()
                .anyMatch(authority -> authority.getAuthority().equals("ROLE_ADMIN"));
        if (admin) {
            return true;
        }
        return jdbc.sql("""
                        select count(*) from user_station_role
                        where user_id = :userId and station_id = :stationId
                        """)
                .param("userId", authentication.getName())
                .param("stationId", stationId)
                .query(Long.class)
                .single() > 0;
    }
}
