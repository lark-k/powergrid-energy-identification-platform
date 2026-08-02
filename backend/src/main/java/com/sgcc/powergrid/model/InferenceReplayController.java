package com.sgcc.powergrid.model;

import com.sgcc.powergrid.common.RequestIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/stations/{stationId}/inference-replays")
@PreAuthorize("@stationAccess.canAccess(#stationId, authentication)")
public class InferenceReplayController {
    private final InferenceReplayService service;

    public InferenceReplayController(InferenceReplayService service) {
        this.service = service;
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'OPERATOR') and @stationAccess.canAccess(#stationId, authentication)")
    public ResponseEntity<Map<String, Object>> start(
            @PathVariable String stationId,
            @Valid @RequestBody ReplayRequest body,
            HttpServletRequest request,
            Authentication authentication) {
        String requestId = String.valueOf(request.getAttribute(RequestIdFilter.ATTRIBUTE));
        return ResponseEntity.accepted().body(service.start(
                stationId, body.from(), body.to(), body.dryRun(), requestId, authentication.getName()));
    }

    @GetMapping
    public List<Map<String, Object>> jobs(@PathVariable String stationId) {
        return service.jobs(stationId);
    }

    @GetMapping("/{jobId}")
    public Map<String, Object> job(@PathVariable String stationId, @PathVariable String jobId) {
        return service.job(stationId, jobId);
    }

    public record ReplayRequest(@NotNull OffsetDateTime from, @NotNull OffsetDateTime to, boolean dryRun) {}
}
