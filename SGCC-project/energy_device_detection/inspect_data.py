from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd

from data_pipeline import (
    DEFAULT_MAX_INTERPOLATION_GAP_MINUTES,
    DEFAULT_MIN_COVERAGE_RATIO,
    infer_power_profile_role,
    interpolate_minute_gaps,
)

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = Path(__file__).resolve().parent / "artifacts"

GROUPS = {
    "pv_a": "202511050001 光伏",
    "main_a": "202511050004 总开",
    "energy_station_a": "202511250005 能源站",
    "pv_b": "台区数据光伏0",
    "main_b": "台区数据总开0",
    "energy_station_b": "台区数据能源站0",
    "unlabeled_12": "台区数据12号",
    "unlabeled_13": "台区数据13号",
    "charger_1_12": "充电桩台区1_12.22-12.31_12号",
    "charger_1_13": "充电桩台区1_12.22-12.31_13号",
    "charger_2_12": "充电桩台区2.1-20251231-20260109-12号",
    "charger_2_13": "充电桩台区2.2-20251231-20260109-13号",
}

PART_RE = re.compile(r"^minute_active_power_part_\d{4}\.csv$", re.IGNORECASE)
VALUE_COLUMNS = [
    "active_power_kw",
    "phase_a_power_w",
    "phase_b_power_w",
    "phase_c_power_w",
    "coverage_ratio",
    "is_complete",
]


def load_group(folder_name: str) -> pd.DataFrame:
    folder = ROOT / folder_name
    files = sorted(
        path
        for path in folder.glob("*.csv")
        if PART_RE.match(path.name)
    )
    if not files:
        return pd.DataFrame()
    frames = []
    for path in files:
        frame = pd.read_csv(path)
        frame["_source_file"] = path.name
        frames.append(frame)
    data = pd.concat(frames, ignore_index=True)
    data["minute_start"] = pd.to_datetime(data["minute_start"], errors="raise")
    data = data.sort_values(["minute_start", "_source_file"], kind="stable")
    return data.reset_index(drop=True)


def summarize(name: str, data: pd.DataFrame) -> dict:
    if data.empty:
        return {
            "name": name,
            "rows": 0,
            "status": "missing_or_empty",
        }
    power = data["active_power_kw"].astype(float)
    times = data["minute_start"]
    duplicate_minutes = int(times.duplicated().sum())
    unique_times = times.drop_duplicates().sort_values()
    deltas = unique_times.diff().dropna().dt.total_seconds().div(60)
    expected_minutes = int(
        (unique_times.iloc[-1] - unique_times.iloc[0]).total_seconds() // 60
    ) + 1
    coverage = data["coverage_ratio"].astype(float)
    return {
        "name": name,
        "folder": GROUPS[name],
        "power_profile_role_audit": infer_power_profile_role(data),
        "rows": int(len(data)),
        "unique_minutes": int(times.nunique()),
        "duplicate_minutes": duplicate_minutes,
        "first_minute": str(times.min()),
        "last_minute": str(times.max()),
        "expected_minutes_in_span": expected_minutes,
        "missing_minutes_in_span": int(expected_minutes - len(unique_times)),
        "gap_count": int((deltas > 1).sum()),
        "max_gap_minutes": float(deltas.max()) if not deltas.empty else 0.0,
        "complete_ratio": float(data["is_complete"].mean()),
        "coverage_mean": float(coverage.mean()),
        "coverage_q01": float(coverage.quantile(0.01)),
        "coverage_q05": float(coverage.quantile(0.05)),
        "coverage_q10": float(coverage.quantile(0.10)),
        "minutes_below_coverage_0_1": int((coverage < 0.1).sum()),
        "minutes_below_coverage_0_5": int((coverage < 0.5).sum()),
        "minutes_below_coverage_0_9": int((coverage < 0.9).sum()),
        "power_kw_mean": float(power.mean()),
        "power_kw_std": float(power.std()),
        "power_kw_min": float(power.min()),
        "power_kw_q01": float(power.quantile(0.01)),
        "power_kw_q10": float(power.quantile(0.10)),
        "power_kw_median": float(power.median()),
        "power_kw_q90": float(power.quantile(0.90)),
        "power_kw_q99": float(power.quantile(0.99)),
        "power_kw_max": float(power.max()),
        "negative_fraction": float((power < -0.1).mean()),
        "near_zero_fraction": float((power.abs() < 0.1).mean()),
        "above_1kw_fraction": float((power > 1).mean()),
        "above_5kw_fraction": float((power > 5).mean()),
    }


