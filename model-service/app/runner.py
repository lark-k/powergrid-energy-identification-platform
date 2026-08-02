from __future__ import annotations

import hashlib
import importlib
import platform
import sys
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as functional

from .config import Settings
from .metrics import metrics
from .schemas import (
    InferenceRequest,
    InferenceResult,
    MinutePoint,
    ModelHealth,
    ModelManifest,
    ModelTask,
    QualityFlag,
    QualityStatus,
    ResourceInference,
)


RECOGNITION_FEATURES = [
    "active_power_kw",
    "phase_a_power_kw",
    "phase_b_power_kw",
    "phase_c_power_kw",
]
SEPARATION_FEATURES = [
    *RECOGNITION_FEATURES,
    "active_power_delta_1m_kw",
    "minute_of_day_sin",
    "minute_of_day_cos",
]
LABEL_NAMES = ["pv_detected", "energy_station_detected", "charger_detected"]
LIMITATIONS = [
    "当前仅对光伏执行数值功率分离；能源站和充电桩只输出辨识概率与状态。",
    "当前充电桩数据没有与总开、光伏和能源站完成真实同步混合验证。",
    "当前模型在其他台区正式应用前需要外部测试。",
    "模型输出仅用于监测分析和辅助决策，不提供设备控制。",
]


class ModelContractError(RuntimeError):
    """Raised when a checkpoint and its preprocessing contract do not match."""


