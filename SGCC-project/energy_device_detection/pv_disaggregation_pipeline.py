from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from data_pipeline import (
    ARTIFACT_DIR,
    DEFAULT_MAX_INTERPOLATION_GAP_MINUTES,
    DEFAULT_MIN_COVERAGE_RATIO,
    FOLDERS,
    align_main_components,
    contiguous_starts,
    load_parts,
    slice_without_boundary_overlap,
    validate_max_interpolation_gap,
    validate_min_coverage_ratio,
    validate_power_profile_role,
)


FEATURE_NAMES = [
    "active_power_kw",
    "phase_a_power_kw",
    "phase_b_power_kw",
    "phase_c_power_kw",
    "active_power_delta_1m_kw",
    "minute_of_day_sin",
    "minute_of_day_cos",
]


def build_frame(
    main_folder_key: str,
    pv_folder_key: str,
    energy_station_folder_key: str,
    active_threshold_kw: float,
    min_coverage_ratio: float,
    max_interpolation_gap_minutes: int,
) -> pd.DataFrame:
    main_data = load_parts(FOLDERS[main_folder_key])
    pv_data = load_parts(FOLDERS[pv_folder_key])
    energy_station_data = load_parts(FOLDERS[energy_station_folder_key])
    role_audit = {
        main_folder_key: validate_power_profile_role(
            main_data,
            "aggregate_main",
            FOLDERS[main_folder_key],
        ),
        pv_folder_key: validate_power_profile_role(
            pv_data,
            "photovoltaic",
            FOLDERS[pv_folder_key],
        ),
        energy_station_folder_key: validate_power_profile_role(
            energy_station_data,
            "energy_station_feeder",
            FOLDERS[energy_station_folder_key],
        ),
    }
    aligned = align_main_components(
        main_data,
        pv_data,
        energy_station_data,
        min_coverage_ratio=min_coverage_ratio,
        max_interpolation_gap_minutes=max_interpolation_gap_minutes,
    )
    frame = pd.DataFrame({"minute_start": aligned["minute_start"]})
    frame["active_power_kw"] = aligned["main__active_power_kw"]
    for phase in ("a", "b", "c"):
        frame[f"phase_{phase}_power_kw"] = aligned[
            f"main__phase_{phase}_power_kw"
        ]
    one_minute_from_previous = (
        frame["minute_start"].diff() == pd.Timedelta(minutes=1)
    )
    frame["active_power_delta_1m_kw"] = frame[
        "active_power_kw"
    ].diff().where(one_minute_from_previous, 0.0)
    minute_of_day = (
        frame["minute_start"].dt.hour * 60
        + frame["minute_start"].dt.minute
    ).to_numpy()
    angle = 2 * np.pi * minute_of_day / 1440.0
    frame["minute_of_day_sin"] = np.sin(angle)
    frame["minute_of_day_cos"] = np.cos(angle)
    frame["pv_power_kw"] = aligned["pv__active_power_kw"].astype(np.float32)
    frame["pv_generation_kw"] = np.maximum(
        -frame["pv_power_kw"].to_numpy(dtype=np.float32),
        0.0,
    )
    frame["pv_active"] = (
        frame["pv_generation_kw"] >= active_threshold_kw
    ).astype(np.float32)
    frame["main_is_interpolated"] = aligned[
        "main__is_interpolated"
    ].astype(np.int8)
    frame["pv_is_interpolated"] = aligned[
        "pv__is_interpolated"
    ].astype(np.int8)
    frame["target_is_original"] = (
        (frame["main_is_interpolated"] == 0)
        & (frame["pv_is_interpolated"] == 0)
    ).astype(np.int8)
    frame.attrs["interpolation"] = aligned.attrs["interpolation"]
    frame.attrs["role_audit"] = role_audit
    return frame


