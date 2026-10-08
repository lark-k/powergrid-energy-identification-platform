"""Stateless adapter for the confirmed 01/04 S4D delivery.

All history and causal hold state belong to one request. Closed arrival minutes
are independent of the recognition model's original sampling-minute axis.
"""
from datetime import datetime, timedelta
import hashlib
import io
import json
import platform
from pathlib import Path

import numpy as np
import pandas as pd
import torch

from .runner import CurrentSgccModelRunner, TaskInference, WindowUnavailable
from .schemas import ModelManifest, ModelTask, QualityFlag
from .s4d_model import SmallCausalS4D

BUNDLE_FILES = ('pv_v3_manifest.json', 'manifest.json', 'normalizer.json')


def bundle_digest(path: Path):
    parts = [b'pv-v3-adapter.v1'] + [path.read_bytes()] + [(path.parent / name).read_bytes() for name in BUNDLE_FILES]
    return hashlib.sha256(b'\0'.join(parts)).hexdigest()


class PVV3ModelRunner(CurrentSgccModelRunner):
    input_channels = 116
    uses_arrival_minutes = True
    history_context_minutes = 244

    def _load(self, sgcc_project_dir, device_name):
        self._require(self.task == ModelTask.PV_SEPARATION, 'S4D bundle only supports PV separation')
        root = self.checkpoint_path.parent
        self.spec = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
        deployment = json.loads((root / 'pv_v3_manifest.json').read_text(encoding='utf-8'))
        self._require(deployment['schema'] == 'pv-v3-adapter.v1', 'unsupported S4D adapter schema')
        for name, digest in deployment['sha256'].items():
            self._require(name in ('manifest.json', 'normalizer.json', self.checkpoint_path.name), 'unexpected S4D bundle file')
            self._require(hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, f'S4D {name} digest mismatch')
        self._require(set(deployment['sha256']) == {'manifest.json', 'normalizer.json', self.checkpoint_path.name}, 'incomplete S4D bundle integrity manifest')
        artifact = self.checkpoint_path.read_bytes()
        norm_bytes = (root / 'normalizer.json').read_bytes()
        self._require(self.spec['checkpoints'] == [self.checkpoint_path.name] and self.spec['seeds'] == [3407], 'unsupported S4D member selection')
        self._require(hashlib.sha256(artifact).hexdigest() == self.spec['checkpoint_sha256'][self.checkpoint_path.name], 'S4D checkpoint digest mismatch')
        self._require(hashlib.sha256(norm_bytes).hexdigest() == self.spec['normalizer_sha256'], 'S4D normalizer digest mismatch')
        self.norm = json.loads(norm_bytes)
        self.fields = self.norm['fields']
        self._require(self.fields == self.spec['fields'] and len(set(self.fields)) == 56, 'S4D fields mismatch')
        channel_order = ['main_' + f for f in self.fields] + ['observed_' + f for f in self.fields] + ['measurement_mask', 'gap_indicator', 'measurement_age_scaled', 'sample_age_scaled']
        self._require(self.norm['channel_order'] == self.spec['channel_order'] == channel_order, 'S4D channel order mismatch')
        self._require(self.spec['method'] == 'small_s4d' and self.spec['window'] == 240, 'S4D method/window mismatch')
        self.center, self.scale, self.lower, self.upper = [np.asarray(self.norm[k], dtype=float) for k in ('center', 'scale', 'lower', 'upper')]
        self._require(all(a.shape == (56,) and np.isfinite(a).all() for a in (self.center, self.scale, self.lower, self.upper)), 'S4D normalizer values invalid')
        self._require((self.scale > 0).all() and (self.lower <= self.upper).all(), 'S4D normalizer bounds invalid')
        self.target_scale = float(self.norm['target_scale_kw'])
        self._require(np.isfinite(self.target_scale) and self.target_scale > 0, 'S4D target scale invalid')
        self._checkpoint = torch.load(io.BytesIO(artifact), map_location='cpu', weights_only=True)
        self._require(self._checkpoint['method'] == 'small_s4d' and self._checkpoint['seed'] == 3407, 'S4D checkpoint selection mismatch')
        config = self._checkpoint['model_config']
        self._require(config['input_channels'] == self.input_channels and 0 <= config['dropout'] < 1, 'S4D config invalid')
        if device_name == 'auto':
            device_name = 'cuda' if torch.cuda.is_available() else 'cpu'
        self._require(device_name in ('cpu', 'cuda') and (device_name != 'cuda' or torch.cuda.is_available()), 'S4D device unavailable')
        self.device = torch.device(device_name)
        self._model = SmallCausalS4D(config['input_channels'], config['dropout'])
        self._model.load_state_dict(self._checkpoint['state_dict'], strict=True)
        self._require(sum(p.numel() for p in self._model.parameters()) == self.spec['parameters'] == 9314, 'S4D parameter count mismatch')
        self._model.to(self.device).eval()
        self._artifact_sha256 = bundle_digest(self.checkpoint_path)
        # This is explicitly the supplier's delivery date, not an invented training timestamp.
        self._trained_at = datetime.fromisoformat(deployment['delivery_date'] + 'T00:00:00+08:00')

    @property
    def required_history_minutes(self):
        return 240

    def manifest(self):
        return ModelManifest(
            model_id='pv-01-04-confirmed-v3', task=self.task, model_version=self.model_version,
            artifact_sha256=self.artifact_sha256, model_type='small_s4d', input_schema_version='minute-point.v3',
            output_schema_version='inference-result.v1', required_history_minutes=240, input_fields=self.fields,
            output_fields=['pv_generation_kw', 'pv_activity_probability'], thresholds={'pv_activity': self.spec['threshold']},
            trained_at=self._trained_at, loaded_at=self.loaded_at,
            runtime_version=f'python-{platform.python_version()}/torch-{torch.__version__}', health_status='ready',
            limitations=['2026-10-08 为提供方确认/交付日期，训练完成时间未记录。',
                         '仅输入04总开56电气字段；116通道；按已闭合到达分钟推理。',
                         '01光伏分支为参考；留出为复用时间留出，未证明其他台区泛化。',
                         '00:00—00:14屏蔽，缺测仅因果保持3分钟；不可用输入返回空分离结果。'])

    def build_window(self, points, target_time):
        target = pd.Timestamp(target_time).tz_convert('Asia/Shanghai')
        start = target - pd.Timedelta(minutes=239)
        context = start - pd.Timedelta(minutes=4)
        decision = target + pd.Timedelta(minutes=1)
        candidates = []
        for point in points:
            arrival = pd.Timestamp(point.arrival_time or point.event_time).tz_convert('Asia/Shanghai')
            sample = pd.Timestamp(point.measurement_time or point.event_time).tz_convert('Asia/Shanghai')
            if arrival < decision and sample < decision:
                candidates.append((arrival, sample, point))
        self._require(len({p.source_id for _, _, p in candidates}) <= 1, 'S4D input mixes main-meter sources')
        # Stable first-arrival version per sample, then last arrival per minute.
        minutes, seen = {}, set()
        for arrival, sample, point in sorted(candidates, key=lambda item: item[0]):
            if sample in seen:
                continue
            seen.add(sample)
            minutes[arrival.floor('min')] = (arrival, sample, point)
        if not minutes:
            raise WindowUnavailable('target_not_available', 'no causal arrival-minute main-meter input')
        past = np.full(56, np.nan)
        ages = np.full(56, 10000, dtype=int)
        last_sample = last_observed = None
        rows, held, suspect_count = [], 0, 0
        first = min(minutes)
        effective_total = None
        for at in pd.date_range(context, target, freq='min'):
            if at < first:
                if at >= start:
                    rows.append(np.zeros(116, np.float32))
                continue
            entry = minutes.get(at)
            point = entry[2] if entry else None
            record = point.electrical_fields if point else {}
            raw = np.array([record.get(f) if record.get(f) is not None else np.nan for f in self.fields], float)
            voltage = raw[[self.fields.index('PhV_phs' + s) for s in 'ABC']]
            suspect = bool(np.all(np.isfinite(voltage) & (np.abs(voltage) < 1)))
            gap = at.hour == 0 and at.minute < 15
            observed = point is not None and point.coverage_ratio >= .999 and point.quality_flag != QualityFlag.MISSING
            valid = np.isfinite(raw) & observed & (not gap) & (not suspect)
            if point:
                valid &= np.array([point.field_validity.get(f, True) for f in self.fields])
            ages += 1
            past[valid] = raw[valid]
            ages[valid] = 0
            values = np.where(ages <= 3, past, np.nan)
            if gap:
                values[:] = np.nan
            z = (np.clip(values, self.lower, self.upper) - self.center) / self.scale
            z = np.where(np.isfinite(z), z, 0)
            if valid[0]:
                last_observed, last_sample = at, entry[1]
            ma = (at - last_observed).total_seconds() / 60 if last_observed is not None else 4
            sa = (at + pd.Timedelta(minutes=1) - last_sample).total_seconds() if last_sample is not None else 300
            if at >= start:
                rows.append(np.r_[z, valid, float(valid[0]), float(gap), min(4, max(0, ma))/4, min(300, max(0, sa))/300].astype(np.float32))
                held += int(not valid[0] and np.isfinite(values[0]) and not gap)
                suspect_count += int(suspect)
            if at == target:
                if not np.isfinite(values[0]) or gap:
                    raise WindowUnavailable('target_not_available', 'S4D input_available=false: midnight or main-meter missing beyond 3 minutes')
                effective_total = float(values[0])
        return np.asarray(rows, np.float32), effective_total, held, suspect_count

    def infer_points(self, points, target_time):
        window, total, held, suspect = self.build_window(points, target_time)
        with torch.inference_mode():
            activity, magnitude = self._model(torch.from_numpy(window.T[None].copy()).to(self.device))
            probability = float(activity.sigmoid().item())
            power = probability * float((torch.nn.functional.softplus(magnitude) * self.target_scale).item())
        self._require(np.isfinite(power) and np.isfinite(probability), 'S4D output is not finite')
        warnings = []
        missing = int((window[:, 56:112] == 0).any(axis=1).sum())
        if missing:
            warnings.append(f'pv_separation:masked_or_padded_minutes:{missing}')
        if held:
            warnings.append(f'pv_separation:causal_hold_minutes:{held}')
        if suspect:
            warnings.append(f'pv_separation:suspect_voltage_minutes:{suspect}')
        return TaskInference(target_time - timedelta(minutes=239), target_time, 0,
                             {'pv_generation_kw': power, 'pv_activity_probability': probability,
                              'separation_input_power_kw': total}, self.model_version, warnings)
