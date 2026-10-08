from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class QualityFlag(StrEnum):
    GOOD = "good"
    WARNING = "warning"
    MISSING = "missing"
    OUT_OF_ORDER = "out_of_order"


class QualityStatus(StrEnum):
    GOOD = "good"
    WARNING = "warning"
    INSUFFICIENT_HISTORY = "insufficient_history"
    DISCONTINUOUS = "discontinuous"
    INVALID = "invalid"


class ModelTask(StrEnum):
    RESOURCE_IDENTIFICATION = "resource_identification"
    PV_SEPARATION = "pv_separation"


class MinutePoint(StrictModel):
    station_id: str = Field(min_length=1, max_length=64)
    event_time: datetime
    active_power_kw: float
    phase_a_power_kw: float
    phase_b_power_kw: float
    phase_c_power_kw: float
    coverage_ratio: float = Field(ge=0, le=1)
    quality_flag: QualityFlag
    source_id: str = Field(min_length=1, max_length=128)
    electrical_fields: dict[str, float | None] = Field(default_factory=dict)
    field_validity: dict[str, bool] = Field(default_factory=dict)
    measurement_time: datetime | None = None
    arrival_time: datetime | None = None

    @field_validator("measurement_time", "arrival_time")
    @classmethod
    def require_source_timezone(cls, value):
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("source times must include a timezone")
        return value

    @field_validator("event_time")
    @classmethod
    def require_timezone_and_minute_boundary(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("event_time must include a timezone")
        if value.second != 0 or value.microsecond != 0:
            raise ValueError("event_time must be aligned to a minute boundary")
        return value


class InferenceRequest(StrictModel):
    request_id: str = Field(min_length=1, max_length=80)
    station_id: str = Field(min_length=1, max_length=64)
    target_time: datetime
    points: list[MinutePoint] = Field(min_length=1, max_length=10080)
    separation_points: list[MinutePoint] | None = Field(default=None, max_length=10080)

    @field_validator("target_time")
    @classmethod
    def require_target_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("target_time must include a timezone")
        if value.second != 0 or value.microsecond != 0:
            raise ValueError("target_time must be aligned to a minute boundary")
        return value

    @model_validator(mode="after")
    def validate_station_and_unique_times(self) -> "InferenceRequest":
        if any(point.station_id != self.station_id for point in self.points):
            raise ValueError("all points must belong to station_id")
        if any(point.station_id != self.station_id for point in (self.separation_points or [])):
            raise ValueError("all separation points must belong to station_id")
        event_times = [point.event_time for point in self.points]
        if len(set(event_times)) != len(event_times):
            raise ValueError("duplicate event_time values are not allowed")
        return self


class BatchInferenceRequest(StrictModel):
    request_id: str = Field(min_length=1, max_length=80)
    station_id: str = Field(min_length=1, max_length=64)
    target_times: list[datetime] = Field(min_length=1, max_length=5000)
    points: list[MinutePoint] = Field(min_length=1, max_length=10080)
    separation_points: list[MinutePoint] | None = Field(default=None, max_length=10080)

    @model_validator(mode="after")
    def validate_batch(self) -> "BatchInferenceRequest":
        if any(point.station_id != self.station_id for point in (self.separation_points or [])):
            raise ValueError("all separation points must belong to station_id")
        if any(point.station_id != self.station_id for point in self.points):
            raise ValueError("all points must belong to station_id")
        if len({point.event_time for point in self.points}) != len(self.points):
            raise ValueError("duplicate event_time values are not allowed")
        if len(set(self.target_times)) != len(self.target_times):
            raise ValueError("duplicate target_times are not allowed")
        for value in self.target_times:
            if value.tzinfo is None or value.utcoffset() is None:
                raise ValueError("target_times must include a timezone")
            if value.second != 0 or value.microsecond != 0:
                raise ValueError("target_times must be minute aligned")
        return self


class ResourceInference(StrictModel):
    score: float | None = Field(default=None, ge=0, le=1)
    detected: bool | None = None


class InferenceResult(StrictModel):
    station_id: str
    target_time: datetime
    request_id: str
    input_window_start: datetime | None
    input_window_end: datetime | None
    recognition_window_start: datetime | None
    separation_window_start: datetime | None
    interpolated_minutes: int = Field(ge=0)
    quality_status: QualityStatus
    recognition_model_version: str | None
    separation_model_version: str | None
    pv: ResourceInference
    energy_station: ResourceInference
    charger: ResourceInference
    pv_generation_kw: float | None = Field(default=None, ge=0)
    pv_activity_probability: float | None = Field(default=None, ge=0, le=1)
    separation_input_power_kw: float | None = None
    inference_time_ms: float = Field(ge=0)
    warnings: list[str]


class ModelManifest(StrictModel):
    model_id: str
    task: ModelTask
    model_version: str
    artifact_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    model_type: str
    input_schema_version: str
    output_schema_version: str
    required_history_minutes: int
    input_fields: list[str]
    output_fields: list[str]
    thresholds: dict[str, float]
    trained_at: datetime
    loaded_at: datetime
    runtime_version: str
    health_status: str
    limitations: list[str]


class ModelHealth(StrictModel):
    task: ModelTask
    status: str
    loaded_at: datetime | None
    message: str | None = None


class HealthResponse(StrictModel):
    status: str
    request_id: str
    details: dict[str, object] = Field(default_factory=dict)


class ErrorResponse(StrictModel):
    code: str
    message: str
    request_id: str
    details: dict[str, object] = Field(default_factory=dict)
