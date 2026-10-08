"""A single-worker runtime with immutable inference snapshots and durable selection."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import tempfile
from pathlib import Path
from threading import RLock

import torch

from .config import Settings
from .runner import CurrentSgccModelRunner, InferenceCoordinator, ModelContractError
from .schemas import ModelTask
from .formal_runner import load_runner, artifact_digest


class ModelSwitchError(RuntimeError):
    def __init__(self, code: str, message: str, status: int = 409):
        super().__init__(message)
        self.code, self.status = code, status


class ModelVersions:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._lock = RLock()
        self._current = InferenceCoordinator(settings)
        self._runners = {r.model_version: r for r in (self._current.recognition, self._current.separation)}
        self._entries: dict[str, dict] = {}
        self._previous: dict[str, str | None] = {task.value: None for task in ModelTask}
        self._refresh()
        for runner in (self._current.recognition, self._current.separation):
            self._require_runner(runner.task, runner.model_version)
        path = settings.active_state_path
        if path and path.is_file():
            state = json.loads(path.read_text(encoding="utf-8"))
            restored = self._current
            for task in ModelTask:
                version = state["active"][task.value]
                restored = self._with_runner(restored, task, self._require_runner(task, version))
            self._current = restored
            self._previous.update(state.get("previous", {}))

    def _refresh(self):
        base = self.settings.sgcc_project_dir / "energy_device_detection"
        paths: dict[Path, ModelTask] = {
            self.settings.recognition_checkpoint: ModelTask.RESOURCE_IDENTIFICATION,
            self.settings.separation_checkpoint: ModelTask.PV_SEPARATION,
            base / "outputs" / "selected_model.pt": ModelTask.RESOURCE_IDENTIFICATION,
            base / "pv_outputs" / "selected_pv_model.pt": ModelTask.PV_SEPARATION,
        }
        bundled = Path(__file__).resolve().parents[1] / "artifacts" / "formal-v1"
        for task, name in ((ModelTask.RESOURCE_IDENTIFICATION, "RESOURCE_TCN_LSTM.pt"), (ModelTask.PV_SEPARATION, "PV_TCN_LSTM.pt")):
            if (bundled / name).is_file():
                paths[bundled / name] = task
        for task, folder in ((ModelTask.RESOURCE_IDENTIFICATION, "outputs"), (ModelTask.PV_SEPARATION, "pv_outputs")):
            for p in (base / folder).glob("*_checkpoint.pt"):
                paths[p] = task
            # Additional artifacts live in task-specific server-managed directories.
            if self.settings.catalog_dir:
                for p in (self.settings.catalog_dir / task.value).rglob("*.pt"):
                    paths[p] = task
        for p in (bundled.parent / "pv-v3").glob("*.pt"):
            paths[p] = ModelTask.PV_SEPARATION
        for path, task in paths.items():
            if not path.is_file():
                continue
            try:
                digest = artifact_digest(path)
            except OSError:
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
            prefix = "sgcc-identification" if task == ModelTask.RESOURCE_IDENTIFICATION else "sgcc-pv-separation"
            version = f"{prefix}-{digest[:12]}"
            if version in self._entries:
                continue
            entry = dict(task=task.value, model_version=version, artifact_sha256=digest,
                         artifact_name=path.name, status="ready", reason=None, manifest=None)
            try:
                runner = self._runners.get(version) or load_runner(
                    task, path, self.settings.sgcc_project_dir, self.settings.device)
                if runner.artifact_sha256 != digest:
                    raise ModelContractError("artifact changed during loading; retry discovery")
                # Verify actual weights and output before a version can become active.
                if not all(torch.isfinite(t).all().item() for t in runner._model.state_dict().values()):
                    raise ModelContractError("model weights contain non-finite values")
                with torch.inference_mode():
                    output = runner._model(torch.zeros(
                        1, runner.input_channels if hasattr(runner, "input_channels") else len(runner._checkpoint["feature_names"]), runner.required_history_minutes,
                        device=runner.device))
                tensors = output if isinstance(output, tuple) else (output,)
                expected = [(1, 3)] if task == ModelTask.RESOURCE_IDENTIFICATION else [(1,), (1,)]
                if [tuple(t.shape) for t in tensors] != expected or not all(torch.isfinite(t).all().item() for t in tensors):
                    raise ModelContractError("model output shape or values are invalid")
                entry["manifest"] = runner.manifest().model_dump(mode="json")
                self._runners[version] = runner
            except Exception as exc:
                entry.update(status="incompatible", reason=str(exc))
            self._entries[version] = entry
        # Loaded versions stay available for rollback even if their source file was removed.
        for version, runner in self._runners.items():
            self._entries.setdefault(version, dict(
                task=runner.task.value, model_version=version, artifact_sha256=runner.artifact_sha256,
                artifact_name=runner.checkpoint_path.name, status="ready", reason=None,
                manifest=runner.manifest().model_dump(mode="json")))

    def catalog(self):
        with self._lock:
            self._refresh()
            return dict(active=self._active(self._current), previous=dict(self._previous),
                        models=list(self._entries.values()))

    @staticmethod
    def _active(coordinator):
        return {r.task.value: r.model_version for r in (coordinator.recognition, coordinator.separation)}

    def _require_runner(self, task, version):
        runner = self._runners.get(version)
        entry = self._entries.get(version)
        if not runner or (entry and entry["status"] != "ready"):
            raise ModelSwitchError("MODEL_INCOMPATIBLE", "模型不存在或未通过输入输出兼容性检查", 422)
        if runner.task != task:
            raise ModelSwitchError("MODEL_TASK_MISMATCH", "模型任务不匹配", 422)
        return runner

    @staticmethod
    def _with_runner(current, task, runner):
        result = copy.copy(current)
        if task == ModelTask.RESOURCE_IDENTIFICATION:
            result.recognition = runner
        else:
            result.separation = runner
        result._interpolate = result.recognition._recognition_predict.interpolate_minute_gaps
        return result

    def activate(self, task: ModelTask, version: str, expected_version: str):
        with self._lock:
            self._refresh()
            active = self._active(self._current)
            if active[task.value] != expected_version:
                raise ModelSwitchError("MODEL_VERSION_CONFLICT", "当前模型已被其他操作切换，请刷新后重试")
            if version == expected_version:
                return self.catalog()
            updated = self._with_runner(self._current, task, self._require_runner(task, version))
            previous = {**self._previous, task.value: expected_version}
            self._persist(dict(active=self._active(updated), previous=previous))
            # One reference exchange: in-flight requests retain their original model pair.
            self._current, self._previous = updated, previous
            return self.catalog()

    def _persist(self, state):
        path = self.settings.active_state_path
        if path is None:
            raise ModelSwitchError("MODEL_STATE_NOT_CONFIGURED", "未配置模型切换状态存储", 503)
        temporary = None
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as handle:
                temporary = Path(handle.name)
                json.dump(state, handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, path)
        except OSError as exc:
            raise ModelSwitchError("MODEL_STATE_WRITE_FAILED", "模型选择无法保存，原模型继续运行", 503) from exc
        finally:
            if temporary and temporary.exists():
                temporary.unlink()

    def snapshot(self):
        return self._current

    def infer(self, request):
        return self.snapshot().infer(request)

    def manifests(self):
        return self.snapshot().manifests()

    def manifest(self, task):
        return self.snapshot().manifest(task)

    def health(self):
        return self.snapshot().health()
