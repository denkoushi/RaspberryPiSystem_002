from __future__ import annotations

import copy
import gzip
import hashlib
import importlib.util
import io
import json
import shutil
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.deploy.rolling_release import signage_artifact_stage as stage


PROJECT = Path(__file__).resolve().parents[3]
SOURCE_SHA = "e1bcd74d5b114d4a5ee3f54df48b94b1019780c3"
OCI_DIGEST = "sha256:" + "d" * 64
ARTIFACT_REF = f"ghcr.io/denkoushi/raspisys-pi3-signage:{SOURCE_SHA}"
RUN_ID = "20260806-160000-abcdef"
HOST = "raspberrypi3"
VERIFIER_SOURCE = (
    PROJECT / "scripts/deploy/signage-distribution-artifact.py"
).read_text(encoding="utf-8")


def load_distribution_builder():
    path = PROJECT / "scripts/deploy/signage-distribution-artifact.py"
    spec = importlib.util.spec_from_file_location("_stage2_distribution_builder", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(spec.name, None)
    return module


class FixtureAcquisition:
    """External OCI transport fixture; core still verifies every acquired byte."""

    def __init__(self, artifact: Path, descriptor: Path, *, digest: str = OCI_DIGEST):
        self.artifact = artifact
        self.descriptor = descriptor
        self.digest = digest
        self.events: list[str] = []

    def acquire(self, artifact_ref: str, directory: Path) -> dict[str, object]:
        self.events.append(f"acquire:{artifact_ref}")
        target_artifact = directory / "signage-release.tar"
        target_descriptor = directory / "signage-release-descriptor.json"
        shutil.copyfile(self.artifact, target_artifact)
        shutil.copyfile(self.descriptor, target_descriptor)
        return {
            "artifactPath": target_artifact,
            "descriptorPath": target_descriptor,
            "ociDigest": self.digest,
        }


class FixtureAttestor:
    """Signature transport fixture returning the statement the verifier must bind."""

    def __init__(self, statement: dict[str, object]):
        self.statement = statement
        self.events: list[str] = []

    def verify(
        self,
        artifact_ref: str,
        exact_reference: str,
        source_sha: str,
    ) -> dict[str, object]:
        self.events.append(f"attest:{exact_reference}:{source_sha}")
        return copy.deepcopy(self.statement)


def attestation_statement(descriptor: dict[str, object]) -> dict[str, object]:
    return {
        "subject": [
            {
                "name": "ghcr.io/denkoushi/raspisys-pi3-signage",
                "digest": {"sha256": OCI_DIGEST.removeprefix("sha256:")},
            }
        ],
        "predicateType": stage.PREDICATE_TYPE,
        "predicate": {
            "schemaVersion": 1,
            "artifactKind": "pi3-signage-release",
            "sourceSha": descriptor["sourceSha"],
            "artifactSha256": descriptor["artifactSha256"],
            "manifestSha256": descriptor["manifestSha256"],
        },
    }


class FakeHttpResponse:
    def __init__(self, payload: bytes, headers: dict[str, str] | None = None):
        self.payload = payload
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, amount: int = -1) -> bytes:
        return self.payload if amount < 0 else self.payload[:amount]


def oci_layer(name: str, payload: bytes) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        member = tarfile.TarInfo(name)
        member.type = tarfile.REGTYPE
        member.mode = 0o600
        member.uid = 0
        member.gid = 0
        member.mtime = 0
        member.size = len(payload)
        archive.addfile(member, io.BytesIO(payload))
    return gzip.compress(buffer.getvalue(), mtime=0)


def rewrite_tar_member(artifact: Path, name: str, payload: bytes) -> None:
    with tarfile.open(artifact, "r:") as archive:
        members = []
        for member in archive.getmembers():
            stream = archive.extractfile(member)
            assert stream is not None
            members.append((member, payload if member.name == name else stream.read()))
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for original, value in members:
            member = copy.copy(original)
            member.size = len(value)
            archive.addfile(member, io.BytesIO(value))
    artifact.write_bytes(output.getvalue())


