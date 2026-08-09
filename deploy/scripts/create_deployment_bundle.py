#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import tarfile
from datetime import datetime, timezone
from pathlib import Path

from deployment_lib import (
    BASELINE_TABLES,
    DeploymentError,
    REPOSITORY_ROOT,
    compose_command,
    postgres_container,
    psql,
    run,
    sha256,
    write_json,
)


MODEL_FILES = {
    "selected_model.pt": REPOSITORY_ROOT
    / "SGCC-project/energy_device_detection/outputs/selected_model.pt",
    "selected_pv_model.pt": REPOSITORY_ROOT
    / "SGCC-project/energy_device_detection/pv_outputs/selected_pv_model.pt",
}


def arguments() -> argparse.Namespace:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    parser = argparse.ArgumentParser(
        description="Export the running local database and all SGCC data assets as a deployment bundle."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=REPOSITORY_ROOT / "deploy/releases" / f"powergrid-demo-{timestamp}",
    )
    parser.add_argument(
        "--env-file",
        type=Path,
        default=REPOSITORY_ROOT / "deploy/.env",
    )
    parser.add_argument(
        "--skip-assets",
        action="store_true",
        help="Do not archive the complete SGCC-project directory (database and approved models are still included).",
    )
    return parser.parse_args()


def database_metadata(container: str) -> dict[str, object]:
    table_pairs = ",".join(
        f"'{table}', (select count(*) from {table})" for table in BASELINE_TABLES
    )
    sql = f"""
select json_build_object(
  'postgres_version', current_setting('server_version'),
  'database_size_bytes', pg_database_size(current_database()),
  'flyway', coalesce((
    select json_agg(json_build_object(
      'installed_rank', installed_rank,
      'version', version,
      'description', description,
      'success', success
    ) order by installed_rank) from flyway_schema_history
  ), '[]'::json),
  'table_counts', json_build_object({table_pairs}),
  'main_switch_range', (
    select json_build_object(
      'first_event_time', min(event_time),
      'last_event_time', max(event_time),
      'rows', count(*)
    ) from main_switch_minute
  )
)::text;
"""
    return json.loads(psql(container, sql))


def archive_filter(info: tarfile.TarInfo) -> tarfile.TarInfo | None:
    parts = Path(info.name).parts
    if any(part in {"__pycache__", ".pytest_cache", ".venv", "venv"} for part in parts):
        return None
    if info.name.endswith((".pyc", ".pyo")):
        return None
    return info


def export_database(container: str, target: Path) -> None:
    temporary = f"/tmp/powergrid-deployment-{os.getpid()}.dump"
    try:
        run(
            [
                "docker",
                "exec",
                container,
                "sh",
                "-ceu",
                'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=9 --no-owner --no-acl --file "$1"',
                "powergrid-pg-dump",
                temporary,
            ]
        )
        run(["docker", "cp", f"{container}:{temporary}", str(target)])
    finally:
        run(["docker", "exec", container, "rm", "-f", temporary], check=False)


def git_value(*args: str) -> str | None:
    result = run(["git", *args], capture=True, check=False)
    return result.stdout.strip() if result.returncode == 0 else None


def main() -> int:
    args = arguments()
    output = args.output.resolve()
    env_file = args.env_file.resolve()
    if output.exists():
        raise DeploymentError(f"Output already exists: {output}")
    for path in MODEL_FILES.values():
        if not path.is_file():
            raise DeploymentError(f"Required approved model is missing: {path}")

    database_dir = output / "database"
    models_dir = output / "models"
    assets_dir = output / "assets"
    for directory in (database_dir, models_dir, assets_dir):
        directory.mkdir(parents=True, exist_ok=False)

    compose = compose_command(env_file, "demo")[:-2]
    container = postgres_container(compose)
    metadata = database_metadata(container)
    dump_path = database_dir / "powergrid.dump"
    print(f"Exporting PostgreSQL to {dump_path} ...")
    export_database(container, dump_path)
    write_json(database_dir / "metadata.json", metadata)

    print("Copying approved inference models ...")
    for name, source in MODEL_FILES.items():
        shutil.copy2(source, models_dir / name)

    assets_archive: Path | None = None
    if not args.skip_assets:
        assets_archive = assets_dir / "sgcc-project.tar.gz"
        print(f"Archiving complete SGCC-project data to {assets_archive} ...")
        with tarfile.open(assets_archive, "w:gz", compresslevel=6) as archive:
            archive.add(
                REPOSITORY_ROOT / "SGCC-project",
                arcname="SGCC-project",
                recursive=True,
                filter=archive_filter,
            )

    artifact_paths = [dump_path, database_dir / "metadata.json"]
    artifact_paths.extend(models_dir / name for name in MODEL_FILES)
    if assets_archive:
        artifact_paths.append(assets_archive)
    files = {
        path.relative_to(output).as_posix(): {
            "size_bytes": path.stat().st_size,
            "sha256": sha256(path),
        }
        for path in artifact_paths
    }
    status = git_value("status", "--porcelain")
    manifest = {
        "format_version": 1,
        "release_id": output.name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_git_commit": git_value("rev-parse", "HEAD"),
        "source_worktree_dirty": bool(status),
        "database": metadata,
        "models": {
            name: {
                "sha256": files[f"models/{name}"]["sha256"],
                "size_bytes": files[f"models/{name}"]["size_bytes"],
            }
            for name in MODEL_FILES
        },
        "assets_included": assets_archive is not None,
        "files": files,
    }
    write_json(output / "manifest.json", manifest)
    checksum_lines = [
        f"{details['sha256']}  {name}" for name, details in sorted(files.items())
    ]
    (output / "SHA256SUMS").write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")
    print(f"Deployment bundle created: {output}")
    print(json.dumps(metadata["table_counts"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except DeploymentError as exception:
        print(f"ERROR: {exception}")
        raise SystemExit(1) from exception
