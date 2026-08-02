#!/usr/bin/env python3
# Version 4 timing fix:
# - Default intrafile time axis: physical DAT record index / CFG sample rate.
# - Does not assume any archive is exactly ten minutes long.
# - Optional validated DAT timestamp mode is retained for other devices.
# - Existing 100-archive CSV partitioning and cross-part minute stitching remain.
#
"""
批量处理包含 COMTRADE .cfg/.dat 文件的 7z 压缩包，计算每分钟三相有功功率。

主要功能：
1. 按压缩包文件名中的时间顺序处理；
2. 跳过开头体积异常偏小的压缩包，默认阈值为 30 MiB；
3. 支持 COMTRADE BINARY、BINARY32 和 FLOAT32 数据格式；
4. 根据 CFG 中的 a*x+b 系数，将 Ua/Ub/Uc/Ia/Ib/Ic 原始码转换为工程量；
5. 计算带符号的三相瞬时有功功率：
       p = Ua*Ia + Ub*Ib + Uc*Ic
6. 按自然分钟聚合，并允许同一分钟的数据跨越多个压缩包；
7. 自动删除相邻录波文件之间重复的采样点；
8. 标记不完整分钟，并输出逐文件处理日志；
9. 每处理指定数量的有效压缩包，立即写出一个分钟级 CSV 分片；
10. 分片时保留尚未结束的最后一个自然分钟，供下一批压缩包继续拼接。

时间处理原则：
1. 文件名时间用于排序、校验和必要时的回退；
2. CFG 起始时间通常优先，因为其可能包含更高的时间精度；
3. DAT 内部时间戳可用时优先使用，否则根据采样序号和采样频率重建；
4. 绝不假设每个文件恰好为 10 分钟，真实时长由 DAT 实际记录数、
   内部时间戳和采样频率共同确定。

前提：Ua/Ub/Uc 是相电压，电压与对应电流同步采样。确认电流方向前，
不要对有功功率直接取绝对值。
"""

from __future__ import annotations

import argparse
import csv
import math
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

import numpy as np

EPOCH = datetime(1970, 1, 1)
MINUTE_US = 60_000_000
ARCHIVE_TS_RE = re.compile(r"_(\d{8})_(\d{6})_(\d+)(?:\.7z)$", re.IGNORECASE)

# 文件名时间只有秒级精度，而 CFG 时间可能包含微秒。
# 二者差异超过该阈值时，将在日志中标记为时间元数据不一致。
FILENAME_CFG_WARNING_SECONDS = 2.0


@dataclass(frozen=True)
class AnalogChannel:
    index: int
    name: str
    unit: str
    a: float
    b: float
    primary: float
    secondary: float
    ps: str


@dataclass(frozen=True)
class ComtradeConfig:
    cfg_path: Path
    station_name: str
    device_id: str
    revision: str
    total_channels: int
    analog_count: int
    digital_count: int
    analog_channels: Tuple[AnalogChannel, ...]
    nominal_frequency: float
    sample_rates: Tuple[Tuple[float, int], ...]
    start_time: datetime
    trigger_time: datetime
    data_format: str
    time_multiplier: float

    @property
    def sample_rate(self) -> float:
        if len(self.sample_rates) != 1:
            raise ValueError(
                f"Only one sample rate is supported, got {len(self.sample_rates)} in {self.cfg_path}"
            )
        return self.sample_rates[0][0]

    @property
    def declared_last_sample(self) -> int:
        return self.sample_rates[-1][1]


@dataclass(frozen=True)
class ArchiveTimeInfo:
    """单个压缩包的时间元数据解析结果。

    filename_time:
        从如下文件名中解析出的时间：
        BAY01_0000_20251222_181242_000.7z.
    effective_start_time:
        DAT 相对时间转换为绝对时间时使用的起点。
    source:
        实际采用了哪一种时间来源，写入处理日志。
    difference_seconds:
        CFG 起始时间减去文件名时间，用于定位错名或时间配置异常。
    """

    filename_time: Optional[datetime]
    effective_start_time: datetime
    source: str
    difference_seconds: Optional[float]


@dataclass
class MinuteAccumulator:
    sum_pa: float = 0.0
    sum_pb: float = 0.0
    sum_pc: float = 0.0
    count: int = 0
    first_us: Optional[int] = None
    last_us: Optional[int] = None
    archives: Optional[Set[str]] = None

    def __post_init__(self) -> None:
        if self.archives is None:
            self.archives = set()

    def add(
        self,
        sum_pa: float,
        sum_pb: float,
        sum_pc: float,
        count: int,
        first_us: int,
        last_us: int,
        archive_name: str,
    ) -> None:
        self.sum_pa += float(sum_pa)
        self.sum_pb += float(sum_pb)
        self.sum_pc += float(sum_pc)
        self.count += int(count)
        self.first_us = first_us if self.first_us is None else min(self.first_us, first_us)
        self.last_us = last_us if self.last_us is None else max(self.last_us, last_us)
        self.archives.add(archive_name)


