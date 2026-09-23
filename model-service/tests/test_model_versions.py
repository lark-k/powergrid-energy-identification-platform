from dataclasses import replace
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
import torch
from fastapi.testclient import TestClient

from app.main import app
from app.model_versions import ModelVersions, ModelSwitchError
from app.schemas import InferenceRequest, ModelTask


@pytest.fixture
def versions(settings, tmp_path):
    torch.set_num_threads(2)
    return ModelVersions(replace(settings, active_state_path=tmp_path / "active.json", catalog_dir=tmp_path / "catalog"))


def alternative(service, task):
    catalog = service.catalog()
    return next(m["model_version"] for m in catalog["models"]
                if m["task"] == task.value and m["status"] == "ready"
                and m["manifest"]["input_schema_version"] == "minute-point.v1"
                and m["model_version"] != catalog["active"][task.value])


def test_switch_changes_real_inference_and_survives_restart(versions, sample_points):
    task = ModelTask.RESOURCE_IDENTIFICATION
    old = versions.catalog()["active"]
    target = alternative(versions, task)
    request = InferenceRequest(request_id="switch-test", station_id="A01",
                               target_time=sample_points[-1].event_time, points=sample_points[-240:])
    old_snapshot = versions.snapshot()
    switched = versions.activate(task, target, old[task.value])
    assert switched["active"][task.value] == target
    assert switched["active"]["pv_separation"] == old["pv_separation"]
    assert switched["previous"][task.value] == old[task.value]
    assert versions.infer(request).recognition_model_version == target
    assert old_snapshot.infer(request).recognition_model_version == old[task.value]
    restored = ModelVersions(versions.settings)
    assert restored.catalog()["active"] == switched["active"]
    restored.activate(task, old[task.value], target)
    assert restored.infer(request).recognition_model_version == old[task.value]


def test_failed_switch_and_stale_selection_keep_current_version(versions, monkeypatch):
    task = ModelTask.PV_SEPARATION
    old = versions.catalog()["active"]
    target = alternative(versions, task)
    with pytest.raises(ModelSwitchError, match="已被其他操作"):
        versions.activate(task, target, "stale-version")
    with pytest.raises(ModelSwitchError, match="不匹配"):
        versions.activate(task, old["resource_identification"], old[task.value])
    with pytest.raises(ModelSwitchError):
        versions.activate(task, "nonexistent", old[task.value])
    def failure(state):
        raise ModelSwitchError("MODEL_STATE_WRITE_FAILED", "write failed", 503)
    monkeypatch.setattr(versions, "_persist", failure)
    with pytest.raises(ModelSwitchError, match="write failed"):
        versions.activate(task, target, old[task.value])
    assert versions.catalog()["active"] == old


def test_inflight_inference_uses_original_pair_while_switch_finishes(versions, monkeypatch):
    entered, finish = Event(), Event()
    snapshot = versions.snapshot()
    old = versions.catalog()["active"]
    target = alternative(versions, ModelTask.PV_SEPARATION)
    def slow_infer(request):
        entered.set()
        assert finish.wait(10)
        return snapshot.separation.model_version
    monkeypatch.setattr(snapshot, "infer", slow_infer)
    with ThreadPoolExecutor() as pool:
        pending = pool.submit(versions.infer, None)
        assert entered.wait(10)
        try:
            versions.activate(ModelTask.PV_SEPARATION, target, old["pv_separation"])
            assert versions.snapshot().separation.model_version == target
        finally:
            finish.set()
        assert pending.result() == old["pv_separation"]


def test_corrupt_and_incompatible_artifacts_are_not_selectable(versions):
    folder = versions.settings.catalog_dir / "resource_identification"
    folder.mkdir(parents=True)
    (folder / "broken.pt").write_bytes(b"not a model")
    torch.save({"state_dict": {}, "config": {"input_channels": 114}}, folder / "new-contract.pt")
    rejected = [m for m in versions.catalog()["models"] if m["status"] == "incompatible"]
    assert len(rejected) == 2
    old = versions.catalog()["active"]["resource_identification"]
    for item in rejected:
        with pytest.raises(ModelSwitchError):
            versions.activate(ModelTask.RESOURCE_IDENTIFICATION, item["model_version"], old)


def test_runtime_api_auth_and_conflict(versions, monkeypatch):
    monkeypatch.setenv("MODEL_ACTIVE_STATE_PATH", str(versions.settings.active_state_path))
    monkeypatch.setenv("MODEL_SERVICE_AUTH_REQUIRED", "true")
    monkeypatch.setenv("MODEL_SERVICE_TOKEN", "test-version-token")
    with TestClient(app) as client:
        assert client.get("/internal/v1/model-versions").status_code == 401
        headers = {"Authorization": "Bearer test-version-token"}
        catalog = client.get("/internal/v1/model-versions", headers=headers).json()
        task = ModelTask.PV_SEPARATION
        target = alternative(versions, task)
        response = client.post(f"/internal/v1/model-versions/{task.value}/activate", headers=headers,
                               json={"model_version": target, "expected_version": catalog["active"][task.value]})
        assert response.status_code == 200
        assert response.json()["active"][task.value] == target
        response = client.post(f"/internal/v1/model-versions/{task.value}/activate", headers=headers,
                               json={"model_version": target, "expected_version": "stale"})
        assert response.status_code == 409
        assert response.json()["code"] == "MODEL_VERSION_CONFLICT"
