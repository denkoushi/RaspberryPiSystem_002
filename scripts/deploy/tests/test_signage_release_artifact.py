from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[3]
SCRIPT = PROJECT / "scripts/deploy/signage-release-artifact.py"
SPEC = importlib.util.spec_from_file_location("signage_release_artifact", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
artifact = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(artifact)


class SignageReleaseArtifactTest(unittest.TestCase):
    CANDIDATE = "a" * 40
    RUN_ID = "artifact-test-001"
    HOST = "raspberrypi3"

    def test_profile_and_import_closure_is_derived_without_api_or_pi4_payloads(self):
        closure = artifact.derive_profile_closure(PROJECT, profile_id="signage")
        self.assertEqual(
            set(closure.runtime_sources),
            {
                "clients/status-agent/status-agent.py",
                "clients/status-agent/storage_health.py",
                "clients/status-agent/terminal_agent_health.py",
                "scripts/deploy/rolling_release/terminal_device_maintenance.py",
            },
        )
        self.assertEqual(
            set(closure.unit_sources),
            {
                "clients/status-agent/status-agent.service",
                "clients/status-agent/status-agent.timer",
            },
        )
        joined = "\n".join((*closure.runtime_sources, *closure.unit_sources))
        self.assertNotIn("apps/", joined)
        self.assertNotIn("infrastructure/docker/", joined)
        self.assertNotIn("clients/nfc-agent/", joined)

    def test_build_is_reproducible_and_binds_sha_profile_and_path_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            first = Path(temporary) / "first.pyz"
            second = Path(temporary) / "second.pyz"
            one = artifact.build_artifact(
                PROJECT, first, candidate_sha=self.CANDIDATE, profile_id="signage"
            )
            two = artifact.build_artifact(
                PROJECT, second, candidate_sha=self.CANDIDATE, profile_id="signage"
            )
            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(one, two)
            self.assertEqual(one["sourceSha"], self.CANDIDATE)
            self.assertEqual(one["profile"], "signage")
            self.assertEqual(one["installPath"], artifact.INSTALL_PATH.as_posix())
            self.assertEqual(one["pathManifestSha256"], two["pathManifestSha256"])
            self.assertLessEqual(one["size"], artifact.MAX_ARTIFACT_BYTES)
            self.assertLessEqual(one["pathCount"], artifact.MAX_SOURCE_PATHS)
            with zipfile.ZipFile(first) as archive:
                self.assertEqual(
                    set(archive.namelist()),
                    {
                        "__main__.py",
                        "SIGNAGE-RELEASE.json",
                        "status_agent.py",
                        "storage_health.py",
                        "terminal_agent_health.py",
                        "terminal_device_maintenance.py",
                    },
                )
                manifest = json.loads(archive.read("SIGNAGE-RELEASE.json"))
            self.assertEqual(
                {source["path"] for source in manifest["sources"]},
                set(
                    artifact.derive_profile_closure(
                        PROJECT, profile_id="signage"
                    ).runtime_sources
                ),
            )
            observed = subprocess.run(
                [sys.executable, str(first), "--release-identity"],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(json.loads(observed.stdout), manifest)
            runtime = subprocess.run(
                [sys.executable, str(first), "--help"],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertIn("usage:", runtime.stdout.lower())

    def test_verify_consume_identity_and_cleanup_are_atomic_and_repo_independent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            staging = root / "staging"
            staging.mkdir()
            install = root / "installed.pyz"
            built = root / "built.pyz"
            reference = artifact.build_artifact(
                PROJECT, built, candidate_sha=self.CANDIDATE, profile_id="signage"
            )
            reference.update({"runId": self.RUN_ID, "host": self.HOST})
            temporary_path, final_path = artifact.staging_paths(staging, self.RUN_ID)
            temporary_path.write_bytes(built.read_bytes())
            temporary_path.chmod(0o600)
            args = artifact.bound_arguments(
                reference, staging_root=staging, install_path=install
            )

            self.assertEqual(artifact.preflight(args)["state"], "temporary-ready")
            self.assertEqual(artifact.promote(args)["state"], "ready")
            self.assertEqual(artifact.verify(args)["state"], "ready")
            self.assertEqual(artifact.consume(args)["state"], "consumed")
            self.assertFalse(final_path.exists())
            identity = artifact.installed_identity(install)
            self.assertEqual(identity["sourceSha"], self.CANDIDATE)
            self.assertEqual(identity["artifactSha256"], reference["artifactSha256"])
            self.assertEqual(artifact.cleanup(args)["removed"], 0)
            self.assertEqual(artifact.cleanup(args)["removed"], 0)

    def test_dynamic_unknown_and_symlink_sources_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "clients/status-agent").mkdir(parents=True)
            (root / "scripts/deploy").mkdir(parents=True)
            registry = {
                "terminalProfiles": [{
                    "id": "signage",
                    "adapterOptions": {
                        "systemdUnits": ["status-agent.service", "status-agent.timer"]
                    },
                }]
            }
            (root / "scripts/deploy/terminal-profile-registry.json").write_text(
                json.dumps(registry), encoding="utf-8"
            )
            service = root / "clients/status-agent/status-agent.service"
            service.write_text(
                "[Service]\nExecStart=/usr/bin/env python3 "
                "/opt/RaspberryPiSystem_002/clients/status-agent/status-agent.py\n",
                encoding="utf-8",
            )
            (root / "clients/status-agent/status-agent.timer").write_text(
                "[Timer]\nOnBootSec=1\n", encoding="utf-8"
            )
            entry = root / "clients/status-agent/status-agent.py"

            for source in (
                "import importlib\nimportlib.import_module('hidden')\n",
                "import dependency_that_does_not_exist\n",
            ):
                with self.subTest(source=source):
                    entry.unlink(missing_ok=True)
                    entry.write_text(source, encoding="utf-8")
                    with self.assertRaises(artifact.ArtifactError):
                        artifact.derive_profile_closure(root, profile_id="signage")

            entry.unlink()
            entry.symlink_to(Path("/etc/passwd"))
            with self.assertRaises(artifact.ArtifactError):
                artifact.derive_profile_closure(root, profile_id="signage")


if __name__ == "__main__":
    unittest.main()
