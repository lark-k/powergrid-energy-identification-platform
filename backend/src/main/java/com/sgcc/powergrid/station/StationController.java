package com.sgcc.powergrid.station;

import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/stations")
public class StationController {
    private final JdbcClient jdbc;

    public StationController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public List<StationResponse> list(Authentication authentication) {
        boolean admin = authentication.getAuthorities().stream()
                .anyMatch(authority -> authority.getAuthority().equals("ROLE_ADMIN"));
        if (admin) {
            return jdbc.sql("""
                            select station_id, station_name, timezone, status
                            from station order by station_name
                            """)
                    .query(StationResponse.class).list();
        }
        return jdbc.sql("""
                        select distinct s.station_id, s.station_name, s.timezone, s.status
                        from station s join user_station_role r on r.station_id = s.station_id
                        where r.user_id = :userId order by s.station_name
                        """)
                .param("userId", authentication.getName())
                .query(StationResponse.class).list();
    }

    public record StationResponse(String stationId, String stationName, String timezone, String status) {}
}
