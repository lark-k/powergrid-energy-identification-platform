from __future__ import annotations

import argparse
import json
import random
import shutil
import sys
import time
from pathlib import Path

VENDOR_DIR = Path(__file__).resolve().parent / ".vendor"
if (VENDOR_DIR / "numpy").is_dir() and (VENDOR_DIR / "torch").is_dir():
    sys.path.insert(0, str(VENDOR_DIR))

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as functional
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

from pv_disaggregation_models import (
    PVModelConfig,
    build_pv_model,
    parameter_count,
)


PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_DATASET = (
    PROJECT_DIR / "artifacts" / "pv_disaggregation_dataset.npz"
)
DEFAULT_OUTPUT_DIR = PROJECT_DIR / "pv_outputs"


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = False
    torch.backends.cudnn.benchmark = True


def make_loader(
    x: np.ndarray,
    y_power: np.ndarray,
    y_active: np.ndarray,
    batch_size: int,
    shuffle: bool,
    seed: int,
    pin_memory: bool,
) -> DataLoader:
    generator = torch.Generator()
    generator.manual_seed(seed)
    return DataLoader(
        TensorDataset(
            torch.from_numpy(x).permute(0, 2, 1).contiguous(),
            torch.from_numpy(y_power),
            torch.from_numpy(y_active),
        ),
        batch_size=batch_size,
        shuffle=shuffle,
        num_workers=0,
        pin_memory=pin_memory,
        generator=generator if shuffle else None,
    )


