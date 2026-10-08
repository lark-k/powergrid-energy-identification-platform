from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import shutil
import sys

import numpy as np
import pytest
import torch

from app.formal_runner import artifact_digest, load_runner
from app.model_versions import ModelVersions, ModelSwitchError
from app.pv_v3_runner import PVV3ModelRunner
from app.runner import ModelContractError, WindowUnavailable
from app.schemas import InferenceRequest, MinutePoint, ModelTask

BUNDLE = Path(__file__).resolve().parents[1] / 'artifacts/pv-v3'
CHECKPOINT = BUNDLE / 'seed_3407_best_validation.pt'
BASE = datetime.fromisoformat('2026-10-07T10:00:00+08:00')


@pytest.fixture
def runner(settings):
    torch.set_num_threads(2)
    return load_runner(ModelTask.PV_SEPARATION, CHECKPOINT, settings.sgcc_project_dir, 'cpu')


@pytest.fixture
def reference(monkeypatch):
    root = Path(__file__).parent / 'reference/pv_v3'
    for name in ('pv_model', 'small_s4d', 'online_inference'):
        spec = importlib.util.spec_from_file_location(name, root / (name + '.py'))
        module = importlib.util.module_from_spec(spec)
        monkeypatch.setitem(sys.modules, name, module)
        spec.loader.exec_module(module)
    return sys.modules['online_inference'].OnlinePV(BUNDLE)


def point(runner, at, i=0, source='main-04', observed=True, arrival=None, sample=None):
    fields = {f: float(v) for f, v in zip(runner.fields, runner.center)}
    fields['TotW_MA'] += float(np.sin(i / 13))
    fields.update({f'PhV_phs{s}': 230. for s in 'ABC'})
    return MinutePoint(station_id='A01', event_time=at, active_power_kw=fields['TotW_MA'],
                       phase_a_power_kw=0., phase_b_power_kw=0., phase_c_power_kw=0.,
                       coverage_ratio=1. if observed else 0., quality_flag='good' if observed else 'missing',
                       source_id=source, electrical_fields=fields, measurement_time=sample or at,
                       arrival_time=arrival or at + timedelta(seconds=20))


def test_matches_delivered_runtime_across_sliding_windows_gaps_and_freshness(runner, reference):
    points = []
    for i in range(530):
        at = BASE + timedelta(minutes=i)
        p = point(runner, at, i)
        if i in (243, 244, 245, 360, 361, 362, 363):
            record = None
        else:
            points.append(p)
            record = dict(p.electrical_fields, sample_time_main=p.measurement_time, arrival_time_main=p.arrival_time)
        expected = reference.update(at, record, record is not None, predict=i >= 239)
        if i < 239:
            continue
        context = [p for p in points if p.event_time >= at - timedelta(minutes=243)]
        previous = [p for p in points if p.event_time < at - timedelta(minutes=243)]
        if previous:
            context.insert(0, previous[-1])
        if not expected['input_available']:
            with pytest.raises(WindowUnavailable):
                runner.infer_points(context, at)
            continue
        window, total, _, _ = runner.build_window(context, at)
        np.testing.assert_allclose(window, np.asarray(reference.history)[-240:], atol=1e-6)
        result = runner.infer_points(context, at)
        assert result.values['pv_generation_kw'] == pytest.approx(expected['pv_power_kw'], abs=1e-5)
        assert result.values['pv_activity_probability'] == pytest.approx(expected['activity_probability'], abs=1e-5)
        assert total == pytest.approx(next(p for p in reversed(points) if p.event_time <= at).electrical_fields['TotW_MA'])


def test_arrival_binning_uses_last_arrival_and_first_sample_version_and_excludes_future(runner):
    old = point(runner, BASE - timedelta(minutes=1), arrival=BASE + timedelta(seconds=10))
    repeated = old.model_copy(update={'arrival_time': BASE + timedelta(seconds=40),
                                      'electrical_fields': dict(old.electrical_fields, TotW_MA=999.)})
    newer = point(runner, BASE, i=1, arrival=BASE + timedelta(seconds=30))
    future = point(runner, BASE + timedelta(minutes=1), i=2)
    window, total, _, _ = runner.build_window([future, repeated, newer, old], BASE)
    assert total == newer.electrical_fields['TotW_MA']
    assert window[-1, 114] == 0
    assert window[-1, 115] == pytest.approx(.2)
    assert runner.infer_points([future, repeated, newer, old], BASE).values == runner.infer_points([old, newer], BASE).values
    with pytest.raises(WindowUnavailable):
        runner.infer_points([future], BASE)