@dataclass(frozen=True)
class DatProcessResult:
    """单个 DAT 文件解码、校时和去重后的处理摘要。"""

    record_count: int
    processed_count: int
    overlap_dropped: int
    first_raw_us: Optional[int]
    last_raw_us: Optional[int]
    first_kept_us: Optional[int]
    last_kept_us: Optional[int]
    trailing_bytes: int
    gap_before_us: Optional[int]
    actual_duration_seconds: float
    nominal_duration_from_count_seconds: float
    declared_duration_seconds: float
    timestamp_mode: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compute minute-level three-phase active power from COMTRADE archives."
    )
    parser.add_argument("--input-dir", required=True, type=Path, help="Directory containing .7z archives")
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help=(
            "Base output CSV path. Part files are written as "
            "<stem>_part_0001.csv, <stem>_part_0002.csv, ..."
        ),
    )
    parser.add_argument(
        "--log-output",
        type=Path,
        default=None,
        help="Per-archive processing log CSV (default: <output_stem>_processing_log.csv)",
    )
    parser.add_argument(
        "--min-leading-mb",
        type=float,
        default=30.0,
        help=(
            "Skip .7z files smaller than this only before the first normal archive. "
            "Set 0 to disable. Default: 30 MiB"
        ),
    )
    parser.add_argument(
        "--chunk-records",
        type=int,
        default=250_000,
        help="COMTRADE records processed per chunk. Default: 250000",
    )
    parser.add_argument(
        "--archives-per-output",
        type=int,
        default=100,
        help=(
            "Write one minute-level CSV part after this many successfully processed "
            "archives. The still-open last natural minute is retained for the next part. "
            "Default: 100"
        ),
    )
    parser.add_argument(
        "--complete-threshold",
        type=float,
        default=0.999,
        help="Minimum sample coverage ratio for is_complete=1. Default: 0.999",
    )
    parser.add_argument(
        "--power-sign",
        type=int,
        choices=(-1, 1),
        default=1,
        help="Multiply final power by 1 or -1 after confirming current polarity. Default: 1",
    )
    parser.add_argument(
        "--time-source",
        choices=("auto", "cfg", "filename"),
        default="auto",
        help=(
            "Absolute start-time source. auto: use CFG when it agrees with the filename "
            "within 2 s, otherwise use filename time and log the mismatch; cfg: always use "
            "CFG; filename: always use filename when parsable. Default: auto"
        ),
    )
    parser.add_argument(
        "--relative-time-source",
        choices=("sample_index", "auto", "dat_timestamp"),
        default="sample_index",
        help=(
            "How to reconstruct time inside each DAT file. sample_index: use the physical "
            "record position divided by the CFG sampling rate (recommended for this device); "
            "auto: use DAT timestamps only when they pass monotonicity and duration checks; "
            "dat_timestamp: force DAT timestamps. Default: sample_index"
        ),
    )
    parser.add_argument(
        "--keep-temp",
        action="store_true",
        help="Keep extracted temporary directories for debugging",
    )
    return parser.parse_args()


def parse_comtrade_datetime(text: str) -> datetime:
    text = text.strip()
    formats = (
        "%d/%m/%Y,%H:%M:%S.%f",
        "%d/%m/%Y,%H:%M:%S",
        "%m/%d/%Y,%H:%M:%S.%f",
        "%m/%d/%Y,%H:%M:%S",
    )
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            pass
    raise ValueError(f"Unsupported COMTRADE datetime: {text!r}")


def read_cfg(cfg_path: Path) -> ComtradeConfig:
    raw = cfg_path.read_bytes()
    text: Optional[str] = None
    for encoding in ("utf-8-sig", "gb18030", "latin-1"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError(f"Cannot decode CFG: {cfg_path}")

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) < 8:
        raise ValueError(f"CFG too short: {cfg_path}")

    header = [x.strip() for x in lines[0].split(",")]
    station = header[0] if len(header) > 0 else ""
    device = header[1] if len(header) > 1 else ""
    revision = header[2] if len(header) > 2 else "1991"

    channel_parts = [x.strip() for x in lines[1].split(",")]
    total_channels = int(channel_parts[0])
    analog_count = int(channel_parts[1].upper().rstrip("A"))
    digital_count = int(channel_parts[2].upper().rstrip("D"))

    cursor = 2
    analog_channels: List[AnalogChannel] = []
    for _ in range(analog_count):
        parts = [x.strip() for x in lines[cursor].split(",")]
        if len(parts) < 13:
            raise ValueError(f"Malformed analog channel line in {cfg_path}: {lines[cursor]}")
        analog_channels.append(
            AnalogChannel(
                index=int(parts[0]),
                name=parts[1],
                unit=parts[4],
                a=float(parts[5]),
                b=float(parts[6]),
                primary=float(parts[10]),
                secondary=float(parts[11]),
                ps=parts[12].upper(),
            )
        )
        cursor += 1

    cursor += digital_count
    nominal_frequency = float(lines[cursor])
    cursor += 1
    nrates = int(lines[cursor])
    cursor += 1

    sample_rates: List[Tuple[float, int]] = []
    for _ in range(nrates):
        parts = [x.strip() for x in lines[cursor].split(",")]
        sample_rates.append((float(parts[0]), int(parts[1])))
        cursor += 1

    start_time = parse_comtrade_datetime(lines[cursor])
    cursor += 1
    trigger_time = parse_comtrade_datetime(lines[cursor])
    cursor += 1
    data_format = lines[cursor].strip().upper()
    cursor += 1
    time_multiplier = float(lines[cursor]) if cursor < len(lines) else 1.0

    return ComtradeConfig(
        cfg_path=cfg_path,
        station_name=station,
        device_id=device,
        revision=revision,
        total_channels=total_channels,
        analog_count=analog_count,
        digital_count=digital_count,
        analog_channels=tuple(analog_channels),
        nominal_frequency=nominal_frequency,
        sample_rates=tuple(sample_rates),
        start_time=start_time,
        trigger_time=trigger_time,
        data_format=data_format,
        time_multiplier=time_multiplier,
    )


