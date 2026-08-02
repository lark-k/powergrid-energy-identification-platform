package com.sgcc.powergrid.feedback;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sgcc.powergrid.common.ApiException;
import com.sgcc.powergrid.common.JdbcValues;
import com.sgcc.powergrid.correction.FeedbackCorrectionPolicy;
import com.sgcc.powergrid.feedback.FeedbackModels.BatchReceipt;
import com.sgcc.powergrid.feedback.FeedbackModels.BatchRequest;
import com.sgcc.powergrid.feedback.FeedbackModels.Point;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FeedbackService {
    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;
    private final FeedbackCorrectionPolicy correctionPolicy;

    public FeedbackService(JdbcClient jdbc, ObjectMapper objectMapper, FeedbackCorrectionPolicy correctionPolicy) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.correctionPolicy = correctionPolicy;
    }

    @Transactional
    public BatchReceipt ingest(BatchRequest request, String requestId) {
        if (request.coverageEnd() == null || !request.coverageEnd().isAfter(request.coverageStart())) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "INVALID_FEEDBACK_PERIOD",
                    "coverage_end 必须晚于 coverage_start");
        }
        long station = jdbc.sql("select count(*) from station where station_id = :id")
                .param("id", request.stationId()).query(Long.class).single();
        if (station == 0) {
            throw new ApiException(HttpStatus.NOT_FOUND, "STATION_NOT_FOUND", "台区不存在");
        }
        try {
            int batchInserted = jdbc.sql("""
                            insert into pv_feedback_batch (
                              batch_id, station_id, arrival_time, coverage_start, coverage_end,
                              interval_minutes, point_count, participant_nodes, missing_nodes,
                              node_coverage_ratio, capacity_coverage_ratio, completeness_ratio,
                              quality_flag, request_id, created_at
                            ) values (:batchId, :stationId, :arrivalTime, :coverageStart,
                              :coverageEnd, :intervalMinutes, :pointCount, :participants,
                              :missing, :nodeCoverage, :capacityCoverage, :completeness,
                              :quality, :requestId, :now)
                            on conflict (batch_id) do nothing
                            """)
                    .param("batchId", request.batchId()).param("stationId", request.stationId())
                    .param("arrivalTime", request.arrivalTime()).param("coverageStart", request.coverageStart())
                    .param("coverageEnd", request.coverageEnd()).param("intervalMinutes", request.intervalMinutes())
                    .param("pointCount", request.points().size())
                    .param("participants", objectMapper.writeValueAsString(request.participantNodes()))
                    .param("missing", objectMapper.writeValueAsString(request.missingNodes() == null ? List.of() : request.missingNodes()))
                    .param("nodeCoverage", request.nodeCoverageRatio())
                    .param("capacityCoverage", request.capacityCoverageRatio())
                    .param("completeness", request.completenessRatio()).param("quality", request.qualityFlag())
                    .param("requestId", requestId).param("now", OffsetDateTime.now()).update();
            if (batchInserted == 0) {
                return new BatchReceipt(request.batchId(), "duplicate", 0, 0);
            }
            for (Point point : request.points()) {
                jdbc.sql("""
                                insert into pv_feedback_point (
                                  feedback_point_id, batch_id, station_id, node_id,
                                  event_time, period_end, arrival_time, pv_value,
                                  value_type, capacity_kw, quality_flag, created_at
                                ) values (:id, :batchId, :stationId, :nodeId, :eventTime,
                                  :periodEnd, :arrivalTime, :value, :valueType, :capacity,
                                  :quality, :now)
                                on conflict (batch_id, node_id, event_time) do nothing
                                """)
                        .param("id", UUID.randomUUID().toString()).param("batchId", request.batchId())
                        .param("stationId", request.stationId()).param("nodeId", point.nodeId())
                        .param("eventTime", point.eventTime()).param("periodEnd", point.periodEnd())
                        .param("arrivalTime", request.arrivalTime()).param("value", point.pvValue())
                        .param("valueType", point.valueType()).param("capacity", point.capacityKw())
                        .param("quality", point.qualityFlag()).param("now", OffsetDateTime.now()).update();
                upsertNode(request.stationId(), point, request.arrivalTime());
            }
            int corrected = request.arrivalTime().isAfter(OffsetDateTime.now())
                    ? 0 : correctBatch(request.batchId(), requestId);
            appendOutbox(request.stationId(), requestId, "feedback.arrived",
                    Map.of("batch_id", request.batchId(), "arrival_time", request.arrivalTime().toString()));
            return new BatchReceipt(request.batchId(), corrected > 0 ? "corrected" : "accepted", request.points().size(), corrected);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Unable to serialize feedback metadata", exception);
        }
    }

    @Scheduled(fixedDelayString = "${platform.feedback.reconcile-delay-ms:60000}")
    public void reconcileArrivedBatches() {
        List<Map<String, Object>> batches = jdbc.sql("""
                        select b.batch_id, b.request_id from pv_feedback_batch b
                        where b.arrival_time <= :now and not exists (
                          select 1 from correction_record c where c.batch_id = b.batch_id
                        ) order by b.arrival_time limit 50
                        """).param("now", OffsetDateTime.now()).query().listOfRows();
        batches.forEach(row -> correctBatch(String.valueOf(row.get("batch_id")), String.valueOf(row.get("request_id"))));
    }

    @Transactional
    public int correctBatch(String batchId, String requestId) {
        List<Map<String, Object>> batchRows = jdbc.sql("""
                        select station_id, node_coverage_ratio, capacity_coverage_ratio,
                               completeness_ratio from pv_feedback_batch where batch_id = :batchId
                        """).param("batchId", batchId).query().listOfRows();
        if (batchRows.isEmpty()) return 0;
        Map<String, Object> batch = batchRows.getFirst();
        String stationId = String.valueOf(batch.get("station_id"));
        double confidence = correctionPolicy.confidence(number(batch, "node_coverage_ratio"),
                number(batch, "capacity_coverage_ratio"), number(batch, "completeness_ratio"));
        List<Map<String, Object>> points = jdbc.sql("""
                        select event_time, period_end, pv_value, value_type
                        from pv_feedback_point where batch_id = :batchId order by event_time
                        """).param("batchId", batchId).query().listOfRows();
        Map<Period, Double> references = new LinkedHashMap<>();
        for (Map<String, Object> point : points) {
            OffsetDateTime start = JdbcValues.offsetDateTime(point.get("event_time"));
            OffsetDateTime end = JdbcValues.offsetDateTime(point.get("period_end"));
            double value = number(point, "pv_value");
            value = correctionPolicy.toAveragePowerKw(String.valueOf(point.get("value_type")), value, start, end);
            references.merge(new Period(start, end), value, Double::sum);
        }
        int corrected = 0;
        for (Map.Entry<Period, Double> entry : references.entrySet()) {
            Period period = entry.getKey();
            double referenceKw = Math.max(entry.getValue(), 0.0);
            List<Map<String, Object>> results = jdbc.sql("""
                            select separation_id, event_time, initial_pv_kw
                            from pv_separation_result
                            where station_id = :stationId and deployment_role = 'active'
                              and event_time >= :start and event_time < :end
                            order by event_time
                            """).param("stationId", stationId).param("start", period.start())
                    .param("end", period.end()).query().listOfRows();
            if (results.isEmpty()) continue;
            double average = results.stream().mapToDouble(row -> number(row, "initial_pv_kw")).average().orElse(0);
            java.util.OptionalDouble scaleValue = correctionPolicy.scale(average, referenceKw);
            if (scaleValue.isEmpty()) continue;
            double scale = scaleValue.getAsDouble();
            for (Map<String, Object> result : results) {
                String separationId = String.valueOf(result.get("separation_id"));
                double before = number(result, "initial_pv_kw");
                double after = correctionPolicy.corrected(before, scale);
                double correction = before - after;
                int changed = jdbc.sql("""
                                update pv_separation_result set corrected_pv_kw = :after,
                                  station_feedback_value = :reference, correction_kw = :correction,
                                  correction_ratio = :ratio, correction_confidence = :confidence,
                                  batch_id = :batchId, updated_at = :now
                                where separation_id = :id and corrected_pv_kw is null
                                """).param("after", after).param("reference", referenceKw)
                        .param("correction", correction).param("ratio", scale).param("confidence", confidence)
                        .param("batchId", batchId).param("now", OffsetDateTime.now()).param("id", separationId).update();
                if (changed == 1) {
                    jdbc.sql("""
                                    insert into correction_record (
                                      correction_id, station_id, separation_id, batch_id,
                                      period_start, period_end, before_kw, reference_kw,
                                      after_kw, correction_kw, confidence, reason, request_id, updated_at
                                    ) values (:correctionId, :stationId, :separationId, :batchId,
                                      :start, :end, :before, :reference, :after, :correction,
                                      :confidence, :reason, :requestId, :now)
                                    on conflict (separation_id, batch_id) do nothing
                                    """).param("correctionId", UUID.randomUUID().toString())
                            .param("stationId", stationId).param("separationId", separationId).param("batchId", batchId)
                            .param("start", result.get("event_time"))
                            .param("end", JdbcValues.offsetDateTime(result.get("event_time")).plusMinutes(1))
                            .param("before", before).param("reference", referenceKw).param("after", after)
                            .param("correction", correction).param("confidence", confidence)
                            .param("reason", "按反馈 event_time 同期约束并保持分钟曲线形状")
                            .param("requestId", requestId).param("now", OffsetDateTime.now()).update();
                    corrected++;
                }
            }
        }
        if (corrected > 0) {
            appendOutbox(stationId, requestId, "history.corrected",
                    Map.of("batch_id", batchId, "corrected_minutes", corrected));
        }
        return corrected;
    }

    private void upsertNode(String stationId, Point point, OffsetDateTime arrivalTime) {
        jdbc.sql("""
                        insert into node_status (
                          station_id, node_id, node_name, capacity_kw, communication_status,
                          latest_event_time, latest_arrival_time, quality_flag, updated_at
                        ) values (:stationId, :nodeId, :nodeId, :capacity, 'online',
                          :eventTime, :arrivalTime, :quality, :now)
                        on conflict (station_id, node_id) do update set
                          capacity_kw = excluded.capacity_kw, communication_status = 'online',
                          latest_event_time = excluded.latest_event_time,
                          latest_arrival_time = excluded.latest_arrival_time,
                          quality_flag = excluded.quality_flag, updated_at = excluded.updated_at
                        """).param("stationId", stationId).param("nodeId", point.nodeId())
                .param("capacity", point.capacityKw()).param("eventTime", point.eventTime())
                .param("arrivalTime", arrivalTime).param("quality", point.qualityFlag())
                .param("now", OffsetDateTime.now()).update();
    }

    private void appendOutbox(String stationId, String requestId, String type, Object payload) {
        try {
            jdbc.sql("""
                            insert into outbox_event (
                              event_id, request_id, station_id, event_type, payload_json,
                              occurred_at, published_at, publish_attempts, last_error
                            ) values (:id, :requestId, :stationId, :type, :payload, :now, null, 0, null)
                            """).param("id", UUID.randomUUID().toString()).param("requestId", requestId)
                    .param("stationId", stationId).param("type", type)
                    .param("payload", objectMapper.writeValueAsString(payload))
                    .param("now", OffsetDateTime.now()).update();
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static double number(Map<String, Object> row, String key) { return ((Number) row.get(key)).doubleValue(); }
    private record Period(OffsetDateTime start, OffsetDateTime end) {}
}
