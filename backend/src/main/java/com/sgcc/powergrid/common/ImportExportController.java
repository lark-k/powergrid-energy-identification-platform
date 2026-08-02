package com.sgcc.powergrid.common;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sgcc.powergrid.feedback.FeedbackModels.BatchRequest;
import com.sgcc.powergrid.feedback.FeedbackService;
import com.sgcc.powergrid.measurement.IngestionModels;
import com.sgcc.powergrid.measurement.IngestionService;
import com.sgcc.powergrid.measurement.MainSwitchMinutePoint;
import com.sgcc.powergrid.security.StationAccessService;
import com.sgcc.powergrid.station.SnapshotService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1")
public class ImportExportController {
    private final PlatformProperties properties;
    private final ObjectMapper objectMapper;
    private final IngestionService ingestion;
    private final FeedbackService feedback;
    private final SnapshotService snapshots;
    private final StationAccessService access;

    public ImportExportController(
            PlatformProperties properties,
            ObjectMapper objectMapper,
            IngestionService ingestion,
            FeedbackService feedback,
            SnapshotService snapshots,
            StationAccessService access) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.ingestion = ingestion;
        this.feedback = feedback;
        this.snapshots = snapshots;
        this.access = access;
    }

    @PostMapping(value = "/imports", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, Object>> importData(
            @RequestParam("file") MultipartFile file,
            @RequestParam("station_id") String stationId,
            @RequestParam("data_type") String dataType,
            Authentication authentication,
            HttpServletRequest servletRequest) throws IOException {
        authorize(stationId, authentication);
        validateUpload(file);
        String requestId = String.valueOf(servletRequest.getAttribute(RequestIdFilter.ATTRIBUTE));
        int rows;
        if ("main_switch".equals(dataType)) {
            List<MainSwitchMinutePoint> points = parseMainSwitch(file, stationId);
            rows = ingestion.ingest(points, requestId).inserted();
        } else if ("pv_feedback".equals(dataType) && MediaType.APPLICATION_JSON_VALUE.equals(file.getContentType())) {
            BatchRequest batch = objectMapper.readValue(file.getBytes(), BatchRequest.class);
            if (!stationId.equals(batch.stationId())) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "STATION_MISMATCH", "上传台区与批次台区不一致");
            }
            rows = feedback.ingest(batch, requestId).acceptedPoints();
        } else {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "UNSUPPORTED_IMPORT_TYPE",
                    "data_type 或文件格式不受支持");
        }
        return ResponseEntity.accepted().body(Map.of(
                "import_id", UUID.randomUUID().toString(), "status", "accepted", "accepted_rows", rows));
    }

    @PostMapping(value = "/exports", produces = "text/csv")
    public ResponseEntity<ByteArrayResource> export(
            @Valid @RequestBody ExportRequest request, Authentication authentication) {
        authorize(request.stationId(), authentication);
        List<Map<String, Object>> results = snapshots.results(
                request.stationId(), request.from(), request.to(), 5000).items();
        String[] fields = {"event_time", "total_power_kw", "initial_pv_kw", "corrected_pv_kw",
                "result_status", "feedback_status", "confidence", "model_version", "batch_id",
                "model_window_start", "model_window_end", "quality_status"};
        StringBuilder csv = new StringBuilder("\uFEFF").append(String.join(",", fields)).append('\n');
        for (Map<String, Object> row : results) {
            csv.append(Arrays.stream(fields).map(field -> escape(row.get(field))).reduce((left, right) -> left + "," + right).orElse(""))
                    .append('\n');
        }
        ByteArrayResource body = new ByteArrayResource(csv.toString().getBytes(StandardCharsets.UTF_8));
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename("pv-separation.csv", StandardCharsets.UTF_8).build().toString())
                .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
                .body(body);
    }

    private void validateUpload(MultipartFile file) throws IOException {
        if (file.isEmpty()) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "EMPTY_FILE", "上传文件为空");
        String name = file.getOriginalFilename();
        if (name == null || name.contains("/") || name.contains("\\") || !name.matches("[A-Za-z0-9._\u4e00-\u9fa5-]{1,160}")) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_FILE_NAME", "文件名不安全");
        }
        String contentType = file.getContentType();
        if (contentType == null || !properties.imports().allowedContentTypes().contains(contentType)) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "UNSUPPORTED_MEDIA_TYPE", "文件内容类型不允许");
        }
        byte[] prefix = Arrays.copyOf(file.getBytes(), Math.min(8, (int) file.getSize()));
        if (prefix.length >= 2 && prefix[0] == 'M' && prefix[1] == 'Z') {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "EXECUTABLE_FILE_REJECTED", "拒绝可执行文件内容");
        }
    }

    private List<MainSwitchMinutePoint> parseMainSwitch(MultipartFile file, String stationId) throws IOException {
        if (MediaType.APPLICATION_JSON_VALUE.equals(file.getContentType())) {
            List<MainSwitchMinutePoint> points = objectMapper.readValue(file.getBytes(), new TypeReference<>() {});
            points.forEach(point -> {
                if (!stationId.equals(point.stationId())) {
                    throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "STATION_MISMATCH", "上传数据包含其他台区");
                }
            });
            return points;
        }
        String text = new String(file.getBytes(), StandardCharsets.UTF_8).replaceFirst("^\uFEFF", "");
        String[] lines = text.split("\\R");
        if (lines.length < 2) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "EMPTY_FILE", "CSV 没有数据行");
        if (text.contains("\"")) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "QUOTED_CSV_UNSUPPORTED", "CSV 不允许含引号字段");
        String[] headers = lines[0].split(",", -1);
        Map<String, Integer> indexes = new LinkedHashMap<>();
        for (int index = 0; index < headers.length; index++) indexes.put(headers[index].trim(), index);
        List<String> required = List.of("event_time", "active_power_kw", "phase_a_power_kw",
                "phase_b_power_kw", "phase_c_power_kw", "coverage_ratio", "quality_flag", "source_id");
        if (!indexes.keySet().containsAll(required)) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "CSV_FIELDS_MISSING", "CSV 缺少总开标准字段");
        }
        List<MainSwitchMinutePoint> points = new ArrayList<>();
        for (int lineIndex = 1; lineIndex < lines.length; lineIndex++) {
            if (lines[lineIndex].isBlank()) continue;
            String[] values = lines[lineIndex].split(",", -1);
            try {
                points.add(new MainSwitchMinutePoint(
                        stationId,
                        OffsetDateTime.parse(value(values, indexes, "event_time")),
                        number(values, indexes, "active_power_kw"),
                        number(values, indexes, "phase_a_power_kw"),
                        number(values, indexes, "phase_b_power_kw"),
                        number(values, indexes, "phase_c_power_kw"),
                        optionalNumber(values, indexes, "reactive_power_kvar"),
                        optionalNumber(values, indexes, "voltage"),
                        optionalNumber(values, indexes, "current"),
                        optionalNumber(values, indexes, "pf"),
                        number(values, indexes, "coverage_ratio"),
                        value(values, indexes, "quality_flag"),
                        value(values, indexes, "source_id")));
            } catch (RuntimeException exception) {
                throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "CSV_ROW_INVALID", "CSV 第 " + (lineIndex + 1) + " 行不合法");
            }
        }
        return points;
    }

    private void authorize(String stationId, Authentication authentication) {
        if (!access.canAccess(stationId, authentication)) throw new AccessDeniedException("station access denied");
    }

    private static String value(String[] values, Map<String, Integer> indexes, String field) {
        Integer index = indexes.get(field);
        return index == null || index >= values.length ? "" : values[index].trim();
    }
    private static double number(String[] values, Map<String, Integer> indexes, String field) { return Double.parseDouble(value(values, indexes, field)); }
    private static Double optionalNumber(String[] values, Map<String, Integer> indexes, String field) {
        String value = value(values, indexes, field); return value.isBlank() ? null : Double.valueOf(value);
    }
    private static String escape(Object value) {
        if (value == null) return "";
        String text = String.valueOf(value);
        return text.contains(",") || text.contains("\n") ? "\"" + text.replace("\"", "\"\"") + "\"" : text;
    }

    public record ExportRequest(String stationId, OffsetDateTime from, OffsetDateTime to,
            String format, List<String> include) {}
}
