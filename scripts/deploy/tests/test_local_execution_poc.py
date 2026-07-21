"""Hermetic tests for the non-live StoneBase local Ansible PoC boundary."""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

from scripts.deploy.rolling_release.local_execution_poc import (
    MODE,
    PLAYBOOK_PATH,
    STONEBASE_HOST,
    CandidateBinding,
    LocalExecutionPocError,
    build_candidate_artifact,
    inspect_candidate_artifact,
    run_staged_candidate,
    stage_candidate_artifact,
)


class LocalExecutionPocTests(unittest.TestCase):
    def binding(self, **changes: object) -> CandidateBinding:
        values: dict[str, object] = {
            "run_id": "run-123",
            "candidate_sha": "a" * 40,
            "host": STONEBASE_HOST,
            "status_client_id": "raspi4-kensaku-stonebase01-kiosk1",
            "ansible_core_version": "2.19.4",
            "collection_versions": (("community.general", "11.4.1"),),
            "rollback_manifest_sha256": "b" * 64,
            "runtime_manifest_sha256": "c" * 64,
            "maintenance_state_sha256": "d" * 64,
        }
        values.update(changes)
        return CandidateBinding(**values)  # type: ignore[arg-type]

    def stage(self, directory: Path, binding: CandidateBinding) -> tuple[Path, str, Path]:
        artifact = build_candidate_artifact(directory / "candidate.zip", binding)
        inspect_candidate_artifact(artifact.path, artifact.sha256, binding)
        staged = stage_candidate_artifact(
            artifact.path, artifact.sha256, binding, directory / "stage"
        )
        return artifact.path, artifact.sha256, staged

    def test_valid_artifact_is_secret_free_and_runs_exact_local_command(self) -> None:
        binding = self.binding()
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            artifact_path, digest, staged = self.stage(directory, binding)
            with zipfile.ZipFile(artifact_path) as archive:
                self.assertEqual(set(archive.namelist()), {
                    "ansible.cfg", "inventory.yml", "manifest.json", PLAYBOOK_PATH
                })
                self.assertNotIn(b"secret", b"".join(archive.read(name).lower() for name in archive.namelist()))
                inventory = json.loads(archive.read("inventory.yml"))
                self.assertEqual(
                    set(inventory["all"]["children"]["stonebase_local"]["hosts"]),
                    {STONEBASE_HOST},
                )

            calls: list[tuple[tuple[str, ...], dict[str, object]]] = []

            def fake_run(command, **kwargs):
                calls.append((tuple(command), kwargs))
                return subprocess.CompletedProcess(command, 0, stdout="ignored", stderr="ignored")

            result = run_staged_candidate(
                staged,
                artifact_sha256=digest,
                binding=binding,
                observed_hostname=STONEBASE_HOST,
                observed_ansible_core_version="2.19.4",
                observed_collection_versions={"community.general": "11.4.1"},
                lock_directory=directory / "locks",
                run=fake_run,
            )

            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.artifact_sha256, digest)
            self.assertEqual(len(calls), 1)
            command, kwargs = calls[0]
            self.assertEqual(command[:4], ("ansible-playbook", "-c", "local", "-i"))
            self.assertEqual(command[-1], str(staged / PLAYBOOK_PATH))
            self.assertEqual(kwargs["cwd"], staged)
            self.assertEqual(kwargs["env"], {
                "ANSIBLE_CONFIG": str(staged / "ansible.cfg"),
                "LANG": "C",
                "LC_ALL": "C",
                "PATH": "/usr/bin:/bin",
            })
            self.assertNotIn("ignored", repr(result))

    def test_tampered_digest_and_extra_member_are_rejected_before_execution(self) -> None:
        binding = self.binding()
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            artifact_path, digest, _staged = self.stage(directory, binding)
            artifact_path.write_bytes(artifact_path.read_bytes() + b"tamper")
            with self.assertRaisesRegex(LocalExecutionPocError, "digest does not match"):
                inspect_candidate_artifact(artifact_path, digest, binding)

            artifact_path.unlink()
            artifact = build_candidate_artifact(artifact_path, binding)
            with zipfile.ZipFile(artifact_path, "a") as archive:
                archive.writestr("unexpected.yml", "not allowed")
            changed_digest = hashlib.sha256(artifact_path.read_bytes()).hexdigest()
            with self.assertRaisesRegex(LocalExecutionPocError, "member set"):
                inspect_candidate_artifact(artifact_path, changed_digest, binding)
            self.assertNotEqual(artifact.sha256, changed_digest)

    def test_identity_runtime_and_failed_execution_never_produce_success(self) -> None:
        binding = self.binding()
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            _artifact_path, digest, staged = self.stage(directory, binding)
            kwargs = {
                "artifact_sha256": digest,
                "binding": binding,
                "observed_hostname": STONEBASE_HOST,
                "observed_ansible_core_version": "2.19.4",
                "observed_collection_versions": {"community.general": "11.4.1"},
                "lock_directory": directory / "locks",
            }
            with self.assertRaisesRegex(LocalExecutionPocError, "identity"):
                run_staged_candidate(staged, **{**kwargs, "observed_hostname": "other-host"})
            with self.assertRaisesRegex(LocalExecutionPocError, "version"):
                run_staged_candidate(staged, **{**kwargs, "observed_ansible_core_version": "2.20.0"})
            with self.assertRaisesRegex(LocalExecutionPocError, "collections"):
                run_staged_candidate(
                    staged,
                    **{**kwargs, "observed_collection_versions": {"community.general": "11.4.2"}},
                )

            def failed_run(command, **_kwargs):
                return subprocess.CompletedProcess(command, 23, stdout="contains-secret", stderr="contains-secret")

            with self.assertRaisesRegex(LocalExecutionPocError, "status 23") as error:
                run_staged_candidate(staged, **kwargs, run=failed_run)
            self.assertNotIn("contains-secret", str(error.exception))

            def lost_response(*_args, **_kwargs):
                raise subprocess.TimeoutExpired("ansible-playbook", 60, output="secret", stderr="secret")

            with self.assertRaisesRegex(LocalExecutionPocError, "did not return") as error:
                run_staged_candidate(staged, **kwargs, run=lost_response)
            self.assertNotIn("secret", str(error.exception))

            (staged / PLAYBOOK_PATH).write_text("tampered", encoding="utf-8")
            with self.assertRaisesRegex(LocalExecutionPocError, "does not match its binding"):
                run_staged_candidate(staged, **kwargs)

    def test_concurrent_run_lock_is_rejected_without_starting_ansible(self) -> None:
        binding = self.binding()
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            _artifact_path, digest, staged = self.stage(directory, binding)
            lock_directory = directory / "locks"
            lock_directory.mkdir(mode=0o700)
            lock_path = lock_directory / f"{binding.run_id}-{binding.host}.lock"
            descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaisesRegex(LocalExecutionPocError, "already running"):
                    run_staged_candidate(
                        staged,
                        artifact_sha256=digest,
                        binding=binding,
                        observed_hostname=STONEBASE_HOST,
                        observed_ansible_core_version="2.19.4",
                        observed_collection_versions={"community.general": "11.4.1"},
                        lock_directory=lock_directory,
                        run=lambda *_args, **_kwargs: self.fail("Ansible must not start"),
                    )
            finally:
                os.close(descriptor)

    def test_mode_is_stonebase_only(self) -> None:
        self.assertEqual(MODE, "stonebase-local-ansible-poc")
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(LocalExecutionPocError, "limited to StoneBase"):
                build_candidate_artifact(
                    Path(temporary) / "candidate.zip", self.binding(host="raspi4-fjv60-80")
                )


if __name__ == "__main__":
    unittest.main()
