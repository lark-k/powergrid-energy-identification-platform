#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import tarfile
import time
from pathlib import Path

from deployment_lib import (
    DeploymentError,
    REPOSITORY_ROOT,
    compose_command,
    load_env,
    postgres_container,
    psql,
    resolve_env_path,
    run,
    sha256,
    write_json,
)


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Restore a deployment bundle into an empty PostgreSQL volume and start the server stack."
    )
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument(
        "--env-file",
        type=Path,
        default=REPOSITORY_ROOT / "deploy/.env.server",
    )
    parser.add_argument("--mode", choices=("demo", "production"), default="demo")
    parser.add_argument("--no-build", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--skip-assets", action="store_true")
    return parser.parse_args()


def load_and_verify_bundle(bundle: Path) -> dict[str, object]:
    manifest_path = bundle / "manifest.json"
    if not manifest_path.is_file():
        raise DeploymentError(f"Bundle manifest is missing: {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format_version") != 1:
        raise DeploymentError("Unsupported deployment bundle format")
    files = manifest.get("files")
    if not isinstance(files, dict):
        raise DeploymentError("Bundle manifest has no file inventory")
    print("Verifying deployment bundle checksums ...")
    for relative, expected in files.items():
        path = (bundle / relative).resolve()
        if bundle not in path.parents or not path.is_file():
            raise DeploymentError(f"Bundle file is missing or unsafe: {relative}")
        actual = sha256(path)
        if actual != expected.get("sha256"):
            raise DeploymentError(f"Checksum mismatch: {relative}")
    return manifest


def validate_production(env: dict[str, str], env_file: Path) -> None:
    required = (
        "OIDC_ISSUER_URI",
        "CORS_ALLOWED_ORIGINS",
        "DB_PASSWORD_SECRET_FILE",
        "MODEL_SERVICE_TOKEN_SECRET_FILE",
    )
    missing = [name for name in required if not env.get(name)]
    if missing:
        raise DeploymentError(
            "Production environment is missing: " + ", ".join(missing)
        )
    for name in ("DB_PASSWORD_SECRET_FILE", "MODEL_SERVICE_TOKEN_SECRET_FILE"):
        secret = resolve_env_path(env[name], env_file)
        if not secret.is_file() or not secret.read_text(encoding="utf-8").strip():
            raise DeploymentError(f"Secret file is missing or empty: {secret}")


def safe_extract(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            target = (root / member.name).resolve()
            if target != root and root not in target.parents:
                raise DeploymentError(f"Unsafe path in asset archive: {member.name}")
        archive.extractall(root)


def install_assets(
    bundle: Path,
    manifest: dict[str, object],
    data_root: Path,
    skip_assets: bool,
) -> None:
    models = data_root / "models"
    models.mkdir(parents=True, exist_ok=True)
    for name in ("selected_model.pt", "selected_pv_model.pt"):
        source = bundle / "models" / name
        if not source.is_file():
            raise DeploymentError(f"Approved model is missing: {source}")
        shutil.copy2(source, models / name)
    if manifest.get("assets_included") and not skip_assets:
        archive = bundle / "assets/sgcc-project.tar.gz"
        existing_assets = data_root / "SGCC-project"
        if existing_assets.exists():
            print(
                f"SGCC data assets already exist at {existing_assets}; preserving them and skipping extraction."
            )
        else:
            print(f"Extracting SGCC data assets into {data_root} ...")
            safe_extract(archive, data_root)
    write_json(data_root / "deployment-manifest.json", manifest)


def verify_installed_assets(
    data_root: Path, manifest: dict[str, object], skip_assets: bool
) -> None:
    expected_models = manifest.get("models")
    if not isinstance(expected_models, dict):
        raise DeploymentError("Manifest has no approved model inventory")
    for name, expected in expected_models.items():
        path = data_root / "models" / name
        if not path.is_file():
            raise DeploymentError(f"Installed model is missing: {path}")
        if not isinstance(expected, dict) or sha256(path) != expected.get("sha256"):
            raise DeploymentError(f"Installed model checksum mismatch: {path}")
    if manifest.get("assets_included") and not skip_assets:
        assets = data_root / "SGCC-project"
        if not assets.is_dir():
            raise DeploymentError(f"Installed SGCC data directory is missing: {assets}")
    print("Installed models and data assets verified.")


def wait_for_postgres(compose: list[str], timeout: int = 120) -> str:
    deadline = time.monotonic() + timeout
    last = ""
    while time.monotonic() < deadline:
        try:
            container = postgres_container(compose)
            result = run(
                [
                    "docker",
                    "exec",
                    container,
                    "sh",
                    "-ceu",
                    'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
                ],
                capture=True,
                check=False,
            )
            if result.returncode == 0:
                return container
            last = result.stderr or result.stdout
        except DeploymentError as exception:
            last = str(exception)
        time.sleep(2)
    raise DeploymentError(f"PostgreSQL did not become ready within {timeout}s: {last.strip()}")


def restore_if_empty(compose: list[str], container: str, dump: Path) -> bool:
    public_tables = int(
        psql(
            container,
            "select count(*) from information_schema.tables where table_schema='public';",
        )
    )
    if public_tables > 0:
        print(
            f"PostgreSQL already contains {public_tables} public tables; preserving existing data and skipping restore."
        )
        return False
    temporary = "/tmp/powergrid-bootstrap.dump"
    print("Empty PostgreSQL database detected; restoring bundled historical data ...")
    try:
        run(["docker", "cp", str(dump), f"{container}:{temporary}"])
        run(
            [
                "docker",
                "exec",
                container,
                "sh",
                "-ceu",
                'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --exit-on-error --no-owner --no-acl "$1"',
                "powergrid-pg-restore",
                temporary,
            ]
        )
    finally:
        run(["docker", "exec", container, "rm", "-f", temporary], check=False)
    return True


def service_health_command(service: str) -> list[str]:
    commands = {
        "postgres": ["sh", "-ceu", 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
        "model-service": [
            "python",
            "-c",
            "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=3)",
        ],
        "backend": [
            "sh",
            "-ceu",
            "wget -qO- http://127.0.0.1:8080/actuator/health/readiness >/dev/null",
        ],
        "frontend": [
            "sh",
            "-ceu",
            "wget -qO- http://127.0.0.1:8080/ >/dev/null",
        ],
    }
    return commands[service]


def wait_for_stack(compose: list[str], timeout: int = 240) -> None:
    services = ("postgres", "model-service", "backend", "frontend")
    deadline = time.monotonic() + timeout
    pending = set(services)
    while pending and time.monotonic() < deadline:
        for service in tuple(pending):
            result = run(
                [*compose, "exec", "-T", service, *service_health_command(service)],
                capture=True,
                check=False,
            )
            if result.returncode == 0:
                print(f"Healthy: {service}")
                pending.remove(service)
        if pending:
            time.sleep(3)
    if pending:
        raise DeploymentError("Services did not become healthy: " + ", ".join(sorted(pending)))


def verify_database(container: str, manifest: dict[str, object]) -> None:
    database = manifest.get("database")
    expected = database.get("table_counts") if isinstance(database, dict) else None
    if not isinstance(expected, dict):
        raise DeploymentError("Manifest has no database table baseline")
    failures: list[str] = []
    for table, minimum in expected.items():
        actual = int(psql(container, f"select count(*) from {table};"))
        if actual < int(minimum):
            failures.append(f"{table}: expected at least {minimum}, got {actual}")
    if failures:
        raise DeploymentError("Database baseline verification failed:\n" + "\n".join(failures))
    data_range = psql(
        container,
        "select coalesce(min(event_time)::text,'null') || ' .. ' || coalesce(max(event_time)::text,'null') || ' (' || count(*) || ' rows)' from main_switch_minute;",
    )
    print(f"Database baseline verified. Main-switch range: {data_range}")


def main() -> int:
    args = arguments()
    bundle = args.bundle.resolve()
    env_file = args.env_file.resolve()
    manifest = load_and_verify_bundle(bundle)
    env = load_env(env_file)
    data_value = env.get("POWERGRID_DATA_DIR")
    if not data_value:
        raise DeploymentError("POWERGRID_DATA_DIR is required in the server environment file")
    data_root = resolve_env_path(data_value, env_file)
    if args.mode == "production":
        validate_production(env, env_file)
    else:
        print("WARNING: demo mode uses development authentication; expose it only on a trusted network or VPN.")

    compose = compose_command(env_file, args.mode)
    if args.verify_only:
        verify_installed_assets(data_root, manifest, args.skip_assets)
        container = wait_for_postgres(compose)
        wait_for_stack(compose)
        verify_database(container, manifest)
        print("Deployment verification completed successfully.")
        return 0

    install_assets(bundle, manifest, data_root, args.skip_assets)
    verify_installed_assets(data_root, manifest, args.skip_assets)
    run([*compose, "up", "-d", "postgres"])
    container = wait_for_postgres(compose)
    restored = restore_if_empty(compose, container, bundle / "database/powergrid.dump")
    up = [*compose, "up", "-d"]
    if not args.no_build:
        up.append("--build")
    run(up)
    wait_for_stack(compose)
    container = postgres_container(compose)
    verify_database(container, manifest)
    marker = {
        "release_id": manifest.get("release_id"),
        "restored_database": restored,
        "verified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "mode": args.mode,
    }
    write_json(data_root / "last-deployment.json", marker)
    port = env.get("FRONTEND_PORT", "5173")
    print(f"Deployment completed successfully. Open http://SERVER_IP:{port}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except DeploymentError as exception:
        print(f"ERROR: {exception}")
        raise SystemExit(1) from exception
