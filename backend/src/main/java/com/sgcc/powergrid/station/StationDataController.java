package com.sgcc.powergrid.station;

import com.sgcc.powergrid.common.ApiException;
import com.sgcc.powergrid.common.PagedResponse;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/stations/{stationId}")
@PreAuthorize("@stationAccess.canAccess(#stationId, authentication)")
public class StationDataController {
    private final SnapshotService service;

    public StationDataController(SnapshotService service) { this.service = service; }

    @GetMapping("/snapshot")
    public Map<String, Object> snapshot(
            @PathVariable String stationId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime at,
            @RequestParam(defaultValue = "24h") String range) {
        return service.snapshot(stationId, at == null ? OffsetDateTime.now(ZoneOffset.UTC) : at, range);
    }

    @GetMapping("/minute-series")
    public PagedResponse<Map<String, Object>> minutes(
            @PathVariable String stationId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime to,
            @RequestParam(name = "page_size", defaultValue = "500") @Min(1) @Max(5000) int pageSize) {
        return service.minutes(stationId, from, to, pageSize);
    }

    @GetMapping("/results")
    public PagedResponse<Map<String, Object>> results(
            @PathVariable String stationId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime to,
            @RequestParam(name = "page_size", defaultValue = "500") @Min(1) @Max(5000) int pageSize) {
        return service.results(stationId, from, to, pageSize);
    }

    @GetMapping("/recognition/latest")
    public Map<String, Object> recognition(
            @PathVariable String stationId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime at) {
        return at == null ? service.latestRecognition(stationId) : service.latestRecognition(stationId, at);
    }

    @GetMapping("/data-range")
    public Map<String, Object> dataRange(@PathVariable String stationId) {
        return service.dataRange(stationId);
    }

    @GetMapping("/feedback-batches")
    public PagedResponse<Map<String, Object>> feedbackBatches(
            @PathVariable String stationId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime to,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime at,
            @RequestParam(name = "page_size", defaultValue = "500") @Min(1) @Max(5000) int pageSize) {
        return service.feedbackBatches(stationId, from, to, at == null ? OffsetDateTime.now(ZoneOffset.UTC) : at, pageSize);
    }

    @GetMapping("/feedback-batches/{batchId}/points")
    public List<Map<String, Object>> feedbackPoints(
            @PathVariable String stationId, @PathVariable String batchId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime at) {
        return service.feedbackPoints(stationId, batchId, at == null ? OffsetDateTime.now(ZoneOffset.UTC) : at);
    }

    @GetMapping("/corrections")
    public PagedResponse<Map<String, Object>> corrections(
            @PathVariable String stationId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime to,
            @RequestParam(name = "page_size", defaultValue = "500") @Min(1) @Max(5000) int pageSize) {
        return service.corrections(stationId, from, to, pageSize);
    }

    @GetMapping("/nodes") public List<Map<String, Object>> nodes(@PathVariable String stationId) { return service.nodes(stationId); }
    @GetMapping("/quality") public Map<String, Object> quality(@PathVariable String stationId) { return service.qualityForStation(stationId); }
    @GetMapping("/models/health") public Map<String, Object> health(@PathVariable String stationId) { return service.modelHealthForStation(stationId); }
    @GetMapping("/process/collection") public Map<String, Object> collection(@PathVariable String stationId) { return service.collectionProcess(stationId); }

    @GetMapping("/training-runs/latest")
    public Map<String, Object> training(@PathVariable String stationId) {
        Map<String, Object> run = service.latestTraining(stationId);
        if (run == null) throw new ApiException(HttpStatus.NOT_FOUND, "TRAINING_RUN_NOT_FOUND",
                "该台区没有真实训练运行记录");
        return run;
    }
}
