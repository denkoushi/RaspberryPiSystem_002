#!/usr/bin/env python3
from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CI = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
CODEQL = (ROOT / ".github/workflows/codeql.yml").read_text(encoding="utf-8")
GITLEAKS = (ROOT / ".github/workflows/gitleaks.yml").read_text(encoding="utf-8")


def job_block(text: str, job: str) -> str:
    marker = f"  {job}:\n"
    start = text.index(marker)
    match = re.search(r"^  [a-z][a-z0-9-]+:\s*$", text[start + len(marker) :], re.MULTILINE)
    if match is None:
        return text[start:]
    return text[start : start + len(marker) + match.start()]


class StagedCiWorkflowTests(unittest.TestCase):
    def test_full_suite_events_and_jst_schedule_are_declared(self) -> None:
        for workflow in (CI, CODEQL, GITLEAKS):
            self.assertIn("  push:\n    branches: [main]", workflow)
            self.assertIn("  pull_request:\n    branches: [main]", workflow)
            self.assertIn("  merge_group:\n", workflow)
            self.assertIn("  workflow_dispatch:\n", workflow)
            self.assertIn("- cron: '30 17 * * *'", workflow)
            self.assertNotIn("develop", workflow)
        classifier = job_block(CI, "change-classification")
        self.assertIn('if [[ "$EVENT_NAME" != "pull_request" ]]', classifier)
        self.assertIn("always runs the full suite", classifier)

    def test_classifier_outputs_drive_every_conditional_job(self) -> None:
        categories = {
            "repo-policy": "repo_policy",
            "workspace-quality": "workspace_quality",
            "api": "api",
            "web": "web",
            "db-infra": "db_infra",
            "deploy-contract": "deploy_contract",
            "client": "client",
            "docker-security": "docker_security",
            "e2e-smoke": "e2e",
            "e2e-tests": "e2e",
        }
        classifier = job_block(CI, "change-classification")
        for output in set(categories.values()):
            self.assertIn(f"      {output}: ${{{{ steps.classify.outputs.{output} }}}}", classifier)
        for job, output in categories.items():
            block = job_block(CI, job)
            self.assertIn("needs: change-classification", block)
            self.assertIn(
                f"needs.change-classification.outputs.{output} == 'true'",
                block,
            )

    def test_api_uses_one_noncoverage_pr_run_and_three_full_coverage_shards(self) -> None:
        api = job_block(CI, "api")
        self.assertIn('"shard":"all","shard_id":"all","coverage":false', api)
        for shard in ("1/3", "2/3", "3/3"):
            self.assertIn(f'"shard":"{shard}"', api)
        self.assertIn("Run API tests (PR, no coverage)", api)
        self.assertIn("pnpm test -- --fileParallelism=true --maxWorkers=1", api)
        self.assertIn("Run API tests (coverage shard)", api)
        self.assertIn("pnpm test:coverage -- --shard=${{ matrix.shard }}", api)

    def test_fixed_aggregate_requires_success_or_an_exact_skip(self) -> None:
        aggregate = job_block(CI, "ci-required")
        for dependency in (
            "change-classification",
            "repo-policy",
            "workspace-quality",
            "api",
            "web",
            "db-infra",
            "deploy-contract",
            "client",
            "docker-security",
            "e2e-smoke",
            "e2e-tests",
        ):
            self.assertIn(f"      - {dependency}\n", aggregate)
        self.assertIn("uses: actions/checkout@v6", aggregate)
        self.assertIn("scripts/ci/validate_required_results.py", aggregate)
        self.assertIn('"api=$API_SELECTED:$API_RESULT"', aggregate)
        self.assertNotIn("lint-build-unit", CI)
        self.assertNotIn("api-db-and-infra", CI)
        self.assertNotIn("security-docker", CI)

    def test_security_workflows_keep_fixed_required_names(self) -> None:
        self.assertIn("  codeql:\n    name: codeql", CODEQL)
        self.assertIn("  gitleaks:\n    name: gitleaks", GITLEAKS)

    def test_manual_gitleaks_scans_only_the_cumulative_main_branch_range(self) -> None:
        block = job_block(GITLEAKS, "gitleaks")
        self.assertIn("if: github.event_name != 'workflow_dispatch'", block)
        self.assertIn("if: github.event_name == 'workflow_dispatch'", block)
        self.assertIn(
            "git fetch --no-tags --force origin main:refs/remotes/origin/main",
            block,
        )
        self.assertIn(
            "zricethezav/gitleaks:v8.24.3@sha256:5d0147dc25c78f8cc2b9861ff8f5c9b4a41419ed60a9ce2217de5a215270b42b",
            block,
        )
        self.assertIn("--log-opts=origin/main..HEAD", block)
        manual = block.split("Run Gitleaks (manual branch range)", 1)[1]
        self.assertNotIn("--all", manual)

    def test_deploy_contract_discovers_terminal_profiles_from_registry(self) -> None:
        deploy = job_block(CI, "deploy-contract")
        self.assertIn("terminal_profile_contracts.py --list-playbooks", deploy)
        self.assertIn("terminal_profile_contracts.py \\\n", deploy)
        self.assertIn("--inventory-json /tmp/inventory.json", deploy)
        self.assertIn("\"${TERMINAL_PROFILE_PLAYBOOKS[@]}\"", deploy)
        self.assertNotIn(
            "ansible-playbook --syntax-check playbooks/deploy-staged.yml",
            deploy,
        )


if __name__ == "__main__":
    unittest.main()
