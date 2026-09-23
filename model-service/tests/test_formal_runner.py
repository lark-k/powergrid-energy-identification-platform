"""Parity with the supplied standalone release, including causal gaps and partial fields."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import importlib
import importlib.util
from pathlib import Path
import sys

import numpy as np
import pandas as pd
import pytest

from app.formal_runner import FormalModelRunner
from app.model_versions import ModelVersions
from app.runner import ModelContractError, WindowUnavailable
from app.schemas import InferenceRequest, MinutePoint, ModelTask

BUNDLE = Path(__file__).resolve().parents[1] / "artifacts/formal-v1"

@pytest.fixture
def reference(monkeypatch, settings):
    monkeypatch.syspath_prepend(str(settings.sgcc_project_dir / "energy_device_detection"))
    monkeypatch.setitem(sys.modules, "resource_model", importlib.import_module("models"))
    monkeypatch.setitem(sys.modules, "pv_model", importlib.import_module("pv_disaggregation_models"))
    spec = importlib.util.spec_from_file_location("formal_reference", Path(__file__).parent / "reference/formal_inference.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def point(at, record, **extra):
    return MinutePoint(station_id="A01", event_time=at, active_power_kw=record.get("TotW_MA", 0),
                       phase_a_power_kw=0, phase_b_power_kw=0, phase_c_power_kw=0, coverage_ratio=1,
                       quality_flag="good", source_id="mqtt:202601230004", electrical_fields=record, **extra)

@pytest.mark.parametrize("short,task,name", [("resource", ModelTask.RESOURCE_IDENTIFICATION, "RESOURCE_TCN_LSTM.pt"),
                                           ("pv", ModelTask.PV_SEPARATION, "PV_TCN_LSTM.pt")])
def test_matches_supplied_release_across_gaps_startup_and_midnight(settings, reference, short, task, name):
    runner = FormalModelRunner(task, BUNDLE / name, settings.sgcc_project_dir, "cpu")
    oracle = reference.FormalModel(short, BUNDLE, cpu_threads=2)
    start = datetime(2026, 9, 21, 23, 40, tzinfo=timezone(timedelta(hours=8)))
    points = []
    for i in range(280):
        if i in (7, 8, 12, 58):
            continue
        record = dict(zip(runner.fields, (runner.center + runner.scale * np.sin(np.arange(56) + i / 10)).tolist()))
        if i in (4, 70):
            record.pop(runner.fields[3])
        at = start + timedelta(minutes=i)
        p = point(at, record)
        points.append(p)
        expected = oracle.update(at, record, 1)
        if i in (0, 4, 9, 19, 20, 34, 35, 70, 239, 279):
            if not expected["measurement_valid"]:
                with pytest.raises(WindowUnavailable):
                    runner.infer_points(points, at)
                continue
            actual = runner.infer_points(points, at).values
            if short == "resource":
                assert [actual[f"{label}.score"] for label in ["pv_detected", "energy_station_detected", "charger_detected"]] == pytest.approx(list(expected["probabilities"].values()), abs=1e-6)
            else:
                assert actual["pv_generation_kw"] == pytest.approx(expected["pv_power_kw"], abs=1e-5)
    # UTC transport must not change the Shanghai midnight mask or results.
    utc = [p.model_copy(update={"event_time": p.event_time.astimezone(timezone.utc)}) for p in points]
    assert runner.infer_points(utc, utc[-1].event_time).values == pytest.approx(runner.infer_points(points, points[-1].event_time).values)
    encoded = runner.encode(pd.Timestamp(points[-1].event_time), points[-1].model_copy(update={"field_validity": {"TotW_MA": False}}))
    assert encoded[0] == encoded[56] == 0

def test_mixed_legacy_and_formal_switch_persistence_and_no_fake_four_field_input(settings, sample_points, tmp_path):
    service = ModelVersions(replace(settings, active_state_path=tmp_path / "active.json"))
    old = service.catalog()["active"]
    version = "sgcc-identification-f291cfb7f4fc"
    service.activate(ModelTask.RESOURCE_IDENTIFICATION, version, old["resource_identification"])
    last = sample_points[-1]
    runner = service.snapshot().recognition
    request = InferenceRequest(request_id="formal", station_id="A01", target_time=last.event_time, points=sample_points)
    missing = service.infer(request)
    assert missing.recognition_model_version is None  # No synthetic 56 fields from legacy four-value rows.
    assert missing.separation_model_version == old["pv_separation"]
    records = [p.model_copy(update={"coverage_ratio": 1.0, "electrical_fields": dict(zip(runner.fields, runner.center.tolist()))}) for p in sample_points]
    actual = service.infer(request.model_copy(update={"points": records}))
    assert actual.recognition_model_version == version
    assert actual.separation_model_version == old["pv_separation"]
    future = records[-1].model_copy(update={"event_time": last.event_time + timedelta(minutes=1)})
    assert service.infer(request.model_copy(update={"points": records + [future]})).pv == actual.pv
    assert ModelVersions(service.settings).catalog()["active"]["resource_identification"] == version
    service.activate(ModelTask.RESOURCE_IDENTIFICATION, old["resource_identification"], version)
    assert service.infer(request).recognition_model_version == old["resource_identification"]

def test_bundle_hash_mismatch_is_rejected(settings, tmp_path):
    import shutil
    for name in ["RESOURCE_TCN_LSTM.pt", "resource_manifest.json", "resource_normalizer.json"]:
        shutil.copyfile(BUNDLE / name, tmp_path / name)
    with (tmp_path / "resource_normalizer.json").open("a") as file:
        file.write(" ")
    with pytest.raises(ModelContractError, match="digest mismatch"):
        FormalModelRunner(ModelTask.RESOURCE_IDENTIFICATION, tmp_path / "RESOURCE_TCN_LSTM.pt", settings.sgcc_project_dir, "cpu")
