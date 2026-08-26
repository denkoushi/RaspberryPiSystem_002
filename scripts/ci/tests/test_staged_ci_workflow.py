#!/usr/bin/env python3
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CI = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
TORQUE_RELEASE = (
    ROOT / ".github/workflows/torque-release.yml"
).read_text(encoding="utf-8")
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
        self.assertIn("types: [opened, synchronize, reopened, edited]", CI)
        self.assertIn("--format json > \"$RUNNER_TEMP/ci-classification.json\"", classifier)
        self.assertIn("scripts/ci/validate_deploy_impact.py", classifier)
        self.assertIn('github.event_name == \'pull_request\'', classifier)

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
            "pi4_agent_matrix",
        }:
            self.assertIn(f"      {output}: ${{{{ steps.classify.outputs.{output} }}}}", classifier)
        for job, output in categories.items():
            block = job_block(CI, job)
            self.assertIn("needs: change-classification", block)
            self.assertIn(
                f"needs.change-classification.outputs.{output} == 'true'",
                block,
            )

        pi4 = job_block(CI, "pi4-agent-image-contract")
        self.assertIn(
            "needs.change-classification.outputs.pi4_agent_matrix != '[]'",
            pi4,
        )

    def test_docker_security_matrix_selects_api_and_web_independently(self) -> None:
        docker = job_block(CI, "docker-security")
        self.assertIn(
            "fromJSON(needs.change-classification.outputs.docker_matrix)",
            docker,
        )

    def test_review_jobs_do_not_repeat_on_exact_main_push(self) -> None:
        review_jobs = (
            "repo-policy",
            "workspace-quality",
            "api",
            "web",
            "db-infra",
            "deploy-contract",
            "container-runtime-rehearsal",
            "client",
            "pi4-agent-image-contract",
            "docker-security",
            "e2e-smoke",
            "e2e-tests",
            "kiosk-sop",
        )
        for job in review_jobs:
            with self.subTest(job=job):
                self.assertIn(
                    "github.event_name != 'push'",
                    job_block(CI, job),
                )

        aggregate = job_block(CI, "ci-required")
        for selector in (
            "REPO_POLICY_SELECTED",
            "WORKSPACE_QUALITY_SELECTED",
            "API_SELECTED",
            "WEB_SELECTED",
            "DB_INFRA_SELECTED",
            "DEPLOY_CONTRACT_SELECTED",
            "CONTAINER_RUNTIME_REHEARSAL_SELECTED",
            "CLIENT_SELECTED",
            "PI4_AGENT_SELECTED",
            "DOCKER_SECURITY_SELECTED",
            "E2E_SELECTED",
            "KIOSK_SOP_SELECTED",
        ):
            with self.subTest(selector=selector):
                line = next(
                    value for value in aggregate.splitlines() if selector in value
                )
                self.assertIn("github.event_name != 'push'", line)

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
            '"pi4-agent-image-contract=$PI4_AGENT_SELECTED:$PI4_AGENT_IMAGE_RESULT"',
            aggregate,
        )
        self.assertNotIn("lint-build-unit", CI)
        self.assertNotIn("api-db-and-infra", CI)
        self.assertNotIn("security-docker", CI)

    def test_pi4_agents_are_contract_built_and_published_for_both_pi_platforms(self) -> None:
        contract = job_block(CI, "pi4-agent-image-contract")
        publish = job_block(CI, "pi4-agent-images-publish")
        for service in ("nfc-agent", "barcode-agent", "torque-agent"):
            self.assertIn(f"service: {service}", publish)
            self.assertIn(f"raspisys-{service}", publish)
        self.assertIn(
            "fromJSON(needs.change-classification.outputs.pi4_agent_matrix)",
            contract,
        )
        self.assertIn("uses: docker/build-push-action@v7", contract)
        self.assertIn("platforms: ${{ matrix.platform }}", contract)
        self.assertIn("load: true", contract)
        self.assertIn("${{ github.sha }}-${{ matrix.platform_tag }}", contract)
        self.assertIn("docker/setup-qemu-action@v4", contract)
        self.assertIn(
            "scope=pi4-agent-${{ matrix.service }}-${{ matrix.platform_tag }}",
            contract,
        )
        self.assertIn("scope=pi4-${{ matrix.service }}", contract)
        self.assertIn("ignore-error=true", contract)
        self.assertIn("aquasecurity/trivy-action", contract)
        self.assertIn("ignore-unfixed: true", contract)
        self.assertIn("severity: HIGH,CRITICAL", contract)
        self.assertIn("exit-code: '1'", contract)
        self.assertIn("scanners: vuln,secret", contract)
        self.assertNotIn("linux/amd64", contract)
        self.assertNotIn("packages: write", contract)
        self.assertIn("github.event_name == 'push'", publish)
        self.assertIn("github.ref == 'refs/heads/main'", publish)
        self.assertIn(
            "needs.change-classification.outputs.pi4_agent_matrix != '[]'",
            publish,
        )
        self.assertIn("platforms: linux/arm64,linux/arm/v7", publish)
        self.assertIn("packages: write", publish)
        self.assertIn("docker/setup-qemu-action@v4", publish)
        self.assertIn("id: publish", publish)
        self.assertEqual(
            publish.count(
                "image-ref: ${{ matrix.repository }}@${{ steps.publish.outputs.digest }}"
            ),
            2,
        )
        self.assertIn("TRIVY_PLATFORM: linux/arm64", publish)
        self.assertIn("TRIVY_PLATFORM: linux/arm/v7", publish)

    def test_signage_artifact_is_read_only_on_pr_and_main_only_for_publication(self) -> None:
        contract = job_block(CI, "signage-artifact-contract")
        gates = job_block(CI, "signage-artifact-gates")
        publish = job_block(CI, "signage-artifact-publish")
        release_set = job_block(CI, "release-set")

        self.assertIn("permissions:\n      contents: read", contract)
        self.assertIn("signage-distribution-artifact.py build", contract)
        self.assertIn("signage-distribution-artifact.py verify", contract)
        self.assertIn("Require deterministic Signage artifact bytes", contract)
        self.assertIn("if: ${{ github.event_name != 'push' }}", contract)
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
        self.assertIn("github.event_name != 'push'", docker)
        self.assertNotIn("Security scan API source filesystem", api)
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

    def test_torque_component_adoption_is_signed_scanned_and_not_rebuilt(self) -> None:
        adoption = job_block(TORQUE_RELEASE, "torque-component-adoption")
        compatibility = job_block(TORQUE_RELEASE, "torque-release-compatibility")
        release_set = job_block(CI, "release-set")
        torque_release_set = job_block(TORQUE_RELEASE, "torque-release-set")

        self.assertIn("github.event_name == 'push'", adoption)
        self.assertIn("github.event_name == 'push'", adoption)
        self.assertEqual(adoption.count("Re-scan adopted torque-agent"), 2)
        self.assertIn("TRIVY_PLATFORM: linux/arm64", adoption)
        self.assertIn("TRIVY_PLATFORM: linux/arm/v7", adoption)
        self.assertIn("torque_component_adoption.py", adoption)
        self.assertIn("torque-agent-component-adoption/v1", adoption)
        self.assertIn("predicate-path: torque-agent-adoption.json", adoption)
        self.assertIn("--bundle-from-oci", adoption)
        self.assertNotIn("docker/build-push-action", adoption)
        self.assertNotIn("docker image tag", adoption)

        self.assertIn("git diff --exit-code", compatibility)
        self.assertIn("3464256da11ee77bebfceb4fafcff4524f5ac8ca", compatibility)
        source_proof = compatibility.split(
            "Prove the adopted torque-agent source closure is unchanged", 1
        )[1].split("Setup pnpm workspace", 1)[0]
        self.assertIn("clients/torque-agent", source_proof)
        self.assertIn("infrastructure/docker/Dockerfile.torque-agent", source_proof)
        self.assertNotIn("apps/api/src/routes/torque-training", source_proof)
        self.assertNotIn("apps/api/src/services/torque-training", source_proof)
        self.assertIn("test_global_ownership.py", compatibility)
        self.assertIn("torqueWrenchConnectionTransport.test.ts", compatibility)
        self.assertIn("torque-wrenches.integration.test.ts", compatibility)
        self.assertIn("torque-training.integration.test.ts", compatibility)
        self.assertIn("prisma migrate deploy", compatibility)
        self.assertIn("sourceClosureUnchanged", compatibility)
        self.assertIn("evidence_digest", compatibility)
        self.assertIn("api-assembly-route-postgresql", compatibility)
        self.assertIn("agent-global-ownership-recovery", compatibility)
        self.assertIn("docker ps -aq --filter", compatibility)
        self.assertIn("xargs -r docker rm --force", compatibility)
        self.assertIn("xargs -r docker volume rm", compatibility)
        self.assertIn("xargs -r docker network rm", compatibility)
        self.assertNotIn("torque-component-adoption", release_set)
        self.assertNotIn("--torque-index-digest", release_set)
        self.assertIn("torque-component-adoption", torque_release_set)
        self.assertIn("torque-release-compatibility", torque_release_set)
        self.assertIn("--required release-set", torque_release_set)
        self.assertIn("--torque-index-digest", torque_release_set)
        self.assertIn(
            "--torque-rehearsal-job torque-release-compatibility",
            torque_release_set,
        )
        self.assertIn("--torque-rehearsal-evidence-digest", torque_release_set)
        self.assertIn("--base-release-digest", torque_release_set)
        self.assertIn("--composition-workflow", torque_release_set)
        self.assertIn("verify-torque-reuse", torque_release_set)
        self.assertIn("steps.existing.outputs.exists != 'true'", torque_release_set)
        self.assertIn("-torque-v2", torque_release_set)
        self.assertIn("attestations: write", torque_release_set)
        self.assertIn("id-token: write", torque_release_set)
        self.assertIn("push-to-registry: true", torque_release_set)
        self.assertIn("github.event_name == 'push'", torque_release_set)
        self.assertNotIn("Attest exact ARM64 API image", torque_release_set)
        self.assertNotIn("Attest exact ARM64 Web image", torque_release_set)

    def test_torque_v2_cannot_block_normal_release_or_required_pr_checks(self) -> None:
        required = job_block(CI, "ci-required")
        release_set = job_block(CI, "release-set")
        adoption = job_block(TORQUE_RELEASE, "torque-component-adoption")
        compatibility = job_block(TORQUE_RELEASE, "torque-release-compatibility")
        torque_release_set = job_block(TORQUE_RELEASE, "torque-release-set")

        for torque_job in (
            "torque-component-adoption",
            "torque-release-compatibility",
            "torque-release-set",
        ):
            self.assertNotIn(f"      - {torque_job}\n", required)
            self.assertNotIn(torque_job, release_set)
        self.assertIn(
            "needs.change-classification.outputs.release_pair == 'true'",
            release_set,
        )
        self.assertNotIn("torque_composition", release_set)
        for block in (adoption, compatibility, torque_release_set):
            self.assertIn(
                "needs.classify-torque-release.outputs.relevant == 'true'",
                block,
            )
        for block in (adoption, torque_release_set):
            self.assertIn(
                "needs.classify-torque-release.outputs.publishable == 'true'",
                block,
            )
        self.assertIn(
            "raspisys-release-set:${{ github.sha }}-${{ needs.release-build-contract.outputs.config_hash }}",
            release_set,
        )
        self.assertNotIn("-torque-v2", release_set)
        self.assertIn("-torque-v2", torque_release_set)

    def test_torque_release_required_is_an_all_pr_fixed_noop_aggregate(self) -> None:
        pull_request = TORQUE_RELEASE.split("  pull_request:\n", 1)[1].split(
            "  push:\n", 1
        )[0]
        self.assertNotIn("paths:", pull_request)
        push = TORQUE_RELEASE.split("  push:\n", 1)[1].split("\njobs:\n", 1)[0]
        self.assertNotIn("paths:", push)
        aggregate = job_block(TORQUE_RELEASE, "torque-release-required")
        self.assertIn("if: ${{ always() && github.event_name != 'push' }}", aggregate)
        self.assertIn("  merge_group:\n", TORQUE_RELEASE)
        self.assertIn("TORQUE_RELEVANT", aggregate)
        self.assertIn("COMPATIBILITY_RESULT", aggregate)
        self.assertIn('test "$COMPATIBILITY_RESULT" = skipped', aggregate)
        self.assertIn('test "$COMPATIBILITY_RESULT" = success', aggregate)
        self.assertNotIn("torque-release-compatibility", CI)
        self.assertNotIn("torque-component-adoption", CI)
        self.assertNotIn("torque-release-set", CI)
        self.assertNotIn("nfc-agent", TORQUE_RELEASE)
        self.assertNotIn("barcode-agent", TORQUE_RELEASE)

    def test_torque_release_uses_pr_head_and_exact_main_identity(self) -> None:
        self.assertIn(
            "TARGET_SHA: ${{ github.event.pull_request.head.sha || github.sha }}",
            TORQUE_RELEASE,
        )
        compatibility = job_block(TORQUE_RELEASE, "torque-release-compatibility")
        self.assertIn("ref: ${{ env.TARGET_SHA }}", compatibility)
        self.assertIn('"releaseSha": os.environ["TARGET_SHA"]', compatibility)
        for job in ("torque-component-adoption", "torque-release-set"):
            block = job_block(TORQUE_RELEASE, job)
            self.assertIn('git rev-parse origin/main', block)
            self.assertIn('= "$GITHUB_SHA"', block)

    def test_security_workflows_separate_required_and_audit_names(self) -> None:
        self.assertIn("  codeql:\n    name: codeql", CODEQL)
        self.assertIn(
            "    name: >-\n"
            "      ${{ (github.event_name == 'schedule' ||\n"
            "          github.event_name == 'workflow_dispatch') &&\n"
            "          'gitleaks-audit' || 'gitleaks' }}",
            GITLEAKS,
        )
        codeql = job_block(CODEQL, "codeql")
        self.assertIn("scripts/ci/classify_event_changes.py", codeql)
        self.assertIn(
            "github.event_name != 'push' && steps.classify.outputs.codeql == 'true'",
            codeql,
        )
        self.assertIn("github.event_name == 'push' ||", codeql)
        self.assertIn("Record intentional analysis skip", codeql)

    def test_manual_gitleaks_scans_only_the_cumulative_main_branch_range(self) -> None:
        block = job_block(GITLEAKS, "gitleaks")
        self.assertIn(
            "if: github.event_name != 'workflow_dispatch' && github.event_name != 'push'",
            block,
        )
        self.assertIn("if: github.event_name == 'workflow_dispatch'", block)
        self.assertIn("Record exact-main publication skip", block)
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
