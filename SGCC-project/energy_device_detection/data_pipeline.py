from __future__ import annotations

import argparse
import itertools
import json
import re
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
PROJECT_DIR = Path(__file__).resolve().parent
ARTIFACT_DIR = PROJECT_DIR / "artifacts"

PART_RE = re.compile(r"^minute_active_power_part_\d{4}\.csv$", re.IGNORECASE)

FOLDERS = {
    "pv_a": "202511050001 光伏",
    "main_a": "202511050004 总开",
    "energy_station_a": "202511250005 能源站",
    "pv_b": "台区数据光伏0",
    "main_b": "台区数据总开0",
    "energy_station_b": "台区数据能源站0",
    "charger_pre_12": "台区数据12号",
    "charger_pre_13": "台区数据13号",
    "charger_post_12": "充电桩台区2.1-20251231-20260109-12号",
    "charger_post_13": "充电桩台区2.2-20251231-20260109-13号",
}

FEATURE_NAMES = [
    "active_power_kw",
    "phase_a_power_kw",
    "phase_b_power_kw",
    "phase_c_power_kw",
]
LABEL_NAMES = [
    "pv_detected",
    "energy_station_detected",
    "charger_detected",
]
SOURCE_NAMES = {
    0: "observed_main",
    1: "observed_charger_feeder",
    2: "synthetic_mixture",
}
DEFAULT_MIN_COVERAGE_RATIO = 0.1
DEFAULT_MAX_INTERPOLATION_GAP_MINUTES = 3
RAW_POWER_COLUMNS = [
    "active_power_kw",
    "phase_a_power_w",
    "phase_b_power_w",
    "phase_c_power_w",
]


def load_parts(folder_name: str) -> pd.DataFrame:
    folder = ROOT / folder_name
    part_files = sorted(
        path for path in folder.glob("*.csv") if PART_RE.match(path.name)
    )
    if not part_files:
        raise FileNotFoundError(f"{folder} 中没有 minute_active_power_part_*.csv")
    frames: list[pd.DataFrame] = []
    for path in part_files:
        frame = pd.read_csv(path)
        frame["_source_file"] = path.name
        frames.append(frame)
    data = pd.concat(frames, ignore_index=True)
    data["minute_start"] = pd.to_datetime(data["minute_start"], errors="raise")
    data = data.sort_values(["minute_start", "_source_file"], kind="stable")
    data = data.drop_duplicates("minute_start", keep="last")
    return data.reset_index(drop=True)


def infer_power_profile_role(data: pd.DataFrame) -> dict:
    """Infer a feeder role from its power morphology, not its folder name."""
    finite = data.loc[
        np.isfinite(data["active_power_kw"].to_numpy(dtype=float)),
        ["minute_start", "active_power_kw"],
    ].copy()
    if len(finite) < 180:
        return {
            "inferred_role": "insufficient_data",
            "rows": int(len(finite)),
        }

    power = finite["active_power_kw"].to_numpy(dtype=float)
    hours = finite["minute_start"].dt.hour.to_numpy()
    q01, q05, q25, q50, q75, q95, q99 = np.quantile(
        power,
        [0.01, 0.05, 0.25, 0.50, 0.75, 0.95, 0.99],
    )
    midday = power[(hours >= 10) & (hours < 15)]
    night = power[hours < 5]
    midday_mean = float(midday.mean()) if len(midday) else float("nan")
    night_mean = float(night.mean()) if len(night) else float("nan")
    fraction_above_1kw = float((power >= 1.0).mean())

    if (
        q05 < -2.0
        and q95 < 1.0
        and abs(night_mean) < 0.5
        and midday_mean < night_mean - 2.0
    ):
        role = "photovoltaic"
    elif q05 < -2.0 and q95 > 5.0:
        role = "aggregate_main"
    elif q01 > 0.25 and q50 > 0.5 and q95 > 5.0:
        role = "energy_station_feeder"
    elif (
        q05 > -0.5
        and abs(q50) < 0.5
        and q95 > 5.0
        and 0.05 <= fraction_above_1kw <= 0.8
    ):
        role = "charger_feeder"
    else:
        role = "unresolved"

    return {
        "inferred_role": role,
        "rows": int(len(power)),
        "q01_kw": float(q01),
        "q05_kw": float(q05),
        "q25_kw": float(q25),
        "median_kw": float(q50),
        "q75_kw": float(q75),
        "q95_kw": float(q95),
        "q99_kw": float(q99),
        "midday_mean_kw": midday_mean,
        "night_mean_kw": night_mean,
        "fraction_at_or_above_1kw": fraction_above_1kw,
    }


