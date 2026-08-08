#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from classify_changes import (  # noqa: E402
    CATEGORIES,
    Change,
    classify_changes,
    parse_name_status_z,
    render_github_output,
    render_markdown,
)


class ClassifyChangesTests(unittest.TestCase):
    def classify(self, *changes: Change) -> dict[str, object]:
        return classify_changes(changes)

    def selected(self, result: dict[str, object]) -> set[str]:
        categories = result["categories"]
        assert isinstance(categories, dict)
        return {name for name, enabled in categories.items() if enabled}

    def test_docs_and_root_markdown_select_repo_policy_only(self) -> None:
        result = self.classify(
            Change("M", "docs/guides/deployment.md"),
            Change("A", "README.md"),
            Change("M", ".github/BRANCH_PROTECTION_SETUP.md"),
        )
        self.assertEqual(self.selected(result), {"repo_policy"})
        self.assertFalse(result["fullSuite"])
        self.assertFalse(result["codeql"])
        self.assertFalse(result["dockerApi"])
        self.assertFalse(result["dockerWeb"])
        self.assertFalse(result["releasePair"])

    def test_api_web_shared_and_migration_paths(self) -> None:
        api = self.classify(Change("M", "apps/api/src/main.ts"))
        self.assertEqual(self.selected(api), {"repo_policy", "workspace_quality", "api"})
        self.assertTrue(api["codeql"])
        self.assertTrue(api["releasePair"])

        web = self.classify(Change("M", "apps/web/src/main.tsx"))
        self.assertEqual(self.selected(web), {"repo_policy", "workspace_quality", "web", "kiosk_sop"})
        self.assertTrue(web["codeql"])
        self.assertTrue(web["releasePair"])

        shared = self.classify(Change("M", "packages/shared-types/src/index.ts"))
        self.assertEqual(
            self.selected(shared),
            {"repo_policy", "workspace_quality", "api", "web", "kiosk_sop"},
        )

        migration = self.classify(
            Change("A", "apps/api/prisma/migrations/20260715000000_expand/migration.sql")
        )
        self.assertEqual(
            self.selected(migration),
            {"repo_policy", "workspace_quality", "api", "db_infra"},
        )

    def test_deploy_client_docker_and_e2e_paths(self) -> None:
        deploy = self.classify(
            Change("M", "scripts/deploy/standard-ansible-release.py")
        )
        self.assertEqual(self.selected(deploy), {"repo_policy", "deploy_contract"})

        client = self.classify(Change("M", "clients/nfc-agent/nfc_agent/main.py"))
        self.assertEqual(self.selected(client), {"repo_policy", "client"})

        docker = self.classify(Change("M", "infrastructure/docker/Dockerfile.api"))
        self.assertEqual(
            self.selected(docker),
            {"repo_policy", "db_infra", "docker_security"},
        )
        self.assertTrue(docker["dockerApi"])
        self.assertFalse(docker["dockerWeb"])
        self.assertTrue(docker["releasePair"])

        e2e = self.classify(Change("M", "e2e/kiosk.spec.ts"))
        self.assertEqual(self.selected(e2e), {"repo_policy", "e2e"})
        self.assertTrue(e2e["codeql"])

    def test_pi4_agent_dockerfiles_select_client_image_contracts_only(self) -> None:
        for path in (
            "infrastructure/docker/Dockerfile.nfc-agent",
            "infrastructure/docker/Dockerfile.barcode-agent",
            "infrastructure/docker/Dockerfile.torque-agent",
        ):
            with self.subTest(path=path):
                result = self.classify(Change("M", path))
                self.assertEqual(
                    self.selected(result),
                    {"repo_policy", "client", "docker_security"},
                )
                self.assertFalse(result["dockerApi"])
                self.assertFalse(result["dockerWeb"])
                self.assertFalse(result["releasePair"])

    def test_signage_artifact_inputs_select_only_the_focused_contract(self) -> None:
        for path in (
            "clients/status-agent/status-agent.py",
            "clients/status-agent/storage_health.py",
            "clients/status-agent/terminal_agent_health.py",
            "scripts/deploy/rolling_release/terminal_device_maintenance.py",
            "scripts/deploy/signage-release-artifact.py",
            "scripts/deploy/signage-distribution-artifact.py",
            "scripts/deploy/tests/test_signage_distribution_artifact.py",
            "scripts/deploy/rolling_release/signage_artifact_stage.py",
            "scripts/deploy/tests/test_signage_artifact_stage.py",
            "infrastructure/ansible/roles/signage/templates/signage-update.sh.j2",
            "infrastructure/docker/Dockerfile.signage-release",
        ):
            with self.subTest(path=path):
                result = self.classify(Change("M", path))
                self.assertTrue(result["categories"]["signage_artifact"])
                if path != "scripts/deploy/rolling_release/terminal_device_maintenance.py":
                    self.assertFalse(result["releasePair"])
                    self.assertFalse(result["dockerApi"])
                    self.assertFalse(result["dockerWeb"])

        for path in (
            "clients/nfc-agent/nfc_agent/main.py",
            "infrastructure/ansible/roles/server/tasks/main.yml",
            "infrastructure/docker/Dockerfile.api",
            "apps/web/src/main.tsx",
        ):
            with self.subTest(path=path):
                result = self.classify(Change("M", path))
                self.assertFalse(result["categories"]["signage_artifact"])

    def test_web_build_configuration_selects_only_web_image_contracts(self) -> None:
        for path in (
            "infrastructure/ansible/group_vars/server/web-build.yml",
            "infrastructure/ansible/templates/docker.env.j2",
            "infrastructure/ansible/templates/web.env.j2",
            "infrastructure/docker/Dockerfile.web",
            "infrastructure/docker/Caddyfile.production",
        ):
            with self.subTest(path=path):
                result = self.classify(Change("M", path))
                self.assertEqual(
                    self.selected(result),
                    {
                        "repo_policy",
                        "web",
                        "deploy_contract",
                        "docker_security",
                    },
                )
                self.assertFalse(result["codeql"])
                self.assertFalse(result["dockerApi"])
                self.assertTrue(result["dockerWeb"])
                self.assertTrue(result["releasePair"])
                self.assertEqual(
                    [item["image"] for item in result["dockerMatrix"]],
                    ["web"],
                )

    def test_general_inventory_and_dockerignore_remain_fail_closed(self) -> None:
        inventory = self.classify(
            Change("M", "infrastructure/ansible/inventory.yml")
        )
        self.assertEqual(
            self.selected(inventory),
            {"repo_policy", "db_infra", "deploy_contract"},
        )
        self.assertTrue(inventory["releasePair"])

        dockerignore = self.classify(Change("M", ".dockerignore"))
        self.assertTrue(dockerignore["fullSuite"])
        self.assertTrue(dockerignore["codeql"])
        self.assertTrue(dockerignore["dockerApi"])
        self.assertTrue(dockerignore["dockerWeb"])

    def test_workflow_unknown_delete_and_rename_fail_closed(self) -> None:
        cases = (
            Change("M", ".github/workflows/ci.yml"),
            Change("M", "scripts/ci/run-deploy-contracts-local.sh"),
            Change("M", "new-top-level/tool.py"),
            Change("D", "docs/obsolete.md"),
            Change("R100", "apps/api/src/old.ts", "apps/api/src/new.ts"),
        )
        for change in cases:
            with self.subTest(change=change):
                result = self.classify(change)
                self.assertEqual(self.selected(result), set(CATEGORIES))
                self.assertTrue(result["fullSuite"])
                self.assertTrue(result["codeql"])
                self.assertTrue(result["dockerApi"])
                self.assertTrue(result["dockerWeb"])
                self.assertTrue(result["releasePair"])
                self.assertTrue(result["failClosedReasons"])

    def test_name_status_parser_preserves_rename_source_and_destination(self) -> None:
        parsed = parse_name_status_z(
            b"M\0apps/api/src/main.ts\0R097\0old name.ts\0new name.ts\0"
        )
        self.assertEqual(
            parsed,
            [
                Change("M", "apps/api/src/main.ts"),
                Change("R097", "new name.ts", "old name.ts"),
            ],
        )

    def test_force_full_reason_handles_missing_diff_base(self) -> None:
        result = classify_changes([], force_full_reason="no stable diff base")
        self.assertEqual(self.selected(result), set(CATEGORIES))
        self.assertEqual(result["failClosedReasons"], ["no stable diff base"])

    def test_enforced_outputs_are_stable_lowercase_booleans(self) -> None:
        result = self.classify(Change("M", "apps/api/src/main.ts"))
        self.assertEqual(result["mode"], "enforced")
        self.assertEqual(
            render_github_output(result).splitlines(),
            [
                "repo_policy=true",
                "workspace_quality=true",
                "api=true",
                "web=false",
                "db_infra=false",
                "deploy_contract=false",
                "client=false",
                "e2e=false",
                "kiosk_sop=false",
                "docker_security=false",
                "signage_artifact=false",
                "full_suite=false",
                "codeql=true",
                "docker_api=false",
                "docker_web=false",
                "release_pair=true",
                "runtime_rehearsal=true",
                'docker_matrix=[{"dockerfile":"./infrastructure/docker/Dockerfile.api","image":"api","tag":"raspisys-api:ci"},{"dockerfile":"./infrastructure/docker/Dockerfile.web","image":"web","tag":"raspisys-web:ci"}]',
            ],
        )
        markdown = render_markdown(result)
        self.assertIn("Change classification (enforced)", markdown)
        self.assertNotIn("informational", markdown)

    def test_malformed_name_status_input_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "missing path"):
            parse_name_status_z(b"M\0")

    def test_terminal_e2e_and_ordinary_docs_do_not_publish_release_pair(self) -> None:
        for path in (
            "clients/nfc-agent/nfc_agent/main.py",
            "e2e/kiosk.spec.ts",
            "docs/guides/deployment.md",
        ):
            with self.subTest(path=path):
                self.assertFalse(
                    self.classify(Change("M", path))["releasePair"]
                )

    def test_runtime_sources_publish_release_pair(self) -> None:
        for path in (
            "apps/web/src/generated/kiosk-sop/inspection-drawing/manual.html",
            "scripts/deploy/deploy-status-state.py",
            "scripts/part-measurement/drawing-local-rapidocr-worker.py",
        ):
            with self.subTest(path=path):
                self.assertTrue(
                    self.classify(Change("M", path))["releasePair"]
                )

        self.assertFalse(
            self.classify(Change("M", "docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html"))["releasePair"]
        )

    def test_runtime_rehearsal_follows_release_runtime_and_fails_closed(self) -> None:
        for path in (
            "apps/api/src/main.ts",
            "apps/web/src/main.tsx",
            "apps/api/prisma/migrations/20260804000000_audit/migration.sql",
            "infrastructure/docker/docker-compose.phase3.yml",
            "infrastructure/ansible/playbooks/server-config-release.yml",
            "scripts/deploy/standard-ansible-release.py",
            "scripts/server/deploy.sh",
        ):
            with self.subTest(path=path):
                self.assertTrue(
                    self.classify(Change("M", path))["runtimeRehearsal"]
                )
        self.assertFalse(
            self.classify(Change("M", "docs/guides/deployment.md"))[
                "runtimeRehearsal"
            ]
        )
        self.assertTrue(
            self.classify(Change("M", "unknown-runtime-surface/file"))[
                "runtimeRehearsal"
            ]
        )

    def test_kiosk_sop_inputs_select_fail_closed_generation(self) -> None:
        for path in (
            "apps/web/src/pages/kiosk/KioskInspectionDrawingLibraryPage.tsx",
            "packages/kiosk-sop-core/src/render.ts",
            "scripts/kiosk-sop/generate.mjs",
            "infrastructure/docker/Dockerfile.kiosk-sop-generator",
            "e2e/inspection-drawing-sop-popup.spec.ts",
            "playwright.kiosk-sop.config.ts",
            "docs/design-previews/kiosk-inspection-drawing-edit-existing-sop.html",
        ):
            with self.subTest(path=path):
                self.assertIn("kiosk_sop", self.selected(self.classify(Change("M", path))))


if __name__ == "__main__":
    unittest.main()
