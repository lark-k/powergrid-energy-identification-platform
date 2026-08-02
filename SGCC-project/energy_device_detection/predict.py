from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

VENDOR_DIR = Path(__file__).resolve().parent / ".vendor"
if (VENDOR_DIR / "numpy").is_dir() and (VENDOR_DIR / "torch").is_dir():
    sys.path.insert(0, str(VENDOR_DIR))

import numpy as np
import pandas as pd
import torch
from torch.utils.data import DataLoader, TensorDataset

from data_pipeline import (
    DEFAULT_MAX_INTERPOLATION_GAP_MINUTES,
    DEFAULT_MIN_COVERAGE_RATIO,
    interpolate_minute_gaps,
)
from models import ModelConfig, build_model


PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_CHECKPOINT = PROJECT_DIR / "outputs" / "selected_model.pt"
PART_RE = re.compile(r"^minute_active_power_part_\d{4}\.csv$", re.IGNORECASE)
RESOURCE_DISPLAY_NAMES = {
    "pv_detected": "光伏",
    "energy_station_detected": "能源站",
    "charger_detected": "充电桩",
}


def load_input(
    input_path: Path,
    min_coverage_ratio: float,
    max_interpolation_gap_minutes: int,
) -> pd.DataFrame:
    if input_path.is_dir():
        files = sorted(
            path
            for path in input_path.glob("*.csv")
            if PART_RE.match(path.name)
        )
        if not files:
            raise FileNotFoundError(
                f"{input_path} 中没有 minute_active_power_part_*.csv"
            )
    elif input_path.suffix.lower() == ".csv":
        files = [input_path]
    else:
        raise ValueError("输入必须是分片 CSV 文件夹或单个 CSV 文件")

    data = pd.concat(
        [pd.read_csv(path) for path in files],
        ignore_index=True,
    )
    required = {
        "minute_start",
        "active_power_kw",
        "phase_a_power_w",
        "phase_b_power_w",
        "phase_c_power_w",
        "coverage_ratio",
    }
    missing = required - set(data.columns)
    if missing:
        raise ValueError(f"输入缺少字段：{sorted(missing)}")
    data["minute_start"] = pd.to_datetime(data["minute_start"], errors="raise")
    return interpolate_minute_gaps(
        data,
        min_coverage_ratio=min_coverage_ratio,
        max_gap_minutes=max_interpolation_gap_minutes,
    )


def contiguous_starts(
    times: np.ndarray,
    window_size: int,
    stride: int,
) -> np.ndarray:
    times_ns = times.astype("datetime64[ns]").astype(np.int64)
    if len(times_ns) < window_size:
        return np.empty(0, dtype=np.int64)
    good_edge = np.diff(times_ns) == 60_000_000_000
    bad_prefix = np.concatenate(
        [[0], np.cumsum((~good_edge).astype(np.int64))]
    )
    starts = []
    for start in range(0, len(times_ns) - window_size + 1, stride):
        end = start + window_size
        if bad_prefix[end - 1] - bad_prefix[start] == 0:
            starts.append(start)
    return np.asarray(starts, dtype=np.int64)


