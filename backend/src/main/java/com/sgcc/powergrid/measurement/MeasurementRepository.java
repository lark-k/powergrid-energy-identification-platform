package com.sgcc.powergrid.measurement;

import com.sgcc.powergrid.common.JdbcValues;
import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class MeasurementRepository {
    private final JdbcClient jdbc;

    public MeasurementRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public boolean stationExists(String stationId) {
        return jdbc.sql("select count(*) from station where station_id = :stationId")
                .param("stationId", stationId).query(Long.class).single() > 0;
    }

    public int insert(MainSwitchMinutePoint point, String requestId, OffsetDateTime arrivalTime) {
        return jdbc.sql("""
                        insert into main_switch_minute (
                          station_id, event_time, arrival_time, active_power_kw,
                          phase_a_power_kw, phase_b_power_kw, phase_c_power_kw,
                          reactive_power_kvar, voltage, current_ampere, power_factor,
                          coverage_ratio, quality_flag, source_id, request_id, created_at,
                          electrical_fields_json, field_validity_json, measurement_time, frame_time
                        ) select
                          :stationId, :eventTime, :arrivalTime, :activePowerKw,
                          :phaseA, :phaseB, :phaseC, :reactivePowerKvar, :voltage,
                          :current, :pf, :coverageRatio, :qualityFlag, :sourceId,
                          :requestId, :arrivalTime, :electrical, :validity, :measurementTime, :frameTime
                        where not exists (
                          select 1 from main_switch_minute
                          where station_id = :stationId and event_time = :eventTime
                        )
                        """)
                .param("stationId", point.stationId())
                .param("eventTime", point.eventTime())
                .param("arrivalTime", arrivalTime)
                .param("activePowerKw", point.activePowerKw())
                .param("phaseA", point.phaseAPowerKw())
                .param("phaseB", point.phaseBPowerKw())
                .param("phaseC", point.phaseCPowerKw())
                .param("reactivePowerKvar", point.reactivePowerKvar())
                .param("voltage", point.voltage())
                .param("current", point.current())
                .param("pf", point.pf())
                .param("coverageRatio", point.coverageRatio())
                .param("qualityFlag", point.qualityFlag())
                .param("sourceId", point.sourceId())
                .param("requestId", requestId)
                .param("electrical", ElectricalFields.json(point.electricalFields()))
                .param("validity", ElectricalFields.json(new java.util.TreeMap<>(point.fieldValidity())))
                .param("measurementTime", point.measurementTime())
                .param("frameTime", point.frameTime())
                .update();
    }

    public int update(MainSwitchMinutePoint point, String requestId, OffsetDateTime arrivalTime) {
        return jdbc.sql("""
                        update main_switch_minute set
                          arrival_time = :arrivalTime,
                          active_power_kw = :activePowerKw,
                          phase_a_power_kw = :phaseA,
                          phase_b_power_kw = :phaseB,
                          phase_c_power_kw = :phaseC,
                          reactive_power_kvar = :reactivePowerKvar,
                          voltage = :voltage,
                          current_ampere = :current,
                          power_factor = :pf,
                          coverage_ratio = :coverageRatio,
                          quality_flag = :qualityFlag,
                          source_id = :sourceId,
                          request_id = :requestId,
                          electrical_fields_json = :electrical, field_validity_json = :validity,
                          measurement_time = coalesce(:measurementTime, measurement_time),
                          frame_time = coalesce(:frameTime, frame_time)
                        where station_id = :stationId and event_time = :eventTime
                          and (
                            active_power_kw is distinct from :activePowerKw or
                            phase_a_power_kw is distinct from :phaseA or
                            phase_b_power_kw is distinct from :phaseB or
                            phase_c_power_kw is distinct from :phaseC or
                            reactive_power_kvar is distinct from :reactivePowerKvar or
                            voltage is distinct from :voltage or
                            current_ampere is distinct from :current or
                            power_factor is distinct from :pf or
                            coverage_ratio is distinct from :coverageRatio or
                            quality_flag is distinct from :qualityFlag or
                            source_id is distinct from :sourceId or
                            electrical_fields_json is distinct from :electrical or
                            field_validity_json is distinct from :validity or
                            (:measurementTime is not null and measurement_time is distinct from :measurementTime) or
                            (:frameTime is not null and frame_time is distinct from :frameTime)
                          )
                        """)
                .param("stationId", point.stationId())
                .param("eventTime", point.eventTime())
                .param("arrivalTime", arrivalTime)
                .param("activePowerKw", point.activePowerKw())
                .param("phaseA", point.phaseAPowerKw())
                .param("phaseB", point.phaseBPowerKw())
                .param("phaseC", point.phaseCPowerKw())
                .param("reactivePowerKvar", point.reactivePowerKvar())
                .param("voltage", point.voltage())
                .param("current", point.current())
                .param("pf", point.pf())
                .param("coverageRatio", point.coverageRatio())
                .param("qualityFlag", point.qualityFlag())
                .param("sourceId", point.sourceId())
                .param("requestId", requestId)
                .param("electrical", ElectricalFields.json(point.electricalFields()))
                .param("validity", ElectricalFields.json(new java.util.TreeMap<>(point.fieldValidity())))
                .param("measurementTime", point.measurementTime())
                .param("frameTime", point.frameTime())
                .update();
    }

    public List<Map<String, Object>> history(String stationId, OffsetDateTime targetTime, int limit) {
        List<Map<String, Object>> rows = jdbc.sql("""
                        select station_id, event_time, active_power_kw,
                               phase_a_power_kw, phase_b_power_kw, phase_c_power_kw,
                               coverage_ratio, quality_flag, source_id, electrical_fields_json, field_validity_json,
                               measurement_time, frame_time
                        from main_switch_minute
                        where station_id = :stationId and event_time <= :targetTime
                          and event_time >= :windowStart
                          and (source_id = (select source_id from main_switch_minute
                                where station_id = :stationId and event_time <= :targetTime order by event_time desc limit 1)
                            or (select source_id from main_switch_minute
                                where station_id = :stationId and event_time <= :targetTime order by event_time desc limit 1) not like 'mqtt:%')
                        order by event_time desc limit :limit
                        """)
                .param("stationId", stationId)
                .param("targetTime", targetTime)
                .param("windowStart", targetTime.minusMinutes(limit - 1L))
                .param("limit", limit)
                .query().listOfRows();
        Collections.reverse(rows);
        return rows;
    }

    public List<Map<String, Object>> between(
            String stationId, OffsetDateTime fromInclusive, OffsetDateTime toInclusive) {
        return jdbc.sql("""
                        select station_id, event_time, active_power_kw,
                               phase_a_power_kw, phase_b_power_kw, phase_c_power_kw,
                               coverage_ratio, quality_flag, source_id, electrical_fields_json, field_validity_json,
                               measurement_time, frame_time
                        from main_switch_minute
                        where station_id = :stationId
                          and event_time >= :fromInclusive
                          and event_time <= :toInclusive
                        order by event_time
                        """)
                .param("stationId", stationId)
                .param("fromInclusive", fromInclusive)
                .param("toInclusive", toInclusive)
                .query().listOfRows();
    }

    public Optional<MainSwitchMinutePoint> latestBefore(String stationId, OffsetDateTime eventTime) {
        List<Map<String, Object>> rows = jdbc.sql("""
                        select station_id, event_time, active_power_kw,
                               phase_a_power_kw, phase_b_power_kw, phase_c_power_kw,
                               reactive_power_kvar, voltage, current_ampere, power_factor,
                               coverage_ratio, quality_flag, source_id, electrical_fields_json, field_validity_json
                        from main_switch_minute
                        where station_id = :stationId and event_time < :eventTime
                        order by event_time desc limit 1
                        """)
                .param("stationId", stationId)
                .param("eventTime", eventTime)
                .query().listOfRows();
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        Map<String, Object> row = rows.getFirst();
        return Optional.of(new MainSwitchMinutePoint(
                String.valueOf(row.get("station_id")),
                JdbcValues.offsetDateTime(row.get("event_time")),
                number(row, "active_power_kw"),
                number(row, "phase_a_power_kw"),
                number(row, "phase_b_power_kw"),
                number(row, "phase_c_power_kw"),
                nullableNumber(row, "reactive_power_kvar"),
                nullableNumber(row, "voltage"),
                nullableNumber(row, "current_ampere"),
                nullableNumber(row, "power_factor"),
                number(row, "coverage_ratio"),
                String.valueOf(row.get("quality_flag")),
                String.valueOf(row.get("source_id")), ElectricalFields.values(row.get("electrical_fields_json")),
                ElectricalFields.validity(row.get("field_validity_json"))));
    }

    public void insertArrivalSample(MainSwitchMinutePoint point, OffsetDateTime receivedAt) {
        if ("missing".equals(point.qualityFlag())) return;
        OffsetDateTime measurement = point.measurementTime() == null ? point.eventTime() : point.measurementTime();
        OffsetDateTime available = point.frameTime() == null ? point.eventTime() : point.frameTime();
        if (point.sourceId().startsWith("mqtt:") && available.isBefore(receivedAt)) available = receivedAt;
        jdbc.sql("""
                insert into main_switch_arrival_sample (
                  station_id, source_id, measurement_time, arrival_time, received_at,
                  active_power_kw, phase_a_power_kw, phase_b_power_kw, phase_c_power_kw,
                  coverage_ratio, quality_flag, electrical_fields_json, field_validity_json
                ) select :station, :source, :measurement, :arrival, :received,
                  :total, :a, :b, :c, :coverage, :quality, :electrical, :validity
                where not exists (select 1 from main_switch_arrival_sample
                  where station_id=:station and source_id=:source and measurement_time=:measurement)
                """)
                .param("station", point.stationId()).param("source", point.sourceId())
                .param("measurement", measurement).param("arrival", available).param("received", receivedAt)
                .param("total", point.activePowerKw()).param("a", point.phaseAPowerKw())
                .param("b", point.phaseBPowerKw()).param("c", point.phaseCPowerKw())
                .param("coverage", point.coverageRatio()).param("quality", point.qualityFlag())
                .param("electrical", ElectricalFields.json(point.electricalFields()))
                .param("validity", ElectricalFields.json(point.fieldValidity())).update();
    }

    /** All first-arrival samples, before last-arrival-per-minute selection in the S4D adapter. */
    public List<Map<String, Object>> arrivalBetween(String stationId, OffsetDateTime from, OffsetDateTime to) {
        return jdbc.sql("""
                select station_id, measurement_time as event_time, measurement_time, arrival_time,
                       active_power_kw, phase_a_power_kw, phase_b_power_kw, phase_c_power_kw,
                       coverage_ratio, quality_flag, source_id, electrical_fields_json, field_validity_json
                from main_switch_arrival_sample
                where station_id=:station and arrival_time < :decision
                  and source_id=(select source_id from main_switch_arrival_sample
                    where station_id=:station and arrival_time < :decision order by arrival_time desc limit 1)
                  and (arrival_time >= :from or arrival_time=(select max(arrival_time) from main_switch_arrival_sample
                    where station_id=:station and arrival_time < :from and source_id=(select source_id from main_switch_arrival_sample
                      where station_id=:station and arrival_time < :decision order by arrival_time desc limit 1)))
                order by arrival_time, measurement_time
                """).param("station", stationId).param("from", from).param("decision", to.plusMinutes(1))
                .query().listOfRows();
    }

    public List<String> recentlyArrivingStations(OffsetDateTime since, OffsetDateTime decision) {
        return jdbc.sql("select distinct station_id from main_switch_arrival_sample where arrival_time >= :since and arrival_time < :decision")
                .param("since", since).param("decision", decision).query(String.class).list();
    }

    public void incrementQuality(String stationId, int duplicates, int outOfOrder, int warnings) {
        jdbc.sql("""
                        update data_quality_summary set
                          duplicate_count = duplicate_count + :duplicates,
                          out_of_order_count = out_of_order_count + :outOfOrder,
                          warning_count = warning_count + :warnings,
                          last_checked_at = :now
                        where station_id = :stationId
                        """)
                .param("duplicates", duplicates)
                .param("outOfOrder", outOfOrder)
                .param("warnings", warnings)
                .param("now", OffsetDateTime.now())
                .param("stationId", stationId)
                .update();
    }

    private static double number(Map<String, Object> row, String key) {
        return ((Number) row.get(key)).doubleValue();
    }

    private static Double nullableNumber(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value == null ? null : ((Number) value).doubleValue();
    }
}
