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
import torch
from torch import nn
import torch.nn.functional as functional
from torch.utils.data import DataLoader, TensorDataset

from models import ModelConfig, build_model, parameter_count


PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_DATASET = PROJECT_DIR / "artifacts" / "device_detection_dataset.npz"
DEFAULT_OUTPUT_DIR = PROJECT_DIR / "outputs"
SOURCE_NAMES = {
    0: "observed_main",
    1: "observed_charger_feeder",
    2: "synthetic_mixture",
}


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = False
    torch.backends.cudnn.benchmark = True


def make_loader(
    x: np.ndarray,
    y: np.ndarray,
    label_mask: np.ndarray,
    batch_size: int,
    shuffle: bool,
    seed: int,
    pin_memory: bool,
) -> DataLoader:
    features = torch.from_numpy(x).permute(0, 2, 1).contiguous()
    labels = torch.from_numpy(y)
    generator = torch.Generator()
    generator.manual_seed(seed)
    return DataLoader(
        TensorDataset(features, labels, torch.from_numpy(label_mask)),
        batch_size=batch_size,
        shuffle=shuffle,
        num_workers=0,
        pin_memory=pin_memory,
        generator=generator if shuffle else None,
    )


class MaskedBCEWithLogitsLoss(nn.Module):
    def __init__(self, pos_weight: torch.Tensor) -> None:
        super().__init__()
        self.register_buffer("pos_weight", pos_weight)

    def forward(
        self,
        logits: torch.Tensor,
        targets: torch.Tensor,
        label_mask: torch.Tensor,
    ) -> torch.Tensor:
        element_loss = functional.binary_cross_entropy_with_logits(
            logits,
            targets,
            pos_weight=self.pos_weight,
            reduction="none",
        )
        weighted = element_loss * label_mask
        return weighted.sum() / label_mask.sum().clamp_min(1.0)


def predict_loader(
    model: nn.Module,
    loader: DataLoader,
    loss_fn: MaskedBCEWithLogitsLoss,
    device: torch.device,
) -> tuple[float, np.ndarray, np.ndarray, np.ndarray]:
    model.eval()
    total_loss = 0.0
    total_supervised_cells = 0.0
    probabilities = []
    targets = []
    label_masks = []
    with torch.no_grad():
        for features, labels, label_mask in loader:
            features = features.to(device, non_blocking=True)
            labels = labels.to(device, non_blocking=True)
            label_mask = label_mask.to(device, non_blocking=True)
            logits = model(features)
            loss = loss_fn(logits, labels, label_mask)
            supervised_cells = float(label_mask.sum().item())
            total_loss += float(loss.item()) * supervised_cells
            total_supervised_cells += supervised_cells
            probabilities.append(torch.sigmoid(logits).cpu().numpy())
            targets.append(labels.cpu().numpy())
            label_masks.append(label_mask.cpu().numpy())
    return (
        total_loss / max(total_supervised_cells, 1.0),
        np.concatenate(probabilities, axis=0),
        np.concatenate(targets, axis=0),
        np.concatenate(label_masks, axis=0),
    )


def binary_counts(
    target: np.ndarray,
    predicted: np.ndarray,
) -> dict[str, int]:
    target_bool = target.astype(bool)
    predicted_bool = predicted.astype(bool)
    return {
        "tp": int(np.logical_and(target_bool, predicted_bool).sum()),
        "tn": int(np.logical_and(~target_bool, ~predicted_bool).sum()),
        "fp": int(np.logical_and(~target_bool, predicted_bool).sum()),
        "fn": int(np.logical_and(target_bool, ~predicted_bool).sum()),
    }


def binary_roc_auc(
    target: np.ndarray,
    probability: np.ndarray,
) -> float | None:
    target_bool = target.astype(bool)
    positive_count = int(target_bool.sum())
    negative_count = int((~target_bool).sum())
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
    positive_rank_sum = float(ranks[target_bool].sum())
    auc = (
        positive_rank_sum
        - positive_count * (positive_count + 1) / 2.0
    ) / (positive_count * negative_count)
    return float(auc)


