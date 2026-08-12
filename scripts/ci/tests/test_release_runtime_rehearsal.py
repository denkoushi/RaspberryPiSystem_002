#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = ROOT / "scripts/ci/rehearse-release-runtime.sh"
SCRIPT = SCRIPT_PATH.read_text(encoding="utf-8")
WORKFLOW = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")


def job_block(job: str) -> str:
    marker = f"  {job}:\n"
    start = WORKFLOW.index(marker)
    following = WORKFLOW[start + len(marker) :]
    match = re.search(r"^  [a-z][a-z0-9-]+:\s*$", following, re.MULTILINE)
    if match is None:
        return WORKFLOW[start:]
    return WORKFLOW[start : start + len(marker) + match.start()]


class ReleaseRuntimeRehearsalTests(unittest.TestCase):
    def test_exact_main_cannot_shorten_the_bounded_monitor(self) -> None:
        environment = os.environ.copy()
        environment.update(
            {
                "GITHUB_EVENT_NAME": "push",
                "GITHUB_REF": "refs/heads/main",
            }
        )
        result = subprocess.run(
            [
                "bash",
                str(SCRIPT_PATH),
                "--api-image",
                "invalid-api-image",
                "--web-image",
                "invalid-web-image",
                "--sha",
                "a" * 40,
                "--stable-seconds",
                "4",
            ],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 78)
        self.assertIn("pulled ARM64 digests", result.stderr)
        self.assertNotIn("docker", result.stderr.lower())

    def test_rehearsal_uses_exact_images_and_runtime_boundaries(self) -> None:
        for required in (
            "docker pull --platform \"$PLATFORM\" \"$API_IMAGE\"",
            "docker pull --platform \"$PLATFORM\" \"$WEB_IMAGE\"",
            "org.opencontainers.image.revision",
            "prisma migrate deploy",
            "prisma migrate status",
            "docker-compose.phase3.yml",
            "docker-compose.phase3.migration.yml",
            "--read-only --cap-drop ALL --security-opt no-new-privileges:true",
            "/app/storage/part-measurement-drawings-derivatives",
            "CREATE TABLE audit_forbidden",
            "deploy-readiness/internal",
            "leader standby",
            "SLOT_CADDY_CONFIG_FILE",
            'caddy validate --config "$SLOT_CADDY_CONFIG_FILE"',
            "net.ipv4.ip_unprivileged_port_start=80",
            "render_gateway blue",
            "render_gateway green",
            "caddy reload",
        ):
            with self.subTest(required=required):
                self.assertIn(required, SCRIPT)
        self.assertIn("STABLE_SECONDS=40", SCRIPT)
        self.assertIn("STABILITY_SAMPLES=5", SCRIPT)
        self.assertIn("while ((samples < STABILITY_SAMPLES))", SCRIPT)
        self.assertNotIn("scripts/update-all-clients.sh", SCRIPT)

    def test_clean_database_is_migrated_before_roles_are_separated(self) -> None:
        initial_migration = SCRIPT.index(
            'DATABASE_URL="$BOOTSTRAP_DATABASE_URL" exec ./node_modules/.bin/prisma migrate deploy'
        )
        role_bootstrap = SCRIPT.index("postgres-role-bootstrap.sql")
        separated_migration = SCRIPT.index(
            'DATABASE_URL="$MIGRATION_DATABASE_URL" exec ./node_modules/.bin/prisma migrate deploy'
        )
        separated_status = SCRIPT.index(
            'DATABASE_URL="$MIGRATION_DATABASE_URL" exec ./node_modules/.bin/prisma migrate status'
        )
        self.assertLess(initial_migration, role_bootstrap)
        self.assertLess(role_bootstrap, separated_migration)
        self.assertLess(separated_migration, separated_status)

    def test_all_disposable_resources_have_global_and_run_labels(self) -> None:
        self.assertIn("com.raspi-system.production-path-audit.run", SCRIPT)
        self.assertIn('docker network create --label "$LABEL" --label "$RUN_LABEL"', SCRIPT)
        self.assertIn('docker volume create --label "$LABEL" --label "$RUN_LABEL"', SCRIPT)
        self.assertIn('docker ps -aq --filter "label=${RUN_LABEL}"', SCRIPT)
        self.assertIn('docker network ls -q --filter "label=${RUN_LABEL}"', SCRIPT)
        self.assertIn('docker volume ls -q --filter "label=${RUN_LABEL}"', SCRIPT)
        self.assertNotIn("mapfile", SCRIPT)
        self.assertNotIn('DB_VOLUME="$(new_volume', SCRIPT)
        self.assertNotIn('volume="$(new_volume', SCRIPT)

    def test_failure_diagnostic_reports_stage_line_and_status_without_command_data(self) -> None:
        self.assertIn("trap 'report_failure \"$LINENO\"' ERR", SCRIPT)
        self.assertIn(
            "[ERROR] release-runtime-audit failure stage=%s line=%s status=%s",
            SCRIPT,
        )
        for stage in (
            "FAILURE_STAGE='image-validation'",
            "FAILURE_STAGE='database-readiness'",
            "FAILURE_STAGE='migration-and-role-bootstrap'",
            "FAILURE_STAGE='compose-and-storage-validation'",
            "FAILURE_STAGE='api-health-and-scheduler'",
            "FAILURE_STAGE='web-health'",
            "FAILURE_STAGE='gateway-and-stability'",
        ):
            with self.subTest(stage=stage):
                self.assertIn(stage, SCRIPT)
        self.assertNotIn("BASH_COMMAND", SCRIPT)

    def test_main_release_set_waits_for_exact_runtime_rehearsal(self) -> None:
        candidate_rehearsal = job_block("container-runtime-rehearsal")
        rehearsal = job_block("release-runtime-rehearsal")
        aggregate = job_block("ci-required")
        release_set = job_block("release-set")
        self.assertIn(
            "needs.change-classification.outputs.runtime_rehearsal == 'true'",
            candidate_rehearsal,
        )
        self.assertIn("Dockerfile.api", candidate_rehearsal)
        self.assertIn("Dockerfile.web", candidate_rehearsal)
        self.assertIn("--platform linux/amd64", candidate_rehearsal)
        self.assertIn("--skip-pull", candidate_rehearsal)
        self.assertIn("--stable-seconds 10", candidate_rehearsal)
        self.assertIn("runs-on: ubuntu-24.04-arm", rehearsal)
        self.assertIn("packages: read", rehearsal)
        self.assertIn("needs['release-api-image'].result == 'success'", rehearsal)
        self.assertIn("needs['release-web-image'].result == 'success'", rehearsal)
        self.assertIn("--api-image \"$API_IMAGE\"", rehearsal)
        self.assertIn("--web-image \"$WEB_IMAGE\"", rehearsal)
        self.assertIn('--sha "$GITHUB_SHA"', rehearsal)
        self.assertNotIn("--stable-seconds", rehearsal)
        self.assertIn("- release-runtime-rehearsal", aggregate)
        self.assertIn(
            '"release-runtime-rehearsal=$RELEASE_PAIR_SELECTED:$RELEASE_RUNTIME_REHEARSAL_RESULT"',
            aggregate,
        )
        self.assertIn("- release-runtime-rehearsal", release_set)
        self.assertIn(
            "needs['release-runtime-rehearsal'].result == 'success'",
            release_set,
        )


if __name__ == "__main__":
    unittest.main()
