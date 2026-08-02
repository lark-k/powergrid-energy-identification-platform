insert into station (station_id, station_name, timezone, status, created_at, updated_at)
select 'A01', '海滨路台区', 'Asia/Shanghai', 'active', current_timestamp, current_timestamp
where not exists (select 1 from station where station_id = 'A01');

insert into app_user (user_id, display_name, enabled, created_at)
select 'dev-operator', '本地开发操作员', true, current_timestamp
where not exists (select 1 from app_user where user_id = 'dev-operator');

insert into user_station_role (user_id, station_id, role_name, created_at)
select 'dev-operator', 'A01', 'ADMIN', current_timestamp
where not exists (
  select 1 from user_station_role
  where user_id = 'dev-operator' and station_id = 'A01' and role_name = 'ADMIN'
);

insert into data_quality_summary (
  station_id, completeness_ratio, duplicate_count, missing_count,
  out_of_order_count, warning_count, last_checked_at
)
select 'A01', 1.0, 0, 0, 0, 0, current_timestamp
where not exists (select 1 from data_quality_summary where station_id = 'A01');
