from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.ci.build_release_image import (  # type: ignore[import-not-found]
    ReleaseImageBuildError,
    build_command,
    read_built_digest,
)
from scripts.ci.wait_for_release_checks import (  # type: ignore[import-not-found]
    evaluate_check_runs,
)
from scripts.deploy.release_build_contract import (
    build_config_hash,
    canonical_contract_json,
    normalize_build_arguments,
)
from scripts.deploy.production_config_contract import (
    ConfigKind,
    PRODUCTION_WEB_SETTINGS,
)


ROOT = Path(__file__).resolve().parents[3]
SHA = "a" * 40
DOCKER_VALIDATOR = (
    ROOT / "scripts/ci/validate-release-artifact-docker.sh"
).read_text(encoding="utf-8")
PULL_PROGRESS_VALIDATOR = (
    ROOT / "scripts/ci/validate-artifact-pull-progress-docker.sh"
).read_text(encoding="utf-8")
API_DOCKERFILE = (
    ROOT / "infrastructure/docker/Dockerfile.api"
).read_text(encoding="utf-8")
CI_WORKFLOW = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
CONTRACT_RENDERER = (
    ROOT / "scripts/ci/render-release-build-contract.sh"
).read_text(encoding="utf-8")
CLIENT_DIRECTORY_BACKUP_PLAYBOOK = (
    ROOT / "infrastructure/ansible/playbooks/backup-client-directory.yml"
).read_text(encoding="utf-8")


def contract_document() -> str:
    web = {
        setting.key: str(setting.production_default)
        for setting in PRODUCTION_WEB_SETTINGS
        if setting.kind is ConfigKind.IMAGE
    }
    web["VITE_RELEASE_SHA"] = SHA
    contract = normalize_build_arguments(
        {"INSTALL_PLAYWRIGHT_CHROMIUM": "true"},
        web,
        SHA,
    )
    return canonical_contract_json(contract)


