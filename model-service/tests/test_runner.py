from __future__ import annotations

import hashlib
from datetime import timedelta

import pytest
import torch

from app.runner import CurrentSgccModelRunner, InferenceCoordinator, ModelContractError
from app.schemas import InferenceRequest, MinutePoint, ModelTask, QualityStatus


def request(points: list[MinutePoint], target_index: int = -1) -> InferenceRequest:
    return InferenceRequest(
        request_id="REQ-MODEL-TEST",
        station_id="A01",
        target_time=points[target_index].event_time,
        points=points,
    )


def test_manifests_bind_real_checkpoints_and_preprocessing(
    coordinator: InferenceCoordinator,
) -> None:
    manifests = {item.task: item for item in coordinator.manifests()}
    recognition = manifests[ModelTask.RESOURCE_IDENTIFICATION]
    separation = manifests[ModelTask.PV_SEPARATION]
    assert recognition.required_history_minutes == 120
    assert separation.required_history_minutes == 240
    assert recognition.thresholds.keys() == {
        "pv_detected",
        "energy_station_detected",
        "charger_detected",
    }
    assert separation.thresholds.keys() == {"pv_activity", "pv_power_gate"}
    for runner, manifest in (
        (coordinator.recognition, recognition),
        (coordinator.separation, separation),
    ):
        assert manifest.artifact_sha256 == hashlib.sha256(
            runner.checkpoint_path.read_bytes()
        ).hexdigest()
        assert manifest.health_status == "ready"
        assert "控制" in manifest.limitations[-1]


def test_real_sample_runs_both_current_sgcc_models(
    coordinator: InferenceCoordinator,
    sample_points: list[MinutePoint],
) -> None:
    result = coordinator.infer(request(sample_points[-240:]))
    assert result.quality_status in {QualityStatus.GOOD, QualityStatus.WARNING}
    assert result.recognition_window_start == result.target_time - timedelta(minutes=119)
    assert result.separation_window_start == result.target_time - timedelta(minutes=239)
    assert result.recognition_model_version.startswith("sgcc-identification-")
    assert result.separation_model_version.startswith("sgcc-pv-separation-")
    assert result.pv.score is not None and 0 <= result.pv.score <= 1
    assert result.energy_station.score is not None
    assert result.charger.score is not None
    assert result.pv_generation_kw is not None and result.pv_generation_kw >= 0
    assert result.pv_activity_probability is not None


def test_120_minutes_warms_recognition_but_not_pv_separation(
    coordinator: InferenceCoordinator,
    sample_points: list[MinutePoint],
) -> None:
    result = coordinator.infer(request(sample_points[-120:]))
    assert result.recognition_model_version is not None
    assert result.pv.score is not None
    assert result.separation_model_version is None
    assert result.pv_generation_kw is None
    assert result.quality_status == QualityStatus.WARNING
    assert "pv_separation:insufficient_history" in result.warnings


def test_short_bounded_gap_is_interpolated_and_audited(
    coordinator: InferenceCoordinator,
    sample_points: list[MinutePoint],
) -> None:
    points = sample_points[-240:].copy()
    del points[100]
    result = coordinator.infer(request(points))
    assert result.pv_generation_kw is not None
    assert result.interpolated_minutes == 1
    assert result.quality_status == QualityStatus.WARNING


def test_long_gap_produces_null_not_fake_zero(
    coordinator: InferenceCoordinator,
    sample_points: list[MinutePoint],
) -> None:
    points = sample_points[-240:].copy()
    del points[200:204]
    result = coordinator.infer(request(points))
    assert result.quality_status == QualityStatus.DISCONTINUOUS
    assert result.pv.score is None
    assert result.energy_station.score is None
    assert result.charger.score is None
    assert result.pv_generation_kw is None


def test_future_points_never_change_current_minute_result(
    coordinator: InferenceCoordinator,
    sample_points: list[MinutePoint],
) -> None:
    causal = sample_points[-250:-10]
    target = causal[-1]
    base = coordinator.infer(request(causal))
    future = [
        point.model_copy(
            update={
                "event_time": target.event_time + timedelta(minutes=index + 1),
                "active_power_kw": 999999.0,
                "phase_a_power_kw": 333333.0,
                "phase_b_power_kw": 333333.0,
                "phase_c_power_kw": 333333.0,
            }
        )
        for index, point in enumerate(sample_points[-10:])
    ]
    with_future = coordinator.infer(
        InferenceRequest(
            request_id="REQ-FUTURE",
            station_id="A01",
            target_time=target.event_time,
            points=[*causal, *future],
        )
    )
    assert with_future.pv.score == pytest.approx(base.pv.score, abs=1e-7)
    assert with_future.pv_generation_kw == pytest.approx(base.pv_generation_kw, abs=1e-7)
    assert "future_points_ignored" in with_future.warnings


def test_checkpoint_preprocessing_mismatch_fails_readiness_contract(
    settings,
    tmp_path,
) -> None:
    checkpoint = torch.load(
        settings.recognition_checkpoint, map_location="cpu", weights_only=False
    )
    checkpoint["feature_names"] = ["wrong_feature"]
    invalid = tmp_path / "invalid.pt"
    torch.save(checkpoint, invalid)
    with pytest.raises(ModelContractError, match="features mismatch"):
        CurrentSgccModelRunner(
            ModelTask.RESOURCE_IDENTIFICATION,
            invalid,
            settings.sgcc_project_dir,
            "cpu",
        )
