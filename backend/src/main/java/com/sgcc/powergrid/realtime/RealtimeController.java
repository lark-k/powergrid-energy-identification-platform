package com.sgcc.powergrid.realtime;

import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/v1/stations/{stationId}/process/collection")
public class RealtimeController {
    private final RealtimeHub hub;

    public RealtimeController(RealtimeHub hub) { this.hub = hub; }

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @PreAuthorize("@stationAccess.canAccess(#stationId, authentication)")
    public SseEmitter stream(@PathVariable String stationId) {
        return hub.subscribe(stationId);
    }
}