class ReleaseImageWorkflowTests(unittest.TestCase):
    def test_build_command_is_exact_arm64_digest_push_without_secret_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            contract_path = Path(directory) / "contract.json"
            metadata_path = Path(directory) / "metadata.json"
            contract_path.write_text(contract_document(), encoding="utf-8")
            contract = normalize_build_arguments(
                {"INSTALL_PLAYWRIGHT_CHROMIUM": "true"},
                json.loads(contract_document())["web"],
                SHA,
            )
            config_hash = build_config_hash(contract)
            command = build_command(
                root=ROOT,
                contract_path=contract_path,
                service="web",
                release_sha=SHA,
                expected_config_hash=config_hash,
                repository="ghcr.io/denkoushi/raspisys-web",
                metadata_path=metadata_path,
            )
        joined = "\n".join(command)
        self.assertIn("--platform\nlinux/arm64", joined)
        self.assertIn("--push", command)
        self.assertIn("--provenance=mode=min", command)
        self.assertIn("--sbom=true", command)
        self.assertIn(f"BUILD_COMMIT={SHA}", command)
        self.assertIn("VITE_AGENT_WS_MODE=local", command)
        self.assertIn(f"VITE_RELEASE_SHA={SHA}", command)
        self.assertNotIn("TOKEN", joined)
        self.assertNotIn("SECRET", joined)

    def test_build_command_rejects_config_hash_drift(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            contract_path = Path(directory) / "contract.json"
            contract_path.write_text(contract_document(), encoding="utf-8")
            with self.assertRaisesRegex(ReleaseImageBuildError, "hash"):
                build_command(
                    root=ROOT,
                    contract_path=contract_path,
                    service="api",
                    release_sha=SHA,
                    expected_config_hash="b" * 64,
                    repository="ghcr.io/denkoushi/raspisys-api",
                    metadata_path=Path(directory) / "metadata.json",
                )

    def test_build_command_rejects_repository_redirect(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            contract_path = Path(directory) / "contract.json"
            contract_path.write_text(contract_document(), encoding="utf-8")
            contract = normalize_build_arguments(
                {"INSTALL_PLAYWRIGHT_CHROMIUM": "true"},
                json.loads(contract_document())["web"],
                SHA,
            )
            with self.assertRaisesRegex(ReleaseImageBuildError, "allowlisted"):
                build_command(
                    root=ROOT,
                    contract_path=contract_path,
                    service="api",
                    release_sha=SHA,
                    expected_config_hash=build_config_hash(contract),
                    repository="ghcr.io/denkoushi/raspisys-web",
                    metadata_path=Path(directory) / "metadata.json",
                )

    def test_build_metadata_requires_immutable_digest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            metadata = Path(directory) / "metadata.json"
            metadata.write_text(
                json.dumps({"containerimage.digest": "sha256:" + "1" * 64}),
                encoding="utf-8",
            )
            self.assertEqual(read_built_digest(metadata), "sha256:" + "1" * 64)
            metadata.write_text(json.dumps({"containerimage.digest": "latest"}))
            with self.assertRaises(ReleaseImageBuildError):
                read_built_digest(metadata)

    def test_external_release_checks_bind_exact_head_and_fixed_names(self) -> None:
        payload = {
            "check_runs": [
                {
                    "name": "codeql",
                    "head_sha": SHA,
                    "status": "completed",
                    "conclusion": "success",
                },
                {
                    "name": "gitleaks",
                    "head_sha": SHA,
                    "status": "in_progress",
                    "conclusion": None,
                },
                {
                    "name": "gitleaks",
                    "head_sha": "b" * 40,
                    "status": "completed",
                    "conclusion": "success",
                },
            ]
        }
        state, observed = evaluate_check_runs(payload, ("codeql", "gitleaks"), SHA)
        self.assertEqual(state, "pending")
        self.assertEqual(observed, {"codeql": "success", "gitleaks": "in_progress"})
        payload["check_runs"][1]["status"] = "completed"
        payload["check_runs"][1]["conclusion"] = "failure"
        self.assertEqual(
            evaluate_check_runs(payload, ("codeql", "gitleaks"), SHA)[0],
            "failed",
        )

    def test_local_docker_validation_is_loopback_scoped_and_cleanup_owned(self) -> None:
        self.assertIn("--network host", DOCKER_VALIDATOR)
        self.assertIn(
            'REGISTRY_HTTP_ADDR=127.0.0.1:${REGISTRY_PORT}',
            DOCKER_VALIDATOR,
        )
        self.assertNotIn("-p ", DOCKER_VALIDATOR)
        self.assertIn("trap cleanup EXIT INT TERM", DOCKER_VALIDATOR)
        self.assertIn("run-owned Docker resources remain after cleanup", DOCKER_VALIDATOR)
        self.assertNotIn("prune", DOCKER_VALIDATOR)

    def test_pull_progress_validation_is_loopback_scoped_and_cleanup_owned(
        self,
    ) -> None:
        self.assertIn("--network host", PULL_PROGRESS_VALIDATOR)
        self.assertIn(
            'REGISTRY_HTTP_ADDR=127.0.0.1:${REGISTRY_PORT}',
            PULL_PROGRESS_VALIDATOR,
        )
        self.assertNotIn("-p ", PULL_PROGRESS_VALIDATOR)
        self.assertIn("trap cleanup EXIT INT TERM", PULL_PROGRESS_VALIDATOR)
        self.assertIn(
            "run-owned Docker resources remain after cleanup",
            PULL_PROGRESS_VALIDATOR,
        )
        self.assertNotIn("prune", PULL_PROGRESS_VALIDATOR)

    def test_contract_renderer_removes_its_temporary_vault_password(self) -> None:
        remove_index = CONTRACT_RENDERER.rindex('rm -f "$VAULT_PASSWORD_FILE"')
        clear_index = CONTRACT_RENDERER.index('VAULT_PASSWORD_FILE=""')
        self.assertLess(remove_index, clear_index)

    def test_api_runtime_boundary_precedes_application_source_and_provenance(self) -> None:
        runtime_boundary = API_DOCKERFILE.index("FROM api-runtime AS api")
        workspace_boundary = API_DOCKERFILE.index(
            "FROM node:20-bookworm-slim AS workspace"
        )
        build_boundary = API_DOCKERFILE.index("FROM workspace AS build")
        runtime_stage = API_DOCKERFILE.index(
            "FROM node:20-bookworm-slim AS api-runtime"
        )
        self.assertLess(workspace_boundary, build_boundary)
        self.assertLess(build_boundary, runtime_stage)
        self.assertLess(
            runtime_stage,
            runtime_boundary,
        )
        for application_instruction in (
            "COPY --from=build --exclude=node_modules /app/apps/api",
            "COPY --from=build /app/scripts",
            "pnpm prisma generate",
            "ARG BUILD_COMMIT=unknown",
            "LABEL org.opencontainers.image.revision",
        ):
            self.assertGreater(
                API_DOCKERFILE.rindex(application_instruction),
                runtime_boundary,
            )
        runtime_definition = API_DOCKERFILE[runtime_stage:runtime_boundary]
        self.assertNotIn("COPY --from=build", runtime_definition)
        self.assertNotIn("BUILD_COMMIT", runtime_definition)

    def test_api_runtime_uses_only_required_production_dependencies(self) -> None:
        runtime_boundary = API_DOCKERFILE.index("FROM api-runtime AS api")
        runtime_stage = API_DOCKERFILE.index(
            "FROM node:20-bookworm-slim AS api-runtime"
        )
        runtime_definition = API_DOCKERFILE[runtime_stage:runtime_boundary]

        self.assertIn("ansible-core", runtime_definition)
        self.assertNotRegex(runtime_definition, r"\bansible(?!-core)\b")
        self.assertIn(
            "pnpm install --prod --filter @raspi-system/api...",
            runtime_definition,
        )
        self.assertNotIn("pnpm install --prod --recursive", runtime_definition)
        self.assertIn("playwright install --only-shell chromium", runtime_definition)
        self.assertNotIn("playwright install chromium", runtime_definition)
        self.assertNotIn(
            "COPY --from=workspace /app/apps/web/package.json",
            runtime_definition,
        )
        self.assertNotIn("COPY apps/web/package.json", API_DOCKERFILE)
        workspace_start = API_DOCKERFILE.index(
            "FROM node:20-bookworm-slim AS workspace"
        )
        workspace_definition = API_DOCKERFILE[
            workspace_start : API_DOCKERFILE.index("FROM workspace AS build")
        ]
        self.assertIn(
            "pnpm install --filter @raspi-system/api...",
            workspace_definition,
        )
        self.assertNotRegex(workspace_definition, r"\bansible(?!-core)\b")

    def test_client_directory_backup_uses_ansible_core_modules_only(self) -> None:
        self.assertNotIn("ansible.builtin.archive", CLIENT_DIRECTORY_BACKUP_PLAYBOOK)
        self.assertIn("ansible.builtin.command", CLIENT_DIRECTORY_BACKUP_PLAYBOOK)
        self.assertIn("argv:", CLIENT_DIRECTORY_BACKUP_PLAYBOOK)
        self.assertIn("ansible.builtin.fetch", CLIENT_DIRECTORY_BACKUP_PLAYBOOK)
        self.assertIn("ansible.builtin.file", CLIENT_DIRECTORY_BACKUP_PLAYBOOK)

    def test_release_api_job_validates_exact_arm64_manifest_before_scan(self) -> None:
        build = CI_WORKFLOW.index("Build and push exact ARM64 API image")
        select = CI_WORKFLOW.index("Select exact ARM64 API image manifest")
        budget = CI_WORKFLOW.index("Enforce compressed API image budget")
        scan = CI_WORKFLOW.index("Security scan exact ARM64 API digest")
        self.assertLess(build, select)
        self.assertLess(select, budget)
        self.assertLess(budget, scan)
        self.assertIn(
            "scripts/ci/validate_release_image_budget.py select-linux-arm64",
            CI_WORKFLOW,
        )
        self.assertIn(
            "scripts/ci/validate_release_image_budget.py validate-api",
            CI_WORKFLOW,
        )
        self.assertIn("${{ steps.build.outputs.digest }}", CI_WORKFLOW)


if __name__ == "__main__":
    unittest.main()
