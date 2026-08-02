from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import pytest

from app.config import Settings
from app.runner import InferenceCoordinator
from app.schemas import MinutePoint, QualityFlag


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SHANGHAI = ZoneInfo("Asia/Shanghai")


def load_sample_points(count: int = 300) -> list[MinutePoint]:
    folder = REPOSITORY_ROOT / "SGCC-project" / "台区数据总开0"
    frames = [pd.read_csv(path) for path in sorted(folder.glob("minute_active_power_part_*.csv"))]
    data = pd.concat(frames, ignore_index=True)
    data["minute_start"] = pd.to_datetime(data["minute_start"])
    data = data.sort_values("minute_start").drop_duplicates("minute_start", keep="last")
    data = data.tail(count)
    return [
        MinutePoint(
            station_id="A01",
            event_time=row.minute_start.to_pydatetime().replace(tzinfo=SHANGHAI),
            active_power_kw=float(row.active_power_kw),
            phase_a_power_kw=float(row.phase_a_power_w) / 1000.0,
            phase_b_power_kw=float(row.phase_b_power_w) / 1000.0,
            phase_c_power_kw=float(row.phase_c_power_w) / 1000.0,
            coverage_ratio=float(row.coverage_ratio),
            quality_flag=QualityFlag.GOOD,
            source_id="sgcc-smoke-sample",
        )
        for row in data.itertuples(index=False)
    ]


@pytest.fixture(scope="session")
def sample_points() -> list[MinutePoint]:
    return load_sample_points()


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings.from_env()


@pytest.fixture(scope="session")
def coordinator(settings: Settings) -> InferenceCoordinator:
    return InferenceCoordinator(settings)
