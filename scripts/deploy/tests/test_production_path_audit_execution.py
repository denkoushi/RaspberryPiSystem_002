from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import uuid


ROOT = Path(__file__).resolve().parents[3]
MODULE_DIR = ROOT / "scripts/deploy/lib/pi5-blue-green"
PHASE3 = ROOT / "infrastructure/docker/docker-compose.phase3.yml"
MIGRATION = ROOT / "infrastructure/docker/docker-compose.phase3.migration.yml"
ENV_FIXTURE = ROOT / "scripts/deploy/tests/fixtures/pi5-compose.env"
AUDIT_LABEL = "com.raspi-system.production-path-audit=true"


def run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, check=False, capture_output=True, text=True, **kwargs)


class ProductionPathAuditExecutionTest(unittest.TestCase):
    def test_public_pi5_entrypoint_exercises_the_safety_lifecycle(self) -> None:
        completed = run(
            ["bash", str(ROOT / "scripts/deploy/tests/test-pi5-blue-green.sh")],
            cwd=ROOT,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("PASS: pi5 blue/green safety lifecycle", completed.stdout)

    def test_migration_compose_executes_for_both_gateway_slots(self) -> None:
        completed = run(
            [
                "bash",
                "-euo",
                "pipefail",
                "-c",
                r'''
source "$1"
source "$2"
PROJECT_DIR=/tmp/pi5-production-path-audit
ENV_FILE=/dev/null
CONFIG_DIR=/tmp/pi5-production-path-audit-config
PHASE3_COMPOSE=/tmp/phase3.yml
PHASE3_MIGRATION_COMPOSE=/tmp/phase3-migration.yml
COMPOSE_PROJECT=production-path-audit
DRY_RUN=0
BLUE_API_IMAGE=api-blue
GREEN_API_IMAGE=api-green
BLUE_WEB_IMAGE=web-blue
GREEN_WEB_IMAGE=web-green
docker() {
  [[ "$1" == compose ]] || return 40
  [[ "${PI5_GATEWAY_IMAGE:-}" == "$EXPECTED_GATEWAY" ]] || return 41
  [[ " ${*} " == *" -f /tmp/phase3.yml -f /tmp/phase3-migration.yml "* ]] || return 42
  [[ " ${*} " == *" run --rm --no-deps api-${EXPECTED_CANDIDATE} "* ]] || return 43
  printf '%s|%s\n' "$EXPECTED_CANDIDATE" "$PI5_GATEWAY_IMAGE"
}
GATEWAY_SLOT=blue
EXPECTED_GATEWAY=web-blue
EXPECTED_CANDIDATE=green
compose_migration run --rm --no-deps api-green sh -lc 'migration command'
GATEWAY_SLOT=green
EXPECTED_GATEWAY=web-green
EXPECTED_CANDIDATE=blue
compose_migration run --rm --no-deps api-blue sh -lc 'migration command'
''',
                "pi5-production-path-audit",
                str(MODULE_DIR / "images-evidence.sh"),
                str(MODULE_DIR / "runtime.sh"),
            ],
            cwd=ROOT,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout, "green|web-blue\nblue|web-green\n")

    def test_phase3_compose_model_resolves_runtime_and_migration(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            temporary = Path(raw)
            migration_env = temporary / "migration.env"
            migration_env.write_text(
                "MIGRATION_DATABASE_URL=postgresql://raspi_migrator:contract-migration-password@db:5432/borrow_return\n",
                encoding="utf-8",
            )
            compose_env = temporary / "compose.env"
            compose_env.write_text(
                ENV_FIXTURE.read_text(encoding="utf-8").replace(
                    "/tmp/raspi-contract-migration.env", str(migration_env)
                ),
                encoding="utf-8",
            )
            base_environment = os.environ.copy()
            base_environment.update(
                {
                    "PI5_BLUE_API_IMAGE": "registry.invalid/api:blue",
                    "PI5_GREEN_API_IMAGE": "registry.invalid/api:green",
                    "PI5_BLUE_WEB_IMAGE": "registry.invalid/web:blue",
                    "PI5_GREEN_WEB_IMAGE": "registry.invalid/web:green",
                    "PI5_PROJECT_DIR": str(ROOT),
                    "PI5_ENV_FILE": str(compose_env),
                }
            )
            for slot, gateway in (("blue", "registry.invalid/web:blue"), ("green", "registry.invalid/web:green")):
                environment = {**base_environment, "PI5_GATEWAY_IMAGE": gateway}
                completed = run(
                    [
                        "docker",
                        "compose",
                        "--env-file",
                        str(compose_env),
                        "-f",
                        str(PHASE3),
                        "-f",
                        str(MIGRATION),
                        "config",
                        "--format",
                        "json",
                    ],
                    cwd=ROOT,
                    env=environment,
                )
                self.assertEqual(completed.returncode, 0, completed.stderr)
                model = json.loads(completed.stdout)
                services = model["services"]
                self.assertEqual(services["gateway"]["image"], gateway, slot)
                for candidate in ("api-blue", "api-green"):
                    self.assertEqual(
                        services[candidate]["environment"]["DATABASE_URL"],
                        "postgresql://raspi_app:contract-app-password@db:5432/borrow_return",
                    )
                    self.assertEqual(
                        services[candidate]["environment"]["MIGRATION_DATABASE_URL"],
                        "postgresql://raspi_migrator:contract-migration-password@db:5432/borrow_return",
                    )
                    self.assertTrue(services[candidate]["read_only"])
                    targets = {
                        mount["target"]
                        for mount in services[candidate]["volumes"]
                        if isinstance(mount, dict) and "target" in mount
                    }
                    self.assertIn("/app/storage/part-measurement-drawings-derivatives", targets)
                    self.assertIn("/run/secrets/backup-ssh/id_ed25519", targets)

    def test_disposable_container_runtime_enforces_read_only_storage(self) -> None:
        info = run(["docker", "info", "--format", "{{.ServerVersion}}"])
        self.assertEqual(info.returncode, 0, "Docker is required for the production-path audit")
        suffix = uuid.uuid4().hex[:12]
        volume = f"raspi-audit-storage-{suffix}"
        network = f"raspi-audit-network-{suffix}"
        container = f"raspi-audit-runtime-{suffix}"
        try:
            self.assertEqual(
                run(["docker", "volume", "create", "--label", AUDIT_LABEL, volume]).returncode,
                0,
            )
            self.assertEqual(
                run(["docker", "network", "create", "--label", AUDIT_LABEL, network]).returncode,
                0,
            )
            initialize = run(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--label",
                    AUDIT_LABEL,
                    "-v",
                    f"{volume}:/app/storage",
                    "alpine:3.20",
                    "sh",
                    "-ec",
                    "chown 65534:65534 /app/storage",
                ]
            )
            self.assertEqual(initialize.returncode, 0, initialize.stderr)
            completed = run(
                [
                    "docker",
                    "run",
                    "--rm",
                    "--name",
                    container,
                    "--label",
                    AUDIT_LABEL,
                    "--network",
                    network,
                    "--read-only",
                    "--user",
                    "65534:65534",
                    "--cap-drop",
                    "ALL",
                    "--security-opt",
                    "no-new-privileges:true",
                    "--tmpfs",
                    "/tmp:rw,nosuid,nodev,mode=1777,size=16m",
                    "-v",
                    f"{volume}:/app/storage",
                    "alpine:3.20",
                    "sh",
                    "-ec",
                    "! touch /root-write-probe; touch /tmp/probe; "
                    "mkdir -p /app/storage/part-measurement-drawings-derivatives; "
                    "touch /app/storage/part-measurement-drawings-derivatives/probe",
                ]
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
        finally:
            run(["docker", "rm", "-f", container])
            run(["docker", "network", "rm", network])
            run(["docker", "volume", "rm", volume])
        for command in (
            ["docker", "ps", "-aq", "--filter", f"label={AUDIT_LABEL}"],
            ["docker", "network", "ls", "-q", "--filter", f"label={AUDIT_LABEL}"],
            ["docker", "volume", "ls", "-q", "--filter", f"label={AUDIT_LABEL}"],
        ):
            residue = run(command)
            self.assertEqual(residue.returncode, 0, residue.stderr)
            self.assertEqual(residue.stdout.strip(), "")


if __name__ == "__main__":
    unittest.main()
