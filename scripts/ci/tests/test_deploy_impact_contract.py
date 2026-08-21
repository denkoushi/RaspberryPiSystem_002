from __future__ import annotations

import unittest
import sys
import json
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deploy_impact_contract import ImpactContractError, assess, parse_table
from classify_changes import Change, classify_changes
from validate_deploy_impact import main as validate_main


FIELDS = (
    "Risk",
    "Target machines",
    "Changed surfaces",
    "Required files/artifacts",
    "Database",
    "Secrets/config delivery",
    "Success evidence",
    "Rollback/cleanup",
    "Production verification",
)


def classification(
    *changes: dict[str, object], full_suite: bool = False
) -> dict[str, object]:
    return {
        "schemaVersion": 6,
        "changes": list(changes),
        "fullSuite": full_suite,
    }


def actual_classification(path: str) -> dict[str, object]:
    """Use the repository classifier output, including fail-closed reasons."""

    return classify_changes([Change("M", path)])


def table(**overrides: str) -> str:
    values = {
        "Risk": "docs",
        "Target machines": "none",
        "Changed surfaces": "docs",
        "Required files/artifacts": "N/A: documentation-only change",
        "Database": "no: no schema, query, or migration change",
        "Secrets/config delivery": "no: no secret or runtime configuration change",
        "Success evidence": "documentation audit and focused tests",
        "Rollback/cleanup": "N/A: revert the documentation commit",
        "Production verification": "N/A: no production runtime target",
    }
    values.update(overrides)
    rows = ["| Item | Declaration |", "| --- | --- |"]
    rows.extend(f"| {field} | {values[field]} |" for field in FIELDS)
    return "<!-- deploy-impact:start -->\n" + "\n".join(rows) + "\n<!-- deploy-impact:end -->"


DOC_CHANGE = {"status": "M", "path": "docs/guide.md", "categories": ["repo_policy"]}