def make_windows(
    frame: pd.DataFrame,
    window_size: int,
    stride: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    starts = contiguous_starts(
        frame["minute_start"].to_numpy(),
        window_size,
        stride,
    )
    end_rows = starts + window_size - 1
    starts = starts[
        frame.loc[
            end_rows,
            "target_is_original",
        ].to_numpy(dtype=np.int8)
        == 1
    ]
    features = frame[FEATURE_NAMES].to_numpy(dtype=np.float32, copy=True)
    generation = frame["pv_generation_kw"].to_numpy(dtype=np.float32)
    active = frame["pv_active"].to_numpy(dtype=np.float32)
    x = np.stack(
        [features[start : start + window_size] for start in starts],
        axis=0,
    )
    end_rows = starts + window_size - 1
    end_times = (
        frame.loc[end_rows, "minute_start"]
        .to_numpy(dtype="datetime64[ns]")
        .astype(np.int64)
    )
    return x, generation[end_rows], active[end_rows], end_times


def split_summary(
    name: str,
    x: np.ndarray,
    y_power: np.ndarray,
    y_active: np.ndarray,
    end_times: np.ndarray,
) -> dict:
    return {
        "name": name,
        "samples": int(len(x)),
        "shape": [int(value) for value in x.shape],
        "first_target_minute": str(
            np.datetime64(int(end_times.min()), "ns")
        ),
        "last_target_minute": str(
            np.datetime64(int(end_times.max()), "ns")
        ),
        "active_rate": float(y_active.mean()),
        "generation_kw_mean": float(y_power.mean()),
        "generation_kw_active_mean": float(y_power[y_active > 0].mean()),
        "generation_kw_max": float(y_power.max()),
    }


def build_dataset(
    output_path: Path,
    window_size: int = 240,
    train_stride: int = 1,
    evaluation_stride: int = 1,
    active_threshold_kw: float = 0.5,
    min_coverage_ratio: float = DEFAULT_MIN_COVERAGE_RATIO,
    max_interpolation_gap_minutes: int = (
        DEFAULT_MAX_INTERPOLATION_GAP_MINUTES
    ),
    seed: int = 20260729,
) -> dict:
    validate_min_coverage_ratio(min_coverage_ratio)
    validate_max_interpolation_gap(max_interpolation_gap_minutes)
    train_frame = build_frame(
        "main_a",
        "pv_a",
        "energy_station_a",
        active_threshold_kw,
        min_coverage_ratio,
        max_interpolation_gap_minutes,
    )
    later_frame = build_frame(
        "main_b",
        "pv_b",
        "energy_station_b",
        active_threshold_kw,
        min_coverage_ratio,
        max_interpolation_gap_minutes,
    )
    validation_frame, test_frame = slice_without_boundary_overlap(
        later_frame,
        first_fraction=0.4,
        buffer_fraction=0.2,
    )

    x_train, y_power_train, y_active_train, end_time_train = make_windows(
        train_frame,
        window_size,
        train_stride,
    )
    x_val, y_power_val, y_active_val, end_time_val = make_windows(
        validation_frame,
        window_size,
        evaluation_stride,
    )
    x_test, y_power_test, y_active_test, end_time_test = make_windows(
        test_frame,
        window_size,
        evaluation_stride,
    )

    raw_training_features = train_frame[FEATURE_NAMES].to_numpy(
        dtype=np.float32
    )
    feature_mean = raw_training_features.mean(axis=0, dtype=np.float64).astype(
        np.float32
    )
    feature_std = raw_training_features.std(axis=0, dtype=np.float64).astype(
        np.float32
    )
    feature_std = np.maximum(feature_std, np.float32(1e-6))
    for values in (x_train, x_val, x_test):
        values -= feature_mean.reshape(1, 1, -1)
        values /= feature_std.reshape(1, 1, -1)

    active_generation = y_power_train[y_active_train > 0]
    target_scale_kw = np.float32(
        max(np.quantile(active_generation, 0.99), 1.0)
    )

    for name, values in {
        "x_train": x_train,
        "x_val": x_val,
        "x_test": x_test,
        "y_power_train": y_power_train,
        "y_power_val": y_power_val,
        "y_power_test": y_power_test,
    }.items():
        if not np.isfinite(values).all():
            raise ValueError(f"{name} 中出现 NaN 或无穷值")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        output_path,
        x_train=x_train.astype(np.float32),
        y_power_train=y_power_train.astype(np.float32),
        y_active_train=y_active_train.astype(np.float32),
        end_time_train=end_time_train,
        x_val=x_val.astype(np.float32),
        y_power_val=y_power_val.astype(np.float32),
        y_active_val=y_active_val.astype(np.float32),
        end_time_val=end_time_val,
        x_test=x_test.astype(np.float32),
        y_power_test=y_power_test.astype(np.float32),
        y_active_test=y_active_test.astype(np.float32),
        end_time_test=end_time_test,
        feature_mean=feature_mean,
        feature_std=feature_std,
        feature_names=np.asarray(FEATURE_NAMES),
        target_scale_kw=np.asarray(target_scale_kw),
        active_threshold_kw=np.asarray(
            active_threshold_kw,
            dtype=np.float32,
        ),
        min_coverage_ratio=np.asarray(
            min_coverage_ratio,
            dtype=np.float32,
        ),
        max_interpolation_gap_minutes=np.asarray(
            max_interpolation_gap_minutes,
            dtype=np.int32,
        ),
    )

    metadata = {
        "dataset_path": str(output_path),
        "seed": seed,
        "task": (
            "same-minute causal sequence-to-point PV disaggregation; "
            "the separated value at t uses observations from t-239 through t "
            "and is not a future forecast"
        ),
        "window_size_minutes": window_size,
        "train_stride_minutes": train_stride,
        "evaluation_stride_minutes": evaluation_stride,
        "active_threshold_kw": active_threshold_kw,
        "min_coverage_ratio": min_coverage_ratio,
        "max_interpolation_gap_minutes": max_interpolation_gap_minutes,
        "target": {
            "training_target": "max(-pv_active_power_kw, 0)",
            "output_conversion": (
                "separated_pv_active_power_kw = "
                "-separated_pv_generation_kw"
            ),
            "target_scale_kw": float(target_scale_kw),
        },
        "feature_names": FEATURE_NAMES,
        "role_audit": {
            "train": train_frame.attrs["role_audit"],
            "validation_and_test": later_frame.attrs["role_audit"],
        },
        "normalization": {
            "mean": {
                name: float(feature_mean[index])
                for index, name in enumerate(FEATURE_NAMES)
            },
            "std": {
                name: float(feature_std[index])
                for index, name in enumerate(FEATURE_NAMES)
            },
        },
        "periods": {
            "train": {
                "source": (
                    "202511050004 总开 + 202511050001 光伏 "
                    "+ 202511250005 能源站"
                ),
                "rows": int(len(train_frame)),
                "first": str(train_frame["minute_start"].min()),
                "last": str(train_frame["minute_start"].max()),
                "interpolation": train_frame.attrs["interpolation"],
            },
            "validation_and_test": {
                "source": (
                    "台区数据总开0 + 台区数据光伏0 + 台区数据能源站0"
                ),
                "rows": int(len(later_frame)),
                "first": str(later_frame["minute_start"].min()),
                "last": str(later_frame["minute_start"].max()),
                "interpolation": later_frame.attrs["interpolation"],
                "split": (
                    "first 40% validation, middle 20% buffer, "
                    "last 40% test"
                ),
            },
        },
        "splits": [
            split_summary(
                "train",
                x_train,
                y_power_train,
                y_active_train,
                end_time_train,
            ),
            split_summary(
                "validation",
                x_val,
                y_power_val,
                y_active_val,
                end_time_val,
            ),
            split_summary(
                "test",
                x_test,
                y_power_test,
                y_active_test,
                end_time_test,
            ),
        ],
        "known_limitations": [
            "Only two acquisition periods from one project are available.",
            "Total-only PV separation is not uniquely identifiable when PV, energy station, charger, and other loads change simultaneously.",
            "Charger-feeder data starts after the synchronized main/PV/energy-station periods; timestamp overlap is zero, so charger interference is neither trained nor validated.",
            "Missing minutes and minutes below the configured coverage ratio are linearly interpolated only when the bounded gap does not exceed the configured limit.",
            "PV targets must have original main and PV readings; interpolated target minutes are excluded to preserve causal evaluation.",
            "Partially covered minutes at or above the configured threshold retain the mean of their available raw samples.",
            "No irradiance, weather, or seasonal coverage is available.",
        ],
    }
    metadata_path = output_path.with_name(
        "pv_disaggregation_dataset_metadata.json"
    )
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return metadata


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build causal minute-level PV disaggregation dataset."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=ARTIFACT_DIR / "pv_disaggregation_dataset.npz",
    )
    parser.add_argument("--window-size", type=int, default=240)
    parser.add_argument("--train-stride", type=int, default=1)
    parser.add_argument("--evaluation-stride", type=int, default=1)
    parser.add_argument("--active-threshold-kw", type=float, default=0.5)
    parser.add_argument(
        "--min-coverage-ratio",
        type=float,
        default=DEFAULT_MIN_COVERAGE_RATIO,
        help=(
            "Treat aligned source rows below this coverage as missing before "
            "interpolation. Default: 0.1"
        ),
    )
    parser.add_argument(
        "--max-interpolation-gap-minutes",
        type=int,
        default=DEFAULT_MAX_INTERPOLATION_GAP_MINUTES,
        help=(
            "Maximum bounded missing run filled by linear interpolation. "
            "Default: 3"
        ),
    )
    parser.add_argument("--seed", type=int, default=20260729)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    metadata = build_dataset(
        output_path=args.output,
        window_size=args.window_size,
        train_stride=args.train_stride,
        evaluation_stride=args.evaluation_stride,
        active_threshold_kw=args.active_threshold_kw,
        min_coverage_ratio=args.min_coverage_ratio,
        max_interpolation_gap_minutes=(
            args.max_interpolation_gap_minutes
        ),
        seed=args.seed,
    )
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