class WindowUnavailable(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class TaskInference:
    window_start: datetime
    window_end: datetime
    interpolated_minutes: int
    values: dict[str, float | bool]
    model_version: str


class ModelRunner(ABC):
    @abstractmethod
    def manifest(self) -> ModelManifest:
        raise NotImplementedError

    @abstractmethod
    def infer(self, frame: pd.DataFrame, target_time: datetime) -> TaskInference:
        raise NotImplementedError

    @abstractmethod
    def health(self) -> ModelHealth:
        raise NotImplementedError


class CurrentSgccModelRunner(ModelRunner):
    """Task-specific adapter around the current, replaceable SGCC implementation."""

    def __init__(
        self,
        task: ModelTask,
        checkpoint_path: Path,
        sgcc_project_dir: Path,
        device_name: str,
    ) -> None:
        self.task = task
        self.checkpoint_path = checkpoint_path
        self.loaded_at = datetime.now(timezone.utc)
        self._failure: str | None = None
        self._model: torch.nn.Module | None = None
        self._checkpoint: dict[str, Any] = {}
        self._recognition_predict: Any = None
        self._separation_predict: Any = None
        try:
            self._load(sgcc_project_dir, device_name)
        except Exception as exc:
            self._failure = str(exc)
            raise

    def _load(self, sgcc_project_dir: Path, device_name: str) -> None:
        model_dir = (sgcc_project_dir / "energy_device_detection").resolve()
        if not model_dir.is_dir():
            raise ModelContractError(f"SGCC model directory does not exist: {model_dir}")
        if not self.checkpoint_path.is_file():
            raise ModelContractError(f"checkpoint does not exist: {self.checkpoint_path}")
        model_dir_text = str(model_dir)
        if model_dir_text not in sys.path:
            sys.path.insert(0, model_dir_text)

        self._recognition_predict = importlib.import_module("predict")
        self._separation_predict = importlib.import_module("predict_pv_disaggregation")
        models = importlib.import_module("models")
        pv_models = importlib.import_module("pv_disaggregation_models")

        self._checkpoint = torch.load(
            self.checkpoint_path,
            map_location="cpu",
            weights_only=False,
        )
        if device_name == "auto":
            self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        elif device_name in {"cpu", "cuda"}:
            if device_name == "cuda" and not torch.cuda.is_available():
                raise ModelContractError("MODEL_DEVICE=cuda but CUDA is unavailable")
            self.device = torch.device(device_name)
        else:
            raise ModelContractError("MODEL_DEVICE must be auto, cpu, or cuda")

        if self.task == ModelTask.RESOURCE_IDENTIFICATION:
            self._validate_recognition_contract()
            config = models.ModelConfig.from_dict(self._checkpoint["model_config"])
            self._model = models.build_model(self._checkpoint["model_name"], config)
        else:
            self._validate_separation_contract()
            config = pv_models.PVModelConfig.from_dict(self._checkpoint["model_config"])
            self._model = pv_models.build_pv_model(
                self._checkpoint["model_name"], config
            )
        self._model.load_state_dict(self._checkpoint["model_state_dict"])
        self._model = self._model.to(self.device).eval()

    def _require(self, condition: bool, message: str) -> None:
        if not condition:
            raise ModelContractError(message)

    def _validate_common(self) -> None:
        self._require(self._checkpoint.get("causal") is True, "checkpoint must be causal")
        self._require(
            self._checkpoint.get("target_time") == "window_endpoint_current_minute",
            "checkpoint target_time is not the current window endpoint",
        )
        mean = np.asarray(self._checkpoint.get("feature_mean"), dtype=np.float32)
        std = np.asarray(self._checkpoint.get("feature_std"), dtype=np.float32)
        self._require(mean.ndim == 1 and std.shape == mean.shape, "normalization shape mismatch")
        self._require(np.isfinite(mean).all(), "feature_mean contains non-finite values")
        self._require(np.isfinite(std).all() and (std > 0).all(), "feature_std is invalid")
        self._require(
            0 <= float(self._checkpoint.get("min_coverage_ratio", -1)) <= 1,
            "min_coverage_ratio is invalid",
        )
        self._require(
            int(self._checkpoint.get("max_interpolation_gap_minutes", -1)) >= 0,
            "max_interpolation_gap_minutes is invalid",
        )

    def _validate_recognition_contract(self) -> None:
        self._validate_common()
        self._require(
            self._checkpoint.get("task")
            == "realtime_current_minute_multi_label_resource_identification",
            "recognition task mismatch",
        )
        self._require(self._checkpoint.get("window_size") == 120, "recognition window must be 120")
        self._require(self._checkpoint.get("feature_names") == RECOGNITION_FEATURES, "recognition features mismatch")
        self._require(self._checkpoint.get("label_names") == LABEL_NAMES, "recognition labels mismatch")
        thresholds = np.asarray(self._checkpoint.get("thresholds"), dtype=np.float32)
        self._require(thresholds.shape == (3,), "recognition thresholds mismatch")

    def _validate_separation_contract(self) -> None:
        self._validate_common()
        self._require(
            self._checkpoint.get("task") == "same_minute_pv_power_disaggregation",
            "PV separation task mismatch",
        )
        self._require(self._checkpoint.get("window_size") == 240, "PV separation window must be 240")
        self._require(self._checkpoint.get("feature_names") == SEPARATION_FEATURES, "PV separation features mismatch")
        self._require(float(self._checkpoint.get("target_scale_kw", 0)) > 0, "target scale is invalid")
        for key in ("activity_probability_threshold", "power_gate_threshold"):
            self._require(0 <= float(self._checkpoint.get(key, -1)) <= 1, f"{key} is invalid")

    @property
    def required_history_minutes(self) -> int:
        return int(self._checkpoint["window_size"])

    @property
    def min_coverage_ratio(self) -> float:
        return float(self._checkpoint["min_coverage_ratio"])

    @property
    def max_interpolation_gap_minutes(self) -> int:
        return int(self._checkpoint["max_interpolation_gap_minutes"])

    @property
    def artifact_sha256(self) -> str:
        return hashlib.sha256(self.checkpoint_path.read_bytes()).hexdigest()

    @property
    def model_version(self) -> str:
        prefix = "sgcc-identification" if self.task == ModelTask.RESOURCE_IDENTIFICATION else "sgcc-pv-separation"
        return f"{prefix}-{self.artifact_sha256[:12]}"

    def manifest(self) -> ModelManifest:
        checkpoint = self._checkpoint
        if self.task == ModelTask.RESOURCE_IDENTIFICATION:
            thresholds = {
                name: float(value)
                for name, value in zip(LABEL_NAMES, checkpoint["thresholds"], strict=True)
            }
            output_fields = [
                "pv.score", "pv.detected", "energy_station.score",
                "energy_station.detected", "charger.score", "charger.detected",
            ]
        else:
            thresholds = {
                "pv_activity": float(checkpoint["activity_probability_threshold"]),
                "pv_power_gate": float(checkpoint["power_gate_threshold"]),
            }
            output_fields = ["pv_generation_kw", "pv_activity_probability"]
        trained_at = datetime.fromtimestamp(
            self.checkpoint_path.stat().st_mtime, tz=timezone.utc
        )
        return ModelManifest(
            model_id=f"current-sgcc-{self.task.value}",
            task=self.task,
            model_version=self.model_version,
            artifact_sha256=self.artifact_sha256,
            model_type=str(checkpoint["model_name"]),
            input_schema_version="minute-point.v1",
            output_schema_version="inference-result.v1",
            required_history_minutes=self.required_history_minutes,
            input_fields=[
                "station_id", "event_time", "active_power_kw",
                "phase_a_power_kw", "phase_b_power_kw", "phase_c_power_kw",
                "coverage_ratio", "quality_flag", "source_id",
            ],
            output_fields=output_fields,
            thresholds=thresholds,
            trained_at=trained_at,
            loaded_at=self.loaded_at,
            runtime_version=f"python-{platform.python_version()}/torch-{torch.__version__}",
            health_status="ready" if self._failure is None else "failed",
            limitations=LIMITATIONS,
        )

    def health(self) -> ModelHealth:
        return ModelHealth(
            task=self.task,
            status="ready" if self._failure is None and self._model is not None else "failed",
            loaded_at=self.loaded_at if self._model is not None else None,
            message=self._failure,
        )

    def _window(self, frame: pd.DataFrame, target_time: datetime) -> pd.DataFrame:
        target = pd.Timestamp(target_time)
        matches = np.flatnonzero((frame["minute_start"] == target).to_numpy())
        if len(matches) != 1:
            raise WindowUnavailable("target_not_available", "target minute is not available after quality repair")
        end = int(matches[0])
        if int(frame.iloc[end]["is_interpolated"]) != 0:
            raise WindowUnavailable("interpolated_target", "target minute cannot be an interpolated value")
        start = end - self.required_history_minutes + 1
        if start < 0:
            raise WindowUnavailable(
                "insufficient_history",
                f"{self.required_history_minutes} minutes of history are required",
            )
        window = frame.iloc[start : end + 1].copy()
        intervals = window["minute_start"].diff().dropna()
        if not (intervals == pd.Timedelta(minutes=1)).all():
            raise WindowUnavailable("discontinuous_window", "history window is not continuous")
        return window

    def infer(self, frame: pd.DataFrame, target_time: datetime) -> TaskInference:
        if self._model is None:
            raise RuntimeError("model is not loaded")
        window = self._window(frame, target_time)
        checkpoint = self._checkpoint
        if self.task == ModelTask.RESOURCE_IDENTIFICATION:
            raw = self._recognition_predict.build_features(window)
            mean = np.asarray(checkpoint["feature_mean"], dtype=np.float32)
            std = np.asarray(checkpoint["feature_std"], dtype=np.float32)
            normalized = (raw - mean.reshape(1, -1)) / std.reshape(1, -1)
            tensor = torch.from_numpy(normalized.astype(np.float32)).transpose(0, 1).unsqueeze(0).to(self.device)
            with torch.no_grad():
                probabilities = torch.sigmoid(self._model(tensor)).cpu().numpy()[0]
            thresholds = np.asarray(checkpoint["thresholds"], dtype=np.float32)
            detected = probabilities >= thresholds
            values: dict[str, float | bool] = {}
            for index, name in enumerate(LABEL_NAMES):
                values[f"{name}.score"] = float(probabilities[index])
                values[f"{name}.detected"] = bool(detected[index])
        else:
            raw = self._separation_predict.build_features(window)
            mean = np.asarray(checkpoint["feature_mean"], dtype=np.float32)
            std = np.asarray(checkpoint["feature_std"], dtype=np.float32)
            normalized = (raw - mean.reshape(1, -1)) / std.reshape(1, -1)
            tensor = torch.from_numpy(normalized.astype(np.float32)).transpose(0, 1).unsqueeze(0).to(self.device)
            with torch.no_grad():
                activity_logits, magnitude_raw = self._model(tensor)
                probability = torch.sigmoid(activity_logits)
                raw_generation = probability * functional.softplus(magnitude_raw) * float(checkpoint["target_scale_kw"])
            probability_value = float(probability.cpu().item())
            generation = float(raw_generation.cpu().item())
            if probability_value < float(checkpoint["power_gate_threshold"]):
                generation = 0.0
            values = {
                "pv_generation_kw": max(generation, 0.0),
                "pv_activity_probability": probability_value,
            }
        return TaskInference(
            window_start=window.iloc[0]["minute_start"].to_pydatetime(),
            window_end=window.iloc[-1]["minute_start"].to_pydatetime(),
            interpolated_minutes=int(window["is_interpolated"].sum()),
            values=values,
            model_version=self.model_version,
        )


class InferenceCoordinator:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.recognition = CurrentSgccModelRunner(
            ModelTask.RESOURCE_IDENTIFICATION,
            settings.recognition_checkpoint,
            settings.sgcc_project_dir,
            settings.device,
        )
        self.separation = CurrentSgccModelRunner(
            ModelTask.PV_SEPARATION,
            settings.separation_checkpoint,
            settings.sgcc_project_dir,
            settings.device,
        )
        if (
            self.recognition.min_coverage_ratio != self.separation.min_coverage_ratio
            or self.recognition.max_interpolation_gap_minutes
            != self.separation.max_interpolation_gap_minutes
        ):
            raise ModelContractError(
                "recognition and separation preprocessing quality policies do not match"
            )
        self._interpolate = self.recognition._recognition_predict.interpolate_minute_gaps
        metrics.gauge("model_loaded", 1, {"task": self.recognition.task.value})
        metrics.gauge("model_loaded", 1, {"task": self.separation.task.value})

    def manifests(self) -> list[ModelManifest]:
        return [self.recognition.manifest(), self.separation.manifest()]

    def manifest(self, task: ModelTask) -> ModelManifest:
        return (self.recognition if task == ModelTask.RESOURCE_IDENTIFICATION else self.separation).manifest()

    def health(self) -> list[ModelHealth]:
        return [self.recognition.health(), self.separation.health()]

    @staticmethod
    def _to_frame(points: list[MinutePoint], target_time: datetime) -> tuple[pd.DataFrame, list[str]]:
        causal_points = [point for point in points if point.event_time <= target_time]
        warnings: list[str] = []
        if len(causal_points) < len(points):
            warnings.append("future_points_ignored")
        if not causal_points:
            raise WindowUnavailable("target_not_available", "no causal points are available")
        offsets = {point.event_time.utcoffset() for point in causal_points}
        if len(offsets) != 1 or target_time.utcoffset() not in offsets:
            raise WindowUnavailable("mixed_timezones", "all points and target_time must use one UTC offset")
        original_times = [point.event_time for point in causal_points]
        if original_times != sorted(original_times):
            warnings.append("input_points_out_of_order")
        rows = []
        for point in sorted(causal_points, key=lambda item: item.event_time):
            coverage = 0.0 if point.quality_flag == QualityFlag.MISSING else point.coverage_ratio
            rows.append(
                {
                    "minute_start": point.event_time,
                    "active_power_kw": point.active_power_kw,
                    "phase_a_power_w": point.phase_a_power_kw * 1000.0,
                    "phase_b_power_w": point.phase_b_power_kw * 1000.0,
                    "phase_c_power_w": point.phase_c_power_kw * 1000.0,
                    "coverage_ratio": coverage,
                }
            )
            if point.quality_flag == QualityFlag.WARNING:
                warnings.append("quality_warning")
        return pd.DataFrame(rows), list(dict.fromkeys(warnings))

    def infer(self, request: InferenceRequest) -> InferenceResult:
        started = time.perf_counter()
        warnings: list[str] = []
        task_results: dict[ModelTask, TaskInference] = {}
        unavailable: dict[ModelTask, WindowUnavailable] = {}
        try:
            source_frame, warnings = self._to_frame(request.points, request.target_time)
            frame = self._interpolate(
                source_frame,
                min_coverage_ratio=self.recognition.min_coverage_ratio,
                max_gap_minutes=self.recognition.max_interpolation_gap_minutes,
            )
            unfilled_minutes = int(frame.attrs["interpolation"]["unfilled_minutes"])
            for runner in (self.recognition, self.separation):
                try:
                    task_results[runner.task] = runner.infer(frame, request.target_time)
                except WindowUnavailable as exc:
                    if exc.code == "insufficient_history" and unfilled_minutes > 0:
                        exc = WindowUnavailable(
                            "discontinuous_window",
                            "required history crosses an unfilled data gap",
                        )
                    unavailable[runner.task] = exc
                    warnings.append(f"{runner.task.value}:{exc.code}")
        except WindowUnavailable as exc:
            unavailable[self.recognition.task] = exc
            unavailable[self.separation.task] = exc
            warnings.append(exc.code)

        recognition = task_results.get(ModelTask.RESOURCE_IDENTIFICATION)
        separation = task_results.get(ModelTask.PV_SEPARATION)
        if recognition is None and separation is None:
            codes = {value.code for value in unavailable.values()}
            quality = (
                QualityStatus.DISCONTINUOUS
                if "discontinuous_window" in codes
                else QualityStatus.INVALID
                if codes & {"target_not_available", "interpolated_target", "mixed_timezones"}
                else QualityStatus.INSUFFICIENT_HISTORY
            )
        elif unavailable or warnings:
            quality = QualityStatus.WARNING
        else:
            quality = QualityStatus.GOOD
        interpolated = max(
            [value.interpolated_minutes for value in task_results.values()],
            default=0,
        )
        if interpolated:
            quality = QualityStatus.WARNING
            warnings.append(f"interpolated_minutes:{interpolated}")

        recognition_values = recognition.values if recognition else {}
        separation_values = separation.values if separation else {}
        windows = [value for value in (recognition, separation) if value is not None]
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        metrics.increment("inference_requests_total", {"status": quality.value})
        metrics.gauge("inference_duration_milliseconds", elapsed_ms)
        if interpolated:
            metrics.increment("inference_interpolated_minutes_total", value=interpolated)
        return InferenceResult(
            station_id=request.station_id,
            target_time=request.target_time,
            request_id=request.request_id,
            input_window_start=min((item.window_start for item in windows), default=None),
            input_window_end=max((item.window_end for item in windows), default=None),
            recognition_window_start=recognition.window_start if recognition else None,
            separation_window_start=separation.window_start if separation else None,
            interpolated_minutes=interpolated,
            quality_status=quality,
            recognition_model_version=recognition.model_version if recognition else None,
            separation_model_version=separation.model_version if separation else None,
            pv=ResourceInference(
                score=recognition_values.get("pv_detected.score"),
                detected=recognition_values.get("pv_detected.detected"),
            ),
            energy_station=ResourceInference(
                score=recognition_values.get("energy_station_detected.score"),
                detected=recognition_values.get("energy_station_detected.detected"),
            ),
            charger=ResourceInference(
                score=recognition_values.get("charger_detected.score"),
                detected=recognition_values.get("charger_detected.detected"),
            ),
            pv_generation_kw=separation_values.get("pv_generation_kw"),
            pv_activity_probability=separation_values.get("pv_activity_probability"),
            inference_time_ms=elapsed_ms,
            warnings=list(dict.fromkeys(warnings)),
        )