def parse_archive_filename_time(path: Path) -> Optional[datetime]:
    """Parse the second-resolution timestamp embedded in the archive name.

    Expected example:
        BAY01_0000_20251222_181242_000.7z

    Returns None for files that do not follow this naming convention. Such files
    are still retained by the scanner, but they sort after correctly named files.
    """

    match = ARCHIVE_TS_RE.search(path.name)
    if not match:
        return None
    date_text, time_text, _suffix = match.groups()
    return datetime.strptime(date_text + time_text, "%Y%m%d%H%M%S")


def archive_sort_key(path: Path) -> Tuple[int, datetime, int, str]:
    """Sort by filename time first, then by the trailing numeric sequence."""

    match = ARCHIVE_TS_RE.search(path.name)
    if not match:
        return (1, datetime.max, 0, path.name)
    date_text, time_text, suffix = match.groups()
    dt = datetime.strptime(date_text + time_text, "%Y%m%d%H%M%S")
    return (0, dt, int(suffix), path.name)


def resolve_archive_time(
    archive: Path,
    cfg: ComtradeConfig,
    mode: str,
) -> ArchiveTimeInfo:
    """Combine filename and CFG time information without assuming 10 minutes.

    The CFG start time is used as the absolute origin whenever it is available,
    because COMTRADE CFG can preserve microseconds while the filename only keeps
    whole seconds. The filename timestamp is not discarded: it is logged and
    compared with CFG time so incorrectly named or mismatched files are visible.

    Actual end time is *not* inferred here. It is calculated later from DAT
    internal timestamps or actual record count plus sampling frequency.
    """

    filename_time = parse_archive_filename_time(archive)
    if filename_time is None:
        return ArchiveTimeInfo(
            filename_time=None,
            effective_start_time=cfg.start_time,
            source="cfg_only",
            difference_seconds=None,
        )

    difference_seconds = (cfg.start_time - filename_time).total_seconds()
    if mode == "cfg":
        effective_start_time = cfg.start_time
        source = "cfg_forced"
    elif mode == "filename":
        effective_start_time = filename_time
        source = "filename_forced"
    elif abs(difference_seconds) <= FILENAME_CFG_WARNING_SECONDS:
        # Normal case: the second-level filename time confirms the CFG time,
        # while CFG preserves any sub-second precision.
        effective_start_time = cfg.start_time
        source = "cfg_verified_by_filename"
    else:
        # In auto mode, a large mismatch is treated as a metadata problem.
        # The user-stated naming convention is used as the absolute start time,
        # while both values and their difference remain visible in the log.
        effective_start_time = filename_time
        source = "filename_due_to_cfg_mismatch"

    return ArchiveTimeInfo(
        filename_time=filename_time,
        effective_start_time=effective_start_time,
        source=source,
        difference_seconds=difference_seconds,
    )


def find_archives(input_dir: Path) -> List[Path]:
    if not input_dir.is_dir():
        raise FileNotFoundError(f"Input directory does not exist: {input_dir}")
    archives = [p for p in input_dir.iterdir() if p.is_file() and p.suffix.lower() == ".7z"]
    archives.sort(key=archive_sort_key)
    return archives


