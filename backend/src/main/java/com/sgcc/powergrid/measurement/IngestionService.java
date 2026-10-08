package com.sgcc.powergrid.measurement;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sgcc.powergrid.common.ApiException;
import com.sgcc.powergrid.measurement.IngestionModels.MinutesIngestedEvent;
import com.sgcc.powergrid.measurement.IngestionModels.Receipt;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IngestionService {
    private final MeasurementRepository repository;
    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper;
    private final ApplicationEventPublisher events;

    public IngestionService(
            MeasurementRepository repository,
            JdbcClient jdbc,
            ObjectMapper objectMapper,
            ApplicationEventPublisher events) {
        this.repository = repository;
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.events = events;
    }

    @Transactional
    public Receipt ingest(List<MainSwitchMinutePoint> points, String requestId) {
        return ingest(points, requestId, false, true);
    }

    @Transactional
    public Receipt ingest(
            List<MainSwitchMinutePoint> points,
            String requestId,
            boolean replaceExisting,
            boolean runInference) {
        Set<String> stations = new LinkedHashSet<>();
        points.forEach(point -> stations.add(point.stationId()));
        for (String stationId : stations) {
            if (!repository.stationExists(stationId)) {
                throw new ApiException(HttpStatus.NOT_FOUND, "STATION_NOT_FOUND", "台区 " + stationId + " 不存在");
            }
        }
        int inserted = 0;
        int updated = 0;
        int duplicates = 0;
        int outOfOrder = 0;
        OffsetDateTime previous = null;
        OffsetDateTime now = OffsetDateTime.now();
        List<OffsetDateTime> insertedTimes = new ArrayList<>();
        for (MainSwitchMinutePoint point : points) {
            repository.insertArrivalSample(point, now);
            if (previous != null && point.eventTime().isBefore(previous)) {
                outOfOrder++;
            }
            previous = point.eventTime();
            int changed = replaceExisting ? repository.update(point, requestId, now) : 0;
            if (changed == 1) {
                updated++;
                insertedTimes.add(point.eventTime());
                continue;
            }
            changed = repository.insert(point, requestId, now);
            if (changed == 1) {
                inserted++;
                insertedTimes.add(point.eventTime());
                if (runInference) {
                    appendOutbox(point.stationId(), requestId, "main_switch.minute.arrived",
                            java.util.Map.of("event_time", point.eventTime().toString()));
                }
            } else {
                duplicates++;
            }
        }
        for (String stationId : stations) {
            repository.incrementQuality(stationId, duplicates, outOfOrder, 0);
            Set<OffsetDateTime> changedTimes = new HashSet<>(insertedTimes);
            List<OffsetDateTime> stationTimes = points.stream()
                    .filter(point -> point.stationId().equals(stationId))
                    .map(MainSwitchMinutePoint::eventTime)
                    .filter(changedTimes::contains)
                    .toList();
            if (runInference && !stationTimes.isEmpty()) {
                events.publishEvent(new MinutesIngestedEvent(stationId, requestId, stationTimes));
            } else if (!runInference && !stationTimes.isEmpty()) {
                appendOutbox(stationId, requestId, "main_switch.bulk_imported", java.util.Map.of(
                        "changed_minutes", stationTimes.size(),
                        "from", stationTimes.getFirst().toString(),
                        "to", stationTimes.getLast().toString(),
                        "inference_scheduled", false));
            }
        }
        return new Receipt(requestId, points.size(), inserted, updated, duplicates, outOfOrder, runInference);
    }

    private void appendOutbox(String stationId, String requestId, String type, Object payload) {
        try {
            jdbc.sql("""
                            insert into outbox_event (
                              event_id, request_id, station_id, event_type, payload_json,
                              occurred_at, published_at, publish_attempts, last_error
                            ) values (:eventId, :requestId, :stationId, :type, :payload,
                              :now, null, 0, null)
                            """)
                    .param("eventId", UUID.randomUUID().toString())
                    .param("requestId", requestId)
                    .param("stationId", stationId)
                    .param("type", type)
                    .param("payload", objectMapper.writeValueAsString(payload))
                    .param("now", OffsetDateTime.now())
                    .update();
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Unable to serialize outbox payload", exception);
        }
    }
}