class SignageArtifactStageE2E(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.controller = self.root / "controller"
        self.controller.mkdir()
        self.source_artifact = self.root / "source.tar"
        self.source_descriptor = self.root / "source.json"
        builder = load_distribution_builder()
        self.descriptor = builder.build_artifact(
            PROJECT,
            self.source_artifact,
            self.source_descriptor,
            source_sha=SOURCE_SHA,
        )
        self.stage_root = self.root / "target-stage"
        self.stage_root.mkdir(mode=0o711)
        self.target = {
            "host": HOST,
            "profile": "signage",
            "address": "127.0.0.1",
            "user": "pi",
            "port": 22,
        }

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def transport(self, **kwargs):
        return stage.LocalFilesystemTransport(
            allowed_staging_root=self.stage_root,
            verifier_source=VERIFIER_SOURCE,
            **kwargs,
        )

    def execute(
        self,
        *,
        retain: bool,
        acquisition: FixtureAcquisition | None = None,
        attestor: FixtureAttestor | None = None,
        transport=None,
        run_id: str = RUN_ID,
    ) -> dict[str, object]:
        acquisition = acquisition or FixtureAcquisition(
            self.source_artifact, self.source_descriptor
        )
        attestor = attestor or FixtureAttestor(
            attestation_statement(self.descriptor)
        )
        return stage.acquire_and_stage(
            ARTIFACT_REF,
            self.target,
            run_id,
            self.stage_root,
            retain,
            acquisition=acquisition,
            attestor=attestor,
            transport=transport or self.transport(),
            verifier_source=VERIFIER_SOURCE,
            controller_root=self.controller,
        )

    def test_retain_false_runs_real_transfer_verify_promote_cleanup_and_zero_residue(self):
        transport = self.transport()

        report = self.execute(retain=False, transport=transport)

        self.assertEqual(report["status"], "passed")
        self.assertFalse(report["retain"])
        self.assertEqual(
            report["lifecycle"],
            [
                "acquired",
                "attested",
                "controller-verified",
                "target-prepared",
                "transferred",
                "temporary-verified",
                "atomically-promoted",
                "ready-verified",
                "cleaned",
            ],
        )
        self.assertEqual(report["artifact"]["sourceSha"], SOURCE_SHA)
        self.assertEqual(
            report["artifact"]["artifactSha256"],
            self.descriptor["artifactSha256"],
        )
        receipt = report["cleanupReceipt"]
        self.assertEqual(receipt["status"], "passed")
        self.assertIs(receipt["residue"], False)
        self.assertTrue(receipt["removedPaths"])
        self.assertEqual(receipt["residuePaths"], [])
        self.assertFalse(self.stage_root.joinpath(RUN_ID).exists())
        self.assertEqual(
            transport.events,
            ["prepare", "copy:signage-release.tar", "copy:signage-release-descriptor.json", "verify-temporary", "promote", "verify-ready", "cleanup"],
        )

    def test_retain_true_leaves_the_same_verified_ready_bytes(self):
        transport = self.transport()

        report = self.execute(retain=True, transport=transport)

        self.assertEqual(report["status"], "passed")
        self.assertTrue(report["retain"])
        self.assertIsNone(report["cleanupReceipt"])
        ready = self.stage_root / RUN_ID / "ready"
        self.assertTrue(ready.is_dir())
        self.assertEqual(
            hashlib.sha256(ready.joinpath("signage-release.tar").read_bytes()).hexdigest(),
            self.descriptor["artifactSha256"],
        )
        verified = stage.target_verify_ready(
            stage.target_request(
                self.target,
                RUN_ID,
                self.stage_root,
                self.descriptor,
                OCI_DIGEST,
            ),
            allowed_staging_root=self.stage_root,
            verifier_source=VERIFIER_SOURCE,
        )
        self.assertEqual(verified["state"], "ready")

    def test_interrupted_transfer_cleans_partial_bytes_without_runtime_mutation(self):
        runtime_before = b"services=active\nmaintenance=off\ncurrent=legacy\n"
        runtime_after = bytearray(runtime_before)
        transport = self.transport(fail_copy_after=1)

        report = self.execute(retain=False, transport=transport)

        self.assertEqual(report["status"], "incomplete")
        self.assertEqual(report["failure"]["code"], "transfer-copy")
        self.assertEqual(report["failure"]["stage"], "transfer")
        self.assertEqual(bytes(runtime_after), runtime_before)
        self.assertEqual(report["cleanupReceipt"]["status"], "passed")
        self.assertIs(report["cleanupReceipt"]["residue"], False)
        self.assertFalse(self.stage_root.joinpath(RUN_ID).exists())

    def test_in_transit_digest_change_is_rejected_before_atomic_promote(self):
        transport = self.transport(corrupt_copy_name="signage-release.tar")

        report = self.execute(retain=False, transport=transport)

        self.assertEqual(report["status"], "blocked")
        self.assertEqual(report["failure"]["code"], "target-verification")
        self.assertNotIn("promote", transport.events)
        self.assertEqual(report["cleanupReceipt"]["status"], "passed")
        self.assertIs(report["cleanupReceipt"]["residue"], False)

    def test_artifact_manifest_and_attestation_tampering_fail_before_promotion(self):
        cases: list[tuple[str, FixtureAcquisition, FixtureAttestor, str]] = []

        changed_artifact = self.root / "changed-artifact.tar"
        shutil.copyfile(self.source_artifact, changed_artifact)
        changed_artifact.write_bytes(changed_artifact.read_bytes() + b"changed")
        cases.append(
            (
                "artifact",
                FixtureAcquisition(changed_artifact, self.source_descriptor),
                FixtureAttestor(attestation_statement(self.descriptor)),
                "artifact-verification",
            )
        )

        changed_manifest = self.root / "changed-manifest.tar"
        changed_descriptor = self.root / "changed-manifest.json"
        shutil.copyfile(self.source_artifact, changed_manifest)
        shutil.copyfile(self.source_descriptor, changed_descriptor)
        rewrite_tar_member(changed_manifest, "SIGNAGE-ARTIFACT.json", b"{}\n")
        changed_descriptor_value = json.loads(changed_descriptor.read_text())
        changed_descriptor_value["artifactSha256"] = hashlib.sha256(
            changed_manifest.read_bytes()
        ).hexdigest()
        changed_descriptor_value["artifactSize"] = changed_manifest.stat().st_size
        changed_descriptor.write_text(
            json.dumps(changed_descriptor_value, sort_keys=True, separators=(",", ":")) + "\n"
        )
        cases.append(
            (
                "manifest",
                FixtureAcquisition(changed_manifest, changed_descriptor),
                FixtureAttestor(attestation_statement(changed_descriptor_value)),
                "artifact-verification",
            )
        )

        changed_statement = attestation_statement(self.descriptor)
        changed_statement["predicate"]["artifactSha256"] = "a" * 64
        cases.append(
            (
                "attestation",
                FixtureAcquisition(self.source_artifact, self.source_descriptor),
                FixtureAttestor(changed_statement),
                "attestation-verification",
            )
        )

        for index, (name, acquisition, attestor, code) in enumerate(cases, start=1):
            with self.subTest(name=name):
                transport = self.transport()
                report = self.execute(
                    retain=False,
                    acquisition=acquisition,
                    attestor=attestor,
                    transport=transport,
                    run_id=f"20260806-1600{index:02d}-abcde{index}",
                )
                self.assertEqual(report["status"], "blocked")
                self.assertEqual(report["failure"]["code"], code)
                self.assertNotIn("promote", transport.events)

    def test_path_traversal_symlink_and_existing_path_collisions_fail_closed(self):
        traversal = self.execute(retain=False, run_id="../escape")
        self.assertEqual(traversal["failure"]["code"], "request-validation")

        run_path = self.stage_root / RUN_ID
        run_path.symlink_to(self.root / "outside", target_is_directory=True)
        symlink = self.execute(retain=False)
        self.assertEqual(symlink["failure"]["code"], "staging-path")
        run_path.unlink()

        run_path.mkdir()
        collision = self.execute(retain=False)
        self.assertEqual(collision["failure"]["code"], "staging-path")
        self.assertTrue(run_path.is_dir())

    def test_atomic_promote_and_cleanup_failures_remain_distinct(self):
        promote = self.execute(
            retain=False,
            transport=self.transport(fail_promote=True),
        )
        self.assertEqual(promote["failure"]["code"], "atomic-promote")
        self.assertEqual(promote["cleanupReceipt"]["status"], "passed")

        cleanup = self.execute(
            retain=False,
            transport=self.transport(fail_cleanup=True),
            run_id="20260806-160001-abcdef",
        )
        self.assertEqual(cleanup["status"], "incomplete")
        self.assertEqual(cleanup["failure"]["code"], "cleanup-verification")
        self.assertEqual(cleanup["cleanupReceipt"]["status"], "failed")
        self.assertIsNot(cleanup["cleanupReceipt"]["residue"], False)

        self.stage_root = self.root / "target-stage-transfer-cleanup"
        self.stage_root.mkdir(mode=0o711)
        transfer_cleanup = self.execute(
            retain=False,
            transport=self.transport(fail_copy_after=1, fail_cleanup=True),
            run_id="20260806-160002-abcdef",
        )
        self.assertEqual(
            transfer_cleanup["failure"],
            {
                "stage": "cleanup",
                "code": "cleanup-verification",
                "primary": {"stage": "transfer", "code": "transfer-copy"},
            },
        )
        self.assertEqual(transfer_cleanup["cleanupReceipt"]["status"], "failed")


class GhcrAcquisitionContract(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        builder = load_distribution_builder()
        self.artifact = self.root / "artifact.tar"
        self.descriptor_path = self.root / "descriptor.json"
        builder.build_artifact(
            PROJECT,
            self.artifact,
            self.descriptor_path,
            source_sha=SOURCE_SHA,
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def fixture(self, *, corrupt_layer: bool = False):
        layers = [
            oci_layer("signage-release.tar", self.artifact.read_bytes()),
            oci_layer(
                "signage-release-descriptor.json",
                self.descriptor_path.read_bytes(),
            ),
        ]
        layer_descriptors = [
            {
                "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip",
                "digest": "sha256:" + hashlib.sha256(payload).hexdigest(),
                "size": len(payload),
            }
            for payload in layers
        ]
        manifest = json.dumps(
            {
                "schemaVersion": 2,
                "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "config": {
                    "mediaType": "application/vnd.oci.image.config.v1+json",
                    "digest": "sha256:" + "1" * 64,
                    "size": 2,
                },
                "layers": layer_descriptors,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        manifest_digest = "sha256:" + hashlib.sha256(manifest).hexdigest()
        index = json.dumps(
            {
                "schemaVersion": 2,
                "mediaType": "application/vnd.oci.image.index.v1+json",
                "manifests": [
                    {
                        "mediaType": "application/vnd.oci.image.manifest.v1+json",
                        "digest": manifest_digest,
                        "size": len(manifest),
                        "platform": {
                            "architecture": "arm",
                            "os": "linux",
                            "variant": "v7",
                        },
                    },
                    {
                        "mediaType": "application/vnd.oci.image.manifest.v1+json",
                        "digest": "sha256:" + "2" * 64,
                        "size": 123,
                        "platform": {"architecture": "unknown", "os": "unknown"},
                    },
                ],
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        index_digest = "sha256:" + hashlib.sha256(index).hexdigest()
        responses = {
            "https://ghcr.io/token?service=ghcr.io&scope=repository%3Adenkoushi%2Fraspisys-pi3-signage%3Apull": FakeHttpResponse(
                b'{"token":"fixture-bearer"}'
            ),
            f"https://ghcr.io/v2/denkoushi/raspisys-pi3-signage/manifests/{SOURCE_SHA}": FakeHttpResponse(
                index, {"Docker-Content-Digest": index_digest}
            ),
            f"https://ghcr.io/v2/denkoushi/raspisys-pi3-signage/manifests/{manifest_digest}": FakeHttpResponse(
                manifest, {"Docker-Content-Digest": manifest_digest}
            ),
        }
        for descriptor, payload in zip(layer_descriptors, layers):
            responses[
                "https://ghcr.io/v2/denkoushi/raspisys-pi3-signage/blobs/"
                + descriptor["digest"]
            ] = FakeHttpResponse(
                payload + (b"corrupt" if corrupt_layer and payload is layers[0] else b"")
            )

        def opener(request, timeout):
            self.assertIn(timeout, {30, 60})
            response = responses.get(request.full_url)
            if response is None:
                raise AssertionError(f"unexpected registry request: {request.full_url}")
            return response

        return opener, index_digest

    def test_real_oci_index_manifest_layers_are_resolved_and_extracted(self):
        opener, index_digest = self.fixture()
        destination = self.root / "download"
        destination.mkdir()
        acquisition = stage.GhcrAcquisition(
            {"username": "denkoushi", "token": "fixture-token"},
            opener=opener,
        )

        result = acquisition.acquire(ARTIFACT_REF, destination)

        self.assertEqual(result["ociDigest"], index_digest)
        self.assertEqual(
            Path(result["artifactPath"]).read_bytes(), self.artifact.read_bytes()
        )
        self.assertEqual(
            Path(result["descriptorPath"]).read_bytes(),
            self.descriptor_path.read_bytes(),
        )

    def test_layer_digest_mismatch_is_rejected_before_target_transfer(self):
        opener, _index_digest = self.fixture(corrupt_layer=True)
        destination = self.root / "download"
        destination.mkdir()
        acquisition = stage.GhcrAcquisition(
            {"username": "denkoushi", "token": "fixture-token"},
            opener=opener,
        )

        with self.assertRaisesRegex(stage.StageError, "blob digest"):
            acquisition.acquire(ARTIFACT_REF, destination)

    def test_existing_gh_verifier_command_binds_custom_predicate_and_source(self):
        descriptor = json.loads(self.descriptor_path.read_text())
        statement = attestation_statement(descriptor)
        output = json.dumps(
            [{"verificationResult": {"statement": statement}}],
            sort_keys=True,
        )
        completed = SimpleNamespace(returncode=0, stdout=output)
        with patch.object(stage.subprocess, "run", return_value=completed) as run:
            result = stage.GhAttestor(
                {"username": "denkoushi", "token": "fixture-token"},
                gh="/usr/bin/gh",
            ).verify(
                ARTIFACT_REF,
                f"{stage.ARTIFACT_REPOSITORY}@{OCI_DIGEST}",
                SOURCE_SHA,
            )

        self.assertEqual(result, statement)
        command = run.call_args.args[0]
        self.assertIn("--bundle-from-oci", command)
        self.assertIn("--deny-self-hosted-runners", command)
        self.assertEqual(command[command.index("--predicate-type") + 1], stage.PREDICATE_TYPE)
        self.assertEqual(command[command.index("--source-digest") + 1], SOURCE_SHA)
        self.assertEqual(command[command.index("--source-ref") + 1], "refs/heads/main")


if __name__ == "__main__":
    unittest.main()