def align(
    datasets: dict[str, pd.DataFrame],
    names: list[str],
) -> pd.DataFrame:
    aligned = None
    for name in names:
        data = datasets[name]
        if data.empty:
            return pd.DataFrame()
        columns = ["minute_start", *VALUE_COLUMNS]
        current = data[columns].drop_duplicates("minute_start", keep="last").copy()
        current = current.rename(
            columns={column: f"{name}__{column}" for column in VALUE_COLUMNS}
        )
        if aligned is None:
            aligned = current
        else:
            aligned = aligned.merge(current, on="minute_start", how="inner")
    return aligned.sort_values("minute_start").reset_index(drop=True)


def aligned_summary(frame: pd.DataFrame, names: list[str]) -> dict:
    if frame.empty:
        return {"names": names, "rows": 0}
    power_columns = [f"{name}__active_power_kw" for name in names]
    coverage_columns = [f"{name}__coverage_ratio" for name in names]
    minimum_coverage = frame[coverage_columns].min(axis=1)
    corr = frame[power_columns].corr()
    result = {
        "names": names,
        "rows": int(len(frame)),
        "first_minute": str(frame["minute_start"].min()),
        "last_minute": str(frame["minute_start"].max()),
        "rows_below_any_coverage_0_1": int(
            (minimum_coverage < 0.1).sum()
        ),
        "rows_retained_at_coverage_0_1": int(
            (minimum_coverage >= 0.1).sum()
        ),
        "correlations": {
            row: {column: float(corr.loc[row, column]) for column in power_columns}
            for row in power_columns
        },
    }
    batch = None
    if set(names) >= {"main_a", "pv_a", "energy_station_a"}:
        batch = "a"
    elif set(names) >= {"main_b", "pv_b", "energy_station_b"}:
        batch = "b"
    if batch is not None:
        main_column = f"main_{batch}__active_power_kw"
        pv_column = f"pv_{batch}__active_power_kw"
        energy_column = (
            f"energy_station_{batch}__active_power_kw"
        )
        batch_coverage_columns = [
            f"main_{batch}__coverage_ratio",
            f"pv_{batch}__coverage_ratio",
            f"energy_station_{batch}__coverage_ratio",
        ]
        valid = (
            frame[batch_coverage_columns].min(axis=1)
            >= DEFAULT_MIN_COVERAGE_RATIO
        )
        aligned_valid = frame.loc[
            valid,
            ["minute_start", main_column, pv_column, energy_column],
        ].copy()
        residual = (
            aligned_valid[main_column]
            - aligned_valid[pv_column]
            - aligned_valid[energy_column]
        )
        result["main_minus_components"] = {
            "rows": int(len(residual)),
            "mean_kw": float(residual.mean()),
            "std_kw": float(residual.std()),
            "rmse_kw": float(np.sqrt(np.mean(residual**2))),
            "mae_kw": float(np.mean(np.abs(residual))),
            "q01_kw": float(residual.quantile(0.01)),
            "median_kw": float(residual.median()),
            "q99_kw": float(residual.quantile(0.99)),
        }

        main_series = aligned_valid[
            ["minute_start", main_column]
        ].rename(columns={main_column: "main_kw"})
        components = aligned_valid[
            ["minute_start", pv_column, energy_column]
        ].copy()
        components["components_kw"] = (
            components[pv_column] + components[energy_column]
        )
        lag_rmse = {}
        for lag in (-1, 0, 1):
            shifted = components[
                ["minute_start", "components_kw"]
            ].copy()
            shifted["minute_start"] += pd.Timedelta(minutes=lag)
            comparison = main_series.merge(
                shifted,
                on="minute_start",
                how="inner",
            )
            error = comparison["main_kw"] - comparison["components_kw"]
            lag_rmse[str(lag)] = {
                "rows": int(len(error)),
                "rmse_kw": float(np.sqrt(np.mean(error**2))),
            }
        result["component_timestamp_lag_check"] = {
            "lag_definition": (
                "component timestamps shifted by lag_minutes before "
                "matching aggregate timestamps"
            ),
            "lag_minutes": lag_rmse,
            "best_lag_minutes": int(
                min(
                    lag_rmse,
                    key=lambda key: lag_rmse[key]["rmse_kw"],
                )
            ),
        }

        event_rows = aligned_valid.loc[
            np.abs(residual.to_numpy()) >= 50.0,
            ["minute_start"],
        ].copy()
        if not event_rows.empty:
            event_rows["residual_kw"] = residual.loc[event_rows.index]
            event_rows["event_group"] = (
                event_rows["minute_start"].diff()
                != pd.Timedelta(minutes=1)
            ).cumsum()
            events = []
            for _, event in event_rows.groupby("event_group"):
                events.append(
                    {
                        "first_minute": str(event["minute_start"].min()),
                        "last_minute": str(event["minute_start"].max()),
                        "minutes": int(len(event)),
                        "residual_min_kw": float(
                            event["residual_kw"].min()
                        ),
                        "residual_max_kw": float(
                            event["residual_kw"].max()
                        ),
                    }
                )
            result["large_unmetered_load_events"] = events
    return result


