#!/usr/bin/env python3
from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
CI = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
CODEQL = (ROOT / ".github/workflows/codeql.yml").read_text(encoding="utf-8")
GITLEAKS = (ROOT / ".github/workflows/gitleaks.yml").read_text(encoding="utf-8")
DEPLOY_CONTRACT_RUNNER = (
    ROOT / "scripts/ci/run-deploy-contracts-local.sh"
).read_text(encoding="utf-8")
RELEASE_IMAGE_BUILDER = (
    ROOT / "scripts/ci/build_release_image.py"
).read_text(encoding="utf-8")
KIOSK_SOP_CONTRACT_RUNNER = (
    ROOT / "scripts/ci/run-kiosk-sop-artifact-contract.sh"
).read_text(encoding="utf-8")


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
        self.assertIn("scripts/ci/classify_event_changes.py", classifier)
        self.assertIn('--event-name "$EVENT_NAME"', classifier)
        self.assertIn('--base-sha "$BASE_SHA"', classifier)
        self.assertIn('--head-sha "$HEAD_SHA"', classifier)
        self.assertNotIn("collect_changed_files.py", classifier)

    def test_classifier_outputs_drive_every_conditional_job(self) -> None:
        categories = {
            "repo-policy": "repo_policy",
            "workspace-quality": "workspace_quality",
            "api": "api",
            "web": "web",
            "db-infra": "db_infra",
            "deploy-contract": "deploy_contract",
            "client": "client",
            "pi4-agent-image-contract": "client",
            "docker-security": "docker_security",
            "e2e-smoke": "e2e",
            "e2e-tests": "e2e",
            "signage-artifact-contract": "signage_artifact",
        }
        classifier = job_block(CI, "change-classification")
        for output in set(categories.values()) | {
            "codeql",
            "docker_api",
            "docker_web",
            "release_pair",
            "runtime_rehearsal",
            "docker_matrix",
        }:
            self.assertIn(f"      {output}: ${{{{ steps.classify.outputs.{output} }}}}", classifier)
        for job, output in categories.items():
            block = job_block(CI, job)
            self.assertIn("needs: change-classification", block)
            self.assertIn(
                f"needs.change-classification.outputs.{output} == 'true'",
                block,
            )

    def test_docker_security_matrix_selects_api_and_web_independently(self) -> None:
        docker = job_block(CI, "docker-security")
        self.assertIn(
            "fromJSON(needs.change-classification.outputs.docker_matrix)",
            docker,
        )

    def test_api_uses_one_thresholded_pr_run_and_three_coverage_shards(self) -> None:
        api = job_block(CI, "api")
        self.assertIn('"shard":"all","shard_id":"all","coverage":true', api)
        for shard in ("1/3", "2/3", "3/3"):
            self.assertIn(f'"shard":"{shard}"', api)
        self.assertIn("Run API tests (coverage shard)", api)
        self.assertIn('if [ "${{ matrix.shard }}" != "all" ]', api)
        self.assertIn('pnpm test:coverage "${shard_args[@]}"', api)
        self.assertIn("COVERAGE_ENFORCE_THRESHOLDS:", api)

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
            "container-runtime-rehearsal",
            "client",
            "pi4-agent-image-contract",
            "release-build-contract",
            "release-api-image",
            "release-web-image",
            "release-runtime-rehearsal",
            "docker-security",
            "e2e-smoke",
            "e2e-tests",
            "signage-artifact-contract",
        ):
            self.assertIn(f"      - {dependency}\n", aggregate)
        self.assertIn("uses: actions/checkout@v6", aggregate)
        self.assertIn("scripts/ci/validate_required_results.py", aggregate)
        self.assertIn('"api=$API_SELECTED:$API_RESULT"', aggregate)
        self.assertIn(
            '"pi4-agent-image-contract=$CLIENT_SELECTED:$PI4_AGENT_IMAGE_RESULT"',
            aggregate,
        )
        self.assertNotIn("lint-build-unit", CI)
        self.assertNotIn("api-db-and-infra", CI)
        self.assertNotIn("security-docker", CI)

    def test_pi4_agents_are_contract_built_and_published_for_both_pi_platforms(self) -> None:
        contract = job_block(CI, "pi4-agent-image-contract")
        publish = job_block(CI, "pi4-agent-images-publish")
        for service in ("nfc-agent", "barcode-agent", "torque-agent"):
            self.assertIn(f"service: {service}", contract)
            self.assertIn(f"service: {service}", publish)
            self.assertIn(f"raspisys-{service}", publish)
        self.assertIn("docker buildx build --load --platform linux/amd64", contract)
        self.assertIn("aquasecurity/trivy-action", contract)
        self.assertNotIn("packages: write", contract)
        self.assertIn("github.event_name == 'push'", publish)
        self.assertIn("github.ref == 'refs/heads/main'", publish)
        self.assertIn("platforms: linux/arm64,linux/arm/v7", publish)
        self.assertIn("packages: write", publish)
        self.assertIn("docker/setup-qemu-action@v4", publish)

    def test_signage_artifact_is_read_only_on_pr_and_main_only_for_publication(self) -> None:
        contract = job_block(CI, "signage-artifact-contract")
        gates = job_block(CI, "signage-artifact-gates")
        publish = job_block(CI, "signage-artifact-publish")
        release_set = job_block(CI, "release-set")

        self.assertIn("permissions:\n      contents: read", contract)
        self.assertIn("signage-distribution-artifact.py build", contract)
        self.assertIn("signage-distribution-artifact.py verify", contract)
        self.assertIn("Security scan exact Signage artifact image", contract)
        self.assertIn("actions/upload-artifact@v6", contract)
        self.assertIn("gh version 2.96.0", contract)
        self.assertIn("ProductionAttestationBoundary", contract)
        for forbidden in ("packages: write", "attestations: write", "id-token: write"):
            self.assertNotIn(forbidden, contract)

        for block in (gates, publish):
            self.assertIn("github.event_name == 'push'", block)
            self.assertIn("github.ref == 'refs/heads/main'", block)
            self.assertIn(
                "needs.change-classification.outputs.signage_artifact == 'true'",
                block,
            )
        self.assertIn("--required codeql", gates)
        self.assertIn("--required gitleaks", gates)
        self.assertIn("packages: write", publish)
        self.assertIn("attestations: write", publish)
        self.assertIn("id-token: write", publish)
        self.assertIn("actions/download-artifact@v7", publish)
        self.assertIn("ghcr.io/denkoushi/raspisys-pi3-signage:${{ github.sha }}", publish)
        self.assertIn("predicate-path: signage-release-attestation.json", publish)
        self.assertIn("push-to-registry: true", publish)
        self.assertIn("gh version 2.96.0", publish)
        self.assertIn("--verify-published-attestation", publish)
        self.assertIn("${{ steps.publish.outputs.digest }}", publish)
        self.assertIn("${{ steps.identity.outputs.artifact_sha256 }}", publish)
        self.assertIn("${{ steps.identity.outputs.manifest_sha256 }}", publish)
        self.assertEqual(release_set.count("uses: actions/attest@v4"), 3)

    def test_main_release_pair_is_native_arm64_scanned_and_attested(self) -> None:
        contract = job_block(CI, "release-build-contract")
        api = job_block(CI, "release-api-image")
        web = job_block(CI, "release-web-image")
        rehearsal = job_block(CI, "release-runtime-rehearsal")
        gates = job_block(CI, "release-gates")
        release_set = job_block(CI, "release-set")
        docker = job_block(CI, "docker-security")

        for block in (contract, api, web, rehearsal, gates, release_set):
            self.assertIn("github.event_name == 'push'", block)
            self.assertIn("github.ref == 'refs/heads/main'", block)
            self.assertIn(
                "needs.change-classification.outputs.release_pair == 'true'",
                block,
            )
        for block in (api, web):
            self.assertIn("runs-on: ubuntu-24.04-arm", block)
            self.assertIn("packages: write", block)
            self.assertIn("Security scan exact ARM64", block)
            self.assertIn(
                'run: docker pull --platform linux/arm64 "$IMAGE_REFERENCE"',
                block,
            )
            self.assertLess(
                block.index("Pull exact ARM64"),
                block.index("Security scan exact ARM64"),
            )
            self.assertIn("ignore-unfixed: true", block)
            self.assertIn("severity: 'HIGH,CRITICAL'", block)
            self.assertIn("exit-code: '1'", block)
        self.assertIn(
            "IMAGE_REFERENCE: ${{ steps.identity.outputs.repository }}@${{ steps.build.outputs.digest }}",
            api,
        )
        self.assertIn(
            "IMAGE_REFERENCE: ${{ steps.identity.outputs.repository }}@${{ steps.build.outputs.digest }}",
            web,
        )
        self.assertIn('"linux/arm64"', RELEASE_IMAGE_BUILDER)
        self.assertIn("runs-on: ubuntu-24.04-arm", rehearsal)
        self.assertIn("--sha \"$GITHUB_SHA\"", rehearsal)
        self.assertNotIn("--stable-seconds", rehearsal)
        self.assertIn("!(\n          github.event_name == 'push'", docker)
        self.assertIn("always() &&", gates)
        self.assertIn("--required codeql", gates)
        self.assertIn("--required gitleaks", gates)
        self.assertIn("needs['ci-required'].result == 'success'", gates)
        self.assertIn("always() &&", release_set)
        for dependency in (
            "release-build-contract",
            "release-api-image",
            "release-web-image",
            "release-runtime-rehearsal",
            "release-gates",
        ):
            self.assertIn(
                f"needs['{dependency}'].result == 'success'",
                release_set,
            )
        self.assertEqual(release_set.count("uses: actions/attest@v4"), 3)
        self.assertIn("attestations: write", release_set)
        self.assertIn("id-token: write", release_set)
        self.assertIn("push-to-registry: true", release_set)
        self.assertNotIn("pull_request", release_set)

    def test_security_workflows_keep_fixed_required_names(self) -> None:
        self.assertIn("  codeql:\n    name: codeql", CODEQL)
        self.assertIn("  gitleaks:\n    name: gitleaks", GITLEAKS)
        codeql = job_block(CODEQL, "codeql")
        self.assertIn("scripts/ci/classify_event_changes.py", codeql)
        self.assertIn(
            "steps.classify.outputs.codeql == 'true'",
            codeql,
        )
        self.assertIn("Record intentional analysis skip", codeql)

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

    def test_deploy_contract_uses_the_same_registry_driven_local_runner(self) -> None:
        deploy = job_block(CI, "deploy-contract")
        self.assertIn(
            "bash scripts/ci/run-deploy-contracts-local.sh --install-collections",
            deploy,
        )
        self.assertNotIn("python3 -m unittest discover -s scripts/deploy/tests", deploy)
        self.assertIn(
            "terminal_profile_contracts.py\" --list-playbooks",
            DEPLOY_CONTRACT_RUNNER,
        )
        self.assertIn(
            '--inventory-json "$TEMP_DIR/inventory.json"', DEPLOY_CONTRACT_RUNNER
        )
        self.assertIn(
            '"${TERMINAL_PROFILE_PLAYBOOKS[@]}"', DEPLOY_CONTRACT_RUNNER
        )
        self.assertNotIn(
            "ansible-playbook --syntax-check playbooks/deploy-staged.yml",
            DEPLOY_CONTRACT_RUNNER,
        )

    def test_kiosk_sop_failure_diagnostics_capture_the_actual_candidate(self) -> None:
        kiosk = job_block(CI, "kiosk-sop")
        self.assertIn("if: always()", kiosk)
        self.assertIn("KIOSK_SOP_DIAGNOSTICS_DIR", kiosk)
        self.assertIn("path: ${{ runner.temp }}/kiosk-sop-diagnostics-", kiosk)
        self.assertIn("run-kiosk-sop-artifact-contract.sh", kiosk)
        self.assertIn("artifact-tree-diff.txt", KIOSK_SOP_CONTRACT_RUNNER)
        self.assertLess(
            KIOSK_SOP_CONTRACT_RUNNER.index('mkdir -p "$diagnostics_dir/candidate"'),
            KIOSK_SOP_CONTRACT_RUNNER.index("docker build"),
        )
        trap = KIOSK_SOP_CONTRACT_RUNNER.index("trap capture_tree_diff EXIT")
        for stage in (
            "node --test",
            "generate.mjs generate",
            "kiosk-sop-artifact-contract.mjs verify",
            "pnpm exec playwright test",
        ):
            self.assertLess(trap, KIOSK_SOP_CONTRACT_RUNNER.index(stage))


if __name__ == "__main__":
    unittest.main()