def test_shanghai_midnight_zero_voltage_and_field_validity(runner):
    midnight = datetime.fromisoformat('2026-10-08T00:14:00+08:00')
    with pytest.raises(WindowUnavailable):
        runner.infer_points([point(runner, midnight)], midnight.astimezone(timezone.utc))
    recovery = midnight + timedelta(minutes=1)
    assert runner.infer_points([point(runner, recovery)], recovery).values['pv_generation_kw'] >= 0
    bad = point(runner, BASE)
    bad.electrical_fields.update({f'PhV_phs{s}': 0. for s in 'ABC'})
    with pytest.raises(WindowUnavailable):
        runner.infer_points([bad], BASE)
    invalid = point(runner, BASE)
    invalid.field_validity['TotW_MA'] = False
    with pytest.raises(WindowUnavailable):
        runner.infer_points([invalid], BASE)


def test_station_source_and_out_of_order_requests_do_not_share_history(runner):
    a = point(runner, BASE)
    b = point(runner, BASE + timedelta(minutes=10), i=40, source='other-main')
    expected = [runner.infer_points([p], p.event_time).values for p in (a, b, a)]
    with ThreadPoolExecutor(max_workers=3) as pool:
        actual = list(pool.map(lambda p: runner.infer_points([p], p.event_time).values, (a, b, a)))
    assert actual == expected
    with pytest.raises(ModelContractError, match='mixes'):
        runner.infer_points([a, b], b.event_time)
    with pytest.raises(ValueError, match='separation points'):
        InferenceRequest(request_id='isolation', station_id='A01', target_time=BASE, points=[a],
                         separation_points=[b.model_copy(update={'station_id': 'A02'})])


def test_switch_preserves_recognition_restart_rollback_and_missing_input(settings, tmp_path, runner):
    service = ModelVersions(replace(settings, active_state_path=tmp_path / 'active.json',
                                    recognition_checkpoint=BUNDLE.parent / 'formal-v1/RESOURCE_TCN_LSTM.pt',
                                    separation_checkpoint=BUNDLE.parent / 'formal-v1/PV_TCN_LSTM.pt'))
    old = service.catalog()['active']
    version = runner.model_version
    assert any(m['model_version'] == version and m['status'] == 'ready' for m in service.catalog()['models'])
    changed = service.activate(ModelTask.PV_SEPARATION, version, old['pv_separation'])
    assert changed['active']['resource_identification'] == old['resource_identification']
    request = InferenceRequest(request_id='pv-only-switch', station_id='A01', target_time=BASE,
                               points=[point(runner, BASE)], separation_points=[point(runner, BASE)])
    result = service.infer(request)
    assert result.separation_model_version == version
    assert result.recognition_model_version == old['resource_identification']
    assert result.separation_input_power_kw is not None
    missing = service.infer(request.model_copy(update={'separation_points': []}))
    assert missing.pv_generation_kw is None and missing.separation_model_version is None
    assert missing.recognition_model_version == old['resource_identification']
    restored = ModelVersions(service.settings)
    assert restored.catalog()['active'] == changed['active']
    restored.activate(ModelTask.PV_SEPARATION, old['pv_separation'], version)
    assert restored.catalog()['active'] == old


def test_integrity_covers_normalizer_manifest_and_weights(settings, tmp_path):
    copy = tmp_path / 'pv-v3'
    shutil.copytree(BUNDLE, copy)
    path = copy / CHECKPOINT.name
    original_digest = artifact_digest(path)
    norm_path = copy / 'normalizer.json'
    norm = json.loads(norm_path.read_text(encoding='utf-8'))
    norm['center'][0] += 1
    norm_path.write_text(json.dumps(norm), encoding='utf-8')
    assert artifact_digest(path) != original_digest
    with pytest.raises(ModelContractError, match='digest mismatch'):
        load_runner(ModelTask.PV_SEPARATION, path, settings.sgcc_project_dir, 'cpu')