def validate_power_profile_role(
    data: pd.DataFrame,
    expected_role: str,
    source_name: str,
) -> dict:
    audit = infer_power_profile_role(data)
    actual_role = audit["inferred_role"]
    if actual_role != expected_role:
        raise ValueError(
            f"{source_name} 的功率形态判为 {actual_role}，"
            f"不符合预期的 {expected_role}；拒绝仅按目录名构建训练数据。"
        )
    return audit


def validate_min_coverage_ratio(min_coverage_ratio: float) -> None:
    if not 0.0 <= min_coverage_ratio <= 1.0:
        raise ValueError("min_coverage_ratio 必须位于 [0, 1]")


def validate_max_interpolation_gap(max_gap_minutes: int) -> None:
    if max_gap_minutes < 0:
        raise ValueError("max_interpolation_gap_minutes 不能为负数")


def true_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    index = 0
    while index < len(mask):
        if not mask[index]:
            index += 1
            continue
        end = index + 1
        while end < len(mask) and mask[end]:
            end += 1
        runs.append((index, end))
        index = end
    return runs


def interpolate_minute_gaps(
    data: pd.DataFrame,
    min_coverage_ratio: float = DEFAULT_MIN_COVERAGE_RATIO,
    max_gap_minutes: int = DEFAULT_MAX_INTERPOLATION_GAP_MINUTES,
) -> pd.DataFrame:
    validate_min_coverage_ratio(min_coverage_ratio)
    validate_max_interpolation_gap(max_gap_minutes)
    if data.empty:
        raise ValueError("不能对空数据执行分钟插值")

    source = (
        data.sort_values("minute_start")
        .drop_duplicates("minute_start", keep="last")
        .set_index("minute_start")
    )
    full_index = pd.date_range(
        source.index.min(),
        source.index.max(),
        freq="min",
        name="minute_start",
    )
    repaired = source.reindex(full_index)
    originally_present = pd.Series(
        full_index.isin(source.index),
        index=full_index,
    )
    original_coverage = repaired["coverage_ratio"].astype(float)
    coverage_is_finite = pd.Series(
        np.isfinite(original_coverage.to_numpy()),
        index=full_index,
    )
    power_is_finite = pd.Series(
        np.isfinite(
            repaired[RAW_POWER_COLUMNS].to_numpy(dtype=float)
        ).all(axis=1),
        index=full_index,
    )
    low_coverage = (
        originally_present
        & (
            ~coverage_is_finite
            | (original_coverage < min_coverage_ratio)
        )
    )
    invalid_power = originally_present & ~power_is_finite
    needs_interpolation = (
        (~originally_present)
        | low_coverage
        | invalid_power
    )

    fillable = np.zeros(len(repaired), dtype=bool)
    gap_lengths: list[int] = []
    for start, end in true_runs(needs_interpolation.to_numpy()):
        length = end - start
        gap_lengths.append(length)
        bounded = (
            start > 0
            and end < len(repaired)
            and not needs_interpolation.iloc[start - 1]
            and not needs_interpolation.iloc[end]
        )
        if bounded and length <= max_gap_minutes:
            fillable[start:end] = True

    power = repaired[RAW_POWER_COLUMNS].astype(float).copy()
    power.loc[needs_interpolation, :] = np.nan
    candidates = power.interpolate(
        method="time",
        limit_area="inside",
    )
    power.loc[fillable, :] = candidates.loc[fillable, :]
    repaired[RAW_POWER_COLUMNS] = power
    filled = fillable & repaired[RAW_POWER_COLUMNS].notna().all(axis=1)
    unfilled = needs_interpolation.to_numpy() & ~filled

    repaired["is_interpolated"] = filled.astype(np.int8)
    repaired["was_missing_minute"] = (
        (~originally_present).to_numpy(dtype=np.int8)
    )
    repaired["was_low_coverage"] = low_coverage.to_numpy(dtype=np.int8)
    repaired["coverage_ratio"] = original_coverage.fillna(0.0)
    repaired = repaired.loc[
        repaired[RAW_POWER_COLUMNS].notna().all(axis=1)
    ].reset_index()
    repaired.attrs["interpolation"] = {
        "rows_before_reindex": int(len(source)),
        "rows_in_full_minute_span": int(len(full_index)),
        "missing_minutes": int((~originally_present).sum()),
        "low_coverage_minutes": int(low_coverage.sum()),
        "invalid_power_minutes": int(invalid_power.sum()),
        "interpolated_minutes": int(filled.sum()),
        "unfilled_minutes": int(unfilled.sum()),
        "maximum_gap_minutes": int(max(gap_lengths, default=0)),
        "max_interpolation_gap_minutes": int(max_gap_minutes),
        "min_coverage_ratio": float(min_coverage_ratio),
        "source_first_minute": str(source.index.min()),
        "source_last_minute": str(source.index.max()),
    }
    return repaired


