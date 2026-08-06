from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile
from dataclasses import replace
from pathlib import Path
from unittest import mock


PROJECT = Path(__file__).resolve().parents[3]
SCRIPT = PROJECT / "scripts/deploy/signage-distribution-artifact.py"
SPEC = importlib.util.spec_from_file_location("signage_distribution_artifact", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
distribution = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = distribution
SPEC.loader.exec_module(distribution)


class SignageDistributionArtifactTest(unittest.TestCase):
    SOURCE_SHA = "a" * 40

    def build(self, directory: Path, stem: str = "release"):
        artifact = directory / f"{stem}.tar"
        descriptor = directory / f"{stem}.json"
        result = distribution.build_artifact(
            PROJECT,
            artifact,
            descriptor,
            source_sha=self.SOURCE_SHA,
        )
        return artifact, descriptor, result

    def test_real_builder_is_reproducible_and_verifies_every_payload(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first, first_descriptor, first_result = self.build(root, "first")
            second, second_descriptor, second_result = self.build(root, "second")

            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(first_descriptor.read_bytes(), second_descriptor.read_bytes())
            self.assertEqual(first_result, second_result)
            verified = distribution.verify_artifact(
                first,
                first_descriptor,
                expected_source_sha=self.SOURCE_SHA,
            )
            self.assertEqual(verified["descriptor"], first_result)
            self.assertEqual(verified["manifest"]["sourceSha"], self.SOURCE_SHA)
            self.assertEqual(verified["manifest"]["artifactKind"], "pi3-signage-release")
            self.assertEqual(len(verified["manifest"]["files"]), 16)

            with tarfile.open(first, "r:") as archive:
                members = archive.getmembers()
                self.assertEqual(
                    [member.name for member in members],
                    sorted(member.name for member in members),
                )
                self.assertEqual(len(members), 17)
                for member in members:
                    self.assertTrue(member.isreg())
                    self.assertEqual(member.mtime, 0)
                    self.assertEqual(member.uid, 0)
                    self.assertEqual(member.gid, 0)
                    self.assertEqual(member.uname, "")
                    self.assertEqual(member.gname, "")

                for spec in distribution.PAYLOAD_SPECS:
                    if spec.source_path.startswith("generated:"):
                        continue
                    extracted = archive.extractfile(spec.archive_path)
                    assert extracted is not None
                    self.assertEqual(
                        extracted.read(),
                        (PROJECT / spec.source_path).read_bytes(),
                    )

            records = {item["path"]: item for item in verified["manifest"]["files"]}
            self.assertEqual(
                set(records),
                {spec.archive_path for spec in distribution.PAYLOAD_SPECS},
            )
            for spec in distribution.PAYLOAD_SPECS:
                record = records[spec.archive_path]
                self.assertEqual(record["sourcePath"], spec.source_path)
                self.assertEqual(record["installPath"], spec.install_path)
                self.assertEqual(record["mode"], f"{spec.mode:04o}")

            with tarfile.open(first, "r:") as archive:
                zipapp = archive.extractfile("bin/raspi-signage-status-agent.pyz")
                assert zipapp is not None
                zipapp_payload = zipapp.read()
                with zipfile.ZipFile(io.BytesIO(zipapp_payload)) as embedded:
                    self.assertEqual(embedded.namelist(), sorted(embedded.namelist()))
                    self.assertTrue(
                        all(
                            entry.compress_type == zipfile.ZIP_STORED
                            for entry in embedded.infolist()
                        )
                    )
            executable = root / "status-agent.pyz"
            executable.write_bytes(zipapp_payload)
            executable.chmod(0o755)
            identity = subprocess.run(
                [sys.executable, str(executable), "--release-identity"],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(json.loads(identity.stdout)["sourceSha"], self.SOURCE_SHA)

    def test_cli_build_and_verify_use_the_same_real_boundary(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifact = root / "release.tar"
            descriptor = root / "descriptor.json"
            built = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "build",
                    "--root",
                    str(PROJECT),
                    "--source-sha",
                    self.SOURCE_SHA,
                    "--output",
                    str(artifact),
                    "--descriptor",
                    str(descriptor),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            verified = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "verify",
                    "--artifact",
                    str(artifact),
                    "--descriptor",
                    str(descriptor),
                    "--expected-source-sha",
                    self.SOURCE_SHA,
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertEqual(json.loads(built.stdout), json.loads(verified.stdout))

    def test_secret_and_host_specific_sources_are_rejected(self):
        cases = (
            replace(
                distribution.PAYLOAD_SPECS[0],
                source_path="infrastructure/docker/.env",
                archive_path="config/docker.env",
            ),
            replace(
                distribution.PAYLOAD_SPECS[0],
                source_path="infrastructure/ansible/inventory.yml",
                archive_path="inventory/inventory.yml",
            ),
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index, unsafe in enumerate(cases):
                with self.subTest(source=unsafe.source_path):
                    specs = (*distribution.PAYLOAD_SPECS, unsafe)
                    with mock.patch.object(distribution, "PAYLOAD_SPECS", specs):
                        with self.assertRaises(distribution.ArtifactError):
                            self.build(root, f"unsafe-{index}")

    def test_manifest_payload_and_source_sha_tampering_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifact, descriptor, _result = self.build(root)

            with self.assertRaises(distribution.ArtifactError):
                distribution.verify_artifact(
                    artifact,
                    descriptor,
                    expected_source_sha="b" * 40,
                )

            manifest_tampered = root / "manifest-tampered.tar"
            self._rewrite_member(
                artifact,
                manifest_tampered,
                distribution.MANIFEST_NAME,
                lambda payload: payload.replace(self.SOURCE_SHA.encode(), b"b" * 40),
            )
            manifest_descriptor = root / "manifest-tampered.json"
            self._descriptor_for_changed_tar(
                descriptor,
                manifest_tampered,
                manifest_descriptor,
                update_manifest_digest=True,
            )
            with self.assertRaises(distribution.ArtifactError):
                distribution.verify_artifact(manifest_tampered, manifest_descriptor)

            payload_tampered = root / "payload-tampered.tar"
            payload_name = distribution.PAYLOAD_SPECS[0].archive_path
            self._rewrite_member(
                artifact,
                payload_tampered,
                payload_name,
                lambda payload: payload + b"\n# tampered\n",
            )
            payload_descriptor = root / "payload-tampered.json"
            self._descriptor_for_changed_tar(descriptor, payload_tampered, payload_descriptor)
            with self.assertRaises(distribution.ArtifactError):
                distribution.verify_artifact(payload_tampered, payload_descriptor)

    def _descriptor_for_changed_tar(
        self,
        original: Path,
        changed_tar: Path,
        output: Path,
        *,
        update_manifest_digest: bool = False,
    ) -> None:
        value = json.loads(original.read_text(encoding="utf-8"))
        payload = changed_tar.read_bytes()
        value["artifactSha256"] = hashlib.sha256(payload).hexdigest()
        value["artifactSize"] = len(payload)
        if update_manifest_digest:
            with tarfile.open(changed_tar, "r:") as archive:
                manifest = archive.extractfile(distribution.MANIFEST_NAME)
                assert manifest is not None
                value["manifestSha256"] = hashlib.sha256(manifest.read()).hexdigest()
        output.write_text(
            json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )

    def _rewrite_member(self, source: Path, output: Path, name: str, transform) -> None:
        entries: list[tuple[tarfile.TarInfo, bytes]] = []
        with tarfile.open(source, "r:") as archive:
            for member in archive.getmembers():
                extracted = archive.extractfile(member)
                assert extracted is not None
                payload = extracted.read()
                if member.name == name:
                    payload = transform(payload)
                info = tarfile.TarInfo(member.name)
                info.size = len(payload)
                info.mode = stat.S_IMODE(member.mode)
                info.mtime = 0
                info.uid = info.gid = 0
                info.uname = info.gname = ""
                entries.append((info, payload))
        with output.open("wb") as handle:
            with tarfile.open(fileobj=handle, mode="w", format=tarfile.USTAR_FORMAT) as archive:
                for info, payload in entries:
                    archive.addfile(info, io.BytesIO(payload))


if __name__ == "__main__":
    unittest.main()
