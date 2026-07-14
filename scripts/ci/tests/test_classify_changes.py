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
        )
        self.assertEqual(self.selected(result), {"repo_policy"})
        self.assertFalse(result["fullSuite"])

    def test_api_web_shared_and_migration_paths(self) -> None:
        api = self.classify(Change("M", "apps/api/src/main.ts"))
        self.assertEqual(self.selected(api), {"repo_policy", "workspace_quality", "api"})

        web = self.classify(Change("M", "apps/web/src/main.tsx"))
        self.assertEqual(self.selected(web), {"repo_policy", "workspace_quality", "web"})

        shared = self.classify(Change("M", "packages/shared-types/src/index.ts"))
        self.assertEqual(
            self.selected(shared),
            {"repo_policy", "workspace_quality", "api", "web"},
        )

        migration = self.classify(
            Change("A", "apps/api/prisma/migrations/20260715000000_expand/migration.sql")
        )
        self.assertEqual(
            self.selected(migration),
            {"repo_policy", "workspace_quality", "api", "db_infra"},
        )

    def test_deploy_client_docker_and_e2e_paths(self) -> None:
        deploy = self.classify(Change("M", "scripts/deploy/rolling-release.py"))
        self.assertEqual(self.selected(deploy), {"repo_policy", "deploy_contract"})

        client = self.classify(Change("M", "clients/nfc-agent/nfc_agent/main.py"))
        self.assertEqual(self.selected(client), {"repo_policy", "client"})

        docker = self.classify(Change("M", "infrastructure/docker/Dockerfile.api"))
        self.assertEqual(
            self.selected(docker),
            {"repo_policy", "db_infra", "docker_security"},
        )

        e2e = self.classify(Change("M", "e2e/kiosk.spec.ts"))
        self.assertEqual(self.selected(e2e), {"repo_policy", "e2e"})

    def test_workflow_unknown_delete_and_rename_fail_closed(self) -> None:
        cases = (
            Change("M", ".github/workflows/ci.yml"),
            Change("M", "new-top-level/tool.py"),
            Change("D", "docs/obsolete.md"),
            Change("R100", "apps/api/src/old.ts", "apps/api/src/new.ts"),
        )
        for change in cases:
            with self.subTest(change=change):
                result = self.classify(change)
                self.assertEqual(self.selected(result), set(CATEGORIES))
                self.assertTrue(result["fullSuite"])
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

    def test_malformed_name_status_input_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "missing path"):
            parse_name_status_z(b"M\0")


if __name__ == "__main__":
    unittest.main()