def feature_columns(prefix: str) -> list[str]:
    return [
        f"{prefix}__active_power_kw",
        f"{prefix}__phase_a_power_kw",
        f"{prefix}__phase_b_power_kw",
        f"{prefix}__phase_c_power_kw",
    ]


def select_and_rename(data: pd.DataFrame, prefix: str) -> pd.DataFrame:
    selected = data[
        [
            "minute_start",
            "active_power_kw",
            "phase_a_power_w",
            "phase_b_power_w",
            "phase_c_power_w",
            "coverage_ratio",
            "is_interpolated",
        ]
    ].copy()
    selected = selected.rename(
        columns={
            "active_power_kw": f"{prefix}__active_power_kw",
            "phase_a_power_w": f"{prefix}__phase_a_power_kw",
            "phase_b_power_w": f"{prefix}__phase_b_power_kw",
            "phase_c_power_w": f"{prefix}__phase_c_power_kw",
            "coverage_ratio": f"{prefix}__coverage_ratio",
            "is_interpolated": f"{prefix}__is_interpolated",
        }
    )
    for column in feature_columns(prefix)[1:]:
        selected[column] = selected[column].astype(np.float64) / 1000.0
    return selected


def align_main_components(
    main_data: pd.DataFrame,
    pv_data: pd.DataFrame,
    energy_station_data: pd.DataFrame,
    min_coverage_ratio: float = DEFAULT_MIN_COVERAGE_RATIO,
    max_interpolation_gap_minutes: int = (
        DEFAULT_MAX_INTERPOLATION_GAP_MINUTES
    ),
) -> pd.DataFrame:
    main_repaired = interpolate_minute_gaps(
        main_data,
        min_coverage_ratio,
        max_interpolation_gap_minutes,
    )
    pv_repaired = interpolate_minute_gaps(
        pv_data,
        min_coverage_ratio,
        max_interpolation_gap_minutes,
    )
    energy_station_repaired = interpolate_minute_gaps(
        energy_station_data,
        min_coverage_ratio,
        max_interpolation_gap_minutes,
    )
    main = select_and_rename(main_repaired, "main")
    pv = select_and_rename(pv_repaired, "pv")
    energy_station = select_and_rename(
        energy_station_repaired,
        "energy_station",
    )
    aligned = main.merge(pv, on="minute_start", how="inner")
    aligned = aligned.merge(energy_station, on="minute_start", how="inner")
    aligned = aligned.sort_values("minute_start").reset_index(drop=True)
    for suffix in FEATURE_NAMES:
        aligned[f"residual__{suffix}"] = (
            aligned[f"main__{suffix}"]
            - aligned[f"pv__{suffix}"]
            - aligned[f"energy_station__{suffix}"]
        )
    aligned["residual__is_interpolated"] = aligned[
        [
            "main__is_interpolated",
            "pv__is_interpolated",
            "energy_station__is_interpolated",
        ]
    ].max(axis=1)
    aligned["pv_minute_active"] = (
        aligned["pv__active_power_kw"] <= -0.5
    ).astype(np.float32)
    aligned["energy_station_minute_active"] = (
        aligned["energy_station__active_power_kw"] >= 5.0
    ).astype(np.float32)
    aligned["charger_minute_active"] = np.float32(0.0)
    aligned.attrs["interpolation"] = {
        "main": main_repaired.attrs["interpolation"],
        "pv": pv_repaired.attrs["interpolation"],
        "energy_station": energy_station_repaired.attrs["interpolation"],
        "aligned_rows": int(len(aligned)),
    }
    return aligned