def extract_7z(archive: Path, dest: Path) -> None:
    seven_zip = shutil.which("7z") or shutil.which("7zz") or shutil.which("7za")
    if seven_zip:
        result = subprocess.run(
            [seven_zip, "x", "-y", f"-o{dest}", str(archive)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode != 0:
            raise RuntimeError(f"7z extraction failed for {archive}:\n{result.stdout[-2000:]}")
        return

    try:
        import py7zr  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "No 7z/7zz/7za command found and py7zr is not installed. "
            "Run: python -m pip install py7zr"
        ) from exc

    with py7zr.SevenZipFile(archive, mode="r") as zf:
        zf.extractall(path=dest)


def find_cfg_dat(root: Path) -> Tuple[Path, Path]:
    files = [p for p in root.rglob("*") if p.is_file()]
    cfgs = [p for p in files if p.suffix.lower() == ".cfg"]
    dats = [p for p in files if p.suffix.lower() == ".dat"]
    if len(cfgs) != 1:
        raise ValueError(f"Expected exactly one .cfg, found {len(cfgs)} in {root}")
    cfg = cfgs[0]
    same_stem = [p for p in dats if p.stem.lower() == cfg.stem.lower()]
    if len(same_stem) == 1:
        return cfg, same_stem[0]
    if len(dats) == 1:
        return cfg, dats[0]
    raise ValueError(f"Could not identify matching .dat for {cfg.name}; found {len(dats)} DAT files")


def normalize_channel_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def resolve_power_channels(cfg: ComtradeConfig) -> Dict[str, int]:
    aliases = {
        "ua": {"ua", "uaph", "va", "van", "voltagea"},
        "ub": {"ub", "ubph", "vb", "vbn", "voltageb"},
        "uc": {"uc", "ucph", "vc", "vcn", "voltagec"},
        "ia": {"ia", "iaph", "currenta"},
        "ib": {"ib", "ibph", "currentb"},
        "ic": {"ic", "icph", "currentc"},
    }
    normalized = [normalize_channel_name(ch.name) for ch in cfg.analog_channels]
    resolved: Dict[str, int] = {}
    for target, names in aliases.items():
        matches = [idx for idx, value in enumerate(normalized) if value in names]
        if len(matches) != 1:
            available = ", ".join(ch.name for ch in cfg.analog_channels)
            raise ValueError(
                f"Cannot uniquely resolve {target} in {cfg.cfg_path.name}; available channels: {available}"
            )
        resolved[target] = matches[0]
    return resolved


def build_record_dtype(cfg: ComtradeConfig) -> np.dtype:
    fmt = cfg.data_format
    if fmt == "BINARY":
        analog_dtype = "<i2"
    elif fmt == "BINARY32":
        analog_dtype = "<i4"
    elif fmt == "FLOAT32":
        analog_dtype = "<f4"
    else:
        raise ValueError(f"Unsupported DAT format {fmt}; this script expects BINARY/BINARY32/FLOAT32")

    digital_words = math.ceil(cfg.digital_count / 16)
    fields: List[Tuple] = [
        ("sample_no", "<u4"),
        ("timestamp", "<u4"),
        ("analog", analog_dtype, (cfg.analog_count,)),
    ]
    if digital_words:
        fields.append(("digital", "<u2", (digital_words,)))
    return np.dtype(fields, align=False)


def datetime_to_epoch_us(value: datetime) -> int:
    return int(round((value - EPOCH).total_seconds() * 1_000_000))


def epoch_us_to_text(value: int) -> str:
    return (EPOCH + timedelta(microseconds=int(value))).strftime("%Y-%m-%d %H:%M:%S.%f")


def channel_scale(cfg: ComtradeConfig, idx: int) -> Tuple[float, float]:
    ch = cfg.analog_channels[idx]
    # a*x+b already produces the engineering value represented by the DAT file.
    # The provided files use primary=secondary=1, so no extra CT/PT conversion is needed.
    return ch.a, ch.b


def process_dat(
    cfg: ComtradeConfig,
    dat_path: Path,
    archive_name: str,
    effective_start_time: datetime,
    accumulators: Dict[int, MinuteAccumulator],
    chunk_records: int,
    last_global_us: Optional[int],
    expected_sample_rate: Optional[float],
    relative_time_source: str,
) -> DatProcessResult:
    """Decode one DAT file and add its samples to minute accumulators.

    Important: this function does not assume that one archive equals ten minutes.
    The file's true sample count is derived from DAT byte size. Absolute sample
    times are reconstructed from:

    - effective archive start time (resolved from CFG + filename), and
    - physical DAT record position divided by the CFG sampling rate by default.

    The device's DAT timestamp field is not trusted blindly. In ``auto`` mode it
    is used only when sampled timestamp values are monotonic and their total
    duration agrees with ``record_count / sample_rate``.

    This lets a partial final minute continue in the next archive. If adjacent
    archives overlap, samples whose absolute time is not newer than the last
    accepted sample are discarded to prevent double counting.
    """

    sample_rate = cfg.sample_rate
    if expected_sample_rate is not None and not math.isclose(
        sample_rate, expected_sample_rate, rel_tol=0.0, abs_tol=1e-9
    ):
        raise ValueError(
            f"Sample rate changed from {expected_sample_rate} to {sample_rate} in {cfg.cfg_path.name}"
        )

    dtype = build_record_dtype(cfg)
    file_size = dat_path.stat().st_size
    record_count = file_size // dtype.itemsize
    trailing_bytes = file_size % dtype.itemsize
    if record_count <= 0:
        raise ValueError(f"DAT has no complete records: {dat_path}")

    data = np.memmap(dat_path, dtype=dtype, mode="r", shape=(record_count,))
    channels = resolve_power_channels(cfg)
    scales = {name: channel_scale(cfg, idx) for name, idx in channels.items()}

    # The effective start time has already been cross-checked against the archive
    # filename. It may equal CFG start time or filename time, depending on mode.
    start_us = datetime_to_epoch_us(effective_start_time)
    sample_period_us = 1_000_000.0 / sample_rate

    # Reconstruct the time axis inside this DAT file.
    #
    # Default and recommended for this device:
    #     relative_time = physical_record_index / sampling_rate
    #
    # This uses the actual DAT record count and therefore does not assume that
    # any archive is exactly ten minutes long.
    first_dat_timestamp = int(data[0]["timestamp"])
    last_dat_timestamp = int(data[record_count - 1]["timestamp"])
    use_dat_timestamps = relative_time_source == "dat_timestamp"

    if relative_time_source == "auto":
        # Validate only bounded probes from the beginning and end to avoid
        # loading the entire large DAT file into memory.
        probe_count = min(record_count, 4096)
        head_ts = np.asarray(data[:probe_count]["timestamp"], dtype=np.int64)
        tail_ts = np.asarray(data[-probe_count:]["timestamp"], dtype=np.int64)

        head_monotonic = bool(np.all(np.diff(head_ts) >= 0)) if head_ts.size > 1 else True
        tail_monotonic = bool(np.all(np.diff(tail_ts) >= 0)) if tail_ts.size > 1 else True

        dat_span_us = (
            (last_dat_timestamp - first_dat_timestamp) * cfg.time_multiplier
        )
        expected_span_us = (record_count - 1) * sample_period_us
        duration_ok = (
            expected_span_us <= 0
            or abs(dat_span_us - expected_span_us)
            <= max(10_000.0, 0.02 * expected_span_us)
        )

        use_dat_timestamps = (
            last_dat_timestamp > first_dat_timestamp
            and head_monotonic
            and tail_monotonic
            and duration_ok
        )

    timestamp_mode = (
        "dat_timestamp_validated"
        if use_dat_timestamps
        else "sample_index_and_rate"
    )

    overlap_dropped = 0
    processed_count = 0
    first_kept_us: Optional[int] = None
    last_kept_us: Optional[int] = last_global_us
    first_raw_us: Optional[int] = None
    last_raw_us: Optional[int] = None
    gap_before_us: Optional[int] = None

    for begin in range(0, record_count, chunk_records):
        end = min(begin + chunk_records, record_count)
        chunk = data[begin:end]

        if use_dat_timestamps:
            # Normalize against the first DAT timestamp because some devices
            # start their relative timestamp counter from a non-zero value.
            raw_rel = (
                chunk["timestamp"].astype(np.float64)
                - float(first_dat_timestamp)
            )
            rel_us = np.rint(
                raw_rel * cfg.time_multiplier
            ).astype(np.int64)
        else:
            # The physical record order is authoritative. This remains stable
            # even when the DAT sample_no or timestamp fields are non-standard.
            record_positions = begin + np.arange(
                end - begin,
                dtype=np.int64,
            )
            rel_us = np.rint(
                record_positions.astype(np.float64) * sample_period_us
            ).astype(np.int64)

        abs_us = rel_us + start_us

        if first_raw_us is None and abs_us.size:
            first_raw_us = int(abs_us[0])
            if last_global_us is not None:
                nominal_next = last_global_us + int(round(sample_period_us))
                gap_before_us = first_raw_us - nominal_next

        if abs_us.size:
            last_raw_us = int(abs_us[-1])

        if last_kept_us is not None:
            # Adjacent recordings may contain a few repeated samples. Absolute
            # timestamps make it possible to remove only the overlapping prefix.
            keep = abs_us > last_kept_us
            overlap_dropped += int((~keep).sum())
            if not np.any(keep):
                continue
            abs_us = abs_us[keep]
            analog = chunk["analog"][keep]
        else:
            analog = chunk["analog"]

        raw_ua = analog[:, channels["ua"]].astype(np.float64)
        raw_ub = analog[:, channels["ub"]].astype(np.float64)
        raw_uc = analog[:, channels["uc"]].astype(np.float64)
        raw_ia = analog[:, channels["ia"]].astype(np.float64)
        raw_ib = analog[:, channels["ib"]].astype(np.float64)
        raw_ic = analog[:, channels["ic"]].astype(np.float64)

        ua = raw_ua * scales["ua"][0] + scales["ua"][1]
        ub = raw_ub * scales["ub"][0] + scales["ub"][1]
        uc = raw_uc * scales["uc"][0] + scales["uc"][1]
        ia = raw_ia * scales["ia"][0] + scales["ia"][1]
        ib = raw_ib * scales["ib"][0] + scales["ib"][1]
        ic = raw_ic * scales["ic"][0] + scales["ic"][1]

        # Per-phase instantaneous active power. Averaging these values over a
        # minute gives minute-level signed active power for each phase.
        pa = ua * ia
        pb = ub * ib
        pc = uc * ic

        # Natural-minute bucketing is based on absolute time, not file position.
        # Therefore a minute split between two archives is automatically merged.
        minute_ids = abs_us // MINUTE_US
        unique_minutes, inverse = np.unique(minute_ids, return_inverse=True)
        counts = np.bincount(inverse)
        sums_pa = np.bincount(inverse, weights=pa)
        sums_pb = np.bincount(inverse, weights=pb)
        sums_pc = np.bincount(inverse, weights=pc)

        for group_idx, minute_id in enumerate(unique_minutes):
            mask = inverse == group_idx
            group_times = abs_us[mask]
            accumulator = accumulators.setdefault(int(minute_id), MinuteAccumulator())
            accumulator.add(
                sum_pa=float(sums_pa[group_idx]),
                sum_pb=float(sums_pb[group_idx]),
                sum_pc=float(sums_pc[group_idx]),
                count=int(counts[group_idx]),
                first_us=int(group_times[0]),
                last_us=int(group_times[-1]),
                archive_name=archive_name,
            )

        if first_kept_us is None:
            first_kept_us = int(abs_us[0])
        last_kept_us = int(abs_us[-1])
        processed_count += int(abs_us.size)

    del data

    # Duration derived from actual first/last sample timestamps. Adding one sample
    # period converts point-to-point span into covered interval length.
    actual_duration_seconds = 0.0
    if first_raw_us is not None and last_raw_us is not None:
        actual_duration_seconds = (
            (last_raw_us - first_raw_us) / 1_000_000.0
            + 1.0 / sample_rate
        )

    # Independent duration estimates are logged for diagnostics. Disagreement can
    # expose truncated DAT files, incorrect CFG sample counts, or timing metadata.
    nominal_duration_from_count_seconds = record_count / sample_rate
    declared_duration_seconds = cfg.declared_last_sample / sample_rate

    return DatProcessResult(
        record_count=record_count,
        processed_count=processed_count,
        overlap_dropped=overlap_dropped,
        first_raw_us=first_raw_us,
        last_raw_us=last_raw_us,
        first_kept_us=first_kept_us,
        last_kept_us=last_kept_us,
        trailing_bytes=int(trailing_bytes),
        gap_before_us=gap_before_us,
        actual_duration_seconds=actual_duration_seconds,
        nominal_duration_from_count_seconds=nominal_duration_from_count_seconds,
        declared_duration_seconds=declared_duration_seconds,
        timestamp_mode=timestamp_mode,
    )


def write_minute_csv(
    output_path: Path,
    accumulators: Dict[int, MinuteAccumulator],
    sample_rate: float,
    complete_threshold: float,
    power_sign: int,
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # A complete natural minute should contain sample_rate * 60 samples. Minutes
    # spanning multiple archives are already merged in the same accumulator.
    expected_samples = int(round(sample_rate * 60.0))
    with output_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "minute_start",
                "active_power_w",
                "active_power_kw",
                "phase_a_power_w",
                "phase_b_power_w",
                "phase_c_power_w",
                "sample_count",
                "expected_samples",
                "coverage_ratio",
                "is_complete",
                "first_sample_time",
                "last_sample_time",
                "source_archive_count",
                "source_archives",
            ]
        )
        for minute_id in sorted(accumulators):
            acc = accumulators[minute_id]
            if acc.count <= 0:
                continue
            pa = power_sign * acc.sum_pa / acc.count
            pb = power_sign * acc.sum_pb / acc.count
            pc = power_sign * acc.sum_pc / acc.count
            total = pa + pb + pc
            coverage = acc.count / expected_samples
            minute_start_us = minute_id * MINUTE_US
            writer.writerow(
                [
                    epoch_us_to_text(minute_start_us)[:19],
                    f"{total:.6f}",
                    f"{total / 1000.0:.9f}",
                    f"{pa:.6f}",
                    f"{pb:.6f}",
                    f"{pc:.6f}",
                    acc.count,
                    expected_samples,
                    f"{coverage:.9f}",
                    1 if coverage >= complete_threshold else 0,
                    epoch_us_to_text(acc.first_us) if acc.first_us is not None else "",
                    epoch_us_to_text(acc.last_us) if acc.last_us is not None else "",
                    len(acc.archives),
                    ";".join(sorted(acc.archives)),
                ]
            )


