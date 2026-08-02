create table inference_replay_job (
  job_id varchar(64) primary key,
  station_id varchar(64) not null references station(station_id),
  range_start timestamp with time zone not null,
  range_end timestamp with time zone not null,
  status varchar(24) not null,
  dry_run boolean not null,
  total_targets integer not null default 0,
  processed_targets integer not null default 0,
  recognition_results integer not null default 0,
  separation_results integer not null default 0,
  skipped_targets integer not null default 0,
  failed_targets integer not null default 0,
  error_summary varchar(1000),
  request_id varchar(80) not null,
  requested_by varchar(80) not null,
  created_at timestamp with time zone not null,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  updated_at timestamp with time zone not null,
  constraint ck_inference_replay_range check (range_end > range_start),
  constraint ck_inference_replay_status check (status in ('queued', 'running', 'completed', 'failed'))
);

create index ix_inference_replay_station_created
  on inference_replay_job(station_id, created_at desc);

