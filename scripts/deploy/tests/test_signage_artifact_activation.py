from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[3]
DEPLOY = PROJECT / "scripts" / "deploy"
sys.path.insert(0, str(DEPLOY))

from rolling_release import signage_artifact_activation as activation
from rolling_release import signage_artifact_stage as stage


SOURCE_SHA = "87f0789231ad4ec7241f6f3aafe00fa68186c3ff"
OCI_DIGEST = "sha256:" + "d" * 64


def _distribution_module():
    path = DEPLOY / "signage-distribution-artifact.py"
    spec = importlib.util.spec_from_file_location("_stage3_distribution_fixture", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(spec.name, None)
    return module


class FakeSystemd:
    def __init__(self) -> None:
        self.active = list(activation.ACTIVE_RUNTIME_UNITS)
        self.events: list[str] = []
        self.fail_after_switch = False

    def capture(self) -> dict[str, object]:
        self.events.append("capture-runtime")
        return {"activeSystemdUnits": list(self.active), "displaySha256": "a" * 64}

    def quiesce(self, units: list[str]) -> None:
        self.events.append("quiesce:" + ",".join(units))
        self.active = []

    def daemon_reload(self) -> None:
        self.events.append("daemon-reload")

    def tmpfiles(self) -> None:
        self.events.append("tmpfiles")

    def resume(self, units: list[str]) -> None:
        self.events.append("resume:" + ",".join(units))
        if self.fail_after_switch:
            raise RuntimeError("injected post-switch health failure")
        self.active = list(units)

    def verify(self, units: list[str]) -> dict[str, object]:
        self.events.append("verify-runtime")
        if self.active != list(units):
            raise RuntimeError("runtime did not recover")
        return {"activeSystemdUnits": list(self.active), "displaySha256": "b" * 64}


class Stage3Fixture(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="stage3-activation-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.system_root = self.root / "system"
        self.release_root = self.root / "releases-root"
        self.rendered = self.root / "rendered"
        self.rendered.mkdir()
        self.artifact = self.root / "signage-release.tar"
        self.descriptor = self.root / "signage-release-descriptor.json"
        self.distribution = _distribution_module()
        self.distribution.build_artifact(
            PROJECT,
            self.artifact,
            self.descriptor,
            source_sha=SOURCE_SHA,
        )
        verified = self.distribution.verify_artifact(
            self.artifact,
            self.descriptor,
            expected_source_sha=SOURCE_SHA,
        )
        self.files = verified["manifest"]["files"]
        with tarfile.open(self.artifact, "r:") as archive:
            payloads = {
                member.name: archive.extractfile(member).read()
                for member in archive.getmembers()
                if member.isfile()
            }
        for record in self.files:
            live = self.system_root / record["installPath"].removeprefix("/")
            if record["path"] != "bin/raspi-signage-status-agent.pyz":
                live.parent.mkdir(parents=True, exist_ok=True)
                live.write_bytes(b"legacy:" + record["path"].encode())
                live.chmod(int(record["mode"], 8))
            if record["templated"]:
                rendered = self.rendered / record["path"]
                rendered.parent.mkdir(parents=True, exist_ok=True)
                rendered.write_bytes(b"rendered:" + payloads[record["path"]])
                rendered.chmod(int(record["mode"], 8))
        self.runtime = FakeSystemd()

    def capture(self) -> dict[str, object]:
        return activation.capture_baseline(
            system_root=self.system_root,
            release_root=self.release_root,
            legacy_repository_sha="1" * 40,
            runtime=self.runtime,
            require_root_owner=False,
        )

    def prepare(self) -> dict[str, object]:
        return activation.prepare_candidate(
            artifact=self.artifact,
            descriptor=self.descriptor,
            rendered_root=self.rendered,
            release_root=self.release_root,
            oci_digest=OCI_DIGEST,
            require_root_owner=False,
        )


class SignageArtifactActivationE2E(Stage3Fixture):
    def test_candidate_absent_preflight_validates_the_sealed_legacy_baseline(self) -> None:
        baseline = self.capture()

        result = activation.preflight_release(
            release_root=self.release_root,
            baseline=baseline,
            candidate=None,
            require_root_owner=False,
        )

        self.assertTrue(result["ready"])
        self.assertEqual(result["issues"], [])
        self.assertEqual(result["previousRelease"], baseline["previousRelease"])
        self.assertIsNone(result["candidateRelease"])
        self.assertEqual(result["runtimeHealth"], baseline["runtimeHealth"])

    def test_stage2_retain_true_feeds_the_same_verified_bytes_to_activation(self) -> None:
        class Acquisition:
            def __init__(self, owner: "SignageArtifactActivationE2E") -> None:
                self.owner = owner

            def acquire(self, _reference: str, destination: Path):
                artifact = destination / stage.ARTIFACT_NAME
                descriptor = destination / stage.DESCRIPTOR_NAME
                shutil.copyfile(self.owner.artifact, artifact)
                shutil.copyfile(self.owner.descriptor, descriptor)
                return {
                    "artifactPath": artifact,
                    "descriptorPath": descriptor,
                    "ociDigest": OCI_DIGEST,
                }

        class Attestor:
            def __init__(self, descriptor: dict[str, object]) -> None:
                self.descriptor = descriptor

            def verify(self, _reference: str, exact_reference: str, _source_sha: str):
                return {
                    "_type": stage.STATEMENT_TYPE,
                    "subject": [{
                        "name": stage.ARTIFACT_REPOSITORY,
                        "digest": {"sha256": exact_reference.rsplit("@sha256:", 1)[1]},
                    }],
                    "predicateType": stage.PREDICATE_TYPE,
                    "predicate": {
                        "schemaVersion": 1,
                        "artifactKind": "pi3-signage-release",
                        "sourceSha": self.descriptor["sourceSha"],
                        "artifactSha256": self.descriptor["artifactSha256"],
                        "manifestSha256": self.descriptor["manifestSha256"],
                    },
                }

        descriptor = json.loads(self.descriptor.read_text(encoding="utf-8"))
        staging_root = self.root / "stage"
        staging_root.mkdir(mode=0o711)
        controller_root = self.root / "controller"
        controller_root.mkdir()
        target = {
            "host": "raspberrypi3",
            "profile": "signage",
            "address": "127.0.0.1",
            "user": "signageras3",
            "port": 22,
        }
        transport = stage.LocalFilesystemTransport(
            allowed_staging_root=staging_root,
            verifier_source=(DEPLOY / "signage-distribution-artifact.py").read_text(
                encoding="utf-8"
            ),
        )
        report = stage.acquire_and_stage(
            f"{stage.ARTIFACT_REPOSITORY}:{SOURCE_SHA}",
            target,
            "20260806-120000-abc123",
            staging_root,
            True,
            acquisition=Acquisition(self),
            attestor=Attestor(descriptor),
            transport=transport,
            verifier_source=(DEPLOY / "signage-distribution-artifact.py").read_text(
                encoding="utf-8"
            ),
            controller_root=controller_root,
        )

        self.assertEqual(report["status"], "passed")
        self.assertTrue(report["retain"])
        self.assertEqual(report["lifecycle"][-1], "ready-verified")
        ready = Path(report["staging"]["readyPath"])
        rendered = Path(report["staging"]["runPath"]) / "rendered"
        shutil.copytree(self.rendered, rendered)
        candidate = activation.prepare_candidate(
            artifact=ready / stage.ARTIFACT_NAME,
            descriptor=ready / stage.DESCRIPTOR_NAME,
            rendered_root=rendered,
            release_root=self.release_root,
            oci_digest=report["artifact"]["ociDigest"],
            require_root_owner=False,
        )
        baseline = self.capture()
        result = activation.activate(
            system_root=self.system_root,
            release_root=self.release_root,
            baseline=baseline,
            candidate=candidate,
            runtime=self.runtime,
            require_root_owner=False,
        )

        self.assertEqual(result["state"], "verified")
        self.assertEqual(candidate["artifactSha256"], report["artifact"]["artifactSha256"])
        self.assertEqual(candidate["manifestSha256"], report["artifact"]["manifestSha256"])
        self.assertEqual(candidate["payloadDigest"], report["artifact"]["payloadDigest"])

    def test_legacy_to_artifact_atomic_activation_and_cleanup(self) -> None:
        baseline = self.capture()
        candidate = self.prepare()

        result = activation.activate(
            system_root=self.system_root,
            release_root=self.release_root,
            baseline=baseline,
            candidate=candidate,
            runtime=self.runtime,
            require_root_owner=False,
        )

        self.assertEqual(result["state"], "verified")
        current = activation.probe_current(
            system_root=self.system_root,
            release_root=self.release_root,
            require_root_owner=False,
        )
        self.assertEqual(current["artifactSha256"], candidate["artifactSha256"])
        self.assertEqual(current["sourceSha"], SOURCE_SHA)
        self.assertIn("daemon-reload", self.runtime.events)
        self.assertIn("tmpfiles", self.runtime.events)
        for record in self.files:
            live = self.system_root / record["installPath"].removeprefix("/")
            self.assertTrue(live.is_symlink(), record["installPath"])

        cleaned = activation.cleanup_candidate(
            release_root=self.release_root,
            candidate=candidate,
            keep_current=True,
        )
        self.assertEqual(cleaned["status"], "passed")
        self.assertFalse(cleaned["stageResidue"])

    def test_artifact_to_artifact_uses_previous_pointer_only(self) -> None:
        first_baseline = self.capture()
        first = self.prepare()
        activation.activate(
            system_root=self.system_root,
            release_root=self.release_root,
            baseline=first_baseline,
            candidate=first,
            runtime=self.runtime,
            require_root_owner=False,
        )
        baseline = activation.capture_baseline(
            system_root=self.system_root,
            release_root=self.release_root,
            legacy_repository_sha=None,
            runtime=self.runtime,
            require_root_owner=False,
        )
        self.assertEqual(baseline["previousReleaseKind"], "artifact")
        self.assertIsNone(baseline["legacyRepositorySha"])

        second_artifact = self.root / "signage-release-2.tar"
        second_descriptor = self.root / "signage-release-2-descriptor.json"
        second_rendered = self.root / "rendered-2"
        second_sha = "9" * 40
        self.distribution.build_artifact(
            PROJECT,
            second_artifact,
            second_descriptor,
            source_sha=second_sha,
        )
        verified = self.distribution.verify_artifact(
            second_artifact,
            second_descriptor,
            expected_source_sha=second_sha,
        )
        with tarfile.open(second_artifact, "r:") as archive:
            payloads = {
                member.name: archive.extractfile(member).read()
                for member in archive.getmembers()
                if member.isfile()
            }
        for record in verified["manifest"]["files"]:
            if record["templated"]:
                rendered = second_rendered / record["path"]
                rendered.parent.mkdir(parents=True, exist_ok=True)
                rendered.write_bytes(b"rendered-2:" + payloads[record["path"]])
                rendered.chmod(int(record["mode"], 8))
        second = activation.prepare_candidate(
            artifact=second_artifact,
            descriptor=second_descriptor,
            rendered_root=second_rendered,
            release_root=self.release_root,
            oci_digest="sha256:" + "e" * 64,
            require_root_owner=False,
        )
        result = activation.activate(
            system_root=self.system_root,
            release_root=self.release_root,
            baseline=baseline,
            candidate=second,
            runtime=self.runtime,
            require_root_owner=False,
        )
        current = activation.probe_current(
            system_root=self.system_root,
            release_root=self.release_root,
            require_root_owner=False,
        )

        self.assertEqual(result["state"], "verified")
        self.assertEqual(current["sourceSha"], second_sha)
        self.assertEqual(current["release"], second["release"])
        self.assertEqual(baseline["previousRelease"], first["release"])

    def test_pre_switch_failure_restores_regular_live_files_and_pointer_absence(self) -> None:
        baseline = self.capture()
        candidate = self.prepare()
        before = {
            record["installPath"]: (
                self.system_root / record["installPath"].removeprefix("/")
            ).read_bytes()
            for record in self.files
            if record["path"] != "bin/raspi-signage-status-agent.pyz"
        }

        with self.assertRaises(activation.ActivationError) as raised:
            activation.activate(
                system_root=self.system_root,
                release_root=self.release_root,
                baseline=baseline,
                candidate={**candidate, "manifestSha256": "0" * 64},
                runtime=self.runtime,
                require_root_owner=False,
            )

        self.assertFalse(raised.exception.switched)
        self.assertFalse((self.release_root / "current").exists())
        for path, payload in before.items():
            live = self.system_root / path.removeprefix("/")
            self.assertFalse(live.is_symlink())
            self.assertEqual(live.read_bytes(), payload)

        restored = activation.rollback(
            system_root=self.system_root,
            release_root=self.release_root,
            baseline=baseline,
            candidate={**candidate, "manifestSha256": "0" * 64},
            runtime=self.runtime,
            require_root_owner=False,
        )
        self.assertEqual(restored["state"], "verified")
        self.assertEqual(restored["releaseKind"], "legacy")
        self.assertFalse((self.release_root / "current").exists())

    def test_post_switch_failure_rolls_back_to_legacy_and_restores_runtime(self) -> None:
        baseline = self.capture()
        candidate = self.prepare()
        self.runtime.fail_after_switch = True
        with self.assertRaises(activation.ActivationError) as raised:
            activation.activate(
                system_root=self.system_root,
                release_root=self.release_root,
                baseline=baseline,
                candidate=candidate,
                runtime=self.runtime,
                require_root_owner=False,
            )
        self.assertTrue(raised.exception.switched)

        self.runtime.fail_after_switch = False
        result = activation.rollback(
            system_root=self.system_root,
            release_root=self.release_root,
            baseline=baseline,
            candidate=candidate,
            runtime=self.runtime,
            require_root_owner=False,
        )
        self.assertEqual(result["state"], "verified")
        current = activation.probe_current(
            system_root=self.system_root,
            release_root=self.release_root,
            require_root_owner=False,
        )
        self.assertEqual(current["releaseKind"], "legacy")

    def test_rollback_verification_failure_is_not_terminal_success(self) -> None:
        baseline = self.capture()
        candidate = self.prepare()
        activation.activate(
            system_root=self.system_root,
            release_root=self.release_root,
            baseline=baseline,
            candidate=candidate,
            runtime=self.runtime,
            require_root_owner=False,
        )
        previous = self.release_root / "releases" / baseline["previousRelease"]
        manifest = previous / activation.RELEASE_MANIFEST
        manifest.chmod(0o644)
        manifest.write_text("{}\n", encoding="utf-8")
        with self.assertRaises(activation.ActivationError):
            activation.rollback(
                system_root=self.system_root,
                release_root=self.release_root,
                baseline=baseline,
                candidate=candidate,
                runtime=self.runtime,
                require_root_owner=False,
            )

    def test_candidate_manifest_binds_rendered_files_and_all_artifact_identities(self) -> None:
        candidate = self.prepare()
        manifest = json.loads(
            (self.release_root / "releases" / candidate["release"] / activation.RELEASE_MANIFEST).read_text()
        )
        self.assertEqual(manifest["sourceSha"], SOURCE_SHA)
        self.assertEqual(manifest["ociDigest"], OCI_DIGEST)
        self.assertEqual(manifest["artifactSha256"], candidate["artifactSha256"])
        self.assertEqual(len(manifest["files"]), 16)
        self.assertFalse(any(item["templated"] for item in manifest["files"]))
        self.assertTrue(
            all("renderedSha256" in item and "sourceSha256" in item for item in manifest["files"])
        )


if __name__ == "__main__":
    unittest.main()