def build_part_output_path(base_output: Path, part_index: int) -> Path:
    """Return a deterministic CSV part filename based on the requested output path.

    Example:
        base_output = /data0/renzhengju/minute_active_power.csv
        part_index = 1
        result = /data0/renzhengju/minute_active_power_part_0001.csv

    The base output file itself is not used as a combined result. It acts as the
    naming prefix so that a very long job can persist results incrementally.
    """

    suffix = base_output.suffix if base_output.suffix else ".csv"
    return base_output.with_name(
        f"{base_output.stem}_part_{part_index:04d}{suffix}"
    )


def select_flushable_minutes(
    accumulators: Dict[int, MinuteAccumulator],
    last_global_us: Optional[int],
    final: bool,
) -> Dict[int, MinuteAccumulator]:
    """Remove and return minute accumulators that are safe to write.

    At an intermediate checkpoint, the minute containing ``last_global_us`` is
    deliberately retained. The next archive may begin inside that same natural
    minute, so writing it prematurely would split one minute across two CSV files
    and make its average incorrect. All earlier minutes are already closed and can
    be written safely.

    At the final checkpoint, every remaining minute is returned, including a
    genuinely incomplete last minute. Its ``coverage_ratio`` and ``is_complete``
    fields make that incompleteness explicit.
    """

    if not accumulators:
        return {}

    if final:
        minute_ids = sorted(accumulators)
    else:
        if last_global_us is None:
            return {}
        open_minute_id = int(last_global_us // MINUTE_US)
        minute_ids = sorted(mid for mid in accumulators if mid < open_minute_id)

    selected: Dict[int, MinuteAccumulator] = {}
    for minute_id in minute_ids:
        selected[minute_id] = accumulators.pop(minute_id)
    return selected


def count_complete_minutes(
    accumulators: Dict[int, MinuteAccumulator],
    sample_rate: float,
    complete_threshold: float,
) -> int:
    """Count complete minute rows using the same rule as CSV output."""

    expected = int(round(sample_rate * 60.0))
    return sum(
        1
        for acc in accumulators.values()
        if acc.count > 0 and acc.count / expected >= complete_threshold
    )


def write_manifest_csv(
    path: Path,
    parts: Sequence[Dict[str, object]],
) -> None:
    """Write a small index describing every generated minute CSV part."""

    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "part_index",
        "file",
        "archive_checkpoint",
        "minute_rows",
        "complete_rows",
        "first_minute",
        "last_minute",
        "is_final_part",
    ]
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in parts:
            writer.writerow({name: row.get(name, "") for name in fieldnames})