def model_predictions(
    activity_logits: torch.Tensor,
    magnitude_raw: torch.Tensor,
    target_scale_kw: float,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    activity_probability = torch.sigmoid(activity_logits)
    magnitude_normalized = functional.softplus(magnitude_raw)
    prediction_normalized = activity_probability * magnitude_normalized
    prediction_kw = prediction_normalized * target_scale_kw
    return prediction_normalized, prediction_kw, activity_probability


def combined_loss(
    activity_logits: torch.Tensor,
    magnitude_raw: torch.Tensor,
    target_power_kw: torch.Tensor,
    target_active: torch.Tensor,
    target_scale_kw: float,
    pos_weight: torch.Tensor,
    activity_loss_weight: float,
    active_regression_weight: float,
) -> tuple[torch.Tensor, dict[str, float]]:
    prediction_normalized, _, _ = model_predictions(
        activity_logits,
        magnitude_raw,
        target_scale_kw,
    )
    target_normalized = target_power_kw / target_scale_kw
    regression_per_row = functional.smooth_l1_loss(
        prediction_normalized,
        target_normalized,
        beta=0.02,
        reduction="none",
    )
    regression_weights = 1.0 + target_active * (
        active_regression_weight - 1.0
    )
    regression_loss = (
        regression_per_row * regression_weights
    ).mean()
    activity_loss = functional.binary_cross_entropy_with_logits(
        activity_logits,
        target_active,
        pos_weight=pos_weight,
    )
    total = regression_loss + activity_loss_weight * activity_loss
    return total, {
        "regression_loss": float(regression_loss.detach().item()),
        "activity_loss": float(activity_loss.detach().item()),
    }


def collect_predictions(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
    target_scale_kw: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    model.eval()
    predicted_power = []
    activity_probability = []
    true_power = []
    true_active = []
    with torch.no_grad():
        for features, target_power, target_active in loader:
            features = features.to(device, non_blocking=True)
            activity_logits, magnitude_raw = model(features)
            _, prediction_kw, probability = model_predictions(
                activity_logits,
                magnitude_raw,
                target_scale_kw,
            )
            predicted_power.append(prediction_kw.cpu().numpy())
            activity_probability.append(probability.cpu().numpy())
            true_power.append(target_power.numpy())
            true_active.append(target_active.numpy())
    return (
        np.concatenate(predicted_power),
        np.concatenate(activity_probability),
        np.concatenate(true_power),
        np.concatenate(true_active),
    )


def binary_counts(
    truth: np.ndarray,
    prediction: np.ndarray,
) -> dict[str, int]:
    truth_bool = truth.astype(bool)
    prediction_bool = prediction.astype(bool)
    return {
        "tp": int(np.logical_and(truth_bool, prediction_bool).sum()),
        "tn": int(np.logical_and(~truth_bool, ~prediction_bool).sum()),
        "fp": int(np.logical_and(~truth_bool, prediction_bool).sum()),
        "fn": int(np.logical_and(truth_bool, ~prediction_bool).sum()),
    }


def binary_roc_auc(
    truth: np.ndarray,
    probability: np.ndarray,
) -> float | None:
    truth_bool = truth.astype(bool)
    positive_count = int(truth_bool.sum())
    negative_count = int((~truth_bool).sum())
    if positive_count == 0 or negative_count == 0:
        return None

    _, inverse, tie_counts = np.unique(
        probability.astype(np.float64),
        return_inverse=True,
        return_counts=True,
    )
    rank_starts = np.cumsum(
        np.concatenate([[0], tie_counts[:-1]])
    )
    average_ranks = rank_starts + (tie_counts + 1.0) / 2.0
    ranks = average_ranks[inverse]
    positive_rank_sum = float(ranks[truth_bool].sum())
    auc = (
        positive_rank_sum
        - positive_count * (positive_count + 1) / 2.0
    ) / (positive_count * negative_count)
    return float(auc)


def optimize_activity_threshold(
    truth: np.ndarray,
    probability: np.ndarray,
) -> float:
    best_threshold = 0.5
    best_f1 = -1.0
    for threshold in np.linspace(0.05, 0.95, 37):
        counts = binary_counts(truth, probability >= threshold)
        precision = counts["tp"] / max(counts["tp"] + counts["fp"], 1)
        recall = counts["tp"] / max(counts["tp"] + counts["fn"], 1)
        f1 = (
            2
            * precision
            * recall
            / max(precision + recall, 1e-12)
        )
        if f1 > best_f1:
            best_f1 = f1
            best_threshold = float(threshold)
    return best_threshold


def power_metrics(
    truth_kw: np.ndarray,
    prediction_kw: np.ndarray,
    truth_active: np.ndarray,
) -> dict:
    error = prediction_kw - truth_kw
    active = truth_active.astype(bool)
    idle = ~active
    residual_sum = float(np.sum((truth_kw - truth_kw.mean()) ** 2))
    r_squared = (
        1.0 - float(np.sum(error**2)) / residual_sum
        if residual_sum > 0
        else 0.0
    )
    true_energy = float(truth_kw.sum() / 60.0)
    predicted_energy = float(prediction_kw.sum() / 60.0)
    mae = float(np.mean(np.abs(error)))
    active_mae = float(np.mean(np.abs(error[active])))
    return {
        "samples": int(len(truth_kw)),
        "mae_kw": mae,
        "rmse_kw": float(np.sqrt(np.mean(error**2))),
        "r_squared": r_squared,
        "active_samples": int(active.sum()),
        "active_mae_kw": active_mae,
        "active_rmse_kw": float(
            np.sqrt(np.mean(error[active] ** 2))
        ),
        "idle_false_generation_mae_kw": float(
            np.mean(np.abs(prediction_kw[idle]))
        ),
        "true_energy_kwh": true_energy,
        "predicted_energy_kwh": predicted_energy,
        "energy_bias_kwh": predicted_energy - true_energy,
        "energy_bias_percent": (
            100.0 * (predicted_energy - true_energy) / max(true_energy, 1e-6)
        ),
        "selection_score": active_mae + 0.5 * mae,
    }


def activity_metrics(
    truth: np.ndarray,
    probability: np.ndarray,
    threshold: float,
) -> dict:
    predicted = probability >= threshold
    counts = binary_counts(truth, predicted)
    precision = counts["tp"] / max(counts["tp"] + counts["fp"], 1)
    recall = counts["tp"] / max(counts["tp"] + counts["fn"], 1)
    f1 = (
        2
        * precision
        * recall
        / max(precision + recall, 1e-12)
    )
    return {
        **counts,
        "threshold": threshold,
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "accuracy": float((predicted == truth.astype(bool)).mean()),
        "roc_auc": binary_roc_auc(truth, probability),
    }


def optimize_power_gate_threshold(
    truth_kw: np.ndarray,
    raw_prediction_kw: np.ndarray,
    probability: np.ndarray,
    truth_active: np.ndarray,
) -> float:
    best_threshold = 0.0
    best_score = float("inf")
    for threshold in np.linspace(0.0, 0.80, 33):
        prediction = np.where(
            probability >= threshold,
            raw_prediction_kw,
            0.0,
        )
        score = power_metrics(
            truth_kw,
            prediction,
            truth_active,
        )["selection_score"]
        if score < best_score:
            best_score = score
            best_threshold = float(threshold)
    return best_threshold


def evaluate_arrays(
    truth_power: np.ndarray,
    raw_prediction_power: np.ndarray,
    truth_active: np.ndarray,
    probability: np.ndarray,
    activity_threshold: float,
    power_gate_threshold: float,
) -> tuple[dict, np.ndarray]:
    gated_prediction = np.where(
        probability >= power_gate_threshold,
        raw_prediction_power,
        0.0,
    )
    return (
        {
            "power": power_metrics(
                truth_power,
                gated_prediction,
                truth_active,
            ),
            "activity": activity_metrics(
                truth_active,
                probability,
                activity_threshold,
            ),
            "power_gate_threshold": power_gate_threshold,
        },
        gated_prediction,
    )


def validation_snapshot(
    model: nn.Module,
    loader: DataLoader,
    device: torch.device,
    target_scale_kw: float,
) -> dict:
    prediction, probability, truth_power, truth_active = collect_predictions(
        model,
        loader,
        device,
        target_scale_kw,
    )
    return power_metrics(truth_power, prediction, truth_active)


def train_one_model(
    model_name: str,
    config: PVModelConfig,
    train_loader: DataLoader,
    validation_loader: DataLoader,
    test_loader: DataLoader,
    y_active_train: np.ndarray,
    feature_names: list[str],
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    target_scale_kw: float,
    active_threshold_kw: float,
    min_coverage_ratio: float,
    max_interpolation_gap_minutes: int,
    device: torch.device,
    output_dir: Path,
    epochs: int,
    patience: int,
    learning_rate: float,
    weight_decay: float,
    activity_loss_weight: float,
    active_regression_weight: float,
) -> dict:
    model = build_pv_model(model_name, config).to(device)
    n_parameters = parameter_count(model)
    positives = float(y_active_train.sum())
    negatives = float(len(y_active_train) - positives)
    pos_weight = torch.tensor(
        negatives / max(positives, 1.0),
        dtype=torch.float32,
        device=device,
    )
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=learning_rate,
        weight_decay=weight_decay,
    )
    scaler = torch.amp.GradScaler(
        "cuda",
        enabled=device.type == "cuda",
    )
    history = {
        "train_loss": [],
        "validation_mae_kw": [],
        "validation_active_mae_kw": [],
        "validation_selection_score": [],
    }
    best_score = float("inf")
    best_epoch = 0
    no_improvement = 0
    state_path = output_dir / f"{model_name}_best_state.pt"
    started = time.perf_counter()

    print(
        f"[{model_name}] parameters={n_parameters:,}, device={device}, "
        f"epochs={epochs}",
        flush=True,
    )
    for epoch in range(1, epochs + 1):
        model.train()
        train_loss_sum = 0.0
        train_rows = 0
        for features, target_power, target_active in train_loader:
            features = features.to(device, non_blocking=True)
            target_power = target_power.to(device, non_blocking=True)
            target_active = target_active.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            with torch.amp.autocast(
                device_type=device.type,
                enabled=device.type == "cuda",
            ):
                activity_logits, magnitude_raw = model(features)
                loss, _ = combined_loss(
                    activity_logits,
                    magnitude_raw,
                    target_power,
                    target_active,
                    target_scale_kw,
                    pos_weight,
                    activity_loss_weight,
                    active_regression_weight,
                )
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
            scaler.step(optimizer)
            scaler.update()
            train_loss_sum += float(loss.item()) * len(features)
            train_rows += len(features)

        train_loss = train_loss_sum / max(train_rows, 1)
        validation = validation_snapshot(
            model,
            validation_loader,
            device,
            target_scale_kw,
        )
        history["train_loss"].append(train_loss)
        history["validation_mae_kw"].append(validation["mae_kw"])
        history["validation_active_mae_kw"].append(
            validation["active_mae_kw"]
        )
        history["validation_selection_score"].append(
            validation["selection_score"]
        )
        print(
            f"[{model_name}] epoch={epoch:02d} loss={train_loss:.5f} "
            f"val_mae={validation['mae_kw']:.4f} "
            f"val_active_mae={validation['active_mae_kw']:.4f} "
            f"score={validation['selection_score']:.4f}",
            flush=True,
        )

        if validation["selection_score"] < best_score - 1e-4:
            best_score = validation["selection_score"]
            best_epoch = epoch
            no_improvement = 0
            torch.save(model.state_dict(), state_path)
        else:
            no_improvement += 1
            if no_improvement >= patience:
                print(
                    f"[{model_name}] early_stop at epoch={epoch}",
                    flush=True,
                )
                break

    model.load_state_dict(
        torch.load(state_path, map_location=device, weights_only=True)
    )
    (
        val_raw_prediction,
        val_probability,
        val_truth_power,
        val_truth_active,
    ) = collect_predictions(
        model,
        validation_loader,
        device,
        target_scale_kw,
    )
    activity_threshold = optimize_activity_threshold(
        val_truth_active,
        val_probability,
    )
    power_gate_threshold = optimize_power_gate_threshold(
        val_truth_power,
        val_raw_prediction,
        val_probability,
        val_truth_active,
    )
    validation_metrics, _ = evaluate_arrays(
        val_truth_power,
        val_raw_prediction,
        val_truth_active,
        val_probability,
        activity_threshold,
        power_gate_threshold,
    )

    (
        test_raw_prediction,
        test_probability,
        test_truth_power,
        test_truth_active,
    ) = collect_predictions(
        model,
        test_loader,
        device,
        target_scale_kw,
    )
    test_metrics, _ = evaluate_arrays(
        test_truth_power,
        test_raw_prediction,
        test_truth_active,
        test_probability,
        activity_threshold,
        power_gate_threshold,
    )

    checkpoint_path = output_dir / f"{model_name}_checkpoint.pt"
    torch.save(
        {
            "task": "same_minute_pv_power_disaggregation",
            "target_time": "window_endpoint_current_minute",
            "causal": True,
            "output_semantics": (
                "minute-level PV power separated from the same-minute "
                "aggregate; not a future forecast"
            ),
            "model_name": model_name,
            "model_config": config.to_dict(),
            "model_state_dict": model.state_dict(),
            "feature_names": feature_names,
            "feature_mean": feature_mean,
            "feature_std": feature_std,
            "target_scale_kw": target_scale_kw,
            "active_threshold_kw": active_threshold_kw,
            "min_coverage_ratio": min_coverage_ratio,
            "max_interpolation_gap_minutes": (
                max_interpolation_gap_minutes
            ),
            "activity_probability_threshold": activity_threshold,
            "power_gate_threshold": power_gate_threshold,
            "window_size": int(train_loader.dataset.tensors[0].shape[-1]),
            "output_sign_convention": (
                "CSV字段“分离光伏发电功率(kW)”为正值；"
                "“分离光伏有功功率(kW)”为其负值"
            ),
        },
        checkpoint_path,
    )

    return {
        "model_name": model_name,
        "parameters": n_parameters,
        "best_epoch": best_epoch,
        "epochs_ran": len(history["train_loss"]),
        "best_validation_selection_score": best_score,
        "training_seconds": float(time.perf_counter() - started),
        "activity_probability_threshold": activity_threshold,
        "power_gate_threshold": power_gate_threshold,
        "validation_metrics": validation_metrics,
        "test_metrics": test_metrics,
        "history": history,
        "checkpoint_path": str(checkpoint_path),
    }


def save_selected_test_predictions(
    checkpoint_path: Path,
    dataset: np.lib.npyio.NpzFile,
    output_path: Path,
    batch_size: int,
    device: torch.device,
) -> None:
    checkpoint = torch.load(
        checkpoint_path,
        map_location="cpu",
        weights_only=False,
    )
    config = PVModelConfig.from_dict(checkpoint["model_config"])
    model = build_pv_model(checkpoint["model_name"], config)
    model.load_state_dict(checkpoint["model_state_dict"])
    model = model.to(device).eval()
    loader = make_loader(
        dataset["x_test"],
        dataset["y_power_test"],
        dataset["y_active_test"],
        batch_size,
        shuffle=False,
        seed=0,
        pin_memory=device.type == "cuda",
    )
    raw_prediction, probability, truth_power, truth_active = collect_predictions(
        model,
        loader,
        device,
        float(checkpoint["target_scale_kw"]),
    )
    prediction = np.where(
        probability >= float(checkpoint["power_gate_threshold"]),
        raw_prediction,
        0.0,
    )
    end_times = pd.to_datetime(dataset["end_time_test"])
    output = pd.DataFrame(
        {
            "目标分钟": end_times,
            "真实光伏发电功率(kW)": truth_power,
            "分离光伏发电功率(kW)": prediction,
            "分离光伏有功功率(kW)": -prediction,
            "真实光伏有功功率(kW)": -truth_power,
            "光伏运行概率": probability,
            "真实光伏运行状态": truth_active.astype(np.int8),
            "分离光伏运行状态": (
                probability
                >= float(checkpoint["activity_probability_threshold"])
            ).astype(np.int8),
        }
    )
    output.to_csv(output_path, index=False, encoding="utf-8-sig")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train real-time causal PV disaggregation models."
    )
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
    )
    parser.add_argument(
        "--models",
        nargs="+",
        choices=["causal_tcn", "causal_tcn_lstm"],
        default=["causal_tcn", "causal_tcn_lstm"],
    )
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--patience", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--learning-rate", type=float, default=2e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--activity-loss-weight", type=float, default=0.20)
    parser.add_argument("--active-regression-weight", type=float, default=2.5)
    parser.add_argument("--seed", type=int, default=20260729)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    set_seed(args.seed)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    dataset = np.load(args.dataset, allow_pickle=False)
    feature_names = dataset["feature_names"].astype(str).tolist()
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    pin_memory = device.type == "cuda"

    train_loader = make_loader(
        dataset["x_train"],
        dataset["y_power_train"],
        dataset["y_active_train"],
        args.batch_size,
        shuffle=True,
        seed=args.seed,
        pin_memory=pin_memory,
    )
    validation_loader = make_loader(
        dataset["x_val"],
        dataset["y_power_val"],
        dataset["y_active_val"],
        args.batch_size,
        shuffle=False,
        seed=args.seed,
        pin_memory=pin_memory,
    )
    test_loader = make_loader(
        dataset["x_test"],
        dataset["y_power_test"],
        dataset["y_active_test"],
        args.batch_size,
        shuffle=False,
        seed=args.seed,
        pin_memory=pin_memory,
    )
    config = PVModelConfig(input_channels=len(feature_names))
    results = []
    for model_name in args.models:
        set_seed(args.seed)
        results.append(
            train_one_model(
                model_name=model_name,
                config=config,
                train_loader=train_loader,
                validation_loader=validation_loader,
                test_loader=test_loader,
                y_active_train=dataset["y_active_train"],
                feature_names=feature_names,
                feature_mean=dataset["feature_mean"],
                feature_std=dataset["feature_std"],
                target_scale_kw=float(dataset["target_scale_kw"]),
                active_threshold_kw=float(
                    dataset["active_threshold_kw"]
                ),
                min_coverage_ratio=float(
                    dataset["min_coverage_ratio"]
                ),
                max_interpolation_gap_minutes=int(
                    dataset["max_interpolation_gap_minutes"]
                ),
                device=device,
                output_dir=args.output_dir,
                epochs=args.epochs,
                patience=args.patience,
                learning_rate=args.learning_rate,
                weight_decay=args.weight_decay,
                activity_loss_weight=args.activity_loss_weight,
                active_regression_weight=args.active_regression_weight,
            )
        )

    selected = min(
        results,
        key=lambda result: (
            result["validation_metrics"]["power"]["selection_score"],
            result["parameters"],
        ),
    )
    selected_checkpoint = args.output_dir / "selected_pv_model.pt"
    shutil.copyfile(selected["checkpoint_path"], selected_checkpoint)
    test_predictions_path = (
        args.output_dir / "selected_model_test_predictions.csv"
    )
    save_selected_test_predictions(
        selected_checkpoint,
        dataset,
        test_predictions_path,
        args.batch_size,
        device,
    )

    comparison = {
        "selection_rule": (
            "lowest validation active_MAE + 0.5 * overall_MAE; "
            "parameter count is the tie breaker"
        ),
        "selected_model": selected["model_name"],
        "selected_checkpoint": str(selected_checkpoint),
        "test_predictions": str(test_predictions_path),
        "device": str(device),
        "torch_version": torch.__version__,
        "seed": args.seed,
        "dataset": str(args.dataset),
        "results": results,
    }
    comparison_path = (
        args.output_dir / "pv_model_comparison.json"
    )
    comparison_path.write_text(
        json.dumps(comparison, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "selected_model": selected["model_name"],
                "selected_checkpoint": str(selected_checkpoint),
                "comparison_path": str(comparison_path),
                "test_predictions": str(test_predictions_path),
                "test_power_metrics": selected["test_metrics"]["power"],
                "test_activity_metrics": selected["test_metrics"][
                    "activity"
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
