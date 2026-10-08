"""Prepare the confirmed PV-only delivery without overwriting formal-v1 archives."""
import csv
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1])
DEST = ROOT / 'model-service/artifacts/pv-v3'
DEST.mkdir(parents=True, exist_ok=True)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_rows(path):
    with path.open(encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


def typed(row):
    result = {}
    for key, value in row.items():
        try:
            result[key] = float(value) if value else None
        except ValueError:
            result[key] = value
    return result


spec = json.loads((SOURCE / 'release/manifest.json').read_text(encoding='utf-8'))
assert spec['method'] == 'small_s4d' and spec['seeds'] == [3407]
checkpoint = spec['checkpoints'][0]
files = ['manifest.json', 'normalizer.json', checkpoint]
assert sha(SOURCE / 'release' / checkpoint) == spec['checkpoint_sha256'][checkpoint]
assert sha(SOURCE / 'release/normalizer.json') == spec['normalizer_sha256']
for name in files:
    shutil.copyfile(SOURCE / 'release' / name, DEST / name)
deployment = {'schema': 'pv-v3-adapter.v1', 'delivery_date': spec['supplier_confirmation_date'],
              'sha256': {name: sha(DEST / name) for name in files}}
(DEST / 'pv_v3_manifest.json').write_text(json.dumps(deployment, ensure_ascii=False, indent=2), encoding='utf-8')
parts = [b'pv-v3-adapter.v1', (DEST / checkpoint).read_bytes()] + [(DEST / name).read_bytes() for name in ['pv_v3_manifest.json', 'manifest.json', 'normalizer.json']]
digest = hashlib.sha256(b'\0'.join(parts)).hexdigest()
version = 'sgcc-pv-separation-' + digest[:12]
evidence = DEST / 'training'
evidence.mkdir(exist_ok=True)
evidence_files = ['selected_model_metrics.csv', 'runtime_verification.json', 'split_manifest.json', 'confirmed_pair_audit.json']
for name in evidence_files:
    shutil.copyfile(SOURCE / name, evidence / name)
for name in ['seed_3407_completed.json', 'seed_3407_epochs.csv']:
    shutil.copyfile(SOURCE / 'training/small_s4d' / name, evidence / name)
completed = json.loads((evidence / 'seed_3407_completed.json').read_text(encoding='utf-8'))
metrics = [typed(row) for row in read_rows(evidence / 'selected_model_metrics.csv') if row['scope'] == 'new']
validation = next(row for row in metrics if row['split'] == 'validation')
epochs = [typed(row) for row in read_rows(evidence / 'seed_3407_epochs.csv')]
metadata = {'archive_kind': 'imported_pv_v3', 'artifact_sha256': digest, 'checkpoint_sha256': spec['checkpoint_sha256'][checkpoint],
            'input_channels': 116, 'model_name': 'small_s4d', 'parameters': spec['parameters'], 'selected_seed': 3407,
            'best_epoch': completed['best_epoch'], 'training_seconds': completed['train_seconds'],
            'completion_time_source': 'supplier_delivery_date', 'completion_date': deployment['delivery_date'],
            'training_completion_time': None, 'evaluation_scope': '01/04真实数据评估；复用时间留出，未证明未见台区泛化',
            'validation_metric': 'generation_mae', 'validation_unit': 'kW', 'evaluation_metrics': metrics,
            'epoch_records': epochs, 'verification': json.loads((evidence / 'runtime_verification.json').read_text(encoding='utf-8')),
            'source_files': {p.name: sha(p) for p in evidence.iterdir() if p.is_file()}}
(evidence / 'archive.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')


def quote(value):
    if value is None:
        return 'null'
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


run_id = 'pv-v3-' + digest[:12]
columns = 'run_id, station_id, status, model_version, model_task, dataset_window_days, window_size_minutes, sample_count, started_at, completed_at, validation_score, metric_name, metric_value, validation_series_name, source_record, created_at'
train = next(row for row in metrics if row['split'] == 'train')
# No actual completion timestamp was supplied. completed_at stays NULL; display
# and ordering explicitly use the recorded delivery date from source_record.
values = [run_id, None, 'completed', version, 'pv_separation', 6, 240, int(train['n']), None, None,
          validation['generation_mae'], 'activity_f1', validation['activity_f1'], '验证发电时段 MAE（kW）',
          json.dumps(metadata, ensure_ascii=False), deployment['delivery_date'] + 'T00:00:00+08:00']
sql = ['-- PV-only confirmed delivery. Existing formal-v1 records and runtime selection are preserved.',
       f"insert into training_run ({columns}) values ({', '.join(map(quote, values))});"]
for row in epochs:
    values = [run_id, int(row['epoch']), row['train_loss'], row['generation_mae'], None]
    sql.append(f"insert into training_epoch (run_id, epoch, training_loss, validation_score, recorded_at) values ({', '.join(map(quote, values))});")
(ROOT / 'backend/src/main/resources/db/migration/V8__import_pv_v3_archive.sql').write_text('\n'.join(sql) + '\n', encoding='utf-8')
ref = ROOT / 'model-service/tests/reference/pv_v3'
ref.mkdir(parents=True, exist_ok=True)
for name in ['online_inference.py', 'pv_model.py', 'small_s4d.py']:
    shutil.copyfile(SOURCE / 'release' / name, ref / name)
print(json.dumps({'model_version': version, 'artifact_sha256': digest, 'archive': run_id}, indent=2))
