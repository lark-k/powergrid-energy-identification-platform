-- Existing rows keep NULL because their original second-level timestamps cannot be recovered
-- from the normalized minute alone.
alter table main_switch_minute
  add column measurement_time timestamp with time zone;
alter table main_switch_minute
  add column frame_time timestamp with time zone;

alter table pv_feedback_point
  add column measurement_time timestamp with time zone;
alter table pv_feedback_point
  add column frame_time timestamp with time zone;
