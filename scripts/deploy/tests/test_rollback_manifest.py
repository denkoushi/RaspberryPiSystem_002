#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "rollback-manifest.py"
SPEC = importlib.util.spec_from_file_location("rollback_manifest", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load rollback manifest helper")
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class RollbackManifestTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.filesystem_root = self.base / "filesystem"
        self.storage_root = self.base / "rollback-manifests"
        self.config_directory = self.filesystem_root / "etc" / "systemd" / "system"
        self.config_directory.mkdir(parents=True)
        self.run_id = "run-123"
        self.host = "terminal-01"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    @property
    def host_directory(self) -> Path:
        return self.storage_root / self.run_id / self.host

    @property
    def manifest_path(self) -> Path:
        return self.host_directory / "manifest.json"

    def capture(self, source: Path | str, destination: Path | str):
        return MODULE.capture(
            root=self.storage_root,
            run_id=self.run_id,
            host=self.host,
            source=source,
            destination=destination,
            filesystem_root=self.filesystem_root,
        )

    def restore(self, expected_manifest_sha256: str | None = None):
        expected = expected_manifest_sha256 or self.read_manifest()["manifestSha256"]
        return MODULE.restore(
            root=self.storage_root,
            run_id=self.run_id,
            host=self.host,
            expected_manifest_sha256=expected,
            filesystem_root=self.filesystem_root,
        )

    def read_manifest(self) -> dict:
        return json.loads(self.manifest_path.read_text(encoding="utf-8"))

    def write_resealed_manifest(self, manifest: dict) -> None:
        manifest["manifestSha256"] = MODULE._manifest_digest(manifest)
        self.manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def git(self, repository: Path, *arguments: str) -> str:
        completed = subprocess.run(
            ["git", "-C", str(repository), *arguments],
            check=True,
            capture_output=True,
            text=True,
        )
        return completed.stdout.strip()

    def create_repository(self) -> tuple[Path, str]:
        repository = self.filesystem_root / "srv" / "terminal-app"
        repository.mkdir(parents=True)
        self.git(repository, "init", "--quiet")
        self.git(repository, "config", "user.name", "Rollback Test")
        self.git(repository, "config", "user.email", "rollback@example.invalid")
        (repository / "tracked.txt").write_text("prior release\n", encoding="utf-8")
        self.git(repository, "add", "tracked.txt")
        self.git(repository, "commit", "--quiet", "-m", "prior release")
        return repository, self.git(repository, "rev-parse", "HEAD")

    def commit_deployed_repository(self, repository: Path) -> str:
        (repository / "tracked.txt").write_text("deployed release\n", encoding="utf-8")
        self.git(repository, "add", "tracked.txt")
        self.git(repository, "commit", "--quiet", "-m", "deployed release")
        return self.git(repository, "rev-parse", "HEAD")

    def test_regular_file_capture_records_metadata_and_restores_atomically(self):
        service = self.config_directory / "kiosk-browser.service"
        unrelated = self.config_directory / "unrelated.service"
        service.write_bytes(b"original service\n")
        unrelated.write_bytes(b"keep me\n")
        service.chmod(0o640)
        original = service.stat()

        result = self.capture(service, service)

        self.assertTrue(result["captured"])
        manifest = self.read_manifest()
        self.assertEqual(result["manifestSha256"], manifest["manifestSha256"])
        entry = manifest["entries"][0]
        self.assertEqual(entry["source"], str(service))
        self.assertEqual(entry["destination"], str(service))
        self.assertEqual(entry["previousState"], "regular")
        self.assertEqual(entry["sha256"], hashlib.sha256(b"original service\n").hexdigest())
        self.assertEqual(entry["mode"], 0o640)
        self.assertEqual(entry["uid"], original.st_uid)
        self.assertEqual(entry["gid"], original.st_gid)
        self.assertEqual(stat.S_IMODE(self.manifest_path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((self.host_directory / "payload/000000.bin").stat().st_mode), 0o600)
        for directory in (
            self.storage_root,
            self.storage_root / self.run_id,
            self.host_directory,
            self.host_directory / "payload",
        ):
            self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)

        service.write_bytes(b"new broken service\n")
        service.chmod(0o600)
        restored = self.restore()

        self.assertEqual(restored["destinations"], [str(service)])
        self.assertEqual(service.read_bytes(), b"original service\n")
        self.assertEqual(stat.S_IMODE(service.stat().st_mode), 0o640)
        self.assertEqual((service.stat().st_uid, service.stat().st_gid), (original.st_uid, original.st_gid))
        self.assertEqual(unrelated.read_bytes(), b"keep me\n")

    def test_explicit_source_is_snapshotted_and_restored_only_to_destination(self):
        source = self.config_directory / "source.service"
        destination = self.config_directory / "destination.service"
        source.write_bytes(b"captured source\n")
        source.chmod(0o644)
        destination.write_bytes(b"old destination\n")

        self.capture(source, destination)
        source.write_bytes(b"source changed after capture\n")
        destination.write_bytes(b"deployed destination\n")
        self.restore()

        self.assertEqual(destination.read_bytes(), b"captured source\n")
        self.assertEqual(source.read_bytes(), b"source changed after capture\n")

    def test_symlink_payload_is_restored_without_following_it(self):
        target_directory = self.filesystem_root / "targets"
        target_directory.mkdir()
        (target_directory / "real.service").write_text("target\n", encoding="utf-8")
        link = self.config_directory / "selected.service"
        link.symlink_to("../../../targets/real.service")
        original = link.lstat()

        self.capture(link, link)
        link.unlink()
        link.write_text("replacement regular file\n", encoding="utf-8")
        self.restore()

        self.assertTrue(link.is_symlink())
        self.assertEqual(os.readlink(link), "../../../targets/real.service")
        restored = link.lstat()
        self.assertEqual(stat.S_IMODE(restored.st_mode), stat.S_IMODE(original.st_mode))
        self.assertEqual((restored.st_uid, restored.st_gid), (original.st_uid, original.st_gid))

    def test_absent_state_deletes_only_the_manifest_destination(self):
        missing = self.config_directory / "not-installed.service"
        unrelated = self.config_directory / "still-installed.service"
        unrelated.write_text("keep\n", encoding="utf-8")

        self.capture(missing, missing)
        entry = self.read_manifest()["entries"][0]
        self.assertEqual(entry["previousState"], "absent")
        self.assertIsNone(entry["payload"])
        self.assertEqual(entry["sha256"], hashlib.sha256(b"").hexdigest())
        self.assertIsNone(entry["mode"])
        missing.write_text("created by failed deploy\n", encoding="utf-8")

        self.restore()

        self.assertFalse(missing.exists())
        self.assertEqual(unrelated.read_text(encoding="utf-8"), "keep\n")

    def test_absent_file_under_absent_parent_can_be_sealed_before_onboarding(self):
        missing = self.filesystem_root / "home" / "new-user" / ".config" / "new.conf"
        captured = self.capture(missing, missing)
        self.assertEqual(captured["previousState"], "absent")

        missing.parent.mkdir(parents=True)
        missing.write_text("created by failed release\n", encoding="utf-8")
        self.restore(captured["manifestSha256"])

        self.assertFalse(missing.exists())

    def test_duplicate_destination_is_rejected_after_normalisation(self):
        first = self.config_directory / "first.service"
        second = self.config_directory / "second.service"
        destination = self.config_directory / "destination.service"
        first.write_text("first\n", encoding="utf-8")
        second.write_text("second\n", encoding="utf-8")
        self.capture(first, destination)

        duplicate_spelling = str(self.config_directory / "." / destination.name)
        with self.assertRaisesRegex(MODULE.ManifestError, "already sealed"):
            self.capture(second, duplicate_spelling)

        self.assertEqual(len(self.read_manifest()["entries"]), 1)

    def test_invalid_identity_traversal_and_outside_paths_fail_closed(self):
        source = self.config_directory / "safe.service"
        source.write_text("safe\n", encoding="utf-8")
        outside = self.base / "outside.service"
        outside.write_text("outside\n", encoding="utf-8")

        for run_id, host in (("../run", self.host), (self.run_id, "../host")):
            with self.subTest(run_id=run_id, host=host), self.assertRaises(MODULE.ManifestError):
                MODULE.capture(
                    root=self.storage_root,
                    run_id=run_id,
                    host=host,
                    source=source,
                    destination=source,
                    filesystem_root=self.filesystem_root,
                )
        with self.assertRaisesRegex(MODULE.ManifestError, "escapes the filesystem root"):
            self.capture(outside, source)
        traversing_source = str(self.config_directory / ".." / "system" / "safe.service")
        with self.assertRaisesRegex(MODULE.ManifestError, "traversal"):
            self.capture(traversing_source, source)
        traversing_root = str(self.base / "unused" / ".." / "rollback")
        with self.assertRaisesRegex(MODULE.ManifestError, "traversal"):
            MODULE.capture(
                root=traversing_root,
                run_id=self.run_id,
                host=self.host,
                source=source,
                destination=source,
                filesystem_root=self.filesystem_root,
            )

    def test_special_source_and_escaping_symlink_are_rejected(self):
        fifo = self.config_directory / "unsafe.pipe"
        os.mkfifo(fifo)
        with self.assertRaisesRegex(MODULE.ManifestError, "regular file, symlink, or absent"):
            self.capture(fifo, fifo)

        link = self.config_directory / "escape.service"
        link.symlink_to("../../../../outside.service")
        with self.assertRaisesRegex(MODULE.ManifestError, "escapes the filesystem root"):
            self.capture(link, link)

    def test_relative_symlink_must_be_safe_at_its_restore_destination(self):
        source_directory = self.filesystem_root / "nested" / "source"
        source_directory.mkdir(parents=True)
        (self.filesystem_root / "target.service").write_text("target\n", encoding="utf-8")
        link = source_directory / "relative.service"
        link.symlink_to("../../target.service")
        unsafe_destination = self.filesystem_root / "restored.service"

        with self.assertRaisesRegex(MODULE.ManifestError, "escapes the filesystem root"):
            self.capture(link, unsafe_destination)

    def test_manifest_symlink_is_rejected_before_restore(self):
        service = self.config_directory / "service.service"
        service.write_text("original\n", encoding="utf-8")
        self.capture(service, service)
        service.write_text("deployed\n", encoding="utf-8")
        copied_manifest = self.base / "copied-manifest.json"
        copied_manifest.write_bytes(self.manifest_path.read_bytes())
        copied_manifest.chmod(0o600)
        self.manifest_path.unlink()
        self.manifest_path.symlink_to(copied_manifest)

        with self.assertRaisesRegex(MODULE.ManifestError, "never a symlink"):
            self.restore()
        self.assertEqual(service.read_text(encoding="utf-8"), "deployed\n")

    def test_payload_symlink_and_checksum_mismatch_are_rejected(self):
        for mutation in ("symlink", "checksum"):
            with self.subTest(mutation=mutation):
                service = self.config_directory / f"{mutation}.service"
                service.write_text("original\n", encoding="utf-8")
                run_id = f"run-{mutation}"
                MODULE.capture(
                    root=self.storage_root,
                    run_id=run_id,
                    host=self.host,
                    source=service,
                    destination=service,
                    filesystem_root=self.filesystem_root,
                )
                service.write_text("deployed\n", encoding="utf-8")
                payload = self.storage_root / run_id / self.host / "payload/000000.bin"
                if mutation == "symlink":
                    substitute = self.base / "substitute-payload"
                    substitute.write_text("original\n", encoding="utf-8")
                    payload.unlink()
                    payload.symlink_to(substitute)
                    expected = "never a symlink"
                else:
                    payload.write_text("tampered\n", encoding="utf-8")
                    expected = "checksum"
                with self.assertRaisesRegex(MODULE.ManifestError, expected):
                    digest = json.loads(
                        (self.storage_root / run_id / self.host / "manifest.json").read_text(
                            encoding="utf-8"
                        )
                    )["manifestSha256"]
                    MODULE.restore(
                        root=self.storage_root,
                        run_id=run_id,
                        host=self.host,
                        expected_manifest_sha256=digest,
                        filesystem_root=self.filesystem_root,
                    )
                self.assertEqual(service.read_text(encoding="utf-8"), "deployed\n")

    def test_manifest_and_payload_must_remain_owner_only(self):
        for target in ("manifest", "payload"):
            with self.subTest(target=target):
                service = self.config_directory / f"permissions-{target}.service"
                service.write_text("original\n", encoding="utf-8")
                run_id = f"run-permissions-{target}"
                MODULE.capture(
                    root=self.storage_root,
                    run_id=run_id,
                    host=self.host,
                    source=service,
                    destination=service,
                    filesystem_root=self.filesystem_root,
                )
                service.write_text("deployed\n", encoding="utf-8")
                host_directory = self.storage_root / run_id / self.host
                unsafe = (
                    host_directory / "manifest.json"
                    if target == "manifest"
                    else host_directory / "payload/000000.bin"
                )
                unsafe.chmod(0o640)

                with self.assertRaisesRegex(MODULE.ManifestError, "outside its owner"):
                    digest = json.loads(
                        (host_directory / "manifest.json").read_text(encoding="utf-8")
                    )["manifestSha256"]
                    MODULE.restore(
                        root=self.storage_root,
                        run_id=run_id,
                        host=self.host,
                        expected_manifest_sha256=digest,
                        filesystem_root=self.filesystem_root,
                    )
                self.assertEqual(service.read_text(encoding="utf-8"), "deployed\n")

    def test_manifest_integrity_tamper_is_rejected(self):
        service = self.config_directory / "service.service"
        service.write_text("original\n", encoding="utf-8")
        self.capture(service, service)
        service.write_text("deployed\n", encoding="utf-8")
        manifest = self.read_manifest()
        manifest["entries"][0]["mode"] = 0o777
        self.manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        with self.assertRaisesRegex(MODULE.ManifestError, "integrity checksum"):
            self.restore()
        self.assertEqual(service.read_text(encoding="utf-8"), "deployed\n")

    def test_resealed_payload_traversal_and_outside_destination_are_rejected(self):
        for mutation in ("payload-traversal", "outside-destination"):
            with self.subTest(mutation=mutation):
                service = self.config_directory / f"{mutation}.service"
                service.write_text("original\n", encoding="utf-8")
                run_id = f"run-{mutation}"
                MODULE.capture(
                    root=self.storage_root,
                    run_id=run_id,
                    host=self.host,
                    source=service,
                    destination=service,
                    filesystem_root=self.filesystem_root,
                )
                service.write_text("deployed\n", encoding="utf-8")
                manifest_path = self.storage_root / run_id / self.host / "manifest.json"
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                if mutation == "payload-traversal":
                    manifest["entries"][0]["payload"] = "payload/../../outside"
                    expected = "payload path"
                else:
                    outside = self.base / "outside-destination.service"
                    outside.write_text("do not touch\n", encoding="utf-8")
                    manifest["entries"][0]["destination"] = str(outside)
                    expected = "escapes the filesystem root"
                manifest["manifestSha256"] = MODULE._manifest_digest(manifest)
                manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

                with self.assertRaisesRegex(MODULE.ManifestError, expected):
                    MODULE.restore(
                        root=self.storage_root,
                        run_id=run_id,
                        host=self.host,
                        expected_manifest_sha256=manifest["manifestSha256"],
                        filesystem_root=self.filesystem_root,
                    )
                self.assertEqual(service.read_text(encoding="utf-8"), "deployed\n")

    def test_preflight_rejects_special_destination_before_any_restore(self):
        first = self.config_directory / "first.service"
        second = self.config_directory / "second.service"
        first.write_text("first-original\n", encoding="utf-8")
        second.write_text("second-original\n", encoding="utf-8")
        self.capture(first, first)
        self.capture(second, second)
        first.write_text("first-deployed\n", encoding="utf-8")
        second.unlink()
        second.mkdir()

        with self.assertRaisesRegex(MODULE.ManifestError, "special file or directory"):
            self.restore()
        self.assertEqual(first.read_text(encoding="utf-8"), "first-deployed\n")

    def test_restore_requires_the_latest_sealed_manifest_digest_before_mutation(self):
        first = self.config_directory / "digest-first.service"
        second = self.config_directory / "digest-second.service"
        first.write_text("first-original\n", encoding="utf-8")
        second.write_text("second-original\n", encoding="utf-8")
        first_capture = self.capture(first, first)
        second_capture = self.capture(second, second)
        self.assertNotEqual(
            first_capture["manifestSha256"], second_capture["manifestSha256"]
        )
        first.write_text("first-deployed\n", encoding="utf-8")
        second.write_text("second-deployed\n", encoding="utf-8")

        with self.assertRaisesRegex(MODULE.ManifestError, "expected sealed digest"):
            self.restore(first_capture["manifestSha256"])
        self.assertEqual(first.read_text(encoding="utf-8"), "first-deployed\n")
        self.assertEqual(second.read_text(encoding="utf-8"), "second-deployed\n")

        with self.assertRaisesRegex(MODULE.ManifestError, "malformed"):
            self.restore("a" * 63)
        self.assertEqual(first.read_text(encoding="utf-8"), "first-deployed\n")
        self.assertEqual(second.read_text(encoding="utf-8"), "second-deployed\n")

        restored = self.restore(second_capture["manifestSha256"])
        self.assertEqual(restored["count"], 2)
        self.assertEqual(first.read_text(encoding="utf-8"), "first-original\n")
        self.assertEqual(second.read_text(encoding="utf-8"), "second-original\n")

    def test_restore_verifies_destination_checksum_after_replacement(self):
        service = self.config_directory / "postflight.service"
        service.write_text("original\n", encoding="utf-8")
        captured = self.capture(service, service)
        service.write_text("deployed\n", encoding="utf-8")
        original_restore = MODULE._restore_regular

        def corrupt_after_replace(entry, payload, context):
            original_restore(entry, payload, context)
            Path(entry["destination"]).write_text("corrupted after replace\n", encoding="utf-8")

        with mock.patch.object(MODULE, "_restore_regular", corrupt_after_replace):
            with self.assertRaisesRegex(MODULE.ManifestError, "post-restore.*checksum"):
                self.restore(captured["manifestSha256"])

    def test_capture_set_seals_one_explicit_manifest_in_request_order(self):
        first = self.config_directory / "set-first.service"
        second = self.config_directory / "set-second.service"
        first.write_text("first\n", encoding="utf-8")
        second.write_text("second\n", encoding="utf-8")

        result = MODULE.capture_set(
            root=self.storage_root,
            run_id=self.run_id,
            host=self.host,
            paths=[first, second],
            filesystem_root=self.filesystem_root,
        )

        self.assertEqual(result["count"], 2)
        self.assertEqual(result["destinations"], [str(first), str(second)])
        self.assertEqual(
            result["manifestSha256"], self.read_manifest()["manifestSha256"]
        )
        with self.assertRaisesRegex(MODULE.ManifestError, "at least one"):
            MODULE.capture_set(
                root=self.storage_root,
                run_id="empty-set",
                host=self.host,
                paths=[],
                filesystem_root=self.filesystem_root,
            )

    def test_capture_set_restores_exact_repository_head_and_preserves_untracked_files(self):
        service = self.config_directory / "repository.service"
        service.write_text("prior service\n", encoding="utf-8")
        repository, prior_head = self.create_repository()
        secret = repository / ".env"
        secret.write_text("LOCAL_SECRET=preserve-me\n", encoding="utf-8")

        captured = MODULE.capture_set(
            root=self.storage_root,
            run_id=self.run_id,
            host=self.host,
            paths=[service, secret],
            repository=repository,
            expected_head=prior_head,
            filesystem_root=self.filesystem_root,
        )

        manifest = self.read_manifest()
        self.assertEqual(manifest["version"], 2)
        self.assertEqual(
            manifest["repository"], {"path": str(repository), "head": prior_head}
        )
        self.assertEqual(captured["repository"], manifest["repository"])
        deployed_head = self.commit_deployed_repository(repository)
        self.assertNotEqual(deployed_head, prior_head)
        service.write_text("deployed service\n", encoding="utf-8")
        secret.write_text("LOCAL_SECRET=deployed-value\n", encoding="utf-8")

        with self.assertRaisesRegex(MODULE.ManifestError, "expected sealed digest"):
            self.restore("0" * 64)
        self.assertEqual(service.read_text(encoding="utf-8"), "deployed service\n")
        self.assertEqual(
            secret.read_text(encoding="utf-8"), "LOCAL_SECRET=deployed-value\n"
        )
        self.assertEqual(self.git(repository, "rev-parse", "HEAD"), deployed_head)

        restored = self.restore(captured["manifestSha256"])

        self.assertEqual(restored["repository"], manifest["repository"])
        self.assertEqual(service.read_text(encoding="utf-8"), "prior service\n")
        self.assertEqual(self.git(repository, "rev-parse", "HEAD"), prior_head)
        self.assertEqual(
            (repository / "tracked.txt").read_text(encoding="utf-8"),
            "prior release\n",
        )
        self.assertEqual(
            secret.read_text(encoding="utf-8"), "LOCAL_SECRET=preserve-me\n"
        )

    def test_repository_capture_requires_paired_path_and_exact_current_head(self):
        service = self.config_directory / "repository-capture.service"
        service.write_text("prior\n", encoding="utf-8")
        repository, prior_head = self.create_repository()
        common = {
            "root": self.storage_root,
            "host": self.host,
            "paths": [service],
            "filesystem_root": self.filesystem_root,
        }

        for run_id, supplied_repository, supplied_head, error in (
            ("missing-head", repository, None, "provided together"),
            ("missing-repository", None, prior_head, "provided together"),
            ("uppercase-head", repository, prior_head.upper(), "lowercase 40-hex"),
            ("wrong-head", repository, "0" * 40, "does not match"),
        ):
            with self.subTest(run_id=run_id), self.assertRaisesRegex(
                MODULE.ManifestError, error
            ):
                MODULE.capture_set(
                    **common,
                    run_id=run_id,
                    repository=supplied_repository,
                    expected_head=supplied_head,
                )
            self.assertFalse(
                (self.storage_root / run_id / self.host / "manifest.json").exists()
            )

    def test_repository_path_must_be_absolute_in_root_and_have_real_git_directory(self):
        service = self.config_directory / "repository-path.service"
        service.write_text("prior\n", encoding="utf-8")
        repository, prior_head = self.create_repository()
        outside = self.base / "outside-repository"
        outside.mkdir()
        not_git = self.filesystem_root / "srv" / "not-git"
        not_git.mkdir()
        repository_link = self.filesystem_root / "srv" / "repository-link"
        repository_link.symlink_to(repository, target_is_directory=True)

        for run_id, supplied_repository, error in (
            ("relative-repository", Path("relative-repository"), "must be absolute"),
            ("outside-repository", outside, "escapes the filesystem root"),
            ("not-git-repository", not_git, r"\.git must be a real"),
            ("symlink-repository", repository_link, "real existing directory"),
        ):
            with self.subTest(run_id=run_id), self.assertRaisesRegex(
                MODULE.ManifestError, error
            ):
                MODULE.capture_set(
                    root=self.storage_root,
                    run_id=run_id,
                    host=self.host,
                    paths=[service],
                    repository=supplied_repository,
                    expected_head=prior_head,
                    filesystem_root=self.filesystem_root,
                )

        with self.assertRaisesRegex(MODULE.ManifestError, "repository metadata"):
            MODULE.capture_set(
                root=self.storage_root,
                run_id="git-metadata-entry",
                host=self.host,
                paths=[repository / ".git" / "config"],
                repository=repository,
                expected_head=prior_head,
                filesystem_root=self.filesystem_root,
            )

    def test_manifest_version_is_strict_before_restore_mutation(self):
        service = self.config_directory / "strict-version.service"
        service.write_text("prior\n", encoding="utf-8")
        self.capture(service, service)
        service.write_text("deployed\n", encoding="utf-8")
        manifest = self.read_manifest()
        manifest["version"] = 1
        self.write_resealed_manifest(manifest)

        with self.assertRaisesRegex(MODULE.ManifestError, "version is unsupported"):
            self.restore(self.read_manifest()["manifestSha256"])
        self.assertEqual(service.read_text(encoding="utf-8"), "deployed\n")

    def test_repository_schema_tamper_and_missing_object_fail_before_file_restore(self):
        service = self.config_directory / "repository-schema.service"
        service.write_text("prior\n", encoding="utf-8")
        repository, prior_head = self.create_repository()
        captured = MODULE.capture_set(
            root=self.storage_root,
            run_id=self.run_id,
            host=self.host,
            paths=[service],
            repository=repository,
            expected_head=prior_head,
            filesystem_root=self.filesystem_root,
        )
        deployed_head = self.commit_deployed_repository(repository)
        service.write_text("deployed\n", encoding="utf-8")

        manifest = self.read_manifest()
        manifest["repository"]["unexpected"] = True
        self.write_resealed_manifest(manifest)
        with self.assertRaisesRegex(MODULE.ManifestError, "repository fields"):
            self.restore(self.read_manifest()["manifestSha256"])
        self.assertEqual(service.read_text(encoding="utf-8"), "deployed\n")
        self.assertEqual(self.git(repository, "rev-parse", "HEAD"), deployed_head)

        manifest = self.read_manifest()
        manifest["repository"] = {"path": str(repository), "head": "f" * 40}
        manifest.pop("manifestSha256")
        self.write_resealed_manifest(manifest)
        with self.assertRaisesRegex(MODULE.ManifestError, "commit object is unavailable"):
            self.restore(self.read_manifest()["manifestSha256"])
        self.assertEqual(service.read_text(encoding="utf-8"), "deployed\n")
        self.assertEqual(self.git(repository, "rev-parse", "HEAD"), deployed_head)
        self.assertNotEqual(captured["manifestSha256"], self.read_manifest()["manifestSha256"])

    def test_missing_repository_and_index_lock_fail_before_file_restore(self):
        for scenario in ("missing-repository", "index-lock"):
            with self.subTest(scenario=scenario):
                run_id = f"run-{scenario}"
                service = self.config_directory / f"{scenario}.service"
                service.write_text("prior\n", encoding="utf-8")
                repository = self.filesystem_root / "srv" / scenario
                repository.mkdir(parents=True)
                self.git(repository, "init", "--quiet")
                self.git(repository, "config", "user.name", "Rollback Test")
                self.git(repository, "config", "user.email", "rollback@example.invalid")
                (repository / "tracked.txt").write_text("prior\n", encoding="utf-8")
                self.git(repository, "add", "tracked.txt")
                self.git(repository, "commit", "--quiet", "-m", "prior")
                head = self.git(repository, "rev-parse", "HEAD")
                captured = MODULE.capture_set(
                    root=self.storage_root,
                    run_id=run_id,
                    host=self.host,
                    paths=[service],
                    repository=repository,
                    expected_head=head,
                    filesystem_root=self.filesystem_root,
                )
                service.write_text("deployed\n", encoding="utf-8")
                if scenario == "missing-repository":
                    repository.rename(repository.with_name(repository.name + "-moved"))
                    error = "real existing directory"
                else:
                    (repository / ".git" / "index.lock").write_text(
                        "locked\n", encoding="utf-8"
                    )
                    error = "index lock"

                with self.assertRaisesRegex(MODULE.ManifestError, error):
                    MODULE.restore(
                        root=self.storage_root,
                        run_id=run_id,
                        host=self.host,
                        expected_manifest_sha256=captured["manifestSha256"],
                        filesystem_root=self.filesystem_root,
                    )
                self.assertEqual(service.read_text(encoding="utf-8"), "deployed\n")

    def test_repository_head_is_verified_after_reset(self):
        service = self.config_directory / "repository-postflight.service"
        service.write_text("prior\n", encoding="utf-8")
        repository, prior_head = self.create_repository()
        captured = MODULE.capture_set(
            root=self.storage_root,
            run_id=self.run_id,
            host=self.host,
            paths=[service],
            repository=repository,
            expected_head=prior_head,
            filesystem_root=self.filesystem_root,
        )
        deployed_head = self.commit_deployed_repository(repository)
        service.write_text("deployed\n", encoding="utf-8")
        real_run_git = MODULE._run_git

        def skip_reset(path, arguments):
            if arguments and arguments[0] == "reset":
                return ""
            return real_run_git(path, arguments)

        with mock.patch.object(MODULE, "_run_git", skip_reset):
            with self.assertRaisesRegex(
                MODULE.ManifestError, "post-restore repository HEAD"
            ):
                self.restore(captured["manifestSha256"])
        self.assertEqual(self.git(repository, "rev-parse", "HEAD"), deployed_head)

    def test_ansible_marker_is_single_line_base64_json(self):
        service = self.config_directory / "marker.service"
        service.write_text("marker\n", encoding="utf-8")
        repository, prior_head = self.create_repository()
        completed = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "capture-set",
                "--root",
                str(self.storage_root),
                "--run-id",
                self.run_id,
                "--host",
                self.host,
                "--filesystem-root",
                str(self.filesystem_root),
                "--ansible-marker",
                "--path",
                str(service),
                "--repository",
                str(repository),
                "--expected-head",
                prior_head,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        prefix = "ROLLBACK_MANIFEST_RESULT:"
        self.assertTrue(completed.stdout.startswith(prefix))
        decoded = __import__("base64").urlsafe_b64decode(
            completed.stdout.removeprefix(prefix).strip()
        )
        result = json.loads(decoded)
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["destinations"], [str(service)])
        self.assertEqual(
            result["repository"], {"path": str(repository), "head": prior_head}
        )

    def test_cli_capture_and_restore(self):
        service = self.config_directory / "cli.service"
        service.write_text("cli-original\n", encoding="utf-8")
        common = [
            "--root",
            str(self.storage_root),
            "--run-id",
            self.run_id,
            "--host",
            self.host,
            "--filesystem-root",
            str(self.filesystem_root),
        ]
        captured = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "capture",
                *common,
                "--source",
                str(service),
                "--destination",
                str(service),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        captured_result = json.loads(captured.stdout)
        self.assertTrue(captured_result["captured"])
        self.assertRegex(captured_result["manifestSha256"], r"^[0-9a-f]{64}$")
        service.write_text("cli-deployed\n", encoding="utf-8")

        restored = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "restore",
                *common,
                "--expected-manifest-sha256",
                captured_result["manifestSha256"],
            ],
            check=True,
            capture_output=True,
            text=True,
        )

        self.assertEqual(json.loads(restored.stdout)["count"], 1)
        self.assertEqual(service.read_text(encoding="utf-8"), "cli-original\n")


if __name__ == "__main__":
    unittest.main()