def metric_report(
    targets: np.ndarray,
    probabilities: np.ndarray,
    label_mask: np.ndarray,
    thresholds: np.ndarray,
    label_names: list[str],
) -> dict:
    predictions = probabilities >= thresholds.reshape(1, -1)
    labels: dict[str, dict] = {}
    f1_values = []
    roc_auc_values = []
    total_counts = {"tp": 0, "tn": 0, "fp": 0, "fn": 0}
    for index, name in enumerate(label_names):
        known = label_mask[:, index] > 0
        counts = binary_counts(
            targets[known, index],
            predictions[known, index],
        )
        for key, value in counts.items():
            total_counts[key] += value
        support = counts["tp"] + counts["fn"]
        predicted_positive = counts["tp"] + counts["fp"]
        precision = counts["tp"] / max(predicted_positive, 1)
        recall = counts["tp"] / max(support, 1)
        specificity = counts["tn"] / max(counts["tn"] + counts["fp"], 1)
        if support == 0:
            f1 = None
        else:
            f1 = 2 * precision * recall / max(precision + recall, 1e-12)
            f1_values.append(f1)
        roc_auc = binary_roc_auc(
            targets[known, index],
            probabilities[known, index],
        )
        if roc_auc is not None:
            roc_auc_values.append(roc_auc)
        labels[name] = {
            **counts,
            "supervised_samples": int(known.sum()),
            "support": int(support),
            "predicted_positive": int(predicted_positive),
            "precision": float(precision),
            "recall": float(recall),
            "specificity": float(specificity),
            "f1": None if f1 is None else float(f1),
            "roc_auc": roc_auc,
            "threshold": float(thresholds[index]),
        }

    micro_precision = total_counts["tp"] / max(
        total_counts["tp"] + total_counts["fp"],
        1,
    )
    micro_recall = total_counts["tp"] / max(
        total_counts["tp"] + total_counts["fn"],
        1,
    )
    micro_f1 = (
        2
        * micro_precision
        * micro_recall
        / max(micro_precision + micro_recall, 1e-12)
    )
    fully_supervised = np.all(label_mask > 0, axis=1)
    known_cells = label_mask > 0
    return {
        "samples": int(len(targets)),
        "fully_supervised_samples": int(fully_supervised.sum()),
        "supervised_label_cells": int(known_cells.sum()),
        "macro_f1": float(np.mean(f1_values)) if f1_values else None,
        "macro_roc_auc": (
            float(np.mean(roc_auc_values)) if roc_auc_values else None
        ),
        "micro_f1": float(micro_f1),
        "exact_match_accuracy": (
            float(
                np.all(
                    predictions[fully_supervised]
                    == targets[fully_supervised].astype(bool),
                    axis=1,
                ).mean()
            )
            if fully_supervised.any()
            else None
        ),
        "hamming_accuracy": (
            float(
                (
                    predictions[known_cells]
                    == targets.astype(bool)[known_cells]
                ).mean()
            )
            if known_cells.any()
            else None
        ),
        "labels": labels,
    }


def optimize_thresholds(
    targets: np.ndarray,
    probabilities: np.ndarray,
    label_mask: np.ndarray,
) -> np.ndarray:
    grid = np.linspace(0.10, 0.90, 33, dtype=np.float32)
    thresholds = np.full(targets.shape[1], 0.5, dtype=np.float32)
    for label_index in range(targets.shape[1]):
        known = label_mask[:, label_index] > 0
        if not known.any():
            continue
        best_threshold = 0.5
        best_f1 = -1.0
        target = targets[known, label_index]
        probability = probabilities[known, label_index]
        for threshold in grid:
            predicted = probability >= threshold
            counts = binary_counts(target, predicted)
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
        thresholds[label_index] = best_threshold
    return thresholds


def grouped_metrics(
    targets: np.ndarray,
    probabilities: np.ndarray,
    label_mask: np.ndarray,
    sources: np.ndarray,
    thresholds: np.ndarray,
    label_names: list[str],
) -> dict:
    result = {
        "all": metric_report(
            targets,
            probabilities,
            label_mask,
            thresholds,
            label_names,
        )
    }
    for source_code, source_name in SOURCE_NAMES.items():
        mask = sources == source_code
        if mask.any():
            result[source_name] = metric_report(
                targets[mask],
                probabilities[mask],
                label_mask[mask],
                thresholds,
                label_names,
            )
    return result


