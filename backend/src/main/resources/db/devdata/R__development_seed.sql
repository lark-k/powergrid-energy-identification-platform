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

-- Real training archives captured by the project training pipelines on 2026-07-30.
-- The fixed IDs make this repeatable seed safe without affecting user-created runs.
delete from training_epoch
where run_id in ('TRAIN-IDENTIFICATION-20260730', 'TRAIN-PV-SEPARATION-20260730');
delete from training_run
where run_id in ('TRAIN-IDENTIFICATION-20260730', 'TRAIN-PV-SEPARATION-20260730');

insert into training_run (
  run_id, station_id, status, model_version, dataset_window_days,
  sample_count, started_at, completed_at, validation_score, source_record,
  created_at, model_task, window_size_minutes, metric_name, metric_value,
  validation_series_name
) values (
  'TRAIN-IDENTIFICATION-20260730', 'A01', 'completed',
  'sgcc-identification-8b2a09fd9b28', 46, 42007,
  timestamp with time zone '2026-07-30 12:13:41+00', timestamp with time zone '2026-07-30 12:14:12+00',
  0.9700236457261407,
  '{"artifact":"outputs/model_comparison.json","model_name":"tcn_lstm","parameters":27995,"best_epoch":13,"epochs_ran":18,"training_seconds":30.369505499998922,"device":"cuda","torch_version":"2.6.0+cu126","seed":20260729}',
  timestamp with time zone '2026-07-30 12:14:12+00', 'resource_identification', 120,
  'macro_f1', 0.9700236457261407, '验证损失'
), (
  'TRAIN-PV-SEPARATION-20260730', 'A01', 'completed',
  'sgcc-pv-separation-ed9cfd51f444', 17, 11466,
  timestamp with time zone '2026-07-30 12:15:14+00', timestamp with time zone '2026-07-30 12:15:32+00',
  0.9631434663417606,
  '{"artifact":"pv_outputs/pv_model_comparison.json","model_name":"causal_tcn_lstm","parameters":34058,"best_epoch":19,"epochs_ran":25,"training_seconds":17.609757599995646,"device":"cuda","torch_version":"2.6.0+cu126","seed":20260729,"validation_mae_kw":0.6436474919319153,"test_mae_kw":0.5281545519828796,"test_r_squared":0.8962163649907502}',
  timestamp with time zone '2026-07-30 12:15:32+00', 'pv_separation', 240,
  'activity_f1', 0.9631434663417606, '验证选择分数'
);

