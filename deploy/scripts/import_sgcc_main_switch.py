#!/usr/bin/env python3
"""Import SGCC minute CSV parts through the stable Java ingestion API.

The source files remain read-only. Naive SGCC timestamps are interpreted in the
configured station timezone, phase power is converted from W to kW, and imports
are sent without per-minute inference so one explicit replay can follow.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Source:
    source_id: str
    folder: Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import SGCC total-main minute data")
    parser.add_argument("--api-url", default="http://localhost:5173")
    parser.add_argument("--station-id", default="A01")
    parser.add_argument("--timezone", default="Asia/Shanghai")
    parser.add_argument("--batch-size", type=int, default=2000)
    parser.add_argument(
        "--source",
        action="append",
        required=True,
        metavar="SOURCE_ID=FOLDER",
        help="Repeat for each SGCC total-main folder",
    )
    parser.add_argument("--apply", action="store_true", help="Send validated points to Java")
    return parser.parse_args()


def sources(values: list[str]) -> list[Source]:
    parsed: list[Source] = []
    for value in values:
        source_id, separator, folder = value.partition("=")
        if not separator or not source_id or not folder:
            raise ValueError(f"invalid --source: {value}")
        path = Path(folder).resolve()
        if not path.is_dir():
            raise FileNotFoundError(path)
        parsed.append(Source(source_id, path))
    return parsed


def finite(row: dict[str, str], field: str) -> float:
    value = float(row[field])
    if not math.isfinite(value):
        raise ValueError(f"{field} is not finite")
    return value


def load(source: Source, station_id: str, timezone_name: str) -> list[dict[str, object]]:
    timezone = ZoneInfo(timezone_name)
    points: list[dict[str, object]] = []
    files = sorted(source.folder.glob("minute_active_power_part_*.csv"))
    files = [path for path in files if "manifest" not in path.name and "processing_log" not in path.name]
    if not files:
        raise FileNotFoundError(f"no minute part CSV in {source.folder}")
    for path in files:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            required = {
                "minute_start", "active_power_kw", "phase_a_power_w",
                "phase_b_power_w", "phase_c_power_w", "coverage_ratio", "is_complete",
            }
            if reader.fieldnames is None or not required.issubset(reader.fieldnames):
                raise ValueError(f"{path} is missing required SGCC columns")
            for line, row in enumerate(reader, start=2):
                try:
                    local_time = datetime.strptime(row["minute_start"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone)
                    coverage = finite(row, "coverage_ratio")
                    point = {
                        "station_id": station_id,
                        "event_time": local_time.isoformat(),
                        "active_power_kw": finite(row, "active_power_kw"),
                        "phase_a_power_kw": finite(row, "phase_a_power_w") / 1000.0,
                        "phase_b_power_kw": finite(row, "phase_b_power_w") / 1000.0,
                        "phase_c_power_kw": finite(row, "phase_c_power_w") / 1000.0,
                        "coverage_ratio": coverage,
                        "quality_flag": "good" if row["is_complete"].strip() == "1" else "warning",
                        "source_id": source.source_id,
                    }
                except Exception as exception:
                    raise ValueError(f"{path}:{line}: {exception}") from exception
                points.append(point)
    return points


def post(api_url: str, points: list[dict[str, object]]) -> dict[str, object]:
    url = api_url.rstrip("/") + "/api/v1/ingestion/main-switch/minutes?replace_existing=true&run_inference=false"
    request = urllib.request.Request(
        url,
        data=json.dumps({"points": points}, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exception:
        body = exception.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Java ingestion returned HTTP {exception.code}: {body}") from exception


def main() -> int:
    args = parse_args()
    if not 1 <= args.batch_size <= 5000:
        raise ValueError("batch size must be between 1 and 5000")
    all_points: list[dict[str, object]] = []
    for source in sources(args.source):
        loaded = load(source, args.station_id, args.timezone)
        print(f"validated {source.source_id}: {len(loaded)} minutes", file=sys.stderr)
        all_points.extend(loaded)
    all_points.sort(key=lambda item: str(item["event_time"]))
    timestamps = [str(point["event_time"]) for point in all_points]
    if len(timestamps) != len(set(timestamps)):
        raise ValueError("duplicate station event_time across supplied total-main sources")
    summary = {
        "station_id": args.station_id,
        "points": len(all_points),
        "first_event_time": timestamps[0],
        "last_event_time": timestamps[-1],
        "apply": args.apply,
    }
    if not args.apply:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    receipts: list[dict[str, object]] = []
    for start in range(0, len(all_points), args.batch_size):
        receipt = post(args.api_url, all_points[start : start + args.batch_size])
        receipts.append(receipt)
        print(f"imported batch {start // args.batch_size + 1}: {receipt}", file=sys.stderr)
    summary.update({
        "inserted": sum(int(receipt["inserted"]) for receipt in receipts),
        "updated": sum(int(receipt["updated"]) for receipt in receipts),
        "duplicates": sum(int(receipt["duplicates"]) for receipt in receipts),
        "inference_scheduled": any(bool(receipt["inference_scheduled"]) for receipt in receipts),
    })
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
