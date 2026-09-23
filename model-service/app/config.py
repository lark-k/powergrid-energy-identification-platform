from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _boolean(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean")


def _positive_int(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def _secret(name: str) -> str | None:
    direct = os.getenv(name)
    if direct:
        return direct
    file_name = os.getenv(f"{name}_FILE", f"/run/secrets/{name}")
    path = Path(file_name)
    return path.read_text(encoding="utf-8").strip() if path.is_file() else None


@dataclass(frozen=True)
class Settings:
    environment: str
    sgcc_project_dir: Path
    recognition_checkpoint: Path
    separation_checkpoint: Path
    device: str
    batch_size: int
    inference_timeout_seconds: int
    auth_required: bool
    service_token: str | None
    catalog_dir: Path | None = None
    active_state_path: Path | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        repository_root = Path(__file__).resolve().parents[2]
        sgcc_project_dir = Path(
            os.getenv("SGCC_PROJECT_DIR", repository_root / "SGCC-project")
        ).expanduser().resolve()
        model_dir = sgcc_project_dir / "energy_device_detection"
        recognition_checkpoint = Path(
            os.getenv(
                "RECOGNITION_CHECKPOINT",
                model_dir / "outputs" / "selected_model.pt",
            )
        ).expanduser().resolve()
        separation_checkpoint = Path(
            os.getenv(
                "SEPARATION_CHECKPOINT",
                model_dir / "pv_outputs" / "selected_pv_model.pt",
            )
        ).expanduser().resolve()
        auth_required = _boolean("MODEL_SERVICE_AUTH_REQUIRED", False)
        token = _secret("MODEL_SERVICE_TOKEN")
        if auth_required and not token:
            raise ValueError(
                "MODEL_SERVICE_TOKEN is required when MODEL_SERVICE_AUTH_REQUIRED=true"
            )
        return cls(
            environment=os.getenv("MODEL_SERVICE_ENV", "development").strip().lower(),
            sgcc_project_dir=sgcc_project_dir,
            recognition_checkpoint=recognition_checkpoint,
            separation_checkpoint=separation_checkpoint,
            device=os.getenv("MODEL_DEVICE", "auto").strip().lower(),
            batch_size=_positive_int("MODEL_BATCH_SIZE", 256),
            inference_timeout_seconds=_positive_int(
                "MODEL_INFERENCE_TIMEOUT_SECONDS", 30
            ),
            auth_required=auth_required,
            service_token=token,
            catalog_dir=Path(os.environ["MODEL_CATALOG_DIR"]).expanduser().resolve()
            if os.getenv("MODEL_CATALOG_DIR") else None,
            active_state_path=Path(os.getenv(
                "MODEL_ACTIVE_STATE_PATH", repository_root / ".local" / "model-runtime" / "active.json"
            )).expanduser().resolve(),
        )