def write_log_csv(path: Path, rows: Sequence[Dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "archive",
        "archive_size_mib",
        "status",
        "message",
        "filename_time",
        "cfg_start_time",
        "effective_start_time",
        "time_source",
        "cfg_minus_filename_ms",
        "sample_rate_hz",
        "declared_last_sample",
        "dat_record_count",
        "actual_duration_s",
        "duration_from_record_count_s",
        "declared_duration_s",
        "timestamp_mode",
        "processed_record_count",
        "overlap_dropped",
        "gap_before_ms",
        "first_raw_time",
        "last_raw_time",
        "first_kept_time",
        "last_kept_time",
        "trailing_bytes",
    ]
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({name: row.get(name, "") for name in fieldnames})


def main() -> int:
    args = parse_args()
    if args.archives_per_output <= 0:
        raise ValueError("--archives-per-output must be greater than 0")

    input_dir = args.input_dir.expanduser().resolve()
    output = args.output.expanduser().resolve()
    log_output = (
        args.log_output.expanduser().resolve()
        if args.log_output
        else output.with_name(output.stem + "_processing_log.csv")
    )

    archives = find_archives(input_dir)
    if not archives:
        print(f"No .7z archives found in {input_dir}", file=sys.stderr)
        return 2

    print(f"Found {len(archives)} .7z archives")
    accumulators: Dict[int, MinuteAccumulator] = {}
    log_rows: List[Dict[str, object]] = []
    normal_started = False
    last_global_us: Optional[int] = None
    global_sample_rate: Optional[float] = None
    processed_archives = 0
    part_index = 0
    output_parts: List[Dict[str, object]] = []
    total_minute_rows = 0
    total_complete_rows = 0

    persistent_temp_root: Optional[Path] = None
    if args.keep_temp:
        persistent_temp_root = output.parent / (output.stem + "_extracted")
        persistent_temp_root.mkdir(parents=True, exist_ok=True)

    for idx, archive in enumerate(archives, start=1):
        size_mib = archive.stat().st_size / (1024.0 * 1024.0)
        base_log: Dict[str, object] = {
            "archive": archive.name,
            "archive_size_mib": f"{size_mib:.3f}",
        }

        if not normal_started and args.min_leading_mb > 0 and size_mib < args.min_leading_mb:
            base_log.update(
                status="skipped_small_leading",
                message=f"Leading archive smaller than {args.min_leading_mb:.3f} MiB",
            )
            log_rows.append(base_log)
            print(f"[{idx}/{len(archives)}] SKIP small leading archive: {archive.name} ({size_mib:.1f} MiB)")
            continue

        normal_started = True
        print(f"[{idx}/{len(archives)}] Processing {archive.name} ({size_mib:.1f} MiB)")

        temp_context = None
        if persistent_temp_root is None:
            temp_context = tempfile.TemporaryDirectory(prefix="comtrade_")
            extract_root = Path(temp_context.name)
        else:
            extract_root = persistent_temp_root / archive.stem
            if extract_root.exists():
                shutil.rmtree(extract_root)
            extract_root.mkdir(parents=True)

        try:
            extract_7z(archive, extract_root)
            cfg_path, dat_path = find_cfg_dat(extract_root)
            cfg = read_cfg(cfg_path)
            time_info = resolve_archive_time(archive, cfg, args.time_source)
            if global_sample_rate is None:
                global_sample_rate = cfg.sample_rate

            result = process_dat(
                cfg=cfg,
                dat_path=dat_path,
                archive_name=archive.name,
                effective_start_time=time_info.effective_start_time,
                accumulators=accumulators,
                chunk_records=args.chunk_records,
                last_global_us=last_global_us,
                expected_sample_rate=global_sample_rate,
                relative_time_source=args.relative_time_source,
            )

            if result.last_kept_us is not None:
                last_global_us = result.last_kept_us
            processed_archives += 1

            mismatch_message = ""
            if (
                time_info.difference_seconds is not None
                and abs(time_info.difference_seconds) > FILENAME_CFG_WARNING_SECONDS
            ):
                mismatch_message = (
                    "CFG/filename start mismatch; "
                    f"auto-selected {time_info.source}"
                )

            base_log.update(
                status="ok",
                message=mismatch_message,
                filename_time=(
                    ""
                    if time_info.filename_time is None
                    else time_info.filename_time.strftime("%Y-%m-%d %H:%M:%S.%f")
                ),
                cfg_start_time=cfg.start_time.strftime("%Y-%m-%d %H:%M:%S.%f"),
                effective_start_time=time_info.effective_start_time.strftime(
                    "%Y-%m-%d %H:%M:%S.%f"
                ),
                time_source=time_info.source,
                cfg_minus_filename_ms=(
                    ""
                    if time_info.difference_seconds is None
                    else f"{time_info.difference_seconds * 1000.0:.6f}"
                ),
                sample_rate_hz=f"{cfg.sample_rate:.9f}",
                declared_last_sample=cfg.declared_last_sample,
                dat_record_count=result.record_count,
                actual_duration_s=f"{result.actual_duration_seconds:.9f}",
                duration_from_record_count_s=(
                    f"{result.nominal_duration_from_count_seconds:.9f}"
                ),
                declared_duration_s=f"{result.declared_duration_seconds:.9f}",
                timestamp_mode=result.timestamp_mode,
                processed_record_count=result.processed_count,
                overlap_dropped=result.overlap_dropped,
                gap_before_ms=(
                    ""
                    if result.gap_before_us is None
                    else f"{result.gap_before_us / 1000.0:.6f}"
                ),
                first_raw_time=(
                    "" if result.first_raw_us is None else epoch_us_to_text(result.first_raw_us)
                ),
                last_raw_time=(
                    "" if result.last_raw_us is None else epoch_us_to_text(result.last_raw_us)
                ),
                first_kept_time=(
                    "" if result.first_kept_us is None else epoch_us_to_text(result.first_kept_us)
                ),
                last_kept_time=(
                    "" if result.last_kept_us is None else epoch_us_to_text(result.last_kept_us)
                ),
                trailing_bytes=int(result.trailing_bytes),
            )
            print(
                f"    records={result.record_count:,}, kept={result.processed_count:,}, "
                f"duration={result.actual_duration_seconds:.6f}s, "
                f"overlap_dropped={result.overlap_dropped:,}, "
                f"start={time_info.effective_start_time} ({time_info.source})"
            )
        except Exception as exc:
            base_log.update(status="error", message=str(exc))
            print(f"    ERROR: {exc}", file=sys.stderr)
        finally:
            log_rows.append(base_log)
            if temp_context is not None:
                temp_context.cleanup()

        # Persist results after every N successfully processed archives. Only
        # minutes strictly earlier than the current open minute are flushed.
        # This preserves correct cross-archive stitching at part boundaries.
        if (
            global_sample_rate is not None
            and processed_archives > 0
            and processed_archives % args.archives_per_output == 0
        ):
            flushable = select_flushable_minutes(
                accumulators=accumulators,
                last_global_us=last_global_us,
                final=False,
            )
            if flushable:
                part_index += 1
                part_path = build_part_output_path(output, part_index)
                complete_rows = count_complete_minutes(
                    flushable,
                    sample_rate=global_sample_rate,
                    complete_threshold=args.complete_threshold,
                )
                write_minute_csv(
                    output_path=part_path,
                    accumulators=flushable,
                    sample_rate=global_sample_rate,
                    complete_threshold=args.complete_threshold,
                    power_sign=args.power_sign,
                )
                minute_ids = sorted(flushable)
                output_parts.append(
                    {
                        "part_index": part_index,
                        "file": str(part_path),
                        "archive_checkpoint": processed_archives,
                        "minute_rows": len(flushable),
                        "complete_rows": complete_rows,
                        "first_minute": epoch_us_to_text(minute_ids[0] * MINUTE_US)[:19],
                        "last_minute": epoch_us_to_text(minute_ids[-1] * MINUTE_US)[:19],
                        "is_final_part": 0,
                    }
                )
                total_minute_rows += len(flushable)
                total_complete_rows += complete_rows
                print(
                    f"    CHECKPOINT: wrote {part_path.name} with "
                    f"{len(flushable):,} minute rows; retained "
                    f"{len(accumulators):,} open minute accumulator(s)"
                )

            # Rewrite the processing log at each checkpoint so progress survives
            # a terminal disconnect, process failure, or later inspection.
            write_log_csv(log_output, log_rows)

    write_log_csv(log_output, log_rows)

    if processed_archives == 0 or global_sample_rate is None:
        print(f"No valid archives were processed. See log: {log_output}", file=sys.stderr)
        return 3

    # Final flush writes every remaining minute, including a possibly incomplete
    # final minute. Its completeness is explicit in the output columns.
    remaining = select_flushable_minutes(
        accumulators=accumulators,
        last_global_us=last_global_us,
        final=True,
    )
    if remaining:
        part_index += 1
        part_path = build_part_output_path(output, part_index)
        complete_rows = count_complete_minutes(
            remaining,
            sample_rate=global_sample_rate,
            complete_threshold=args.complete_threshold,
        )
        write_minute_csv(
            output_path=part_path,
            accumulators=remaining,
            sample_rate=global_sample_rate,
            complete_threshold=args.complete_threshold,
            power_sign=args.power_sign,
        )
        minute_ids = sorted(remaining)
        output_parts.append(
            {
                "part_index": part_index,
                "file": str(part_path),
                "archive_checkpoint": processed_archives,
                "minute_rows": len(remaining),
                "complete_rows": complete_rows,
                "first_minute": epoch_us_to_text(minute_ids[0] * MINUTE_US)[:19],
                "last_minute": epoch_us_to_text(minute_ids[-1] * MINUTE_US)[:19],
                "is_final_part": 1,
            }
        )
        total_minute_rows += len(remaining)
        total_complete_rows += complete_rows
        print(
            f"    FINAL: wrote {part_path.name} with "
            f"{len(remaining):,} minute rows"
        )

    manifest_path = output.with_name(output.stem + "_parts_manifest.csv")
    write_manifest_csv(manifest_path, output_parts)

    print("Done")
    print(f"Processed archives: {processed_archives}/{len(archives)}")
    print(
        f"Minute rows: {total_minute_rows:,}; "
        f"complete rows: {total_complete_rows:,}"
    )
    print(f"Minute output parts: {output.parent}/{output.stem}_part_*.csv")
    print(f"Parts manifest: {manifest_path}")
    print(f"Processing log: {log_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
