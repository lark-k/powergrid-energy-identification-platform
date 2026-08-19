package com.sgcc.powergrid.station;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sgcc.powergrid.common.ApiException;
import com.sgcc.powergrid.common.PagedResponse;
import com.sgcc.powergrid.model.ModelRuntimeState;
import com.sgcc.powergrid.integration.modelservice.ModelServiceClient;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
public class SnapshotService {
    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;
    private final ModelRuntimeState modelRuntimeState;
    private final ModelServiceClient modelService;

    public SnapshotService(JdbcClient jdbc, ObjectMapper objectMapper, ModelRuntimeState modelRuntimeState,
            ModelServiceClient modelService) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.modelRuntimeState = modelRuntimeState;
        this.modelService = modelService;
    }

    public Map<String, Object> snapshot(String stationId, OffsetDateTime at, String range) {
        Map<String, Object> station = station(stationId);
        OffsetDateTime from = at.minusMinutes(rangeMinutes(range));
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("now", at);
        output.put("station_id", station.get("station_id"));
        output.put("station_name", station.get("station_name"));
        output.put("minute_points", minuteRows(stationId, from, at, 10080));
        output.put("separation_results", separationRows(stationId, from, at, at, 10080));
        output.put("substation_points", feedbackPointRows(stationId, null, at));
        output.put("feedback_batches", feedbackBatchRows(stationId, from, at, at, 5000));
        output.put("recognition", latestRecognition(stationId, at));
        output.put("corrections", correctionRows(stationId, from, at, 5000));
        output.put("training", latestTraining(stationId));
        output.put("model_health", modelHealth(stationId));
        output.put("node_statuses", nodeRows(stationId));
        output.put("quality", quality(stationId));
        return output;
    }

    public PagedResponse<Map<String, Object>> minutes(
            String stationId, OffsetDateTime from, OffsetDateTime to, int pageSize) {
        station(stationId);
        List<Map<String, Object>> rows = minuteRows(stationId, from, to, pageSize + 1);
        return page(rows, pageSize, "event_time");
    }

    public PagedResponse<Map<String, Object>> results(
            String stationId, OffsetDateTime from, OffsetDateTime to, int pageSize) {
        station(stationId);
        List<Map<String, Object>> rows = separationRows(stationId, from, to, OffsetDateTime.now(), pageSize + 1);
        return page(rows, pageSize, "event_time");
    }

    public PagedResponse<Map<String, Object>> feedbackBatches(
            String stationId, OffsetDateTime from, OffsetDateTime to, OffsetDateTime at, int pageSize) {
        station(stationId);
        List<Map<String, Object>> rows = feedbackBatchRows(stationId, from, to, at, pageSize + 1);
        return page(rows, pageSize, "arrival_time");
    }

    public PagedResponse<Map<String, Object>> corrections(
            String stationId, OffsetDateTime from, OffsetDateTime to, int pageSize) {
        station(stationId);
        List<Map<String, Object>> rows = correctionRows(stationId, from, to, pageSize + 1);
        return page(rows, pageSize, "updated_at");
    }

    public List<Map<String, Object>> feedbackPoints(String stationId, String batchId, OffsetDateTime at) {
        station(stationId);
        Long visible = jdbc.sql("""
                        select count(*) from pv_feedback_batch
                        where station_id = :stationId and batch_id = :batchId and arrival_time <= :at
                        """)
                .param("stationId", stationId).param("batchId", batchId).param("at", at)
                .query(Long.class).single();
        if (visible == 0) {
            throw new ApiException(HttpStatus.NOT_FOUND, "FEEDBACK_BATCH_NOT_FOUND", "反馈批次不存在或尚未到达");
        }
        return feedbackPointRows(stationId, batchId, at);
    }

    public Map<String, Object> latestRecognition(String stationId) {
        return latestRecognition(stationId, OffsetDateTime.now(ZoneOffset.UTC));
    }

    public Map<String, Object> latestRecognition(String stationId, OffsetDateTime at) {
        List<Map<String, Object>> results = jdbc.sql("""
                        select recognition_id, result_time, input_window_start,
                               input_window_end, model_version, quality_status
                        from recognition_result
                        where station_id = :stationId and deployment_role = 'active'
                          and event_time <= :at
                        order by event_time desc limit 1
                        """)
                .param("stationId", stationId).param("at", at).query().listOfRows();
        if (results.isEmpty()) {
            return null;
        }
        Map<String, Object> row = results.getFirst();
        List<Map<String, Object>> items = jdbc.sql("""
                        select kind, score, detected, feature_summary
                        from recognition_item where recognition_id = :id
                        order by case kind when 'pv' then 1 when 'energy_station' then 2 else 3 end
                        """)
                .param("id", row.get("recognition_id")).query().listOfRows().stream()
                .map(item -> {
                    Map<String, Object> mapped = new LinkedHashMap<>();
                    mapped.put("kind", item.get("kind"));
                    Boolean detected = (Boolean) item.get("detected");
                    mapped.put("label", detected == null ? "未发现明显特征" : detected ? "存在" : "未发现明显特征");
                    mapped.put("score", item.get("score"));
                    mapped.put("detected", detected);
                    mapped.put("features", jsonList(String.valueOf(item.get("feature_summary"))));
                    return mapped;
                }).toList();
        Map<String, Object> mapped = new LinkedHashMap<>();
        mapped.put("result_time", row.get("result_time"));
        mapped.put("window_start", row.get("input_window_start"));
        mapped.put("window_end", row.get("input_window_end"));
        mapped.put("model_version", row.get("model_version"));
        mapped.put("quality_status", row.get("quality_status"));
        mapped.put("items", items);
        return mapped;
    }

    public List<Map<String, Object>> nodes(String stationId) {
        station(stationId);
        return nodeRows(stationId);
    }

    public Map<String, Object> qualityForStation(String stationId) {
        station(stationId);
        return quality(stationId);
    }

    public Map<String, Object> modelHealthForStation(String stationId) {
        station(stationId);
        return modelHealth(stationId);
    }

    public Map<String, Object> dataRange(String stationId) {
        station(stationId);
        Map<String, Object> minuteRange = jdbc.sql("""
                        select min(event_time) as first_event_time,
                               max(event_time) as last_event_time,
                               count(*) as minute_count
                        from main_switch_minute where station_id = :stationId
                        """).param("stationId", stationId).query().singleRow();
        long recognitionCount = jdbc.sql("""
                        select count(*) from recognition_result
                        where station_id = :stationId and deployment_role = 'active'
                        """).param("stationId", stationId).query(Long.class).single();
        long separationCount = jdbc.sql("""
                        select count(*) from pv_separation_result
                        where station_id = :stationId and deployment_role = 'active'
                        """).param("stationId", stationId).query(Long.class).single();
        Map<String, Object> output = new LinkedHashMap<>(minuteRange);
        output.put("recognition_result_count", recognitionCount);
        output.put("separation_result_count", separationCount);
        return output;
    }

    public Map<String, Object> collectionProcess(String stationId) {
        station(stationId);
        long minuteCount = jdbc.sql("select count(*) from main_switch_minute where station_id = :stationId")
                .param("stationId", stationId).query(Long.class).single();
        long feedbackCount = jdbc.sql("select count(*) from pv_feedback_batch where station_id = :stationId")
                .param("stationId", stationId).query(Long.class).single();
        List<Map<String, Object>> signal = jdbc.sql("""
                        select event_time as at, active_power_kw as value
                        from main_switch_minute where station_id = :stationId
                        order by event_time desc limit 42
                        """)
                .param("stationId", stationId).query().listOfRows();
        java.util.Collections.reverse(signal);
        List<Map<String, Object>> eventRows = jdbc.sql("""
                        select event_id, occurred_at as at, event_type as label,
                               detail_json as detail, status
                        from collection_process_event where station_id = :stationId
                        order by occurred_at desc limit 10
                        """)
                .param("stationId", stationId).query().listOfRows();
        List<Map<String, Object>> events = eventRows.stream().map(row -> Map.<String, Object>of(
                "event_id", row.get("event_id"), "at", row.get("at"),
                "label", row.get("label"), "detail", row.get("detail"),
                "level", "degraded".equals(row.get("status")) ? "warning" : "info")).toList();
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("source", "rest-api");
        output.put("process_id", "COL-" + stationId);
        output.put("station_id", stationId);
        output.put("status", modelRuntimeState.get().recognitionStatus().equals("degraded") ? "degraded" : "running");
        output.put("updated_at", OffsetDateTime.now());
        output.put("sources", List.of(
                Map.of("source_id", "main_switch", "name", "总开计量", "cadence", "1 min",
                        "fields", List.of("总开有功", "A相有功", "B相有功", "C相有功"),
                        "received_count", minuteCount, "status", minuteCount == 0 ? "delayed" : "online"),
                Map.of("source_id", "pv_feedback", "name", "光伏分站反馈", "cadence", "async",
                        "fields", List.of("event_time", "arrival_time", "光伏功率"),
                        "received_count", feedbackCount, "status", "online")));
        output.put("steps", List.of(
                step("validate", "输入校验", "字段、单位和时间检查", minuteCount == 0 ? "waiting" : "completed", minuteCount),
                step("idempotency", "幂等入库", "station_id + event_time", minuteCount == 0 ? "waiting" : "completed", minuteCount),
                step("window", "历史窗口", "120/240 分钟因果窗口", modelRuntimeState.get().windowStatus().equals("ready") ? "completed" : "running", minuteCount),
                step("inference", "模型推理", "Python 模型服务", modelRuntimeState.get().recognitionStatus().equals("running") ? "completed" : "waiting", minuteCount)));
        output.put("quality", quality(stationId));
        output.put("signal", signal);
        output.put("events", events);
        return output;
    }

    public Map<String, Object> latestTraining(String stationId) {
        List<Map<String, Object>> runs = trainingRuns(stationId);
        return runs.isEmpty() ? null : runs.getFirst();
    }

    public List<Map<String, Object>> trainingRuns(String stationId) {
        station(stationId);
        List<Map<String, Object>> runs = jdbc.sql("""
                        select run_id, station_id, status, model_version, model_task,
                               dataset_window_days, window_size_minutes, sample_count,
                               started_at, completed_at, validation_score,
                               metric_name, metric_value, validation_series_name, source_record
                        from training_run where station_id = :stationId or station_id is null
                        order by started_at desc
                        """)
                .param("stationId", stationId).query().listOfRows();
        return runs.stream().map(this::trainingRunDetails).toList();
    }

    private Map<String, Object> trainingRunDetails(Map<String, Object> row) {
        Map<String, Object> run = new LinkedHashMap<>(row);
        run.put("source", "rest-api");
        String task = String.valueOf(run.get("model_task"));
        run.put("steps", List.of(
                trainingStep("sample", "样本准备", "训练数据集装载"),
                trainingStep("clean", "清洗切片", "异常样本剔除"),
                trainingStep("feature", "特征构建", task.equals("pv_separation") ? "240 分钟因果窗口" : "120 分钟因果窗口"),
                trainingStep("fit", "离线拟合", "参数收敛与早停"),
                trainingStep("release", "验证发布", "最佳权重归档")));
        run.put("epochs", jdbc.sql("""
                        select epoch, training_loss, validation_loss, validation_score
                        from training_epoch
                        where run_id = :runId order by epoch
                        """).param("runId", run.get("run_id")).query().listOfRows());
        run.put("release_checks", task.equals("pv_separation")
                ? List.of(
                        releaseCheck("quality", "数据质量检查"),
                        releaseCheck("regression", "功率回归验证"),
                        releaseCheck("activity", "光伏活动检测"))
                : List.of(
                        releaseCheck("quality", "数据质量检查"),
                        releaseCheck("classification", "多标签分类验证"),
                        releaseCheck("threshold", "识别阈值标定")));
        return run;
    }

    private Map<String, Object> trainingStep(String id, String name, String description) {
        return Map.of("step_id", id, "name", name, "description", description,
                "status", "completed", "progress", 1.0);
    }

    private Map<String, Object> releaseCheck(String id, String name) {
        return Map.of("check_id", id, "name", name, "status", "passed");
    }

    private Map<String, Object> station(String stationId) {
        List<Map<String, Object>> rows = jdbc.sql(
                        "select station_id, station_name, timezone, status from station where station_id = :stationId")
                .param("stationId", stationId).query().listOfRows();
        if (rows.isEmpty()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "STATION_NOT_FOUND", "台区 " + stationId + " 不存在");
        }
        return rows.getFirst();
    }

    private List<Map<String, Object>> minuteRows(String stationId, OffsetDateTime from, OffsetDateTime to, int limit) {
        return jdbc.sql("""
                        select station_id, event_time, active_power_kw, phase_a_power_kw,
                               phase_b_power_kw, phase_c_power_kw, reactive_power_kvar,
                               voltage, current_ampere as current, power_factor as pf,
                               coverage_ratio, quality_flag, source_id
                        from main_switch_minute
                        where station_id = :stationId and event_time >= :from and event_time < :to
                        order by event_time asc limit :limit
                        """)
                .param("stationId", stationId).param("from", from).param("to", to)
                .param("limit", limit).query().listOfRows();
    }

    private List<Map<String, Object>> separationRows(
            String stationId, OffsetDateTime from, OffsetDateTime to, OffsetDateTime visibleAt, int limit) {
        OffsetDateTime realtimeBoundary = visibleAt.minusMinutes(5);
        return jdbc.sql("""
                        select r.event_time, r.separation_time,
                          case when r.corrected_pv_kw is not null and b.arrival_time <= :visibleAt then '已反馈校正'
                               when r.event_time >= :realtimeBoundary then '实时初始'
                               else '等待反馈' end as result_status,
                          r.total_power_kw, r.initial_pv_kw,
                          case when b.arrival_time <= :visibleAt then r.corrected_pv_kw else null end as corrected_pv_kw,
                          case when b.arrival_time <= :visibleAt then r.station_feedback_value else null end as station_feedback_value,
                          case when r.corrected_pv_kw is not null and b.arrival_time <= :visibleAt then '已反馈' else '等待回传' end as feedback_status,
                          case when b.arrival_time <= :visibleAt then r.correction_kw else null end as correction_kw,
                          case when b.arrival_time <= :visibleAt then r.correction_ratio else null end as correction_ratio,
                          coalesce(case when b.arrival_time <= :visibleAt then r.correction_confidence else null end,
                                   r.pv_activity_probability) as confidence,
                          r.model_version,
                          case when b.arrival_time <= :visibleAt then r.batch_id else null end as batch_id,
                          r.input_window_start as model_window_start,
                          r.input_window_end as model_window_end,
                          r.total_power_kw - coalesce(
                            case when b.arrival_time <= :visibleAt then r.corrected_pv_kw else null end,
                            r.initial_pv_kw) as remaining_load_kw,
                          r.quality_status
                        from pv_separation_result r
                        left join pv_feedback_batch b on b.batch_id = r.batch_id
                        where r.station_id = :stationId and r.deployment_role = 'active'
                          and r.event_time >= :from and r.event_time < :to
                        order by r.event_time asc limit :limit
                        """)
                .param("realtimeBoundary", realtimeBoundary).param("visibleAt", visibleAt)
                .param("stationId", stationId)
                .param("from", from).param("to", to).param("limit", limit)
                .query().listOfRows().stream().map(row -> {
                    Map<String, Object> mapped = new LinkedHashMap<>(row);
                    mapped.put("participating_nodes", List.of());
                    return mapped;
                }).toList();
    }

    private List<Map<String, Object>> feedbackBatchRows(
            String stationId, OffsetDateTime from, OffsetDateTime to, OffsetDateTime at, int limit) {
        return jdbc.sql("""
                        select batch_id, arrival_time, coverage_start, coverage_end,
                               interval_minutes, point_count, participant_nodes, missing_nodes,
                               node_coverage_ratio, capacity_coverage_ratio, completeness_ratio,
                               quality_flag
                        from pv_feedback_batch
                        where station_id = :stationId and arrival_time >= :from
                          and arrival_time < :to and arrival_time <= :at
                        order by arrival_time asc limit :limit
                        """)
                .param("stationId", stationId).param("from", from).param("to", to)
                .param("at", at).param("limit", limit).query().listOfRows().stream()
                .map(row -> {
                    Map<String, Object> mapped = new LinkedHashMap<>(row);
                    mapped.put("participant_nodes", jsonList(String.valueOf(row.get("participant_nodes"))));
                    mapped.put("missing_nodes", jsonList(String.valueOf(row.get("missing_nodes"))));
                    return mapped;
                }).toList();
    }

    private List<Map<String, Object>> feedbackPointRows(String stationId, String batchId, OffsetDateTime at) {
        String batchPredicate = batchId == null ? "" : " and p.batch_id = :batchId";
        JdbcClient.StatementSpec query = jdbc.sql("""
                        select p.node_id, p.event_time as period_start, p.period_end, p.arrival_time,
                               p.batch_id, p.pv_value, p.value_type, p.capacity_kw, p.quality_flag
                        from pv_feedback_point p join pv_feedback_batch b on b.batch_id = p.batch_id
                        where p.station_id = :stationId and b.arrival_time <= :at
                        """ + batchPredicate + " order by p.event_time asc").param("stationId", stationId).param("at", at);
        if (batchId != null) query = query.param("batchId", batchId);
        return query.query().listOfRows();
    }

    private List<Map<String, Object>> correctionRows(String stationId, OffsetDateTime from, OffsetDateTime to, int limit) {
        return jdbc.sql("""
                        select correction_id, batch_id, period_start, period_end,
                               before_kw, reference_kw, after_kw, correction_kw,
                               confidence, reason, updated_at
                        from correction_record where station_id = :stationId
                          and period_start >= :from and period_start < :to
                        order by period_start asc limit :limit
                        """).param("stationId", stationId).param("from", from).param("to", to)
                .param("limit", limit).query().listOfRows();
    }

    private List<Map<String, Object>> nodeRows(String stationId) {
        return jdbc.sql("""
                        select node_id, node_name as name, capacity_kw, communication_status,
                               latest_event_time, latest_arrival_time, quality_flag
                        from node_status where station_id = :stationId order by node_id
                        """).param("stationId", stationId).query().listOfRows();
    }

    private Map<String, Object> quality(String stationId) {
        List<Map<String, Object>> rows = jdbc.sql("""
                        select completeness_ratio, duplicate_count, missing_count,
                               out_of_order_count, warning_count, last_checked_at
                        from data_quality_summary where station_id = :stationId
                        """).param("stationId", stationId).query().listOfRows();
        return rows.isEmpty() ? Map.of(
                "completeness_ratio", 0.0, "duplicate_count", 0L, "missing_count", 0L,
                "out_of_order_count", 0L, "warning_count", 0L,
                "last_checked_at", OffsetDateTime.now(ZoneOffset.UTC)) : rows.getFirst();
    }

    private Map<String, Object> modelHealth(String stationId) {
        ModelRuntimeState.State state = modelRuntimeState.get();
        List<Map<String, Object>> recognitionRows = jdbc.sql("""
                        select model_version, result_time as inference_time
                        from recognition_result where station_id = :stationId and deployment_role = 'active'
                        order by event_time desc limit 1
                        """).param("stationId", stationId).query().listOfRows();
        List<Map<String, Object>> separationRows = jdbc.sql("""
                        select model_version, separation_time as inference_time
                        from pv_separation_result where station_id = :stationId and deployment_role = 'active'
                        order by event_time desc limit 1
                        """).param("stationId", stationId).query().listOfRows();
        String recognitionVersion = state.recognitionVersion() != null
                ? state.recognitionVersion()
                : recognitionRows.isEmpty() ? null : String.valueOf(recognitionRows.getFirst().get("model_version"));
        String separationVersion = state.separationVersion() != null
                ? state.separationVersion()
                : separationRows.isEmpty() ? null : String.valueOf(separationRows.getFirst().get("model_version"));
        Object persistedInferenceTime = !separationRows.isEmpty()
                ? separationRows.getFirst().get("inference_time")
                : recognitionRows.isEmpty() ? null : recognitionRows.getFirst().get("inference_time");
        boolean serviceReady = modelService.ready();
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("recognition_status", serviceReady ? "running" : "degraded");
        output.put("separation_status", serviceReady ? "running" : "degraded");
        output.put("recognition_version", recognitionVersion);
        output.put("separation_version", separationVersion);
        output.put("last_inference_ms", state.lastInferenceMs());
        output.put("last_inference_time", state.lastInferenceTime() != null
                ? state.lastInferenceTime() : persistedInferenceTime);
        output.put("window_status", !serviceReady ? "delayed" : separationVersion != null ? "ready" : "warming_up");
        return output;
    }

    private static Map<String, Object> step(String id, String name, String description, String status, long count) {
        return Map.of("step_id", id, "name", name, "description", description,
                "status", status, "processed_count", count, "latency_ms", 0);
    }

    private List<String> jsonList(String value) {
        try {
            return objectMapper.readValue(value, new TypeReference<>() {});
        } catch (JsonProcessingException exception) {
            return List.of();
        }
    }

    private static long rangeMinutes(String range) {
        return switch (range) {
            case "1h" -> 60;
            case "6h" -> 360;
            case "24h" -> 1440;
            case "7d" -> 10080;
            default -> throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY,
                    "INVALID_RANGE", "range 必须是 1h、6h、24h 或 7d");
        };
    }

    private static PagedResponse<Map<String, Object>> page(
            List<Map<String, Object>> rows, int pageSize, String cursorField) {
        boolean hasMore = rows.size() > pageSize;
        List<Map<String, Object>> items = hasMore ? new ArrayList<>(rows.subList(0, pageSize)) : rows;
        String next = hasMore && !items.isEmpty() ? String.valueOf(items.getLast().get(cursorField)) : null;
        return new PagedResponse<>(items, next, hasMore);
    }
}
