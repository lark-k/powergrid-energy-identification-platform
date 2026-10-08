-- Preserve each first-arrival measurement separately from the original sample-minute ledger.
create table main_switch_arrival_sample (
  station_id varchar(64) not null references station(station_id),
  source_id varchar(128) not null,
  measurement_time timestamp with time zone not null,
  arrival_time timestamp with time zone not null,
  received_at timestamp with time zone not null,
  active_power_kw double precision not null,
  phase_a_power_kw double precision not null,
  phase_b_power_kw double precision not null,
  phase_c_power_kw double precision not null,
  coverage_ratio double precision not null,
  quality_flag varchar(24) not null,
  electrical_fields_json text not null,
  field_validity_json text not null,
  primary key (station_id, source_id, measurement_time)
);
create index ix_arrival_sample_station_time on main_switch_arrival_sample (station_id, arrival_time);

-- Only previously retained records can be backfilled. Original imported source
-- report times are retained; live MQTT cannot become available before receipt.
insert into main_switch_arrival_sample
select station_id, source_id, coalesce(measurement_time, event_time),
       case when source_id like 'mqtt:%' then greatest(coalesce(frame_time, arrival_time), arrival_time)
            else coalesce(frame_time, event_time) end,
       arrival_time, active_power_kw, phase_a_power_kw, phase_b_power_kw, phase_c_power_kw,
       coverage_ratio, quality_flag, electrical_fields_json, field_validity_json
from main_switch_minute
where quality_flag <> 'missing';
