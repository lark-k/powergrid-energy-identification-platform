from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as functional
from torch.utils.data import DataLoader, TensorDataset

from data_pipeline import (
    FOLDERS,
    align_main_components,
    contiguous_starts,
    load_parts,
    prepare_charger,
    slice_without_boundary_overlap,
)
from models import ModelConfig, build_model
from pv_disaggregation_models import PVModelConfig, build_pv_model


PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_IDENTIFICATION_DATASET = (
    PROJECT_DIR / "artifacts" / "device_detection_dataset.npz"
)
DEFAULT_IDENTIFICATION_CHECKPOINT = (
    PROJECT_DIR / "outputs" / "selected_model.pt"
)
DEFAULT_PV_DATASET = (
    PROJECT_DIR / "artifacts" / "pv_disaggregation_dataset.npz"
)
DEFAULT_PV_CHECKPOINT = (
    PROJECT_DIR / "pv_outputs" / "selected_pv_model.pt"
)
DEFAULT_OUTPUT_DIR = (
    PROJECT_DIR / "outputs" / "holdout_1000_20260731"
)

RESOURCE_NAMES = ["光伏", "能源站", "充电桩"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Evaluate deterministic samples from independent holdout sets."
    )
    parser.add_argument("--sample-size", type=int, default=1000)
    parser.add_argument(
        "--identification-dataset",
        type=Path,
        default=DEFAULT_IDENTIFICATION_DATASET,
    )
    parser.add_argument(
        "--identification-checkpoint",
        type=Path,
        default=DEFAULT_IDENTIFICATION_CHECKPOINT,
    )
    parser.add_argument(
        "--pv-dataset",
        type=Path,
        default=DEFAULT_PV_DATASET,
    )
    parser.add_argument(
        "--pv-checkpoint",
        type=Path,
        default=DEFAULT_PV_CHECKPOINT,
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--batch-size", type=int, default=512)
    return parser.parse_args()


def evenly_spaced_indices(indices: np.ndarray, count: int) -> np.ndarray:
    if count <= 0:
        return np.empty(0, dtype=np.int64)
    if len(indices) < count:
        raise ValueError(
            f"候选测试点只有 {len(indices)} 个，少于请求的 {count} 个"
        )
    positions = np.linspace(0, len(indices) - 1, count, dtype=np.int64)
    selected = indices[positions]
    if len(np.unique(selected)) != count:
        raise ValueError("等间隔取样产生了重复测试点")
    return selected


def binary_auc(target: np.ndarray, probability: np.ndarray) -> float | None:
    target_bool = target.astype(bool)
    positive_count = int(target_bool.sum())
    negative_count = int((~target_bool).sum())
    if positive_count == 0 or negative_count == 0:
        return None
    order = np.argsort(probability, kind="mergesort")
    sorted_probability = probability[order]
    sorted_target = target_bool[order]
    ranks = np.empty(len(probability), dtype=np.float64)
    start = 0
    while start < len(probability):
        end = start + 1
        while (
            end < len(probability)
            and sorted_probability[end] == sorted_probability[start]
        ):
            end += 1
        average_rank = (start + 1 + end) / 2.0
        ranks[order[start:end]] = average_rank
        start = end
    positive_rank_sum = float(ranks[target_bool].sum())
    return float(
        (
            positive_rank_sum
            - positive_count * (positive_count + 1) / 2.0
        )
        / (positive_count * negative_count)
    )


def classification_metrics(
    target: np.ndarray,
    probability: np.ndarray,
    predicted: np.ndarray,
) -> dict[str, float | int | None]:
    target_bool = target.astype(bool)
    predicted_bool = predicted.astype(bool)
    tp = int(np.logical_and(target_bool, predicted_bool).sum())
    tn = int(np.logical_and(~target_bool, ~predicted_bool).sum())
    fp = int(np.logical_and(~target_bool, predicted_bool).sum())
    fn = int(np.logical_and(target_bool, ~predicted_bool).sum())
    precision = tp / max(tp + fp, 1)
    recall = tp / max(tp + fn, 1)
    specificity = tn / max(tn + fp, 1)
    f1 = 2 * precision * recall / max(precision + recall, 1e-12)
    return {
        "样本数": int(len(target)),
        "正样本数": int(target_bool.sum()),
        "预测正样本数": int(predicted_bool.sum()),
        "准确率": float((target_bool == predicted_bool).mean()),
        "AUC": binary_auc(target, probability),
        "精确率": float(precision),
        "召回率": float(recall),
        "特异度": float(specificity),
        "F1": float(f1),
        "真阳性": tp,
        "真阴性": tn,
        "假阳性": fp,
        "假阴性": fn,
    }


def predict_identification(
    checkpoint_path: Path,
    windows: np.ndarray,
    batch_size: int,
    device: torch.device,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    checkpoint = torch.load(
        checkpoint_path,
        map_location="cpu",
        weights_only=False,
    )
    config = ModelConfig.from_dict(checkpoint["model_config"])
    model = build_model(checkpoint["model_name"], config)
    model.load_state_dict(checkpoint["model_state_dict"])
    model = model.to(device).eval()
    loader = DataLoader(
        TensorDataset(
            torch.from_numpy(windows).permute(0, 2, 1).contiguous()
        ),
        batch_size=batch_size,
        shuffle=False,
        num_workers=0,
        pin_memory=device.type == "cuda",
    )
    probabilities = []
    with torch.no_grad():
        for (features,) in loader:
            logits = model(features.to(device, non_blocking=True))
            probabilities.append(torch.sigmoid(logits).cpu().numpy())
    probability_array = np.concatenate(probabilities, axis=0)
    thresholds = np.asarray(checkpoint["thresholds"], dtype=np.float32)
    predicted = probability_array >= thresholds.reshape(1, -1)
    return probability_array, predicted.astype(np.int8), thresholds


def observed_test_endpoint_metadata(
    window_size: int,
    min_coverage_ratio: float,
    max_interpolation_gap_minutes: int,
) -> tuple[np.ndarray, np.ndarray]:
    loaded = {
        key: load_parts(FOLDERS[key])
        for key in [
            "main_b",
            "pv_b",
            "energy_station_b",
            "charger_post_12",
            "charger_post_13",
        ]
    }
    main_b = align_main_components(
        loaded["main_b"],
        loaded["pv_b"],
        loaded["energy_station_b"],
        min_coverage_ratio=min_coverage_ratio,
        max_interpolation_gap_minutes=max_interpolation_gap_minutes,
    )
    _, main_test = slice_without_boundary_overlap(main_b)
    charger_frames = [
        prepare_charger(
            loaded[key],
            min_coverage_ratio=min_coverage_ratio,
            max_interpolation_gap_minutes=max_interpolation_gap_minutes,
        )
        for key in ["charger_post_12", "charger_post_13"]
    ]
    charger_test_frames = [
        slice_without_boundary_overlap(frame)[1]
        for frame in charger_frames
    ]

    time_arrays: list[np.ndarray] = []
    source_arrays: list[np.ndarray] = []
    for frame, source_name in [
        (main_test, "总开实测"),
        (charger_test_frames[0], "12号充电馈线实测"),
        (charger_test_frames[1], "13号充电馈线实测"),
    ]:
        starts = contiguous_starts(
            frame["minute_start"].to_numpy(),
            window_size,
            1,
        )
        end_rows = starts + window_size - 1
        starts = starts[
            frame.loc[
                end_rows,
                "main__is_interpolated",
            ].to_numpy(dtype=np.int8)
            == 0
        ]
        end_rows = starts + window_size - 1
        time_arrays.append(
            frame.loc[end_rows, "minute_start"].to_numpy(
                dtype="datetime64[ns]"
            )
        )
        source_arrays.append(
            np.full(len(starts), source_name, dtype=object)
        )
    return np.concatenate(time_arrays), np.concatenate(source_arrays)


def evaluate_identification(
    dataset_path: Path,
    checkpoint_path: Path,
    sample_size: int,
    batch_size: int,
    device: torch.device,
) -> tuple[pd.DataFrame, dict]:
    with np.load(dataset_path, allow_pickle=False) as dataset:
        x_test = dataset["x_test"]
        y_test = dataset["y_test"]
        label_mask = dataset["label_mask_test"]
        source = dataset["source_test"]
        feature_mean = dataset["feature_mean"]
        feature_std = dataset["feature_std"]
        min_coverage_ratio = round(
            float(dataset["min_coverage_ratio"]),
            6,
        )
        max_gap = int(dataset["max_interpolation_gap_minutes"])

    observed_main = np.flatnonzero(source == 0)
    observed_charger = np.flatnonzero(source == 1)
    main_count = sample_size // 2
    charger_count = sample_size - main_count
    selected = np.concatenate(
        [
            evenly_spaced_indices(observed_main, main_count),
            evenly_spaced_indices(observed_charger, charger_count),
        ]
    )

    probabilities, predicted, thresholds = predict_identification(
        checkpoint_path,
        x_test[selected],
        batch_size,
        device,
    )
    targets = y_test[selected]
    masks = label_mask[selected] > 0
    endpoint_kw = (
        x_test[selected, -1, 0] * feature_std[0] + feature_mean[0]
    )

    endpoint_times, source_names = observed_test_endpoint_metadata(
        window_size=x_test.shape[1],
        min_coverage_ratio=min_coverage_ratio,
        max_interpolation_gap_minutes=max_gap,
    )
    observed_count = int((source != 2).sum())
    if len(endpoint_times) != observed_count:
        raise ValueError(
            "重建的实测测试时间数量与辨识测试集不一致："
            f"{len(endpoint_times)} != {observed_count}"
        )
    selected_observed_positions = np.concatenate(
        [
            np.flatnonzero(source == 0)[
                np.linspace(
                    0,
                    len(observed_main) - 1,
                    main_count,
                    dtype=np.int64,
                )
            ],
            np.flatnonzero(source == 1)[
                np.linspace(
                    0,
                    len(observed_charger) - 1,
                    charger_count,
                    dtype=np.int64,
                )
            ],
        ]
    )
    if not np.array_equal(selected, selected_observed_positions):
        raise ValueError("测试集索引映射不一致")

    detail = pd.DataFrame(
        {
            "测试序号": np.arange(1, sample_size + 1),
            "测试集索引": selected,
            "目标分钟": endpoint_times[selected],
            "数据来源": source_names[selected],
            "目标分钟有功功率(kW)": endpoint_kw,
        }
    )
    resource_metrics = {}
    all_correct = []
    for label_index, resource_name in enumerate(RESOURCE_NAMES):
        known = masks[:, label_index]
        detail[f"{resource_name}真值有效"] = known.astype(np.int8)
        detail[f"{resource_name}真实状态"] = np.where(
            known,
            targets[:, label_index],
            np.nan,
        )
        detail[f"{resource_name}运行概率"] = probabilities[:, label_index]
        detail[f"{resource_name}预测状态"] = predicted[:, label_index]
        detail[f"{resource_name}是否正确"] = np.where(
            known,
            predicted[:, label_index]
            == targets[:, label_index].astype(np.int8),
            np.nan,
        )
        resource_metrics[resource_name] = classification_metrics(
            targets[known, label_index],
            probabilities[known, label_index],
            predicted[known, label_index],
        )
        resource_metrics[resource_name]["判定阈值"] = float(
            thresholds[label_index]
        )
        all_correct.extend(
            (
                predicted[known, label_index]
                == targets[known, label_index].astype(np.int8)
            ).tolist()
        )
    summary = {
        "测试点数": sample_size,
        "取样方式": (
            "独立测试集内等间隔确定性取样；500个总开实测点和"
            "500个充电馈线实测点；不含合成样本"
        ),
        "总开实测点数": main_count,
        "充电馈线实测点数": charger_count,
        "有真值的标签判断数": len(all_correct),
        "整体有真值标签准确率": float(np.mean(all_correct)),
        "各资源": resource_metrics,
    }
    return detail, summary


def predict_pv(
    checkpoint_path: Path,
    windows: np.ndarray,
    batch_size: int,
    device: torch.device,
) -> tuple[np.ndarray, np.ndarray, float]:
    checkpoint = torch.load(
        checkpoint_path,
        map_location="cpu",
        weights_only=False,
    )
    config = PVModelConfig.from_dict(checkpoint["model_config"])
    model = build_pv_model(checkpoint["model_name"], config)
    model.load_state_dict(checkpoint["model_state_dict"])
    model = model.to(device).eval()
    loader = DataLoader(
        TensorDataset(
            torch.from_numpy(windows).permute(0, 2, 1).contiguous()
        ),
        batch_size=batch_size,
        shuffle=False,
        num_workers=0,
        pin_memory=device.type == "cuda",
    )
    probabilities = []
    raw_generation = []
    target_scale_kw = float(checkpoint["target_scale_kw"])
    with torch.no_grad():
        for (features,) in loader:
            activity_logits, magnitude_raw = model(
                features.to(device, non_blocking=True)
            )
            probability = torch.sigmoid(activity_logits)
            prediction = (
                probability
                * functional.softplus(magnitude_raw)
                * target_scale_kw
            )
            probabilities.append(probability.cpu().numpy())
            raw_generation.append(prediction.cpu().numpy())
    probability_array = np.concatenate(probabilities)
    raw_generation_array = np.concatenate(raw_generation)
    power_gate = float(checkpoint["power_gate_threshold"])
    generation = np.where(
        probability_array >= power_gate,
        raw_generation_array,
        0.0,
    )
    activity_threshold = float(
        checkpoint["activity_probability_threshold"]
    )
    return probability_array, generation, activity_threshold


def evaluate_pv(
    dataset_path: Path,
    checkpoint_path: Path,
    sample_size: int,
    batch_size: int,
    device: torch.device,
) -> tuple[pd.DataFrame, dict]:
    with np.load(dataset_path, allow_pickle=False) as dataset:
        x_test = dataset["x_test"]
        y_power = dataset["y_power_test"]
        y_active = dataset["y_active_test"]
        end_times = dataset["end_time_test"]

    selected = evenly_spaced_indices(
        np.arange(len(x_test), dtype=np.int64),
        sample_size,
    )
    probabilities, generation, activity_threshold = predict_pv(
        checkpoint_path,
        x_test[selected],
        batch_size,
        device,
    )
    true_power = y_power[selected]
    true_active = y_active[selected].astype(np.int8)
    predicted_active = (
        probabilities >= activity_threshold
    ).astype(np.int8)
    error = generation - true_power
    absolute_error = np.abs(error)
    squared_error = error**2
    active_mask = true_active > 0
    total_variance = float(
        np.sum((true_power - true_power.mean()) ** 2)
    )
    r_squared = (
        1.0 - float(squared_error.sum()) / total_variance
        if total_variance > 0
        else None
    )
    true_energy = float(true_power.sum() / 60.0)
    predicted_energy = float(generation.sum() / 60.0)

    detail = pd.DataFrame(
        {
            "测试序号": np.arange(1, sample_size + 1),
            "测试集索引": selected,
            "目标分钟": pd.to_datetime(end_times[selected]),
            "实际光伏发电功率(kW)": true_power,
            "分离光伏发电功率(kW)": generation,
            "分离偏差(kW)": error,
            "绝对偏差(kW)": absolute_error,
            "实际光伏运行状态": true_active,
            "光伏运行概率": probabilities,
            "分离光伏运行状态": predicted_active,
            "运行状态是否正确": (
                predicted_active == true_active
            ).astype(np.int8),
        }
    )
    power_summary = {
        "样本数": sample_size,
        "MAE(kW)": float(absolute_error.mean()),
        "RMSE(kW)": float(np.sqrt(squared_error.mean())),
        "平均偏差(kW)": float(error.mean()),
        "绝对偏差中位数(kW)": float(np.median(absolute_error)),
        "绝对偏差P95(kW)": float(np.quantile(absolute_error, 0.95)),
        "最大绝对偏差(kW)": float(absolute_error.max()),
        "决定系数R2": r_squared,
        "实际累计电量(kWh)": true_energy,
        "分离累计电量(kWh)": predicted_energy,
        "累计电量偏差(kWh)": predicted_energy - true_energy,
        "累计电量偏差率": (
            (predicted_energy - true_energy) / true_energy
            if true_energy > 0
            else None
        ),
        "实际运行样本数": int(active_mask.sum()),
        "运行时MAE(kW)": (
            float(absolute_error[active_mask].mean())
            if active_mask.any()
            else None
        ),
        "停机时误分离MAE(kW)": (
            float(absolute_error[~active_mask].mean())
            if (~active_mask).any()
            else None
        ),
    }
    activity_summary = classification_metrics(
        true_active,
        probabilities,
        predicted_active,
    )
    activity_summary["判定阈值"] = activity_threshold
    summary = {
        "测试点数": sample_size,
        "取样方式": "独立光伏测试集内按时间等间隔确定性取样",
        "测试起始分钟": str(detail["目标分钟"].min()),
        "测试结束分钟": str(detail["目标分钟"].max()),
        "功率分离": power_summary,
        "运行状态": activity_summary,
    }
    return detail, summary


def main() -> None:
    args = parse_args()
    if args.sample_size <= 0:
        raise ValueError("--sample-size 必须为正整数")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    identification_detail, identification_summary = (
        evaluate_identification(
            args.identification_dataset,
            args.identification_checkpoint,
            args.sample_size,
            args.batch_size,
            device,
        )
    )
    pv_detail, pv_summary = evaluate_pv(
        args.pv_dataset,
        args.pv_checkpoint,
        args.sample_size,
        args.batch_size,
        device,
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    identification_path = (
        args.output_dir / "辨识测试_1000点_逐点结果.csv"
    )
    pv_path = args.output_dir / "光伏分离测试_1000点_逐点结果.csv"
    summary_path = args.output_dir / "独立测试集_1000点_指标汇总.json"
    identification_detail.to_csv(
        identification_path,
        index=False,
        encoding="utf-8-sig",
    )
    pv_detail.to_csv(pv_path, index=False, encoding="utf-8-sig")
    summary = {
        "测试设备": str(device),
        "说明": (
            "两组结果均来自训练阶段未参与模型拟合的独立测试集。"
            "辨识测试排除了合成样本。"
        ),
        "资源辨识": identification_summary,
        "光伏分离": pv_summary,
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "资源辨识结果": str(identification_path),
                "光伏分离结果": str(pv_path),
                "指标汇总": str(summary_path),
                "资源辨识整体准确率": identification_summary[
                    "整体有真值标签准确率"
                ],
                "光伏分离MAE(kW)": pv_summary["功率分离"]["MAE(kW)"],
                "光伏分离RMSE(kW)": pv_summary["功率分离"]["RMSE(kW)"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
