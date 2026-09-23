"""Build the audited release bundle and SQL archive from the supplied training folder.

Run only when intentionally preparing a new migration; never rewrite an applied migration.
Usage: python -X utf8 scripts/import_formal_archive.py TRAINING_FOLDER
"""
import csv
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1])
DEST = ROOT / "model-service/artifacts/formal-v1"
DEST.mkdir(parents=True, exist_ok=True)
sql = ["-- Imported selected weights and real epoch records; completion date assigned by the user."]

def quote(value):
    if value is None:
        return "null"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"

def rows(path):
    with path.open(encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))

def typed(row):
    result = {}
    for key, value in row.items():
        try:
            result[key] = float(value) if value else None
        except ValueError:
            result[key] = value
    return result

for short, folder, task, prefix in [
    ("resource", "resource", "resource_identification", "sgcc-identification"),
    ("pv", "pv_all_constructed", "pv_separation", "sgcc-pv-separation"),
]:
    release = SOURCE / "release_all_constructed"
    manifest = json.loads((release / f"{short}_manifest.json").read_text(encoding="utf-8"))
    seed = manifest["selected_seed"]
    run_folder = SOURCE / folder / "tcn_lstm"
    digest = hashlib.sha256((release / manifest["checkpoint"]).read_bytes()).hexdigest()
    assert digest == manifest["checkpoint_sha256"] == hashlib.sha256((run_folder / f"seed_{seed}.pt").read_bytes()).hexdigest()
    for name in [manifest["checkpoint"], manifest["normalizer"], f"{short}_manifest.json", f"{short}_split_manifest.json"]:
        shutil.copyfile(release / name, DEST / name)
    evidence = DEST / "training" / short
    evidence.mkdir(parents=True, exist_ok=True)
    for name in [f"seed_{seed}_epochs.csv", f"seed_{seed}_completed.json", "metrics.csv", "runtime.json"]:
        shutil.copyfile(run_folder / name, evidence / name)
    epochs = rows(run_folder / f"seed_{seed}_epochs.csv")
    selected_metrics = [typed(row) for row in rows(run_folder / "metrics.csv") if int(row["seed"]) == seed]
    val = next(row for row in selected_metrics if row["split"] == "validation")
    assignments = json.loads((release / f"{short}_split_manifest.json").read_text(encoding="utf-8"))["assignments"]
    days = len({row["date"] for row in assignments if row["split"] == "train"})
    completed = json.loads((run_folder / f"seed_{seed}_completed.json").read_text(encoding="utf-8"))
    validation_key = "macro_pr_auc" if short == "resource" else "generation_mae"
    main_epochs = [row for row in epochs if row.get("stage", "main_raw_finetune") == "main_raw_finetune"]
    verification = SOURCE / ("verification" if short == "resource" else "pv_all_constructed/verification") / "summary.json"
    checks = json.loads(verification.read_text(encoding="utf-8"))
    shutil.copyfile(verification, evidence / "verification.json")
    metadata = {
        "archive_kind": "imported_formal_v1", "artifact_sha256": digest, "input_channels": 114,
        "model_name": "tcn_lstm" if short == "resource" else "causal_tcn_lstm",
        "parameters": 38555 if short == "resource" else 44330,
        "selected_seed": seed, "best_epoch": completed["best_epoch"], "training_seconds": completed["seconds"],
        "completion_time_source": "user_assigned_date", "completion_date": "2026-09-22",
        "evaluation_scope": "原始数据验证；资源标签为运行代理" if short == "resource" else "全部构造数据评估，不代表真实在线精度",
        "validation_metric": validation_key, "validation_unit": "score" if short == "resource" else "kW",
        "evaluation_metrics": selected_metrics, "auxiliary_epochs": [typed(row) for row in epochs if row.get("stage") == "aux_ev_raw_pretrain"],
        "auxiliary_sample_count": 54570 if short == "resource" else 0,
        "verification": checks, "epoch_records": [typed(row) for row in main_epochs],
        "source_files": {name: hashlib.sha256((evidence / name).read_bytes()).hexdigest() for name in [f"seed_{seed}_epochs.csv", "metrics.csv"]},
    }
    (evidence / "archive.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    version = f"{prefix}-{digest[:12]}"
    run_id = f"formal-v1-{short}-{digest[:12]}"
    metric_name = "macro_f1" if short == "resource" else "activity_f1"
    metric = val["macro_f1" if short == "resource" else "f1"]
    samples = 21726 if short == "resource" else int(next(row for row in selected_metrics if row["split"] == "train")["n"])
    columns = "run_id, station_id, status, model_version, model_task, dataset_window_days, window_size_minutes, sample_count, started_at, completed_at, validation_score, metric_name, metric_value, validation_series_name, source_record, created_at"
    values = [run_id, None, "completed", version, task, days, manifest["window"], samples, None,
              "2026-09-22T00:00:00+08:00", metric, metric_name, metric,
              "验证 Macro AP" if short == "resource" else "验证发电时段 MAE（kW）", json.dumps(metadata, ensure_ascii=False), "2026-09-22T00:00:00+08:00"]
    sql.append(f"insert into training_run ({columns}) values ({', '.join(map(quote, values))});")
    for row in main_epochs:
        values = [run_id, int(row["epoch"]), float(row["loss"]), float(row[validation_key]), None]
        sql.append(f"insert into training_epoch (run_id, epoch, training_loss, validation_score, recorded_at) values ({', '.join(map(quote, values))});")

(ROOT / "backend/src/main/resources/db/migration/V5__import_formal_v1_archive.sql").write_text("\n".join(sql) + "\n", encoding="utf-8")
print("Imported two selected models and their authentic training/validation archives.")