insert into training_epoch (
  run_id, epoch, training_loss, validation_score, recorded_at, validation_loss
) values
  ('TRAIN-IDENTIFICATION-20260730', 1, 0.49577719275553883, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.29705382859112384),
  ('TRAIN-IDENTIFICATION-20260730', 2, 0.2571095534903356, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.18228320329353814),
  ('TRAIN-IDENTIFICATION-20260730', 3, 0.192119276945865, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.1342971699454718),
  ('TRAIN-IDENTIFICATION-20260730', 4, 0.15431943896594455, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.13333876231174155),
  ('TRAIN-IDENTIFICATION-20260730', 5, 0.1342228130342119, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.10147637640144926),
  ('TRAIN-IDENTIFICATION-20260730', 6, 0.1182789079760442, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.12111910276967706),
  ('TRAIN-IDENTIFICATION-20260730', 7, 0.11071905248658702, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.09107177458266796),
  ('TRAIN-IDENTIFICATION-20260730', 8, 0.106219919273111, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.10735035973699963),
  ('TRAIN-IDENTIFICATION-20260730', 9, 0.09716014388151915, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.08602673324899104),
  ('TRAIN-IDENTIFICATION-20260730', 10, 0.09190908683415344, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.08519890602230375),
  ('TRAIN-IDENTIFICATION-20260730', 11, 0.09269065743052492, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.08236467768424455),
  ('TRAIN-IDENTIFICATION-20260730', 12, 0.09414472919253766, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.08156655137425976),
  ('TRAIN-IDENTIFICATION-20260730', 13, 0.08135802572645032, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.07739095555587233),
  ('TRAIN-IDENTIFICATION-20260730', 14, 0.08544065849167624, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.0792849516863704),
  ('TRAIN-IDENTIFICATION-20260730', 15, 0.07722914747234659, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.0788921192072231),
  ('TRAIN-IDENTIFICATION-20260730', 16, 0.07688144490088945, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.08113754223259913),
  ('TRAIN-IDENTIFICATION-20260730', 17, 0.07728470517370838, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.08420585597093894),
  ('TRAIN-IDENTIFICATION-20260730', 18, 0.07448936211524235, null, timestamp with time zone '2026-07-30 12:14:12+00', 0.07966043791719506),
  ('TRAIN-PV-SEPARATION-20260730', 1, 0.30866931326077823, null, timestamp with time zone '2026-07-30 12:15:32+00', 3.802940547466278),
  ('TRAIN-PV-SEPARATION-20260730', 2, 0.20456998302074456, null, timestamp with time zone '2026-07-30 12:15:32+00', 3.1240199208259583),
  ('TRAIN-PV-SEPARATION-20260730', 3, 0.16104576449867902, null, timestamp with time zone '2026-07-30 12:15:32+00', 3.363861083984375),
  ('TRAIN-PV-SEPARATION-20260730', 4, 0.1339844876733642, null, timestamp with time zone '2026-07-30 12:15:32+00', 3.06283301115036),
  ('TRAIN-PV-SEPARATION-20260730', 5, 0.11597259985710259, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.879148304462433),
  ('TRAIN-PV-SEPARATION-20260730', 6, 0.10154693396838364, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.8497886955738068),
  ('TRAIN-PV-SEPARATION-20260730', 7, 0.09184088436056552, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.751961201429367),
  ('TRAIN-PV-SEPARATION-20260730', 8, 0.08180839826606152, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.596706300973892),
  ('TRAIN-PV-SEPARATION-20260730', 9, 0.07526312462404597, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.4906940162181854),
  ('TRAIN-PV-SEPARATION-20260730', 10, 0.0675441080191966, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.310168743133545),
  ('TRAIN-PV-SEPARATION-20260730', 11, 0.06345376181881632, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.3206558525562286),
  ('TRAIN-PV-SEPARATION-20260730', 12, 0.060467582054991136, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.1630782186985016),
  ('TRAIN-PV-SEPARATION-20260730', 13, 0.05512818265897991, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.248601406812668),
  ('TRAIN-PV-SEPARATION-20260730', 14, 0.05334921957970123, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.2809834480285645),
  ('TRAIN-PV-SEPARATION-20260730', 15, 0.049236000989060655, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.0628336668014526),
  ('TRAIN-PV-SEPARATION-20260730', 16, 0.048541582526907795, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.1012628078460693),
  ('TRAIN-PV-SEPARATION-20260730', 17, 0.04704269405520027, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.250625789165497),
  ('TRAIN-PV-SEPARATION-20260730', 18, 0.04492416403591165, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.191453695297241),
  ('TRAIN-PV-SEPARATION-20260730', 19, 0.04305386343396149, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.0363978445529938),
  ('TRAIN-PV-SEPARATION-20260730', 20, 0.04202607087693496, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.193222016096115),
  ('TRAIN-PV-SEPARATION-20260730', 21, 0.041693488363687976, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.0940490663051605),
  ('TRAIN-PV-SEPARATION-20260730', 22, 0.0396823335303159, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.1395935118198395),
  ('TRAIN-PV-SEPARATION-20260730', 23, 0.03886642302104613, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.098061114549637),
  ('TRAIN-PV-SEPARATION-20260730', 24, 0.037699078902220115, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.187455505132675),
  ('TRAIN-PV-SEPARATION-20260730', 25, 0.03721882776725506, null, timestamp with time zone '2026-07-30 12:15:32+00', 2.1045967638492584);