def prepare_charger(
    data: pd.DataFrame,
    min_coverage_ratio: float = DEFAULT_MIN_COVERAGE_RATIO,
    max_interpolation_gap_minutes: int = (
        DEFAULT_MAX_INTERPOLATION_GAP_MINUTES
    ),
) -> pd.DataFrame:
    repaired = interpolate_minute_gaps(
        data,
        min_coverage_ratio,
        max_interpolation_gap_minutes,
    )
    charger = select_and_rename(repaired, "main")
    charger["pv_minute_active"] = np.float32(0.0)
    charger["energy_station_minute_active"] = np.float32(0.0)
    charger["charger_minute_active"] = (
        charger["main__active_power_kw"] >= 1.0
    ).astype(np.float32)
    charger = charger.sort_values("minute_start").reset_index(drop=True)
    charger.attrs["interpolation"] = repaired.attrs["interpolation"]
    return charger


def slice_without_boundary_overlap(
    data: pd.DataFrame,
    first_fraction: float = 0.4,
    buffer_fraction: float = 0.2,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    n_rows = len(data)
    first_end = int(n_rows * first_fraction)
    second_start = int(n_rows * (first_fraction + buffer_fraction))
    return (
        data.iloc[:first_end].reset_index(drop=True),
        data.iloc[second_start:].reset_index(drop=True),
    )


def contiguous_starts(
    times: np.ndarray,
    window_size: int,
    stride: int,
) -> np.ndarray:
    if len(times) < window_size:
        return np.empty(0, dtype=np.int64)
    times_ns = times.astype("datetime64[ns]").astype(np.int64)
    good_edge = np.diff(times_ns) == 60_000_000_000
    bad_edge_prefix = np.concatenate(
        [[0], np.cumsum((~good_edge).astype(np.int64))]
    )
    starts = []
    for start in range(0, len(times) - window_size + 1, stride):
        end = start + window_size
        bad_edges = bad_edge_prefix[end - 1] - bad_edge_prefix[start]
        if bad_edges == 0:
            starts.append(start)
    return np.asarray(starts, dtype=np.int64)


def matrix_from_prefix(data: pd.DataFrame, prefix: str) -> np.ndarray:
    return data[feature_columns(prefix)].to_numpy(dtype=np.float32, copy=True)


def label_matrix(data: pd.DataFrame) -> np.ndarray:
    return data[
        [
            "pv_minute_active",
            "energy_station_minute_active",
            "charger_minute_active",
        ]
    ].to_numpy(dtype=np.float32, copy=True)


def label_interpolation_matrix(data: pd.DataFrame) -> np.ndarray:
    zeros = np.zeros(len(data), dtype=np.float32)
    pv = (
        data["pv__is_interpolated"].to_numpy(dtype=np.float32)
        if "pv__is_interpolated" in data
        else zeros
    )
    energy_station = (
        data["energy_station__is_interpolated"].to_numpy(dtype=np.float32)
        if "energy_station__is_interpolated" in data
        else zeros
    )
    charger = data["main__is_interpolated"].to_numpy(dtype=np.float32)
    return np.column_stack([pv, energy_station, charger])


def windowize_observed(
    data: pd.DataFrame,
    window_size: int,
    stride: int,
    source_code: int,
    supervised_labels: tuple[float, float, float],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    starts = contiguous_starts(
        data["minute_start"].to_numpy(),
        window_size,
        stride,
    )
    end_rows = starts + window_size - 1
    starts = starts[
        data.loc[
            end_rows,
            "main__is_interpolated",
        ].to_numpy(dtype=np.int8)
        == 0
    ]
    features = matrix_from_prefix(data, "main")
    minute_labels = label_matrix(data)
    minute_interpolated = label_interpolation_matrix(data)
    x = np.stack(
        [features[start : start + window_size] for start in starts],
        axis=0,
    )
    end_rows = starts + window_size - 1
    y = minute_labels[end_rows].astype(np.float32, copy=True)
    label_mask = (
        minute_interpolated[end_rows] <= 0
    ).astype(np.float32)
    label_mask *= np.asarray(
        supervised_labels,
        dtype=np.float32,
    ).reshape(1, -1)
    source = np.full(len(starts), source_code, dtype=np.int8)
    return x, y, label_mask, source


def raw_component_windows(
    data: pd.DataFrame,
    prefix: str,
    active_column: str | None,
    window_size: int,
    stride: int,
) -> tuple[np.ndarray, np.ndarray]:
    starts = contiguous_starts(
        data["minute_start"].to_numpy(),
        window_size,
        stride,
    )
    end_rows = starts + window_size - 1
    starts = starts[
        data.loc[
            end_rows,
            f"{prefix}__is_interpolated",
        ].to_numpy(dtype=np.int8)
        == 0
    ]
    if active_column is None:
        active = np.zeros(len(starts), dtype=bool)
    else:
        minute_active = data[active_column].to_numpy(dtype=np.float32)
        end_rows = starts + window_size - 1
        active = minute_active[end_rows] > 0
    values = matrix_from_prefix(data, prefix)
    windows = np.stack(
        [values[start : start + window_size] for start in starts],
        axis=0,
    )
    return windows, active


def concatenate_window_pools(
    items: list[tuple[np.ndarray, np.ndarray]],
) -> tuple[np.ndarray, np.ndarray]:
    windows = np.concatenate([item[0] for item in items], axis=0)
    active = np.concatenate([item[1] for item in items], axis=0)
    return windows, active


def choose_window(
    rng: np.random.Generator,
    windows: np.ndarray,
    active: np.ndarray,
    want_active: bool,
    inactive_keep_probability: float,
) -> np.ndarray:
    candidates = np.flatnonzero(active if want_active else ~active)
    if len(candidates) == 0:
        if not want_active:
            return np.zeros_like(windows[0])
        raise ValueError(
            f"没有可用于 {'正' if want_active else '负'} 类的组件窗口"
        )
    if not want_active and rng.random() > inactive_keep_probability:
        return np.zeros_like(windows[0])
    return windows[rng.choice(candidates)]


def make_synthetic_mixtures(
    rng: np.random.Generator,
    n_samples: int,
    baseline_windows: np.ndarray,
    pv_pool: tuple[np.ndarray, np.ndarray],
    energy_station_pool: tuple[np.ndarray, np.ndarray],
    charger_pool: tuple[np.ndarray, np.ndarray],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    combinations = np.asarray(
        list(itertools.product([0, 1], repeat=3)),
        dtype=np.float32,
    )
    labels = np.tile(
        combinations,
        (int(np.ceil(n_samples / len(combinations))), 1),
    )[:n_samples]
    rng.shuffle(labels, axis=0)

    x = np.empty(
        (n_samples, baseline_windows.shape[1], baseline_windows.shape[2]),
        dtype=np.float32,
    )
    for index, label in enumerate(labels):
        baseline = baseline_windows[rng.integers(len(baseline_windows))]
        pv = choose_window(
            rng,
            pv_pool[0],
            pv_pool[1],
            bool(label[0]),
            inactive_keep_probability=0.65,
        )
        energy_station = choose_window(
            rng,
            energy_station_pool[0],
            energy_station_pool[1],
            bool(label[1]),
            inactive_keep_probability=0.65,
        )
        charger = choose_window(
            rng,
            charger_pool[0],
            charger_pool[1],
            bool(label[2]),
            inactive_keep_probability=0.65,
        )
        mixture = baseline + pv + energy_station + charger
        # Tiny measurement noise prevents the network from memorizing exact sums.
        scale = np.maximum(np.std(mixture, axis=0, keepdims=True), 0.02)
        noise = rng.normal(0.0, 0.002, size=mixture.shape).astype(np.float32)
        x[index] = mixture + noise * scale
    label_mask = np.ones_like(labels, dtype=np.float32)
    source = np.full(n_samples, 2, dtype=np.int8)
    return x, labels, label_mask, source


def create_component_pools(
    main_components: pd.DataFrame,
    charger_frames: list[pd.DataFrame],
    window_size: int,
    stride: int,
) -> dict[str, tuple[np.ndarray, np.ndarray] | np.ndarray]:
    baseline, _ = raw_component_windows(
        main_components,
        "residual",
        None,
        window_size,
        stride,
    )
    pv = raw_component_windows(
        main_components,
        "pv",
        "pv_minute_active",
        window_size,
        stride,
    )
    energy_station = raw_component_windows(
        main_components,
        "energy_station",
        "energy_station_minute_active",
        window_size,
        stride,
    )
    charger_items = [
        raw_component_windows(
            frame,
            "main",
            "charger_minute_active",
            window_size,
            stride,
        )
        for frame in charger_frames
    ]
    charger = concatenate_window_pools(charger_items)
    return {
        "baseline": baseline,
        "pv": pv,
        "energy_station": energy_station,
        "charger": charger,
    }


def concatenate_sets(
    sets: list[
        tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]
    ],
    rng: np.random.Generator,
    shuffle: bool,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    x = np.concatenate([item[0] for item in sets], axis=0)
    y = np.concatenate([item[1] for item in sets], axis=0)
    label_mask = np.concatenate([item[2] for item in sets], axis=0)
    source = np.concatenate([item[3] for item in sets], axis=0)
    if shuffle:
        order = rng.permutation(len(x))
        x, y, label_mask, source = (
            x[order],
            y[order],
            label_mask[order],
            source[order],
        )
    return x, y, label_mask, source


def split_summary(
    name: str,
    x: np.ndarray,
    y: np.ndarray,
    label_mask: np.ndarray,
    source: np.ndarray,
) -> dict:
    return {
        "name": name,
        "samples": int(len(x)),
        "shape": [int(value) for value in x.shape],
        "positive_rates": {
            label: (
                float(y[label_mask[:, index] > 0, index].mean())
                if (label_mask[:, index] > 0).any()
                else None
            )
            for index, label in enumerate(LABEL_NAMES)
        },
        "supervised_samples": {
            label: int((label_mask[:, index] > 0).sum())
            for index, label in enumerate(LABEL_NAMES)
        },
        "sources": {
            SOURCE_NAMES[int(code)]: int((source == code).sum())
            for code in np.unique(source)
        },
        "feature_min": {
            name: float(x[:, :, index].min())
            for index, name in enumerate(FEATURE_NAMES)
        },
        "feature_max": {
            name: float(x[:, :, index].max())
            for index, name in enumerate(FEATURE_NAMES)
        },
    }


def build_dataset(
    output_path: Path,
    window_size: int = 120,
    stride: int = 1,
    synthetic_train_samples: int = 6000,
    synthetic_eval_samples: int = 1200,
    min_coverage_ratio: float = DEFAULT_MIN_COVERAGE_RATIO,
    max_interpolation_gap_minutes: int = (
        DEFAULT_MAX_INTERPOLATION_GAP_MINUTES
    ),
    seed: int = 20260729,
) -> dict:
    validate_min_coverage_ratio(min_coverage_ratio)
    validate_max_interpolation_gap(max_interpolation_gap_minutes)
    rng = np.random.default_rng(seed)

    loaded = {key: load_parts(folder) for key, folder in FOLDERS.items()}
    expected_roles = {
        "pv_a": "photovoltaic",
        "main_a": "aggregate_main",
        "energy_station_a": "energy_station_feeder",
        "pv_b": "photovoltaic",
        "main_b": "aggregate_main",
        "energy_station_b": "energy_station_feeder",
        "charger_pre_12": "charger_feeder",
        "charger_pre_13": "charger_feeder",
        "charger_post_12": "charger_feeder",
        "charger_post_13": "charger_feeder",
    }
    role_audit = {
        key: {
            "folder": FOLDERS[key],
            "expected_role": expected_role,
            **validate_power_profile_role(
                loaded[key],
                expected_role,
                FOLDERS[key],
            ),
        }
        for key, expected_role in expected_roles.items()
    }
    main_a = align_main_components(
        loaded["main_a"],
        loaded["pv_a"],
        loaded["energy_station_a"],
        min_coverage_ratio=min_coverage_ratio,
        max_interpolation_gap_minutes=max_interpolation_gap_minutes,
    )
    main_b = align_main_components(
        loaded["main_b"],
        loaded["pv_b"],
        loaded["energy_station_b"],
        min_coverage_ratio=min_coverage_ratio,
        max_interpolation_gap_minutes=max_interpolation_gap_minutes,
    )
    charger_pre = [
        prepare_charger(
            loaded["charger_pre_12"],
            min_coverage_ratio=min_coverage_ratio,
            max_interpolation_gap_minutes=max_interpolation_gap_minutes,
        ),
        prepare_charger(
            loaded["charger_pre_13"],
            min_coverage_ratio=min_coverage_ratio,
            max_interpolation_gap_minutes=max_interpolation_gap_minutes,
        ),
    ]
    charger_post = [
        prepare_charger(
            loaded["charger_post_12"],
            min_coverage_ratio=min_coverage_ratio,
            max_interpolation_gap_minutes=max_interpolation_gap_minutes,
        ),
        prepare_charger(
            loaded["charger_post_13"],
            min_coverage_ratio=min_coverage_ratio,
            max_interpolation_gap_minutes=max_interpolation_gap_minutes,
        ),
    ]

    main_b_val, main_b_test = slice_without_boundary_overlap(main_b)
    charger_post_splits = [
        slice_without_boundary_overlap(frame) for frame in charger_post
    ]
    charger_val = [item[0] for item in charger_post_splits]
    charger_test = [item[1] for item in charger_post_splits]

    observed_train = [
        windowize_observed(
            main_a,
            window_size,
            stride,
            source_code=0,
            supervised_labels=(1.0, 1.0, 0.0),
        ),
        *[
            windowize_observed(
                frame,
                window_size,
                stride,
                source_code=1,
                supervised_labels=(0.0, 0.0, 1.0),
            )
            for frame in charger_pre
        ],
    ]
    observed_val = [
        windowize_observed(
            main_b_val,
            window_size,
            stride,
            source_code=0,
            supervised_labels=(1.0, 1.0, 0.0),
        ),
        *[
            windowize_observed(
                frame,
                window_size,
                stride,
                source_code=1,
                supervised_labels=(0.0, 0.0, 1.0),
            )
            for frame in charger_val
        ],
    ]
    observed_test = [
        windowize_observed(
            main_b_test,
            window_size,
            stride,
            source_code=0,
            supervised_labels=(1.0, 1.0, 0.0),
        ),
        *[
            windowize_observed(
                frame,
                window_size,
                stride,
                source_code=1,
                supervised_labels=(0.0, 0.0, 1.0),
            )
            for frame in charger_test
        ],
    ]

    train_pools = create_component_pools(
        main_a,
        charger_pre,
        window_size,
        stride,
    )
    val_pools = create_component_pools(
        main_b_val,
        charger_val,
        window_size,
        stride,
    )
    test_pools = create_component_pools(
        main_b_test,
        charger_test,
        window_size,
        stride,
    )

    synthetic_train = make_synthetic_mixtures(
        rng,
        synthetic_train_samples,
        train_pools["baseline"],
        train_pools["pv"],
        train_pools["energy_station"],
        train_pools["charger"],
    )
    synthetic_val = make_synthetic_mixtures(
        rng,
        synthetic_eval_samples,
        val_pools["baseline"],
        val_pools["pv"],
        val_pools["energy_station"],
        val_pools["charger"],
    )
    synthetic_test = make_synthetic_mixtures(
        rng,
        synthetic_eval_samples,
        test_pools["baseline"],
        test_pools["pv"],
        test_pools["energy_station"],
        test_pools["charger"],
    )

    x_train, y_train, label_mask_train, source_train = concatenate_sets(
        [*observed_train, synthetic_train],
        rng,
        shuffle=True,
    )
    x_val, y_val, label_mask_val, source_val = concatenate_sets(
        [*observed_val, synthetic_val],
        rng,
        shuffle=False,
    )
    x_test, y_test, label_mask_test, source_test = concatenate_sets(
        [*observed_test, synthetic_test],
        rng,
        shuffle=False,
    )

    feature_mean = x_train.mean(axis=(0, 1), dtype=np.float64).astype(np.float32)
    feature_std = x_train.std(axis=(0, 1), dtype=np.float64).astype(np.float32)
    feature_std = np.maximum(feature_std, np.float32(1e-6))

    for values in (x_train, x_val, x_test):
        values -= feature_mean.reshape(1, 1, -1)
        values /= feature_std.reshape(1, 1, -1)

    for name, values in {
        "x_train": x_train,
        "y_train": y_train,
        "x_val": x_val,
        "y_val": y_val,
        "x_test": x_test,
        "y_test": y_test,
    }.items():
        if not np.isfinite(values).all():
            raise ValueError(f"{name} 中出现 NaN 或无穷值")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        output_path,
        x_train=x_train.astype(np.float32),
        y_train=y_train.astype(np.float32),
        label_mask_train=label_mask_train.astype(np.float32),
        source_train=source_train,
        x_val=x_val.astype(np.float32),
        y_val=y_val.astype(np.float32),
        label_mask_val=label_mask_val.astype(np.float32),
        source_val=source_val,
        x_test=x_test.astype(np.float32),
        y_test=y_test.astype(np.float32),
        label_mask_test=label_mask_test.astype(np.float32),
        source_test=source_test,
        feature_mean=feature_mean,
        feature_std=feature_std,
        feature_names=np.asarray(FEATURE_NAMES),
        label_names=np.asarray(LABEL_NAMES),
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
            "real-time current-minute multi-label resource identification; "
            f"the state at t uses observations from t-{window_size - 1} "
            "through t and is not a future forecast"
        ),
        "window_size_minutes": window_size,
        "stride_minutes": stride,
        "target_minute": "window endpoint t",
        "min_coverage_ratio": min_coverage_ratio,
        "max_interpolation_gap_minutes": max_interpolation_gap_minutes,
        "thresholds": {
            "pv_minute_active": "pv active_power_kw <= -0.5",
            "energy_station_minute_active": (
                "energy-station feeder active_power_kw >= 5.0"
            ),
            "charger_minute_active": "charger feeder active_power_kw >= 1.0",
            "output": "current-minute state at window endpoint t",
        },
        "feature_names": FEATURE_NAMES,
        "label_names": LABEL_NAMES,
        "source_names": SOURCE_NAMES,
        "role_audit": role_audit,
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
        "aligned_periods": {
            "train_main_a": {
                "rows": int(len(main_a)),
                "first": str(main_a["minute_start"].min()),
                "last": str(main_a["minute_start"].max()),
                "interpolation": main_a.attrs["interpolation"],
            },
            "validation_test_main_b": {
                "rows": int(len(main_b)),
                "first": str(main_b["minute_start"].min()),
                "last": str(main_b["minute_start"].max()),
                "interpolation": main_b.attrs["interpolation"],
            },
            "train_charger_pre": [
                {
                    "rows": int(len(frame)),
                    "first": str(frame["minute_start"].min()),
                    "last": str(frame["minute_start"].max()),
                    "interpolation": frame.attrs["interpolation"],
                }
                for frame in charger_pre
            ],
            "validation_test_charger_post": [
                {
                    "rows": int(len(frame)),
                    "first": str(frame["minute_start"].min()),
                    "last": str(frame["minute_start"].max()),
                    "interpolation": frame.attrs["interpolation"],
                }
                for frame in charger_post
            ],
        },
        "splits": [
            split_summary(
                "train",
                x_train,
                y_train,
                label_mask_train,
                source_train,
            ),
            split_summary(
                "validation",
                x_val,
                y_val,
                label_mask_val,
                source_val,
            ),
            split_summary(
                "test",
                x_test,
                y_test,
                label_mask_test,
                source_test,
            ),
        ],
        "known_limitations": [
            "PV/energy-station labels are derived from synchronized component meters.",
            "Charger labels are derived from the charging-feeder aggregate threshold, not an independent charger submeter.",
            "Observed main windows have no synchronized charger label and observed charger-feeder windows have no synchronized PV/energy-station labels; unsynchronized labels are masked out of loss and metrics.",
            "Missing minutes and minutes below the configured coverage ratio are linearly interpolated only when the bounded gap does not exceed the configured limit.",
            "Observed-window endpoints must be original, non-interpolated minutes so real-time outputs do not depend on future samples.",
            "Partially covered minutes at or above the configured threshold retain the mean of their available raw samples.",
            "The target is the operating state at the current window endpoint, not proof of physical installation while fully idle.",
            "Synthetic mixtures cover label combinations absent from the observed aggregate datasets; they are component additions, not timestamp-synchronized observations.",
        ],
    }
    metadata_path = output_path.with_name("dataset_metadata.json")
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return metadata


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build device-detection dataset.")
    parser.add_argument(
        "--output",
        type=Path,
        default=ARTIFACT_DIR / "device_detection_dataset.npz",
    )
    parser.add_argument("--window-size", type=int, default=120)
    parser.add_argument("--stride", type=int, default=1)
    parser.add_argument("--synthetic-train", type=int, default=6000)
    parser.add_argument("--synthetic-eval", type=int, default=1200)
    parser.add_argument(
        "--min-coverage-ratio",
        type=float,
        default=DEFAULT_MIN_COVERAGE_RATIO,
        help=(
            "Treat rows below this raw-sample coverage as missing before "
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
        stride=args.stride,
        synthetic_train_samples=args.synthetic_train,
        synthetic_eval_samples=args.synthetic_eval,
        min_coverage_ratio=args.min_coverage_ratio,
        max_interpolation_gap_minutes=(
            args.max_interpolation_gap_minutes
        ),
        seed=args.seed,
    )
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