class DeployImpactContractTests(unittest.TestCase):
    def test_docs_only_passes(self) -> None:
        declaration = parse_table(table())
        result = assess(declaration, classification(DOC_CHANGE))
        self.assertEqual(result.inferred_risk, "docs")
        self.assertEqual(result.inferred_targets, frozenset())
        self.assertEqual(result.inferred_surfaces, frozenset({"docs"}))

    def test_explicit_documentation_paths_are_docs(self) -> None:
        known_docs = (
            "docs/guide.md",
            "README.md",
            ".cursor/rules/10-quality-ci-and-tests.mdc",
            ".agent/PLANS.md",
        )
        for path in known_docs:
            with self.subTest(path=path):
                result = assess(
                    parse_table(table()),
                    actual_classification(path),
                )
                self.assertEqual(result.inferred_risk, "docs")
                self.assertEqual(result.inferred_surfaces, frozenset({"docs"}))

    def test_classifier_fail_closed_document_paths_have_unknown_risk(self) -> None:
        for path in (".github/pull_request_template.md",):
            with self.subTest(path=path):
                result = assess(
                    parse_table(
                        table(
                            Risk="unknown",
                            **{
                                "Changed surfaces": "docs, unknown",
                                "Required files/artifacts": "documentation rule or PR template",
                            },
                        )
                    ),
                    actual_classification(path),
                )
                self.assertEqual(result.inferred_risk, "unknown")
                self.assertEqual(
                    result.inferred_surfaces, frozenset({"docs", "unknown"})
                )

    def test_repo_policy_only_git_lifecycle_has_no_runtime_target(self) -> None:
        result = assess(
            parse_table(
                table(
                    Risk="db-auth-systemd-deploy",
                    **{
                        "Changed surfaces": "ci",
                        "Required files/artifacts": "repository lifecycle policy tool",
                    },
                )
            ),
            actual_classification("scripts/git_lifecycle/cli.py"),
        )
        self.assertEqual(result.inferred_targets, frozenset())
        self.assertEqual(result.deploy_components, tuple())

    def test_classifier_and_lifecycle_changes_keep_runtime_targets_empty(self) -> None:
        changes = classify_changes(
            [
                Change("M", "scripts/ci/classify_changes.py"),
                Change("A", "scripts/git_lifecycle/cli.py"),
            ]
        )
        result = assess(
            parse_table(
                table(
                    Risk="db-auth-systemd-deploy",
                    **{
                        "Changed surfaces": "ci",
                        "Required files/artifacts": "repository policy scripts and tests",
                    },
                )
            ),
            changes,
        )
        self.assertEqual(result.inferred_targets, frozenset())
        self.assertEqual(result.deploy_components, tuple())

    def test_package_metadata_full_suite_is_unknown(self) -> None:
        for path in ("package.json", "pnpm-lock.yaml"):
            with self.subTest(path=path):
                change = {"status": "M", "path": path}
                with self.assertRaisesRegex(ImpactContractError, "Risk under-declared"):
                    assess(parse_table(table()), classification(change, full_suite=True))
                declaration = parse_table(
                    table(
                        Risk="unknown",
                        **{
                            "Target machines": "pi5",
                            "Changed surfaces": "unknown",
                            "Required files/artifacts": "package metadata and lockfile",
                            "Success evidence": "full suite and dependency audit",
                        },
                    )
                )
                result = assess(
                    declaration, classification(change, full_suite=True)
                )
                self.assertEqual(result.inferred_risk, "unknown")
                self.assertEqual(result.inferred_surfaces, frozenset({"unknown"}))

    def test_table_is_required_and_unique(self) -> None:
        with self.assertRaises(ImpactContractError):
            parse_table("no table")
        duplicate = table() + "\n" + table()
        with self.assertRaises(ImpactContractError):
            parse_table(duplicate)

    def test_missing_row_and_placeholder_fail(self) -> None:
        missing = table().replace("| Success evidence | documentation audit and focused tests |\n", "")
        with self.assertRaises(ImpactContractError):
            parse_table(missing)
        with self.assertRaises(ImpactContractError):
            parse_table(table(**{"Success evidence": "TODO"}))

    def test_n_a_and_yes_no_need_explanation(self) -> None:
        with self.assertRaises(ImpactContractError):
            assess(
                parse_table(table(**{"Rollback/cleanup": "N/A"})),
                classification(DOC_CHANGE),
            )
        with self.assertRaises(ImpactContractError):
            assess(
                parse_table(table(**{"Database": "no"})),
                classification(DOC_CHANGE),
            )
        with self.assertRaises(ImpactContractError):
            assess(
                parse_table(table(**{"Secrets/config delivery": "yes"})),
                classification(DOC_CHANGE),
            )

    def test_api_change_cannot_be_declared_as_docs(self) -> None:
        api = {"status": "M", "path": "apps/api/src/routes/example.ts"}
        with self.assertRaisesRegex(ImpactContractError, "Risk under-declared"):
            assess(parse_table(table()), classification(api))

    def test_api_change_passes_with_surface_and_risk(self) -> None:
        api = {"status": "M", "path": "apps/api/src/routes/example.ts"}
        declaration = parse_table(
            table(
                Risk="api-agent-config",
                **{
                    "Target machines": "pi5",
                    "Changed surfaces": "api",
                    "Required files/artifacts": "API source and generated client contract",
                    "Success evidence": "API unit tests and health check",
                },
            )
        )
        result = assess(declaration, classification(api))
        self.assertEqual(result.inferred_risk, "api-agent-config")

    def test_server_and_agent_paths_require_registry_targets(self) -> None:
        changes = (
            {"status": "M", "path": "apps/api/src/routes/example.ts"},
            {"status": "M", "path": "clients/status-agent/status-agent.py"},
        )
        declaration = parse_table(
            table(
                Risk="api-agent-config",
                **{
                    "Target machines": "pi3, pi4, pi5",
                    "Changed surfaces": "api, agent",
                    "Required files/artifacts": "API and status-agent runtime files",
                    "Success evidence": "API tests, agent health check, and runtime rehearsal",
                    "Rollback/cleanup": "Revert the commit and remove test-owned runtime resources",
                    "Production verification": "N/A: production deploy is separately authorized",
                },
            )
        )
        result = assess(declaration, classification(*changes))
        self.assertEqual(result.inferred_targets, frozenset({"pi3", "pi4", "pi5"}))

    def test_google_drive_dr_is_pi5_deploy_risk(self) -> None:
        paths = (
            "scripts/google_drive_dr/runner.py",
            "infrastructure/ansible/playbooks/deploy-google-drive-disaster-recovery.yml",
            "infrastructure/ansible/templates/raspi-google-drive-dr.env.j2",
            "infrastructure/ansible/templates/raspi-google-drive-dr.service.j2",
            "infrastructure/ansible/templates/raspi-google-drive-dr.timer.j2",
        )
        changes = [
            classify_changes([Change("M", path)])["changes"][0]
            for path in paths
        ]
        declaration = parse_table(
            table(
                Risk="db-auth-systemd-deploy",
                **{
                    "Target machines": "pi5",
                    "Changed surfaces": "config, deploy, systemd",
                    "Required files/artifacts": "Google Drive DR package and Pi5 deployment units",
                    "Success evidence": "focused classifier and deployment contract tests",
                    "Rollback/cleanup": "revert the classifier and registry mappings",
                    "Production verification": "N/A: production deploy is separately authorized",
                },
            )
        )

        result = assess(declaration, classification(*changes))

        self.assertEqual(result.inferred_risk, "db-auth-systemd-deploy")
        self.assertEqual(result.inferred_targets, frozenset({"pi5"}))
        self.assertNotIn("unknown", result.inferred_surfaces)

    def test_database_no_is_rejected_and_yes_is_allowed(self) -> None:
        migration = {"status": "M", "path": "apps/api/prisma/migrations/001_init.sql"}
        with self.assertRaisesRegex(ImpactContractError, "Database must be yes"):
            assess(
                parse_table(
                    table(
                        Risk="db-auth-systemd-deploy",
                        **{
                            "Changed surfaces": "api, db",
                            "Target machines": "pi5",
                            "Required files/artifacts": "migration and SQL fixture",
                        },
                    )
                ),
                classification(migration),
            )
        result = assess(
            parse_table(
                table(
                    Risk="db-auth-systemd-deploy",
                    **{
                        "Changed surfaces": "api, db",
                        "Target machines": "pi5",
                        "Required files/artifacts": "migration and SQL fixture",
                        "Database": "yes: apply migration and run EXPLAIN in isolated PostgreSQL",
                    },
                )
            ),
            classification(migration),
        )
        self.assertEqual(result.inferred_surfaces, frozenset({"api", "db"}))

    def test_unknown_delete_requires_unknown_risk_and_surface(self) -> None:
        deleted = {"status": "D", "path": "legacy/removed-runtime.sh"}
        with self.assertRaisesRegex(ImpactContractError, "Risk under-declared"):
            assess(parse_table(table(Risk="db-auth-systemd-deploy")), classification(deleted))
        declaration = parse_table(
            table(
                Risk="unknown",
                **{
                    "Target machines": "pi3, pi4, pi5",
                    "Changed surfaces": "unknown",
                    "Required files/artifacts": "deleted path requires full-suite review",
                    "Success evidence": "full suite and runtime rehearsal",
                    "Rollback/cleanup": "revert deletion and remove rehearsal resources",
                },
            )
        )
        result = assess(declaration, classification(deleted))
        self.assertEqual(result.inferred_risk, "unknown")

    def test_unstable_empty_diff_fails_closed(self) -> None:
        unstable = {
            "schemaVersion": 6,
            "changes": [],
            "fullSuite": True,
            "failClosedReasons": ["stable diff base is unavailable"],
        }
        declaration = parse_table(
            table(
                Risk="unknown",
                **{
                    "Target machines": "none",
                    "Changed surfaces": "unknown",
                    "Required files/artifacts": "N/A: no stable diff can identify artifacts",
                    "Success evidence": "full suite and manual review",
                },
            )
        )
        result = assess(declaration, unstable)
        self.assertEqual(result.inferred_risk, "unknown")

    def test_safe_over_declaration_is_allowed(self) -> None:
        result = assess(
            parse_table(
                table(
                    Risk="db-auth-systemd-deploy",
                    **{
                        "Target machines": "pi3",
                        "Changed surfaces": "docs, ci",
                        "Required files/artifacts": "docs and CI workflow",
                        "Success evidence": "focused tests and hosted full suite",
                        "Rollback/cleanup": "revert commit; no runtime resources are created",
                    },
                )
            ),
            classification(DOC_CHANGE),
        )
        self.assertIn("docs", result.inferred_surfaces)

    def test_current_change_shape_is_safe_without_runtime_target(self) -> None:
        current_changes = [
            {"status": "A", "path": ".github/pull_request_template.md"},
            {"status": "M", "path": ".github/workflows/ci.yml"},
            {"status": "A", "path": "scripts/ci/deploy_impact_contract.py"},
            {"status": "A", "path": "scripts/ci/validate_deploy_impact.py"},
            {"status": "A", "path": "scripts/deploy/deploy_impact.py"},
            {"status": "M", "path": "docs/guides/ci-branch-protection.md"},
        ]
        declaration = parse_table(
            table(
                Risk="unknown",
                **{
                    "Changed surfaces": "ci, deploy, docs, unknown",
                    "Required files/artifacts": "PR template, validator, registry helper, workflow, and guide",
                    "Success evidence": "contract suites, full deploy contracts, and documentation audit",
                },
            )
        )
        result = assess(
            declaration, classification(*current_changes, full_suite=True)
        )
        self.assertEqual(result.inferred_risk, "unknown")
        self.assertIn("unknown", result.inferred_surfaces)
        self.assertEqual(result.inferred_targets, frozenset())

    def test_schema_version_is_current(self) -> None:
        with self.assertRaisesRegex(ImpactContractError, "schemaVersion 6"):
            assess(parse_table(table()), {"schemaVersion": 5, "changes": []})

    def test_validator_consumes_event_and_schema_six_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            event_path = root / "event.json"
            classification_path = root / "classification.json"
            summary_path = root / "summary.md"
            event_path.write_text(
                json.dumps({"pull_request": {"body": table()}}), encoding="utf-8"
            )
            classification_path.write_text(
                json.dumps(classification(DOC_CHANGE)), encoding="utf-8"
            )
            self.assertEqual(
                validate_main(
                    [
                        "--event-path",
                        str(event_path),
                        "--classification-json",
                        str(classification_path),
                        "--markdown-file",
                        str(summary_path),
                    ]
                ),
                0,
            )
            self.assertIn("Deploy impact contract", summary_path.read_text())

    def test_validator_returns_input_error_for_old_schema(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            event_path = root / "event.json"
            classification_path = root / "classification.json"
            event_path.write_text(
                json.dumps({"pull_request": {"body": table()}}), encoding="utf-8"
            )
            classification_path.write_text(
                json.dumps({"schemaVersion": 5, "changes": []}), encoding="utf-8"
            )
            self.assertEqual(
                validate_main(
                    [
                        "--event-path",
                        str(event_path),
                        "--classification-json",
                        str(classification_path),
                    ]
                ),
                2,
            )


if __name__ == "__main__":
    unittest.main()
