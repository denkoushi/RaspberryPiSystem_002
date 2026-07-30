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
CONTRACT_RENDERER = (
    ROOT / "scripts/ci/render-release-build-contract.sh"
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


if __name__ == "__main__":
    unittest.main()
