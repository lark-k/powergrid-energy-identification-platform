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
                          coverage_ratio, quality_flag, source_id, request_id, created_at
                        ) select
                          :stationId, :eventTime, :arrivalTime, :activePowerKw,
                          :phaseA, :phaseB, :phaseC, :reactivePowerKvar, :voltage,
                          :current, :pf, :coverageRatio, :qualityFlag, :sourceId,
                          :requestId, :arrivalTime
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
                          request_id = :requestId
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
                            source_id is distinct from :sourceId
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
                .update();
    }

    public List<Map<String, Object>> history(String stationId, OffsetDateTime targetTime, int limit) {
        List<Map<String, Object>> rows = jdbc.sql("""
                        select station_id, event_time, active_power_kw,
                               phase_a_power_kw, phase_b_power_kw, phase_c_power_kw,
                               coverage_ratio, quality_flag, source_id
                        from main_switch_minute
                        where station_id = :stationId and event_time <= :targetTime
                          and event_time >= :windowStart
                          and (source_id = (select source_id from main_switch_minute
                                where station_id = :stationId and event_time = :targetTime)
                            or (select source_id from main_switch_minute
                                where station_id = :stationId and event_time = :targetTime) not like 'mqtt:%')
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
                               coverage_ratio, quality_flag, source_id
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
                               coverage_ratio, quality_flag, source_id
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
                String.valueOf(row.get("source_id"))));
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
