"""Standalone main-meter-only inference. Timestamps are minute starts in Beijing time."""
import os
os.environ.setdefault('MKL_THREADING_LAYER', 'SEQUENTIAL')
from collections import deque
import hashlib
import json
from pathlib import Path
import numpy as np
import pandas as pd
import torch
from resource_model import ModelConfig, TCNLSTMClassifier
from pv_model import PVModelConfig, CausalTCNLSTMRegressor


class FormalModel:
    def __init__(self, task, directory=None, cpu_threads=4):
        if task not in ('resource', 'pv'):
            raise ValueError('task must be resource or pv')
        self.task = task
        root = Path(directory or Path(__file__).resolve().parent)
        self.manifest = json.loads((root / f'{task}_manifest.json').read_text(encoding='utf-8'))
        for key in ('checkpoint', 'normalizer'):
            path = root / self.manifest[key]
            if hashlib.sha256(path.read_bytes()).hexdigest() != self.manifest[key + '_sha256']:
                raise ValueError(f'{key} checksum mismatch')
        self.norm = json.loads((root / self.manifest['normalizer']).read_text(encoding='utf-8'))
        self.fields = [f.removeprefix('main_') for f in self.norm['fields']]
        self.window = int(self.manifest['window'])
        self.center = np.asarray(self.norm['median' if task == 'resource' else 'center'])
        self.scale = np.asarray(self.norm['scale'])
        self.lower, self.upper = np.asarray(self.norm['lower']), np.asarray(self.norm['upper'])
        torch.set_num_threads(cpu_threads)
        if task == 'resource':
            self.model = TCNLSTMClassifier(ModelConfig.from_dict(self.manifest['config']))
            self.threshold = np.asarray(self.manifest['thresholds'])
        else:
            self.model = CausalTCNLSTMRegressor(PVModelConfig.from_dict(self.manifest['config']))
            self.threshold = self.manifest['validation_scores']['threshold']
        state = torch.load(root / self.manifest['checkpoint'], map_location='cpu', weights_only=True)
        self.model.load_state_dict(state['state_dict'])
        self.model.eval()
        self.reset()

    def reset(self):
        """Reset only when starting a different physical main meter or replay segment."""
        self.history = deque(maxlen=self.window)
        self.previous = None

    def encode(self, at, record, complete):
        # Only the frozen main electrical whitelist enters the network.
        values = np.asarray([record.get(f, record.get('main_' + f, np.nan)) for f in self.fields], dtype=float)
        gap = at.hour == 0 and at.minute < 15
        valid = np.isfinite(values) & complete & (not gap)
        z = (np.clip(values, self.lower, self.upper) - self.center) / self.scale
        z = np.where(valid, z, 0).astype(np.float32)
        measured = bool(valid.any()) if self.task == 'resource' else bool(valid[0])
        return np.concatenate([z, valid.astype(np.float32), np.asarray([measured, gap], np.float32)])

    def _advance(self, minute_start, record, coverage_ratio):
        at = pd.Timestamp(minute_start)
        if pd.isna(at):
            raise ValueError('Missing timestamp')
        if at.tzinfo is not None:
            at = at.tz_convert('Asia/Shanghai').tz_localize(None)
        if at != at.floor('min'):
            raise ValueError('Expected a natural minute start, not a packet identifier')
        if self.previous is not None:
            if at <= self.previous:
                raise ValueError('Duplicate/out-of-order minute; reset for another meter')
            first = max(self.previous + pd.Timedelta(minutes=1), at - pd.Timedelta(minutes=self.window-1))
            for missing in pd.date_range(first, at - pd.Timedelta(minutes=1), freq='min'):
                self.history.append(self.encode(missing, {}, False))
        complete = bool(record) and np.isfinite(coverage_ratio) and coverage_ratio >= .999
        self.history.append(self.encode(at, record or {}, complete))
        self.previous = at

    def window_array(self):
        if not self.history:
            return np.zeros((self.window, 114), np.float32)
        a = np.asarray(self.history, dtype=np.float32)
        return np.pad(a, ((self.window-len(a), 0), (0, 0)))

    def predict_current(self):
        if self.previous is None:
            raise ValueError('No record received')
        a = self.window_array()
        valid = bool(a[-1, -2])
        result = dict(minute_start=str(self.previous),
                      available_at=str(self.previous + pd.Timedelta(minutes=1)),
                      measurement_valid=valid,
                      status='formal_v1_demo' if valid else 'missing_measurement')
        if not valid:
            return result
        with torch.inference_mode():
            out = self.model(torch.from_numpy(a.T[None].copy()))
        if self.task == 'resource':
            p = out.sigmoid().numpy()[0]
            result.update(probabilities=dict(zip(['PV', 'ESS', 'EV'], map(float, p))),
                          flags=dict(zip(['PV', 'ESS', 'EV'], map(bool, p >= self.threshold))))
        else:
            activity, magnitude = out
            p = float(activity.sigmoid().item())
            mag = float(torch.nn.functional.softplus(magnitude).item() * self.norm['target_scale'])
            result.update(pv_activity=p, pv_active=bool(p >= self.threshold),
                          pv_magnitude_kw=mag, pv_power_kw=p*mag)
        return result

    def update(self, minute_start, record, coverage_ratio):
        """Feed a CLOSED minute. Incomplete/missing minutes advance state but emit no estimate."""
        self._advance(minute_start, record, coverage_ratio)
        return self.predict_current()


class FormalSystem:
    def __init__(self, directory=None, cpu_threads=4):
        self.models = {t: FormalModel(t, directory, cpu_threads) for t in ('resource', 'pv')}

    def reset(self):
        for model in self.models.values():
            model.reset()

    def update(self, minute_start, main_record, coverage_ratio):
        return {task: model.update(minute_start, main_record, coverage_ratio)
                for task, model in self.models.items()}


if __name__ == '__main__':
    import sys
    system = FormalSystem()
    for line in sys.stdin:
        item = json.loads(line)
        print(json.dumps(system.update(item['minute_start'], item['main'], item['coverage_ratio']),
                         ensure_ascii=False, allow_nan=False), flush=True)
