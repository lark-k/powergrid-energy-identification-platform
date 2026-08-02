from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd


PROJECT_DIR = Path(__file__).resolve().parent
ARTIFACT_DIR = PROJECT_DIR / "artifacts"


def load_aligned(name: str) -> pd.DataFrame:
    data = pd.read_csv(
        ARTIFACT_DIR / name,
        parse_dates=["minute_start"],
    )
    batch = "a" if name.endswith("_a.csv") else "b"
    data = data.rename(
        columns={
            column: column.replace(f"main_{batch}__", "main__")
            .replace(f"pv_{batch}__", "pv__")
            .replace(
                f"energy_station_{batch}__",
                "energy_station__",
            )
            for column in data.columns
        }
    )
    for prefix in ("main", "pv", "energy_station"):
        for phase in ("a", "b", "c"):
            watts = f"{prefix}__phase_{phase}_power_w"
            kilowatts = f"{prefix}__phase_{phase}_power_kw"
            data[kilowatts] = data[watts].astype(np.float64) / 1000.0
    return data.sort_values("minute_start").reset_index(drop=True)


def make_causal_features(data: pd.DataFrame) -> pd.DataFrame:
    output = pd.DataFrame(index=data.index)
    raw_columns = [
        "main__active_power_kw",
        "main__phase_a_power_kw",
        "main__phase_b_power_kw",
        "main__phase_c_power_kw",
    ]
    for column in raw_columns:
        short = column.replace("main__", "")
        output[short] = data[column]
        for window in (5, 15, 60):
            output[f"{short}_mean_{window}"] = (
                data[column].rolling(window, min_periods=window).mean()
            )
    total = data["main__active_power_kw"]
    for lag in (1, 5, 15, 60):
        output[f"total_delta_{lag}"] = total - total.shift(lag)
    output["total_std_15"] = total.rolling(15, min_periods=15).std()
    output["total_std_60"] = total.rolling(60, min_periods=60).std()

    minute_of_day = (
        data["minute_start"].dt.hour * 60
        + data["minute_start"].dt.minute
    ).to_numpy()
    angle = 2 * np.pi * minute_of_day / 1440.0
    output["time_sin"] = np.sin(angle)
    output["time_cos"] = np.cos(angle)
    return output


def regression_fit_predict(
    train: pd.DataFrame,
    test: pd.DataFrame,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    train_features = make_causal_features(train)
    test_features = make_causal_features(test)
    train_valid = train_features.notna().all(axis=1)
    test_valid = test_features.notna().all(axis=1)
    feature_names = train_features.columns.tolist()

    x_train = train_features.loc[train_valid].to_numpy(dtype=np.float64)
    x_test = test_features.loc[test_valid].to_numpy(dtype=np.float64)
    y_train = train.loc[
        train_valid,
        "pv__active_power_kw",
    ].to_numpy(dtype=np.float64)

    mean = x_train.mean(axis=0)
    std = np.maximum(x_train.std(axis=0), 1e-6)
    x_train = (x_train - mean) / std
    x_test = (x_test - mean) / std
    x_train = np.column_stack([np.ones(len(x_train)), x_train])
    x_test = np.column_stack([np.ones(len(x_test)), x_test])

    penalty = np.eye(x_train.shape[1]) * 1.0
    penalty[0, 0] = 0.0
    coefficients = np.linalg.solve(
        x_train.T @ x_train + penalty,
        x_train.T @ y_train,
    )
    prediction = x_test @ coefficients
    prediction = np.clip(prediction, -40.0, 0.0)
    return prediction, test_valid.to_numpy(), feature_names


def metrics(
    truth: np.ndarray,
    prediction: np.ndarray,
    active_threshold: float = -0.5,
) -> dict:
    error = prediction - truth
    active = truth <= active_threshold
    idle = ~active
    return {
        "rows": int(len(truth)),
        "mae_kw": float(np.mean(np.abs(error))),
        "rmse_kw": float(np.sqrt(np.mean(error**2))),
        "active_rows": int(active.sum()),
        "active_mae_kw": float(np.mean(np.abs(error[active]))),
        "active_rmse_kw": float(np.sqrt(np.mean(error[active] ** 2))),
        "idle_false_generation_mae_kw": float(
            np.mean(np.abs(prediction[idle]))
        ),
        "true_energy_kwh": float(truth.sum() / 60.0),
        "predicted_energy_kwh": float(prediction.sum() / 60.0),
        "energy_bias_kwh": float(error.sum() / 60.0),
    }


def main() -> None:
    train = load_aligned("aligned_pv_energy_station_a.csv")
    test = load_aligned("aligned_pv_energy_station_b.csv")
    truth = test["pv__active_power_kw"].to_numpy(dtype=np.float64)
    total = test["main__active_power_kw"].to_numpy(dtype=np.float64)
    energy_station = test[
        "energy_station__active_power_kw"
    ].to_numpy(dtype=np.float64)

    regression_prediction, valid, feature_names = regression_fit_predict(
        train,
        test,
    )
    report = {
        "train_period": {
            "rows": int(len(train)),
            "first": str(train["minute_start"].min()),
            "last": str(train["minute_start"].max()),
        },
        "test_period": {
            "rows": int(len(test)),
            "first": str(test["minute_start"].min()),
            "last": str(test["minute_start"].max()),
        },
        "target": "pv__active_power_kw (negative means generation)",
        "baselines": {
            "always_zero": metrics(truth, np.zeros_like(truth)),
            "negative_part_of_main": metrics(truth, np.minimum(total, 0.0)),
            "main_minus_energy_station_oracle": metrics(
                truth,
                np.clip(total - energy_station, -40.0, 0.0),
            ),
            "causal_ridge_from_main_only": metrics(
                truth[valid],
                regression_prediction,
            ),
        },
        "causal_ridge_features": feature_names,
        "interpretation": {
            "main_minus_energy_station_oracle": (
                "Not a total-only model; shows the upper bound when the "
                "energy-station feeder meter is available."
            ),
            "causal_ridge_from_main_only": (
                "Uses only current/past main total+phases and time-of-day."
            ),
        },
    }
    output_path = ARTIFACT_DIR / "pv_disaggregation_diagnostic.json"
    output_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