def build_features(data: pd.DataFrame) -> np.ndarray:
    return np.column_stack(
        [
            data["active_power_kw"].to_numpy(dtype=np.float32),
            data["phase_a_power_w"].to_numpy(dtype=np.float32) / 1000.0,
            data["phase_b_power_w"].to_numpy(dtype=np.float32) / 1000.0,
            data["phase_c_power_w"].to_numpy(dtype=np.float32) / 1000.0,
        ]
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run causal current-minute multi-label resource identification."
        )
    )
    parser.add_argument("input", type=Path)
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=DEFAULT_CHECKPOINT,
    )
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--stride", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument(
        "--min-coverage-ratio",
        type=float,
        default=None,
        help=(
            "Override checkpoint minute-coverage threshold. "
            "Default: use checkpoint, falling back to 0.1."
        ),
    )
    parser.add_argument(
        "--max-interpolation-gap-minutes",
        type=int,
        default=None,
        help=(
            "Override checkpoint maximum bounded gap filled by linear "
            "interpolation. Default: checkpoint, falling back to 3."
        ),
    )
    parser.add_argument(
        "--latest-only",
        action="store_true",
        help="Only identify the latest arrived minute.",
    )
    parser.add_argument(
        "--last-n",
        type=int,
        default=None,
        help="Only output the latest N valid minute windows.",
    )
    parser.add_argument(
        "--target-start",
        type=str,
        default=None,
        help="Only output target minutes at or after this timestamp.",
    )
    parser.add_argument(
        "--target-end",
        type=str,
        default=None,
        help="Only output target minutes at or before this timestamp.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    checkpoint = torch.load(
        args.checkpoint,
        map_location="cpu",
        weights_only=False,
    )
    config = ModelConfig.from_dict(checkpoint["model_config"])
    model = build_model(checkpoint["model_name"], config)
    model.load_state_dict(checkpoint["model_state_dict"])
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = model.to(device).eval()

    min_coverage_ratio = (
        float(args.min_coverage_ratio)
        if args.min_coverage_ratio is not None
        else float(
            checkpoint.get(
                "min_coverage_ratio",
                DEFAULT_MIN_COVERAGE_RATIO,
            )
        )
    )
    max_interpolation_gap_minutes = (
        int(args.max_interpolation_gap_minutes)
        if args.max_interpolation_gap_minutes is not None
        else int(
            checkpoint.get(
                "max_interpolation_gap_minutes",
                DEFAULT_MAX_INTERPOLATION_GAP_MINUTES,
            )
        )
    )
    data = load_input(
        args.input,
        min_coverage_ratio,
        max_interpolation_gap_minutes,
    )
    window_size = int(checkpoint["window_size"])
    starts = contiguous_starts(
        data["minute_start"].to_numpy(),
        window_size,
        1 if args.latest_only else args.stride,
    )
    end_rows = starts + window_size - 1
    starts = starts[
        data.loc[
            end_rows,
            "is_interpolated",
        ].to_numpy(dtype=np.int8)
        == 0
    ]
    if len(starts) == 0:
        raise ValueError(
            f"没有长度为 {window_size} 分钟的连续数据窗口"
        )
    if args.latest_only and (
        args.target_start is not None or args.target_end is not None
    ):
        raise ValueError(
            "--latest-only 不能与 --target-start/--target-end 同时使用"
        )
    target_minutes = data.loc[
        starts + window_size - 1,
        "minute_start",
    ].reset_index(drop=True)
    target_mask = np.ones(len(starts), dtype=bool)
    if args.target_start is not None:
        target_mask &= (
            target_minutes >= pd.Timestamp(args.target_start)
        ).to_numpy()
    if args.target_end is not None:
        target_mask &= (
            target_minutes <= pd.Timestamp(args.target_end)
        ).to_numpy()
    starts = starts[target_mask]
    if len(starts) == 0:
        raise ValueError("指定目标时间范围内没有有效推理窗口")
    if args.latest_only and args.last_n is not None:
        raise ValueError("--latest-only 与 --last-n 不能同时使用")
    if args.last_n is not None:
        if args.last_n <= 0:
            raise ValueError("--last-n 必须为正整数")
        if len(starts) < args.last_n:
            raise ValueError(
                f"只有 {len(starts)} 个有效窗口，少于请求的 "
                f"{args.last_n} 个"
            )
        starts = starts[-args.last_n :]
    if args.latest_only:
        source_last_minute = pd.Timestamp(
            data.attrs["interpolation"]["source_last_minute"]
        )
        if data["minute_start"].iloc[-1] != source_last_minute:
            raise ValueError(
                "最新原始分钟缺失或覆盖率过低，尚无右侧锚点可做 "
                "线性插值；请等待下一分钟数据后再回补"
            )
        if starts[-1] + window_size != len(data):
            raise ValueError(
                "最新一分钟之前没有完整连续的 "
                f"{window_size} 分钟窗口，拒绝返回较早分钟的陈旧辨识结果"
            )
        starts = starts[-1:]

    raw = build_features(data)
    mean = np.asarray(checkpoint["feature_mean"], dtype=np.float32)
    std = np.asarray(checkpoint["feature_std"], dtype=np.float32)
    normalized = (raw - mean.reshape(1, -1)) / std.reshape(1, -1)
    windows = np.stack(
        [normalized[start : start + window_size] for start in starts],
        axis=0,
    ).astype(np.float32)
    loader = DataLoader(
        TensorDataset(
            torch.from_numpy(windows).permute(0, 2, 1).contiguous()
        ),
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=0,
        pin_memory=device.type == "cuda",
    )

    probabilities = []
    with torch.no_grad():
        for (features,) in loader:
            logits = model(features.to(device, non_blocking=True))
            probabilities.append(torch.sigmoid(logits).cpu().numpy())
    probabilities_array = np.concatenate(probabilities, axis=0)
    thresholds = np.asarray(checkpoint["thresholds"], dtype=np.float32)
    detections = probabilities_array >= thresholds.reshape(1, -1)
    label_names = list(checkpoint["label_names"])

    output = pd.DataFrame(
        {
            "目标分钟": data.loc[
                starts + window_size - 1,
                "minute_start",
            ].to_numpy(),
            "窗口开始时间": data.loc[starts, "minute_start"].to_numpy(),
            "窗口结束时间": data.loc[
                starts + window_size - 1,
                "minute_start",
            ].to_numpy(),
            "窗口内插值分钟数": [
                int(
                    data.loc[
                        start : start + window_size - 1,
                        "is_interpolated",
                    ].sum()
                )
                for start in starts
            ],
        }
    )
    for index, label in enumerate(label_names):
        if label not in RESOURCE_DISPLAY_NAMES:
            raise ValueError(f"检查点包含未定义中文表头的标签：{label}")
        resource_name = RESOURCE_DISPLAY_NAMES[label]
        output[f"{resource_name}运行概率"] = probabilities_array[:, index]
        output[f"{resource_name}运行状态"] = detections[:, index].astype(
            np.int8
        )

    output_path = args.output
    if output_path is None:
        base_dir = args.input if args.input.is_dir() else args.input.parent
        output_path = base_dir / "device_detection_predictions.csv"
    output.to_csv(output_path, index=False, encoding="utf-8-sig")
    print(
        f"model={checkpoint['model_name']} windows={len(output)} "
        f"latest={output['目标分钟'].iloc[-1]} output={output_path}"
    )


if __name__ == "__main__":
    main()