def temporal_overlap_summary(
    datasets: dict[str, pd.DataFrame],
    left_names: list[str],
    right_names: list[str],
) -> dict:
    left_time_sets = []
    right_times = set()
    for name in left_names:
        if not datasets[name].empty:
            left_time_sets.append(
                set(datasets[name]["minute_start"].tolist())
            )
    for name in right_names:
        if not datasets[name].empty:
            right_times.update(datasets[name]["minute_start"].tolist())
    left_times = set().union(*left_time_sets)
    if len(left_time_sets) >= 3:
        first_period = set.intersection(*left_time_sets[:3])
        second_period = set.intersection(*left_time_sets[3:])
        left_times = first_period.union(second_period)
    overlap = left_times.intersection(right_times)
    left_last = max(left_times)
    right_first = min(right_times)
    return {
        "left_sources": left_names,
        "right_sources": right_names,
        "overlap_minutes": int(len(overlap)),
        "left_last_minute": str(left_last),
        "right_first_minute": str(right_first),
        "gap_between_periods": str(right_first - left_last),
    }


def archive_source_identity_summary(
    datasets: dict[str, pd.DataFrame],
    unlabeled_name: str,
    explicitly_labeled_name: str,
) -> dict:
    def archive_names(group_name: str) -> set[str]:
        path = (
            ROOT
            / GROUPS[group_name]
            / "minute_active_power_processing_log.csv"
        )
        if not path.exists():
            return set()
        log = pd.read_csv(path)
        if "archive" not in log:
            return set()
        return set(log["archive"].dropna().astype(str))

    unlabeled_archives = archive_names(unlabeled_name)
    labeled_archives = archive_names(explicitly_labeled_name)
    result = {
        "unlabeled_source": GROUPS[unlabeled_name],
        "explicitly_labeled_source": GROUPS[explicitly_labeled_name],
        "unlabeled_archive_count": int(len(unlabeled_archives)),
        "explicitly_labeled_archive_count": int(len(labeled_archives)),
        "shared_archive_count": int(
            len(unlabeled_archives & labeled_archives)
        ),
        "explicit_archive_names_are_subset": bool(
            labeled_archives
            and labeled_archives <= unlabeled_archives
        ),
    }

    left = datasets[unlabeled_name]
    right = datasets[explicitly_labeled_name]
    if left.empty or right.empty:
        result["overlap_minutes"] = 0
        result["power_comparison_status"] = "one_minute_table_is_empty"
        return result

    overlap = (
        left[["minute_start", "active_power_kw"]]
        .drop_duplicates("minute_start", keep="last")
        .merge(
            right[["minute_start", "active_power_kw"]].drop_duplicates(
                "minute_start",
                keep="last",
            ),
            on="minute_start",
            how="inner",
            suffixes=("_unlabeled", "_explicit"),
        )
    )
    error = (
        overlap["active_power_kw_unlabeled"]
        - overlap["active_power_kw_explicit"]
    ).abs()
    result.update(
        {
            "overlap_minutes": int(len(overlap)),
            "active_power_mae_kw": (
                float(error.mean()) if len(error) else None
            ),
            "fraction_equal_within_1e_6_kw": (
                float((error <= 1e-6).mean()) if len(error) else None
            ),
        }
    )
    return result


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    datasets = {name: load_group(folder) for name, folder in GROUPS.items()}
    inventory = [summarize(name, data) for name, data in datasets.items()]

    alignment_specs = {
        "pv_energy_station_a": [
            "main_a",
            "pv_a",
            "energy_station_a",
        ],
        "pv_energy_station_b": [
            "main_b",
            "pv_b",
            "energy_station_b",
        ],
        "charger_1_12": ["unlabeled_12", "charger_1_12"],
        "charger_1_13": ["unlabeled_13", "charger_1_13"],
        "charger_2_pair": ["charger_2_12", "charger_2_13"],
    }
    aligned_results = {}
    for key, names in alignment_specs.items():
        frame = align(datasets, names)
        aligned_results[key] = aligned_summary(frame, names)
        if not frame.empty:
            frame.to_csv(OUT_DIR / f"aligned_{key}.csv", index=False)

    interpolation_results = {}
    for name, data in datasets.items():
        if data.empty:
            interpolation_results[name] = {
                "status": "missing_or_empty",
            }
            continue
        repaired = interpolate_minute_gaps(
            data,
            min_coverage_ratio=DEFAULT_MIN_COVERAGE_RATIO,
            max_gap_minutes=(
                DEFAULT_MAX_INTERPOLATION_GAP_MINUTES
            ),
        )
        interpolation_results[name] = {
            **repaired.attrs["interpolation"],
            "rows_after_interpolation": int(len(repaired)),
        }

    report = {
        "inventory": inventory,
        "alignments": aligned_results,
        "interpolation_audit": interpolation_results,
        "unlabeled_folder_identity_evidence": {
            "unlabeled_12_vs_explicit_charger_12": (
                archive_source_identity_summary(
                    datasets,
                    "unlabeled_12",
                    "charger_1_12",
                )
            ),
            "unlabeled_13_vs_explicit_charger_13": (
                archive_source_identity_summary(
                    datasets,
                    "unlabeled_13",
                    "charger_1_13",
                )
            ),
            "decision": (
                "台区数据12号/13号按充电馈线使用：功率形态是低功率"
                "待机与固定高功率平台切换，并且归档文件名与后来明确标注"
                "的充电桩目录同源；不是仅按未标明的目录名猜测。"
            ),
        },
        "temporal_relationships": {
            "main_pv_energy_station_vs_charger": temporal_overlap_summary(
                datasets,
                [
                    "main_a",
                    "pv_a",
                    "energy_station_a",
                    "main_b",
                    "pv_b",
                    "energy_station_b",
                ],
                [
                    "unlabeled_12",
                    "unlabeled_13",
                    "charger_1_12",
                    "charger_2_12",
                    "charger_2_13",
                ],
            )
        },
    }
    (OUT_DIR / "data_inspection.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    pd.DataFrame(inventory).to_csv(OUT_DIR / "data_inventory.csv", index=False)

    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
