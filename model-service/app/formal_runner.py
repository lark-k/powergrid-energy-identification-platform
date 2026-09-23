"""Frozen formal-v1 preprocessing; independent of the legacy 4/7-channel path."""
from __future__ import annotations

import hashlib
import importlib
import io
import json
import platform
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from .runner import CurrentSgccModelRunner, ModelContractError, TaskInference, WindowUnavailable, LABEL_NAMES
from .schemas import ModelManifest, ModelTask, QualityFlag


class FormalModelRunner(CurrentSgccModelRunner):
    def _load(self, sgcc_project_dir: Path, device_name: str):
        sys.path.insert(0, str(sgcc_project_dir / "energy_device_detection"))
        self._recognition_predict = importlib.import_module("predict")
        short_task = "resource" if self.task == ModelTask.RESOURCE_IDENTIFICATION else "pv"
        root = self.checkpoint_path.parent
        self.spec = json.loads((root / f"{short_task}_manifest.json").read_text(encoding="utf-8"))
        artifact = self.checkpoint_path.read_bytes()
        self._artifact_sha256 = hashlib.sha256(artifact).hexdigest()
        self._require(self.spec["checkpoint_sha256"] == self._artifact_sha256, "formal checkpoint digest mismatch")
        self._require(self.spec["task"] == short_task, "formal task mismatch")
        normalizer_path = root / self.spec["normalizer"]
        self._require(normalizer_path.resolve().parent == root.resolve(), "normalizer must be inside model bundle")
        norm_bytes = normalizer_path.read_bytes()
        self._require(hashlib.sha256(norm_bytes).hexdigest() == self.spec["normalizer_sha256"], "normalizer digest mismatch")
        norm = json.loads(norm_bytes)
        self.fields = [f.removeprefix("main_") for f in norm["fields"]]
        self._require(len(self.fields) == 56 and self.fields == self.spec["fields"], "formal field order mismatch")
        expected_channels = ([f"main_{f}" for f in self.fields] if short_task == "pv" else self.fields) + [f"valid_{f}" for f in self.fields] + ["measurement_mask", "gap_indicator"]
        self._require(self.spec["input_channel_order"] == expected_channels, "formal channel order mismatch")
        self._require(self.spec["channels"] == 114 and self.spec["config"]["input_channels"] == 114, "formal channel count mismatch")
        self._require(self.spec["window"] == (120 if short_task == "resource" else 240), "formal window mismatch")
        self.center = np.asarray(norm["median" if short_task == "resource" else "center"], dtype=float)
        self.scale = np.asarray(norm["scale"], dtype=float)
        self.lower, self.upper = np.asarray(norm["lower"], dtype=float), np.asarray(norm["upper"], dtype=float)
        self._require(all(a.shape == (56,) and np.isfinite(a).all() for a in (self.center, self.scale, self.lower, self.upper)), "formal normalization shape/values invalid")
        self._require((self.scale > 0).all() and (self.lower <= self.upper).all(), "formal normalization bounds invalid")
        self._checkpoint = torch.load(io.BytesIO(artifact), map_location="cpu", weights_only=True)
        self._require(self._checkpoint["config"] == self.spec["config"], "formal config mismatch")
        if device_name == "auto":
            device_name = "cuda" if torch.cuda.is_available() else "cpu"
        self._require(device_name in {"cpu", "cuda"}, "invalid model device")
        self.device = torch.device(device_name)
        if short_task == "resource":
            module = importlib.import_module("models")
            self._model = module.TCNLSTMClassifier(module.ModelConfig.from_dict(self.spec["config"]))
            self.thresholds = np.asarray(self.spec["thresholds"], dtype=float)
            self._require(self.thresholds.shape == (3,) and np.isfinite(self.thresholds).all() and ((self.thresholds >= 0) & (self.thresholds <= 1)).all(), "invalid resource thresholds")
        else:
            module = importlib.import_module("pv_disaggregation_models")
            self._model = module.CausalTCNLSTMRegressor(module.PVModelConfig.from_dict(self.spec["config"]))
            self.target_scale = float(norm["target_scale"])
            self._require(np.isfinite(self.target_scale) and self.target_scale > 0 and self.target_scale == self.spec["target_scale"], "invalid target scale")
        self._model.load_state_dict(self._checkpoint["state_dict"])
        self._model.to(self.device).eval()
        # The supplied logs contain no wall-clock completion timestamp. User-assigned date.
        self._trained_at = datetime.fromisoformat("2026-09-22T00:00:00+08:00")

    @property
    def required_history_minutes(self):
        return self.spec["window"]

    @property
    def min_coverage_ratio(self):
        return .999

    @property
    def max_interpolation_gap_minutes(self):
        return 0

    def manifest(self):
        resource = self.task == ModelTask.RESOURCE_IDENTIFICATION
        return ModelManifest(
            model_id=f"formal-v1-{self.task.value}", task=self.task, model_version=self.model_version,
            artifact_sha256=self.artifact_sha256, model_type="tcn_lstm" if resource else "causal_tcn_lstm",
            input_schema_version="minute-point.v2", output_schema_version="inference-result.v1",
            required_history_minutes=self.required_history_minutes, input_fields=self.fields,
            output_fields=["pv.score", "energy_station.score", "charger.score"] if resource else ["pv_generation_kw", "pv_activity_probability"],
            thresholds=dict(zip(LABEL_NAMES, self.thresholds.tolist())) if resource else {"pv_activity": self.spec["activity_threshold"]},
            trained_at=self._trained_at, loaded_at=self.loaded_at,
            runtime_version=f"python-{platform.python_version()}/torch-{torch.__version__}", health_status="ready",
            limitations=["完成日期由用户指定为 2026-09-22，非日志时间戳。", "输入为已闭合分钟的总开56字段；缺失按掩码处理。",
                         "资源标签表示运行代理，不能等同设备存在。" if resource else "光伏训练及验证均为构造数据，真实在线精度尚未确立。"],
        )

    def encode(self, at, point):
        record = point.electrical_fields if point else {}
        valid_values = point.field_validity if point else {}
        complete = point is not None and point.coverage_ratio >= .999 and point.quality_flag != QualityFlag.MISSING
        values = np.asarray([record.get(f) if record.get(f) is not None else np.nan for f in self.fields], dtype=float)
        local = pd.Timestamp(at).tz_convert("Asia/Shanghai")
        gap = local.hour == 0 and local.minute < 15
        valid = np.isfinite(values) & complete & (not gap) & np.asarray([valid_values.get(f, True) for f in self.fields])
        normalized = (np.clip(values, self.lower, self.upper) - self.center) / self.scale
        normalized = np.where(valid, normalized, 0).astype(np.float32)
        measured = bool(valid.any()) if self.task == ModelTask.RESOURCE_IDENTIFICATION else bool(valid[0])
        return np.concatenate([normalized, valid.astype(np.float32), np.asarray([measured, gap], np.float32)])

    def infer_points(self, points, target_time):
        causal = {p.event_time: p for p in points if p.event_time <= target_time}
        if not causal:
            raise WindowUnavailable("target_not_available", "no closed main-meter minute")
        start = target_time - timedelta(minutes=self.required_history_minutes - 1)
        first = min(causal)
        # Leading padding is all zeros, identical to the supplied standalone adapter.
        rows = [self.encode(at, causal.get(at)) if at >= first else np.zeros(114, np.float32)
                for at in pd.date_range(start, target_time, freq="min")]
        window = np.asarray(rows, dtype=np.float32)
        if not window[-1, -2]:
            raise WindowUnavailable("target_not_available", "current minute lacks valid electrical fields or is in the midnight masked interval")
        tensor = torch.from_numpy(window.T[None].copy()).to(self.device)
        with torch.inference_mode():
            output = self._model(tensor)
        values = {}
        if self.task == ModelTask.RESOURCE_IDENTIFICATION:
            probs = output.sigmoid().cpu().numpy()[0]
            for name, prob, threshold in zip(LABEL_NAMES, probs, self.thresholds, strict=True):
                values[f"{name}.score"], values[f"{name}.detected"] = float(prob), bool(prob >= threshold)
        else:
            activity, magnitude = output
            probability = float(activity.sigmoid().item())
            values = {"pv_activity_probability": probability,
                      "pv_generation_kw": probability * float(torch.nn.functional.softplus(magnitude).item()) * self.target_scale}
        missing = int((window[:, 56:112] == 0).any(axis=1).sum())
        return TaskInference(start, target_time, 0, values, self.model_version,
                             [f"{self.task.value}:masked_or_padded_minutes:{missing}"] if missing else [])


def load_runner(task, path, sgcc_project_dir, device):
    short_task = "resource" if task == ModelTask.RESOURCE_IDENTIFICATION else "pv"
    runner_type = FormalModelRunner if (path.parent / f"{short_task}_manifest.json").is_file() else CurrentSgccModelRunner
    return runner_type(task, path, sgcc_project_dir, device)
