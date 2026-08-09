from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Iterable


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
BASE_COMPOSE_FILE = REPOSITORY_ROOT / "deploy" / "docker-compose.yml"
SERVER_COMPOSE_FILE = REPOSITORY_ROOT / "deploy" / "compose.server.yml"
PRODUCTION_COMPOSE_FILE = REPOSITORY_ROOT / "deploy" / "compose.production.yml"

BASELINE_TABLES = (
    "station",
    "app_user",
    "user_station_role",
    "main_switch_minute",
    "recognition_result",
    "recognition_item",
    "pv_separation_result",
    "pv_feedback_batch",
    "pv_feedback_point",
    "correction_record",
    "model_registry",
    "model_deployment",
    "shadow_inference_comparison",
    "training_run",
    "training_epoch",
    "collection_process_event",
    "node_status",
    "data_quality_summary",
    "audit_log",
    "outbox_event",
    "inference_replay_job",
)


class DeploymentError(RuntimeError):
    pass


def run(
    command: Iterable[str],
    *,
    capture: bool = False,
    cwd: Path = REPOSITORY_ROOT,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    command_list = [str(value) for value in command]
    result = subprocess.run(
        command_list,
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
        check=False,
    )
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise DeploymentError(
            f"Command failed ({result.returncode}): {' '.join(command_list)}"
            + (f"\n{detail}" if detail else "")
        )
    return result


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        raise DeploymentError(f"Environment file does not exist: {path}")
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key.strip()] = value
    return values


def compose_command(env_file: Path, mode: str) -> list[str]:
    command = [
        "docker",
        "compose",
        "--env-file",
        str(env_file.resolve()),
        "-f",
        str(BASE_COMPOSE_FILE),
        "-f",
        str(SERVER_COMPOSE_FILE),
    ]
    if mode == "production":
        command.extend(["-f", str(PRODUCTION_COMPOSE_FILE)])
    return command


def postgres_container(compose: list[str]) -> str:
    result = run([*compose, "ps", "-q", "postgres"], capture=True)
    container = result.stdout.strip()
    if not container:
        raise DeploymentError("PostgreSQL container is not running")
    return container


def psql(container: str, sql: str) -> str:
    result = run(
        [
            "docker",
            "exec",
            container,
            "sh",
            "-ceu",
            'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "$1"',
            "powergrid-psql",
            sql,
        ],
        capture=True,
    )
    return result.stdout.strip()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def resolve_env_path(value: str, env_file: Path) -> Path:
    expanded = Path(os.path.expandvars(os.path.expanduser(value)))
    if not expanded.is_absolute():
        expanded = env_file.parent / expanded
    return expanded.resolve()