def train_one_model(
    model_name: str,
    config: ModelConfig,
    train_loader: DataLoader,
    val_loader: DataLoader,
    test_loader: DataLoader,
    y_train: np.ndarray,
    label_mask_train: np.ndarray,
    source_val: np.ndarray,
    source_test: np.ndarray,
    label_names: list[str],
    feature_names: list[str],
    feature_mean: np.ndarray,
    feature_std: np.ndarray,
    min_coverage_ratio: float,
    max_interpolation_gap_minutes: int,
    device: torch.device,
    output_dir: Path,
    epochs: int,
    patience: int,
    learning_rate: float,
    weight_decay: float,
) -> dict:
    model = build_model(model_name, config).to(device)
    n_parameters = parameter_count(model)
    positive = (y_train * label_mask_train).sum(axis=0)
    negative = ((1.0 - y_train) * label_mask_train).sum(axis=0)
    pos_weight = torch.from_numpy(
        (negative / np.maximum(positive, 1)).astype(np.float32)
    ).to(device)
    loss_fn = MaskedBCEWithLogitsLoss(pos_weight=pos_weight)
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=learning_rate,
        weight_decay=weight_decay,
    )
    scaler = torch.amp.GradScaler(
        "cuda",
        enabled=device.type == "cuda",
    )

    history = {"train_loss": [], "val_loss": []}
    best_val_loss = float("inf")
    best_epoch = 0
    no_improvement = 0
    state_path = output_dir / f"{model_name}_best_state.pt"
    started = time.perf_counter()

    print(
        f"[{model_name}] parameters={n_parameters:,}, "
        f"device={device}, epochs={epochs}",
        flush=True,
    )
    for epoch in range(1, epochs + 1):
        model.train()
        train_loss = 0.0
        train_rows = 0
        train_supervised_cells = 0.0
        for features, labels, label_mask in train_loader:
            features = features.to(device, non_blocking=True)
            labels = labels.to(device, non_blocking=True)
            label_mask = label_mask.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            with torch.amp.autocast(
                device_type=device.type,
                enabled=device.type == "cuda",
            ):
                logits = model(features)
                loss = loss_fn(logits, labels, label_mask)
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
            scaler.step(optimizer)
            scaler.update()
            supervised_cells = float(label_mask.sum().item())
            train_loss += float(loss.item()) * supervised_cells
            train_supervised_cells += supervised_cells
            train_rows += len(features)

        train_loss /= max(train_supervised_cells, 1.0)
        val_loss, _, _, _ = predict_loader(
            model,
            val_loader,
            loss_fn,
            device,
        )
        history["train_loss"].append(train_loss)
        history["val_loss"].append(val_loss)
        print(
            f"[{model_name}] epoch={epoch:02d} "
            f"train_loss={train_loss:.5f} val_loss={val_loss:.5f}",
            flush=True,
        )

        if val_loss < best_val_loss - 1e-4:
            best_val_loss = val_loss
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

    model.load_state_dict(torch.load(state_path, map_location=device))
    (
        val_loss,
        val_probabilities,
        val_targets,
        val_label_mask,
    ) = predict_loader(
        model,
        val_loader,
        loss_fn,
        device,
    )
    (
        test_loss,
        test_probabilities,
        test_targets,
        test_label_mask,
    ) = predict_loader(
        model,
        test_loader,
        loss_fn,
        device,
    )
    thresholds = optimize_thresholds(
        val_targets,
        val_probabilities,
        val_label_mask,
    )
    validation_metrics = grouped_metrics(
        val_targets,
        val_probabilities,
        val_label_mask,
        source_val,
        thresholds,
        label_names,
    )
    test_metrics = grouped_metrics(
        test_targets,
        test_probabilities,
        test_label_mask,
        source_test,
        thresholds,
        label_names,
    )

    checkpoint_path = output_dir / f"{model_name}_checkpoint.pt"
    torch.save(
        {
            "task": (
                "realtime_current_minute_multi_label_"
                "resource_identification"
            ),
            "target_time": "window_endpoint_current_minute",
            "causal": True,
            "output_semantics": (
                "three booleans indicate whether PV, energy station, and charger "
                "operating signals are detectable at the current minute; "
                "they do not prove installation while fully idle"
            ),
            "model_name": model_name,
            "model_config": config.to_dict(),
            "model_state_dict": model.state_dict(),
            "feature_names": feature_names,
            "label_names": label_names,
            "feature_mean": feature_mean,
            "feature_std": feature_std,
            "thresholds": thresholds,
            "window_size": int(train_loader.dataset.tensors[0].shape[-1]),
            "min_coverage_ratio": min_coverage_ratio,
            "max_interpolation_gap_minutes": (
                max_interpolation_gap_minutes
            ),
        },
        checkpoint_path,
    )

    return {
        "model_name": model_name,
        "parameters": n_parameters,
        "best_epoch": best_epoch,
        "epochs_ran": len(history["train_loss"]),
        "best_validation_loss": float(best_val_loss),
        "final_validation_loss": float(val_loss),
        "test_loss": float(test_loss),
        "training_seconds": float(time.perf_counter() - started),
        "thresholds": {
            name: float(thresholds[index])
            for index, name in enumerate(label_names)
        },
        "validation_metrics": validation_metrics,
        "test_metrics": test_metrics,
        "history": history,
        "checkpoint_path": str(checkpoint_path),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Train causal real-time current-minute resource identifiers."
        )
    )
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--models",
        nargs="+",
        choices=["tcn", "tcn_lstm"],
        default=["tcn", "tcn_lstm"],
    )
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--patience", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--seed", type=int, default=20260729)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    set_seed(args.seed)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    dataset = np.load(args.dataset, allow_pickle=False)
    label_names = dataset["label_names"].astype(str).tolist()
    feature_names = dataset["feature_names"].astype(str).tolist()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    pin_memory = device.type == "cuda"
    train_loader = make_loader(
        dataset["x_train"],
        dataset["y_train"],
        dataset["label_mask_train"],
        args.batch_size,
        shuffle=True,
        seed=args.seed,
        pin_memory=pin_memory,
    )
    val_loader = make_loader(
        dataset["x_val"],
        dataset["y_val"],
        dataset["label_mask_val"],
        args.batch_size,
        shuffle=False,
        seed=args.seed,
        pin_memory=pin_memory,
    )
    test_loader = make_loader(
        dataset["x_test"],
        dataset["y_test"],
        dataset["label_mask_test"],
        args.batch_size,
        shuffle=False,
        seed=args.seed,
        pin_memory=pin_memory,
    )

    config = ModelConfig(
        input_channels=len(feature_names),
        output_labels=len(label_names),
    )
    results = []
    for model_name in args.models:
        set_seed(args.seed)
        results.append(
            train_one_model(
                model_name=model_name,
                config=config,
                train_loader=train_loader,
                val_loader=val_loader,
                test_loader=test_loader,
                y_train=dataset["y_train"],
                label_mask_train=dataset["label_mask_train"],
                source_val=dataset["source_val"],
                source_test=dataset["source_test"],
                label_names=label_names,
                feature_names=feature_names,
                feature_mean=dataset["feature_mean"],
                feature_std=dataset["feature_std"],
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
            )
        )

    selected = max(
        results,
        key=lambda result: (
            result["validation_metrics"]["all"]["macro_f1"],
            -result["parameters"],
        ),
    )
    selected_checkpoint = args.output_dir / "selected_model.pt"
    shutil.copyfile(selected["checkpoint_path"], selected_checkpoint)

    comparison = {
        "selection_rule": (
            "highest validation all-sources macro F1; "
            "parameter count is the tie breaker"
        ),
        "selected_model": selected["model_name"],
        "selected_checkpoint": str(selected_checkpoint),
        "device": str(device),
        "torch_version": torch.__version__,
        "seed": args.seed,
        "dataset": str(args.dataset),
        "results": results,
    }
    comparison_path = args.output_dir / "model_comparison.json"
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
                "validation_macro_f1": selected["validation_metrics"]["all"][
                    "macro_f1"
                ],
                "test_macro_f1": selected["test_metrics"]["all"]["macro_f1"],
            },
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
