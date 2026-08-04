#!/usr/bin/env python3
"""Executable regression probes for production release-path incidents."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import Sequence


ROOT = Path(__file__).resolve().parents[2]
INCIDENT_IDS = (
    "encrypted-vault-planning",
    "pi5-runtime-permissions",
    "caddy-allowlist-expansion",
    "pi3-ssh-compression",
    "backup-ssh-bind-authority",
    "database-role-wiring",
    "derivative-storage-mount",
    "migration-gateway-image",
    "slot-web-runtime-config",
)


def read(root: Path, relative: str) -> str:
    return (root / relative).read_text(encoding="utf-8")


def migration_gateway_probe(root: Path) -> bool:
    module = root / "scripts/deploy/lib/pi5-blue-green"
    completed = subprocess.run(
        [
            "bash",
            "-euo",
            "pipefail",
            "-c",
            r'''
source "$1"
source "$2"
PROJECT_DIR=/tmp/incident-audit
ENV_FILE=/dev/null
CONFIG_DIR=/tmp/incident-audit-config
PHASE3_COMPOSE=/tmp/phase3.yml
PHASE3_MIGRATION_COMPOSE=/tmp/phase3-migration.yml
COMPOSE_PROJECT=incident-audit
DRY_RUN=0
BLUE_API_IMAGE=api-blue
GREEN_API_IMAGE=api-green
BLUE_WEB_IMAGE=web-blue
GREEN_WEB_IMAGE=web-green
docker() { [[ "${PI5_GATEWAY_IMAGE:-}" == web-blue ]]; }
GATEWAY_SLOT=blue
compose_migration config
''',
            "incident-audit",
            str(module / "images-evidence.sh"),
            str(module / "runtime.sh"),
        ],
        cwd=root,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return completed.returncode == 0


def slot_web_runtime_config_probe(root: Path) -> bool:
    runtime = root / "scripts/deploy/lib/pi5-blue-green/runtime.sh"
    with tempfile.TemporaryDirectory(prefix="slot-web-config-audit-") as raw:
        temporary = Path(raw)
        config = temporary / "Caddyfile.slot"
        binary = temporary / "bin"
        binary.mkdir()
        config.write_text("slot config\n", encoding="utf-8")
        caddy = binary / "caddy"
        caddy.write_text(
            """#!/bin/sh
set -eu
[ "$1" = validate ]
[ "$2" = --config ]
[ "$3" = "$EXPECTED_SLOT_CONFIG" ]
[ -f "$3" ]
""",
            encoding="utf-8",
        )
        caddy.chmod(0o755)
        environment = os.environ.copy()
        environment.update(
            {
                "EXPECTED_SLOT_CONFIG": str(config),
                "PATH": f"{binary}:{environment['PATH']}",
            }
        )
        completed = subprocess.run(
            [
                "bash",
                "-euo",
                "pipefail",
                "-c",
                r'''
source "$1"
DRY_RUN=0
slot_container_id() { printf '%s\n' candidate-web; }
docker() {
  [[ "$1" == exec && "$2" == candidate-web ]]
  shift 2
  SLOT_CADDY_CONFIG_FILE="$EXPECTED_SLOT_CONFIG" "$@"
}
slot_web_validate green
''',
                "slot-web-config-audit",
                str(runtime),
            ],
            cwd=root,
            env=environment,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return completed.returncode == 0


def incident_status(root: Path) -> dict[str, bool]:
    ansible = read(root, "scripts/deploy/rolling_release/backends/ansible.py")
    server_role = read(root, "infrastructure/ansible/roles/server/tasks/main.yml")
    web_dockerfile = read(root, "infrastructure/docker/Dockerfile.web")
    terminal_preflight = read(root, "scripts/deploy/rolling_release/terminal_preflight.py")
    phase3 = read(root, "infrastructure/docker/docker-compose.phase3.yml")
    migration = read(root, "infrastructure/docker/docker-compose.phase3.migration.yml")
    local_tls_direct = (
        'elif [ -n \\"$USE_LOCAL_CERTS\\" ]; then caddy run --config '
        '/srv/Caddyfile.local.template'
    )
    derivative = (
        "part-measurement-drawings-derivatives-storage:"
        "/app/storage/part-measurement-drawings-derivatives"
    )
    slot_runtime_contract = all(
        value in web_dockerfile
        for value in (
            "ENV SLOT_CADDY_CONFIG_FILE=/tmp/Caddyfile.slot",
            '> \\"$SLOT_CADDY_CONFIG_FILE\\"',
            'caddy run --config \\"$SLOT_CADDY_CONFIG_FILE\\"',
        )
    )
    return {
        "encrypted-vault-planning": ansible.count(
            "_read_only_inventory_context(path, runtime=runtime)"
        )
        >= 2,
        "pi5-runtime-permissions": all(
            value in server_role
            for value in (
                "Verify existing Pi5 writable trees are ready",
                'become_user: "{{ ansible_user }}"',
                '"{{ repo_path }}/storage/part-measurement-drawings-derivatives"',
            )
        ),
        "caddy-allowlist-expansion": local_tls_direct in web_dockerfile
        and "envsubst < /srv/Caddyfile.local.template" not in web_dockerfile,
        "pi3-ssh-compression": terminal_preflight.count('"Compression=yes"') == 1,
        "backup-ssh-bind-authority": all(
            value in phase3
            for value in (
                "BACKUP_SSH_PRIVATE_KEY_HOST_PATH",
                "/run/secrets/backup-ssh/id_ed25519",
                "BACKUP_SSH_KNOWN_HOSTS_HOST_PATH",
                "/run/secrets/backup-ssh/known_hosts",
            )
        ),
        "database-role-wiring": (
            "DATABASE_URL: ${APP_DATABASE_URL:?APP_DATABASE_URL is required}" in phase3
            and phase3.count("DATABASE_URL: ${APP_DATABASE_URL:?APP_DATABASE_URL is required}")
            == 1
            and migration.count(
                "${MIGRATION_DATABASE_ENV_FILE:?MIGRATION_DATABASE_ENV_FILE is required}"
            )
            == 2
        ),
        "derivative-storage-mount": derivative in phase3
        and "part-measurement-drawings-derivatives-storage:" in phase3,
        "migration-gateway-image": migration_gateway_probe(root),
        "slot-web-runtime-config": slot_runtime_contract
        and slot_web_runtime_config_probe(root),
    }


def validate(root: Path) -> dict[str, bool]:
    statuses = incident_status(root)
    missing = sorted(set(INCIDENT_IDS) - set(statuses))
    failed = sorted(key for key, value in statuses.items() if value is not True)
    if missing or failed:
        raise ValueError(f"incident regressions detected: missing={missing} failed={failed}")
    return statuses


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--format", choices=("text", "json"), default="text")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    try:
        statuses = validate(args.root.resolve())
    except (OSError, ValueError) as error:
        print(f"production incident audit failed: {error}", file=sys.stderr)
        return 1
    if args.format == "json":
        print(json.dumps({"schemaVersion": 1, "incidents": statuses}, sort_keys=True))
    else:
        print(f"production incident audit passed: incidents={len(statuses)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
