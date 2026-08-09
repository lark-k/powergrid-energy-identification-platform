alter table training_run add column model_task varchar(48) not null default 'resource_identification';
alter table training_run add column window_size_minutes integer not null default 120;
alter table training_run add column metric_name varchar(64) not null default 'validation_score';
alter table training_run add column metric_value double precision;
alter table training_run add column validation_series_name varchar(64) not null default '验证损失';

alter table training_epoch alter column validation_score drop not null;
alter table training_epoch add column validation_loss double precision;

create index ix_training_run_station_task_time
  on training_run(station_id, model_task, started_at desc);
