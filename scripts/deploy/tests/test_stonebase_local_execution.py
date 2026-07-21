"""Hermetic safety tests for the integrated StoneBase local executor."""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import fcntl
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


PROJECT = Path(__file__).resolve().parents[3]
DEPLOY_DIR = PROJECT / "scripts/deploy"
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))

from scripts.deploy.rolling_release import coordinator, local_execution  # noqa: E402
from scripts.deploy.rolling_release.local_execution import (  # noqa: E402
    LOCAL_EXECUTOR,
    SSH_EXECUTOR,
    STONEBASE_HOST,
    CandidateBinding,
    LocalExecutionError,
    build_candidate_artifact,
    inspect_candidate_artifact,
    select_executor,
)
from scripts.deploy.tests.test_fleet_coordinator_transitions import (  # noqa: E402
    NEW_SHA,
    OLD_SHA,
    FakeRuntime,
    FakeToken,
    args as coordinator_args,
    decision,
    host_record,
)


def _load_runner():
    path = DEPLOY_DIR / "stonebase-local-ansible-runner.py"
    spec = importlib.util.spec_from_file_location("stonebase_local_ansible_runner", path)
    if spec is None or spec.loader is None:  # pragma: no cover - import invariant
        raise RuntimeError("runner module cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


RUNNER = _load_runner()


def _bootstrap_observation(
    *,
    status: str = "current",
    phase: str = "complete",
    failure_code: str | None = None,
    cleanup: str = "complete",
    lock_sha256: str | None = "sha256:" + "d" * 64,
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "attemptId": "1" * 32,
        "status": status,
        "phase": phase,
        "failureCode": failure_code,
        "cleanup": cleanup,
        "runtimeVersion": local_execution.RUNTIME_VERSION,
        "lockSha256": lock_sha256,
        "observedAt": "2026-07-21T12:00:00Z",
    }


def _git(project: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["git", "-C", str(project), *arguments],
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def _write(project: Path, name: str, value: str) -> None:
    path = project / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8")


def _commit(project: Path, message: str) -> str:
    _git(project, "add", "--all")
    _git(project, "commit", "-q", "-m", message)
    return _git(project, "rev-parse", "HEAD")


class RepositoryFixture:
    def __init__(self, root: Path):
        self.project = root / "repo"
        self.project.mkdir()
        _git(self.project, "init", "-q")
        _git(self.project, "config", "user.email", "local-test@example.invalid")
        _git(self.project, "config", "user.name", "Local Test")
        for name in sorted(local_execution._PAYLOAD_EXACT):
            _write(self.project, name, "---\n# fixed local payload\n")
        _write(
            self.project,
            "infrastructure/ansible/roles/common/tasks/main.yml",
            "---\n# common role\n",
        )
        _write(self.project, "clients/nfc-agent/app.py", "print('old')\n")
        self.previous = _commit(self.project, "previous")
        _write(self.project, "clients/nfc-agent/app.py", "print('candidate')\n")
        self.candidate = _commit(self.project, "safe agent candidate")


class StoneBaseLocalExecutionTest(unittest.TestCase):
    def binding(self, fixture: RepositoryFixture, **changes: object) -> CandidateBinding:
        values: dict[str, object] = {
            "run_id": "run-local-123",
            "previous_sha": fixture.previous,
            "candidate_sha": fixture.candidate,
            "host": STONEBASE_HOST,
            "status_client_id": "raspi4-kensaku-stonebase01-kiosk1",
            "rollback_manifest_sha256": "a" * 64,
            "runtime_manifest_sha256": "b" * 64,
            "maintenance_state_sha256": "c" * 64,
        }
        values.update(changes)
        return CandidateBinding(**values)  # type: ignore[arg-type]

    @staticmethod
    def public_contract() -> dict[str, object]:
        return {
            "host": STONEBASE_HOST,
            "profile": "kiosk",
            "user": "pi",
            "repoPath": "/opt/RaspberryPiSystem_002",
            "nfcEnabled": True,
            "barcodeEnabled": True,
            "torqueEnabled": False,
            "servicesToRestart": [
                "status-agent.service",
                "status-agent.timer",
                "kiosk-browser.service",
            ],
        }

    @staticmethod
    def runner_preflight() -> dict[str, object]:
        return {
            "ready": True,
            "host": STONEBASE_HOST,
            "pythonVersion": local_execution.RUNTIME_PYTHON,
            "ansibleCoreVersion": "2.19.4",
            "collections": {"community.general": "11.4.1"},
            "freeBytes": local_execution.MIN_FREE_BYTES,
            "runnerVersion": local_execution.SCHEMA_VERSION,
            "configurationReady": True,
            "failureCode": "ready",
            "bootstrapObservation": _bootstrap_observation(),
        }

    @staticmethod
    def local_plan(terminal: dict[str, str]) -> dict[str, object]:
        work = {
            "host": terminal["host"],
            "role": "kiosk",
            "mutationRequired": True,
            "activationRequired": False,
            "verificationRequired": True,
            "activationStrategyId": "kiosk-web-activation-v1",
            "activationMode": None,
            "claimRequirements": [
                {
                    "kind": "controlPlaneWeb",
                    "expectedIdentity": OLD_SHA,
                    "status": "current",
                },
                {
                    "kind": "terminalRepository",
                    "expectedIdentity": NEW_SHA,
                    "status": "stale-or-unverified",
                },
            ],
        }
        return {
            "pi5Required": False,
            "activationExecutionEnabled": True,
            "verificationOnlyExecutionEnabled": True,
            "mutationTargets": [{"host": terminal["host"]}],
            "activationTargets": [],
            "verificationTargets": [{"host": terminal["host"]}],
            "terminalWork": [work],
            "hosts": [
                decision("pi5", "server", targeted=False),
                decision(terminal["host"], "kiosk"),
            ],
        }

    def test_safe_candidate_builds_incremental_secret_free_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = RepositoryFixture(root)
            binding = self.binding(fixture)
            selection = select_executor(
                requested_executor=LOCAL_EXECUTOR,
                project=fixture.project,
                previous_sha=fixture.previous,
                candidate_sha=fixture.candidate,
                host=STONEBASE_HOST,
                public_contract=self.public_contract(),
                runner_preflight=self.runner_preflight(),
            )
            self.assertEqual(selection.effective_executor, LOCAL_EXECUTOR)
            artifact = build_candidate_artifact(
                fixture.project,
                root / "candidate.zip",
                binding,
                self.public_contract(),
            )
            manifest = inspect_candidate_artifact(
                artifact.path, artifact.sha256, binding
            )
            self.assertEqual(manifest["previousSha"], fixture.previous)
            self.assertEqual(manifest["candidateSha"], fixture.candidate)
            self.assertEqual(manifest["unitName"], binding.unit_name)
            with zipfile.ZipFile(artifact.path) as archive:
                names = set(archive.namelist())
                self.assertIn("candidate.bundle", names)
                self.assertFalse(
                    any(
                        "group_vars" in name
                        or "host_vars" in name
                        or "vault" in name.lower()
                        or ".env" in name.lower()
                        for name in names
                    )
                )
                inventory = json.loads(archive.read("inventory.json"))
                host_vars = inventory["all"]["children"]["stonebase_local"][
                    "hosts"
                ][STONEBASE_HOST]
                self.assertNotIn("token", json.dumps(host_vars).lower())
                self.assertEqual(
                    host_vars["ansible_python_interpreter"],
                    "/opt/raspi-local-ansible-runtime/active/bin/python3",
                )
                bundle = root / "candidate.bundle"
                bundle.write_bytes(archive.read("candidate.bundle"))
            verified = subprocess.run(
                ["git", "-C", str(fixture.project), "bundle", "verify", str(bundle)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(verified.returncode, 0, verified.stderr)

    def test_history_secret_and_configuration_changes_fallback_before_maintenance(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = RepositoryFixture(Path(temporary))
            _write(
                fixture.project,
                "infrastructure/ansible/group_vars/all/vault.yml",
                "secret: changed\n",
            )
            _commit(fixture.project, "touch secret history")
            (fixture.project / "infrastructure/ansible/group_vars/all/vault.yml").unlink()
            secret_reverted = _commit(fixture.project, "remove secret again")
            selection = select_executor(
                requested_executor=LOCAL_EXECUTOR,
                project=fixture.project,
                previous_sha=fixture.previous,
                candidate_sha=secret_reverted,
                host=STONEBASE_HOST,
                public_contract=self.public_contract(),
                runner_preflight=self.runner_preflight(),
            )
            self.assertEqual(selection.effective_executor, SSH_EXECUTOR)
            self.assertEqual(
                selection.fallback_reason, "candidate-history-touches-secret-path"
            )
            self.assertEqual(selection.changed_paths, ())

            _write(
                fixture.project,
                "infrastructure/ansible/roles/client/tasks/main.yml",
                "---\n# configuration mutation\n",
            )
            configuration_candidate = _commit(fixture.project, "configuration")
            selection = select_executor(
                requested_executor=LOCAL_EXECUTOR,
                project=fixture.project,
                previous_sha=secret_reverted,
                candidate_sha=configuration_candidate,
                host=STONEBASE_HOST,
                public_contract=self.public_contract(),
                runner_preflight=self.runner_preflight(),
            )
            self.assertEqual(selection.effective_executor, SSH_EXECUTOR)
            self.assertEqual(
                selection.fallback_reason, "candidate-requires-ssh-configuration"
            )

    def test_runner_unavailable_falls_back_and_non_stonebase_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = RepositoryFixture(Path(temporary))
            default_selection = select_executor(
                requested_executor=SSH_EXECUTOR,
                project=fixture.project / "does-not-need-to-exist",
                previous_sha="not-read",
                candidate_sha="not-read",
                host="any-existing-terminal",
                public_contract=None,
                runner_preflight=None,
            )
            self.assertEqual(default_selection.effective_executor, SSH_EXECUTOR)
            self.assertIsNone(default_selection.fallback_reason)
            selection = select_executor(
                requested_executor=LOCAL_EXECUTOR,
                project=fixture.project,
                previous_sha=fixture.previous,
                candidate_sha=fixture.candidate,
                host=STONEBASE_HOST,
                public_contract=self.public_contract(),
                runner_preflight=None,
            )
            self.assertEqual(selection.effective_executor, SSH_EXECUTOR)
            self.assertIn("runner-ineligible", selection.fallback_reason or "")
            with self.assertRaisesRegex(LocalExecutionError, "non-StoneBase"):
                select_executor(
                    requested_executor=LOCAL_EXECUTOR,
                    project=fixture.project,
                    previous_sha=fixture.previous,
                    candidate_sha=fixture.candidate,
                    host="raspi4-fjv60-80",
                    public_contract=self.public_contract(),
                    runner_preflight=self.runner_preflight(),
                )

    def test_typed_runner_ineligibility_is_an_explicit_ssh_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = RepositoryFixture(Path(temporary))
            runner = self.runner_preflight()
            runner.update(
                {
                    "ready": False,
                    "pythonVersion": "",
                    "ansibleCoreVersion": "",
                    "collections": {},
                    "failureCode": "runtime-unavailable",
                }
            )
            selection = select_executor(
                requested_executor=LOCAL_EXECUTOR,
                project=fixture.project,
                previous_sha=fixture.previous,
                candidate_sha=fixture.candidate,
                host=STONEBASE_HOST,
                public_contract=self.public_contract(),
                runner_preflight=runner,
            )

        self.assertEqual(selection.effective_executor, SSH_EXECUTOR)
        self.assertEqual(
            selection.fallback_reason,
            "runner-ineligible: local runner preflight reports runtime-unavailable",
        )

    def test_extra_member_symlink_and_secret_inventory_key_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = RepositoryFixture(root)
            binding = self.binding(fixture)
            artifact = build_candidate_artifact(
                fixture.project,
                root / "candidate.zip",
                binding,
                self.public_contract(),
            )
            with zipfile.ZipFile(artifact.path, "a") as archive:
                info = zipfile.ZipInfo("unexpected.txt")
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                archive.writestr(info, b"unexpected")
            changed_digest = hashlib.sha256(artifact.path.read_bytes()).hexdigest()
            with self.assertRaisesRegex(LocalExecutionError, "unexpected member"):
                inspect_candidate_artifact(artifact.path, changed_digest, binding)

            symlink_artifact = root / "symlink.zip"
            with zipfile.ZipFile(symlink_artifact, "w") as archive:
                info = zipfile.ZipInfo("binding-manifest.json")
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(info, b"inventory.json")
            symlink_digest = hashlib.sha256(symlink_artifact.read_bytes()).hexdigest()
            with self.assertRaisesRegex(LocalExecutionError, "member is unsafe"):
                inspect_candidate_artifact(symlink_artifact, symlink_digest, binding)

            clean = build_candidate_artifact(
                fixture.project,
                root / "clean.zip",
                binding,
                self.public_contract(),
            )
            with self.assertRaisesRegex(LocalExecutionError, "digest or file"):
                inspect_candidate_artifact(clean.path, "0" * 64, binding)
            mismatched_binding = self.binding(
                fixture, candidate_sha=fixture.previous
            )
            with self.assertRaisesRegex(LocalExecutionError, "binding"):
                inspect_candidate_artifact(
                    clean.path, clean.sha256, mismatched_binding
                )
            with patch.object(local_execution, "MAX_ARTIFACT_BYTES", 1):
                with self.assertRaisesRegex(LocalExecutionError, "digest or file"):
                    inspect_candidate_artifact(clean.path, clean.sha256, binding)
            with zipfile.ZipFile(clean.path) as archive:
                members = {
                    info.filename: archive.read(info)
                    for info in archive.infolist()
                    if info.filename != "binding-manifest.json"
                }
            runtime_members = dict(members)
            runtime_lock = json.loads(runtime_members["runtime-lock.json"])
            runtime_lock["ansibleCore"] = "2.18.0"
            runtime_members["runtime-lock.json"] = local_execution.canonical_json(
                runtime_lock
            )
            runtime_manifest = local_execution._manifest(binding, runtime_members)
            runtime_poisoned = root / "runtime-poisoned.zip"
            with zipfile.ZipFile(runtime_poisoned, "w") as archive:
                for name, value in sorted(
                    {
                        **runtime_members,
                        "binding-manifest.json": local_execution.canonical_json(
                            runtime_manifest
                        ),
                    }.items()
                ):
                    info = zipfile.ZipInfo(name)
                    info.external_attr = (stat.S_IFREG | 0o600) << 16
                    archive.writestr(info, value)
            runtime_digest = hashlib.sha256(runtime_poisoned.read_bytes()).hexdigest()
            with self.assertRaisesRegex(LocalExecutionError, "runtime lock"):
                inspect_candidate_artifact(runtime_poisoned, runtime_digest, binding)

            inventory = json.loads(members["inventory.json"])
            inventory["all"]["children"]["stonebase_local"]["hosts"][
                STONEBASE_HOST
            ]["apiToken"] = "must-not-enter-artifact"
            members["inventory.json"] = local_execution.canonical_json(inventory)
            manifest = local_execution._manifest(binding, members)
            poisoned = root / "poisoned.zip"
            with zipfile.ZipFile(poisoned, "w") as archive:
                for name, value in sorted(
                    {**members, "binding-manifest.json": local_execution.canonical_json(manifest)}.items()
                ):
                    info = zipfile.ZipInfo(name)
                    info.external_attr = (stat.S_IFREG | 0o600) << 16
                    archive.writestr(info, value)
            poisoned_digest = hashlib.sha256(poisoned.read_bytes()).hexdigest()
            with self.assertRaisesRegex(LocalExecutionError, "fixed schema"):
                inspect_candidate_artifact(poisoned, poisoned_digest, binding)

    def test_runner_uses_exact_command_and_persists_only_bounded_result(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "runner-state"
            fixture = RepositoryFixture(Path(temporary))
            binding = self.binding(fixture)
            destination = root / "artifacts" / f"{binding.run_id}.zip"
            artifact = build_candidate_artifact(
                fixture.project, destination, binding, self.public_contract()
            )
            runtime = Path(temporary) / "runtime"
            calls: list[tuple[list[str], dict[str, object]]] = []

            def fake_run(command, **kwargs):
                calls.append((list(command), kwargs))
                return subprocess.CompletedProcess(command, 0, stdout="secret", stderr="secret")

            observation = {
                "pythonVersion": local_execution.RUNTIME_PYTHON,
                "ansibleCoreVersion": "2.19.4",
                "collections": {"community.general": "11.4.1"},
            }
            with (
                patch.object(RUNNER.os, "geteuid", return_value=0),
                patch.object(
                    RUNNER,
                    "_configured_status_client_id",
                    return_value=binding.status_client_id,
                ),
                patch.object(RUNNER, "_runtime_observation", return_value=observation),
            ):
                result = RUNNER.execute_candidate(
                    artifact.path,
                    artifact.sha256,
                    root=root,
                    runtime=runtime,
                    run=fake_run,
                    now=iter(["2026-07-21T00:00:00Z", "2026-07-21T00:00:01Z"]).__next__,
                )
            self.assertEqual(result["state"], "success")
            self.assertEqual(len(calls), 2)
            command, options = calls[1]
            stage = root / "staging" / binding.run_id
            self.assertEqual(
                command,
                [
                    str(runtime / "bin/ansible-playbook"),
                    "-c",
                    "local",
                    "-i",
                    str(stage / "inventory.json"),
                    str(stage / RUNNER.LOCAL_PLAYBOOK_MEMBER),
                ],
            )
            self.assertIs(options["stdin"], subprocess.DEVNULL)
            self.assertIs(options["stdout"], subprocess.DEVNULL)
            self.assertIs(options["stderr"], subprocess.DEVNULL)
            self.assertEqual(options["env"]["LANG"], "C.UTF-8")
            self.assertEqual(options["env"]["LC_ALL"], "C.UTF-8")
            self.assertEqual(
                options["env"]["ANSIBLE_CONFIG"], str(stage / "ansible.cfg")
            )
            persisted = json.loads(
                (root / "results" / f"{binding.run_id}.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(set(persisted), {
                "schemaVersion", "runId", "host", "candidateSha",
                "artifactSha256", "unitName", "state", "startedAt",
                "completedAt", "returnCode",
            })
            self.assertNotIn("secret", json.dumps(persisted))
            ready_calls: list[tuple[list[str], dict[str, object]]] = []

            def ready_run(command, **kwargs):
                ready_calls.append((list(command), kwargs))
                return subprocess.CompletedProcess(command, 0)

            with (
                patch.object(RUNNER.os, "geteuid", return_value=0),
                patch.object(
                    RUNNER,
                    "_configured_status_client_id",
                    return_value=binding.status_client_id,
                ),
            ):
                ready = RUNNER.acknowledge_ready(
                    RUNNER.CandidateBinding(**binding.__dict__),
                    artifact.sha256,
                    "1" * 32,
                    root=root,
                    run=ready_run,
                )
            self.assertTrue(ready["acknowledged"])
            self.assertEqual(ready["candidateSha"], binding.candidate_sha)
            self.assertEqual(len(ready_calls), 1)
            ready_command, ready_options = ready_calls[0]
            self.assertEqual(ready_command[0], str(RUNNER.READY_PROBE))
            self.assertIn(binding.candidate_sha, ready_command)
            self.assertIs(ready_options["stdout"], subprocess.DEVNULL)
            self.assertIs(ready_options["stderr"], subprocess.DEVNULL)

    def test_runner_preflight_requires_existing_identity_environments_and_runtime(self) -> None:
        observation = {
            "pythonVersion": local_execution.RUNTIME_PYTHON,
            "ansibleCoreVersion": "2.19.4",
            "collections": {"community.general": "11.4.1"},
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "runner-state"
            with (
                patch.object(RUNNER.os, "geteuid", return_value=0),
                patch.object(
                    RUNNER,
                    "_configured_status_client_id",
                    return_value="raspi4-kensaku-stonebase01-kiosk1",
                ),
                patch.object(RUNNER, "_require_existing_agent_environments") as environments,
                patch.object(RUNNER, "_runtime_observation", return_value=observation),
                patch.object(
                    RUNNER,
                    "_runtime_bootstrap_observation",
                    return_value=(_bootstrap_observation(), True),
                ),
                patch.object(RUNNER.shutil, "disk_usage") as disk_usage,
            ):
                disk_usage.return_value.free = local_execution.MIN_FREE_BYTES
                result = RUNNER.preflight(
                    "pi",
                    "raspi4-kensaku-stonebase01-kiosk1",
                    ["nfc-agent", "barcode-agent"],
                    root=root,
                )
            environments.assert_called_once_with(
                "pi", ["nfc-agent", "barcode-agent"]
            )
            self.assertTrue(result["configurationReady"])
            self.assertTrue(result["ready"])
            self.assertEqual(result["failureCode"], "ready")
            self.assertEqual(result["freeBytes"], local_execution.MIN_FREE_BYTES)

    def test_runner_preflight_reports_incomplete_runtime_without_leaking_details(self) -> None:
        with (
            patch.object(RUNNER.os, "geteuid", return_value=0),
            patch.object(
                RUNNER,
                "_configured_status_client_id",
                return_value="raspi4-kensaku-stonebase01-kiosk1",
            ),
            patch.object(RUNNER, "_require_existing_agent_environments"),
            patch.object(
                RUNNER,
                "_runtime_observation",
                side_effect=RUNNER.LocalExecutionError("must not be disclosed"),
            ),
            patch.object(
                RUNNER,
                "_runtime_bootstrap_observation",
                return_value=(
                    _bootstrap_observation(
                        status="failed",
                        phase="python-packages",
                        failure_code="python-packages-failed",
                        lock_sha256="sha256:" + "e" * 64,
                    ),
                    False,
                ),
            ),
            patch.object(RUNNER.shutil, "disk_usage") as disk_usage,
        ):
            disk_usage.return_value.free = local_execution.MIN_FREE_BYTES
            result = RUNNER.preflight(
                "pi",
                "raspi4-kensaku-stonebase01-kiosk1",
                ["nfc-agent"],
            )

        self.assertEqual(
            set(result),
            {
                "ready", "host", "pythonVersion", "ansibleCoreVersion",
                "collections", "freeBytes", "runnerVersion",
                "configurationReady", "failureCode", "bootstrapObservation",
            },
        )
        self.assertFalse(result["ready"])
        self.assertTrue(result["configurationReady"])
        self.assertEqual(result["failureCode"], "runtime-unavailable")
        self.assertEqual(
            result["bootstrapObservation"]["failureCode"],
            "python-packages-failed",
        )
        self.assertNotIn("must not be disclosed", json.dumps(result))

    def test_runner_runtime_observation_preserves_exact_python_patch(self) -> None:
        environments: list[dict[str, str]] = []

        def fake_run(command, **_kwargs):
            environments.append(_kwargs["env"])
            executable = Path(command[0]).name
            if executable == "python3":
                return subprocess.CompletedProcess(
                    command, 0, stdout="Python 3.11.15\n", stderr=""
                )
            if executable == "ansible":
                return subprocess.CompletedProcess(
                    command, 0, stdout="ansible [core 2.19.4]\n", stderr=""
                )
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=json.dumps(
                    {
                        "/runtime/collections": {
                            "community.general": {"version": "11.4.1"}
                        }
                    }
                ),
                stderr="",
            )

        result = RUNNER._runtime_observation(
            runtime=Path("/runtime"), run=fake_run
        )

        self.assertEqual(result["pythonVersion"], "3.11.15")
        self.assertEqual(len(environments), 3)
        for environment in environments:
            self.assertEqual(environment["LANG"], "C.UTF-8")
            self.assertEqual(environment["LC_ALL"], "C.UTF-8")
            self.assertEqual(environment["PYTHONNOUSERSITE"], "1")
            self.assertEqual(
                environment["ANSIBLE_COLLECTIONS_PATH"],
                "/runtime/collections",
            )

    def test_runner_preserves_failed_bootstrap_and_binds_success_to_lock(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            observation_path = root / "bootstrap.json"
            lock_path = root / "runtime-lock.json"
            lock_path.write_text('{"schemaVersion":2}\n', encoding="utf-8")
            real_lstat = os.lstat

            def metadata(path):
                real = real_lstat(path)
                return SimpleNamespace(
                    st_mode=real.st_mode,
                    st_uid=0,
                    st_size=real.st_size,
                )

            failed = _bootstrap_observation(
                status="failed",
                phase="python-packages",
                failure_code="python-packages-failed",
                lock_sha256="sha256:" + "e" * 64,
            )
            observation_path.write_text(json.dumps(failed), encoding="utf-8")
            with patch.object(RUNNER.os, "lstat", side_effect=metadata):
                observed, ready = RUNNER._runtime_bootstrap_observation(
                    observation_path, lock_path
                )
            self.assertEqual(observed, failed)
            self.assertFalse(ready)

            success = _bootstrap_observation(
                lock_sha256="sha256:"
                + hashlib.sha256(lock_path.read_bytes()).hexdigest()
            )
            observation_path.write_text(json.dumps(success), encoding="utf-8")
            with patch.object(RUNNER.os, "lstat", side_effect=metadata):
                observed, ready = RUNNER._runtime_bootstrap_observation(
                    observation_path, lock_path
                )
            self.assertEqual(observed, success)
            self.assertTrue(ready)

            success["lockSha256"] = "sha256:" + "f" * 64
            observation_path.write_text(json.dumps(success), encoding="utf-8")
            with patch.object(RUNNER.os, "lstat", side_effect=metadata):
                _observed, ready = RUNNER._runtime_bootstrap_observation(
                    observation_path, lock_path
                )
            self.assertFalse(ready)

    def test_runner_rejects_tampered_staging_and_bounds_failure_results(self) -> None:
        observation = {
            "pythonVersion": local_execution.RUNTIME_PYTHON,
            "ansibleCoreVersion": "2.19.4",
            "collections": {"community.general": "11.4.1"},
        }
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            fixture = RepositoryFixture(base)
            binding = self.binding(fixture, run_id="run-tampered-stage")
            root = base / "tampered-state"
            artifact = build_candidate_artifact(
                fixture.project,
                root / "artifacts" / f"{binding.run_id}.zip",
                binding,
                self.public_contract(),
            )
            original_extract = RUNNER._extract_verified

            def tamper_after_extract(source, stage):
                original_extract(source, stage)
                (stage / "inventory.json").write_bytes(b"{}\n")

            calls: list[list[str]] = []

            def maintenance_only(command, **_kwargs):
                calls.append(list(command))
                return subprocess.CompletedProcess(command, 0)

            with (
                patch.object(RUNNER.os, "geteuid", return_value=0),
                patch.object(
                    RUNNER,
                    "_configured_status_client_id",
                    return_value=binding.status_client_id,
                ),
                patch.object(RUNNER, "_runtime_observation", return_value=observation),
                patch.object(RUNNER, "_extract_verified", side_effect=tamper_after_extract),
            ):
                with self.assertRaisesRegex(
                    RUNNER.LocalExecutionError, "staging member digest"
                ):
                    RUNNER.execute_candidate(
                        artifact.path,
                        artifact.sha256,
                        root=root,
                        runtime=base / "runtime",
                        run=maintenance_only,
                    )
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][0], str(RUNNER.MAINTENANCE_PROBE))

            for name, expected_state, expected_code in (
                ("nonzero", "failed", 17),
                ("timeout", "timeout", 124),
            ):
                with self.subTest(name=name):
                    run_binding = self.binding(fixture, run_id=f"run-{name}-result")
                    run_root = base / f"state-{name}"
                    run_artifact = build_candidate_artifact(
                        fixture.project,
                        run_root / "artifacts" / f"{run_binding.run_id}.zip",
                        run_binding,
                        self.public_contract(),
                    )

                    def failed_run(command, **_kwargs):
                        if command[0] == str(RUNNER.MAINTENANCE_PROBE):
                            return subprocess.CompletedProcess(command, 0)
                        if name == "timeout":
                            raise subprocess.TimeoutExpired(command, 900)
                        return subprocess.CompletedProcess(command, 17)

                    with (
                        patch.object(RUNNER.os, "geteuid", return_value=0),
                        patch.object(
                            RUNNER,
                            "_configured_status_client_id",
                            return_value=run_binding.status_client_id,
                        ),
                        patch.object(
                            RUNNER, "_runtime_observation", return_value=observation
                        ),
                    ):
                        result = RUNNER.execute_candidate(
                            run_artifact.path,
                            run_artifact.sha256,
                            root=run_root,
                            runtime=base / "runtime",
                            run=failed_run,
                            now=iter(
                                ["2026-07-21T00:00:00Z", "2026-07-21T00:00:01Z"]
                            ).__next__,
                        )
                    self.assertEqual(result["state"], expected_state)
                    self.assertEqual(result["returnCode"], expected_code)
                    result_path = run_root / "results" / f"{run_binding.run_id}.json"
                    result_path.write_text("{}\n", encoding="utf-8")

                    def stopped_unit(command, **_kwargs):
                        return subprocess.CompletedProcess(
                            command,
                            0,
                            stdout=(
                                "LoadState=loaded\nActiveState=failed\nSubState=failed\n"
                                "Result=exit-code\nExecMainStatus=1\n"
                            ),
                            stderr="",
                        )

                    reconciled = RUNNER.reconcile(
                        RUNNER.CandidateBinding(**run_binding.__dict__),
                        run_artifact.sha256,
                        root=run_root,
                        run=stopped_unit,
                    )
                    self.assertTrue(reconciled["quiesced"])
                    self.assertIsNone(reconciled["result"])

    def test_local_result_rejects_unbounded_or_reversed_timestamps(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fixture = RepositoryFixture(Path(temporary))
            binding = self.binding(fixture)
            result = {
                "schemaVersion": local_execution.SCHEMA_VERSION,
                "runId": binding.run_id,
                "host": binding.host,
                "candidateSha": binding.candidate_sha,
                "artifactSha256": "e" * 64,
                "unitName": binding.unit_name,
                "state": "success",
                "startedAt": "2026-07-21T00:00:00Z",
                "completedAt": "2026-07-21T00:00:01Z",
                "returnCode": 0,
            }
            validated = local_execution.validate_local_result(
                result,
                binding=binding,
                artifact_sha256="e" * 64,
            )
            self.assertEqual(validated, result)
            for started, completed in (
                ("x" * 1000, "2026-07-21T00:00:01Z"),
                ("2026-07-21T00:00:02Z", "2026-07-21T00:00:01Z"),
            ):
                with self.subTest(started=started[:24], completed=completed):
                    changed = {**result, "startedAt": started, "completedAt": completed}
                    with self.assertRaisesRegex(
                        LocalExecutionError,
                        "does not match the candidate binding",
                    ):
                        local_execution.validate_local_result(
                            changed,
                            binding=binding,
                            artifact_sha256="e" * 64,
                        )

    def test_receive_rejects_second_or_overlong_candidate_transfer(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            fixture = RepositoryFixture(base)
            binding = self.binding(fixture)
            runner_binding = RUNNER.CandidateBinding(**binding.__dict__)
            controller_artifact = build_candidate_artifact(
                fixture.project,
                base / "controller.zip",
                binding,
                self.public_contract(),
            )
            payload = controller_artifact.path.read_bytes()
            root = base / "runner-state"
            with (
                patch.object(RUNNER.os, "geteuid", return_value=0),
                patch.object(
                    RUNNER,
                    "_configured_status_client_id",
                    return_value=runner_binding.status_client_id,
                ),
            ):
                with self.assertRaisesRegex(RUNNER.LocalExecutionError, "exceeded"):
                    RUNNER.receive_and_submit(
                        runner_binding,
                        artifact_sha256=controller_artifact.sha256,
                        artifact_size=len(payload),
                        stream=io.BytesIO(payload + b"second-transfer"),
                        root=root,
                        run=lambda *_args, **_kwargs: self.fail("unit must not start"),
                    )
                submitted: list[list[str]] = []

                def submit_unit(command, **_kwargs):
                    submitted.append(list(command))
                    return subprocess.CompletedProcess(command, 0)

                accepted = RUNNER.receive_and_submit(
                    runner_binding,
                    artifact_sha256=controller_artifact.sha256,
                    artifact_size=len(payload),
                    stream=io.BytesIO(payload),
                    root=root,
                    run=submit_unit,
                )
                self.assertEqual(accepted["submission"], "accepted")
                self.assertEqual(len(submitted), 1)
                receipt = root / "receipts" / f"{binding.run_id}.json"
                self.assertTrue(receipt.is_file())
                with self.assertRaisesRegex(
                    RUNNER.LocalExecutionError, "already been received"
                ):
                    RUNNER.receive_and_submit(
                        runner_binding,
                        artifact_sha256=controller_artifact.sha256,
                        artifact_size=len(payload),
                        stream=io.BytesIO(payload),
                        root=root,
                        run=lambda *_args, **_kwargs: self.fail(
                            "replayed unit must not start"
                        ),
                    )

    def test_runner_rejects_a_sealed_candidate_when_status_identity_differs(self) -> None:
        binding = RUNNER.CandidateBinding(
            run_id="run-status-identity",
            previous_sha="a" * 40,
            candidate_sha="b" * 40,
            host=STONEBASE_HOST,
            status_client_id="raspi4-kensaku-stonebase01-kiosk1",
            rollback_manifest_sha256="c" * 64,
            runtime_manifest_sha256="d" * 64,
            maintenance_state_sha256="e" * 64,
        )
        with (
            patch.object(RUNNER.os, "geteuid", return_value=0),
            patch.object(
                RUNNER,
                "_configured_status_client_id",
                return_value="another-terminal-client",
            ),
        ):
            with self.assertRaisesRegex(
                RUNNER.LocalExecutionError, "status configuration identity"
            ):
                RUNNER.receive_and_submit(
                    binding,
                    artifact_sha256="f" * 64,
                    artifact_size=1,
                    stream=io.BytesIO(b"x"),
                    run=lambda *_args, **_kwargs: self.fail("must not submit"),
                )

    def test_missing_unit_is_quiesced_only_after_receiver_lock_is_free(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            fixture = RepositoryFixture(base)
            binding = self.binding(fixture)
            root = base / "runner-state"
            (root / "locks").mkdir(parents=True)

            def missing_unit(command, **_kwargs):
                return subprocess.CompletedProcess(
                    command,
                    1,
                    stdout=(
                        "LoadState=not-found\nActiveState=inactive\n"
                        "SubState=dead\nResult=success\nExecMainStatus=0\n"
                    ),
                    stderr="",
                )

            reconciled = RUNNER.reconcile(
                binding,
                "e" * 64,
                root=root,
                run=missing_unit,
            )
            self.assertEqual(reconciled["state"], "not-submitted")
            self.assertTrue(reconciled["quiesced"])

            lock_path = root / "locks" / f"{binding.run_id}.submission.lock"
            descriptor = os.open(lock_path, os.O_RDWR)
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                reconciled = RUNNER.reconcile(
                    binding,
                    "e" * 64,
                    root=root,
                    run=missing_unit,
                )
            finally:
                os.close(descriptor)
            self.assertEqual(reconciled["state"], "unknown")
            self.assertFalse(reconciled["quiesced"])

    def test_response_loss_reconciles_before_rollback_authority(self) -> None:
        terminal = {
            "host": STONEBASE_HOST,
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "raspi4-kensaku-stonebase01-kiosk1",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                STONEBASE_HOST: host_record("kiosk", OLD_SHA),
            },
            hosts=[
                {"host": "pi5", "role": "server"},
                terminal,
                {
                    "host": "raspi4-fjv60-80",
                    "role": "kiosk",
                    "terminalType": "kiosk",
                    "clientId": "raspi4-fjv60-80-kiosk1",
                },
            ],
            plan=self.local_plan(terminal),
            targets=[terminal],
        )

        def selection(*_args, **_kwargs):
            runtime.events.append("local:selection")
            return {
                "requestedExecutor": LOCAL_EXECUTOR,
                "effectiveExecutor": LOCAL_EXECUTOR,
                "fallbackReason": None,
                "changedPaths": ["clients/nfc-agent/app.py"],
                "publicContract": self.public_contract(),
                "runnerPreflight": self.runner_preflight(),
            }

        def prepare(_inventory, _target_spec, _target, run_id, maintenance_digest):
            runtime.events.append("local:artifact-seal")
            return {
                "schemaVersion": 2,
                "runId": run_id,
                "artifactPath": f"/sealed/{run_id}/candidate.zip",
                "artifactSha256": "e" * 64,
                "payloadSha256": "f" * 64,
                "artifactSize": 1024,
                "previousSha": OLD_SHA,
                "candidateSha": NEW_SHA,
                "rollbackManifestSha256": "c" * 64,
                "runtimeManifestSha256": "d" * 64,
                "maintenanceStateSha256": maintenance_digest,
                "unitName": "raspi-local-ansible-run-1.service",
            }

        def submit(*_args, **_kwargs):
            runtime.events.append("local:single-transfer-response-lost")
            raise RuntimeError("receiver response lost")

        def reconcile(*_args, **_kwargs):
            runtime.events.append("local:reconcile-unknown")
            return {
                "state": "unknown",
                "unitName": "raspi-local-ansible-run-1.service",
                "quiesced": False,
                "result": None,
            }

        runtime.select_terminal_executor = selection
        runtime.selected_hosts = lambda _inventory, _limit: [
            "pi5",
            STONEBASE_HOST,
        ]
        runtime.release_hosts = lambda _inventory, selected=None: [
            host
            for host in runtime.hosts
            if selected is None or host["host"] in set(selected)
        ]
        runtime.maintenance_ack_authority_sha256 = lambda *_args: "9" * 64
        runtime.prepare_local_terminal_candidate = prepare
        runtime.submit_local_terminal_candidate = submit
        runtime.reconcile_local_terminal_candidate = reconcile
        runtime.prove_local_terminal_ready = lambda *_args: self.fail(
            "ready proof must not run"
        )
        runtime.cleanup_local_terminal_candidate = lambda *_args: self.fail(
            "cleanup must wait for quiescence"
        )

        with self.assertRaisesRegex(RuntimeError, "rollback deferred"):
            coordinator.execute(
                coordinator_args(
                    limit="raspberrypi5:raspi4-kensaku-stonebase01",
                    stonebase_local_ansible_poc=True,
                ),
                runtime=runtime,
                token=FakeToken(runtime.events),
            )
        self.assertLess(
            runtime.events.index("local:single-transfer-response-lost"),
            runtime.events.index("local:reconcile-unknown"),
        )
        self.assertFalse(any(event == f"rollback:{STONEBASE_HOST}" for event in runtime.events))
        target = runtime.states[-1].target(STONEBASE_HOST)
        self.assertEqual(target["evidence"], "unknown")
        self.assertEqual(target["recoveryRequired"], "local-unit-quiescence")
        self.assertEqual(target["submissionState"], "uncertain")
        self.assertFalse(
            any("raspi4-fjv60-80" in event for event in runtime.events),
            runtime.events,
        )

    def test_abandoned_out_of_scope_terminal_blocks_without_contact(self) -> None:
        terminal = {
            "host": STONEBASE_HOST,
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "raspi4-kensaku-stonebase01-kiosk1",
        }
        fjv = host_record("kiosk", OLD_SHA)
        fjv["lastRunId"] = "abandoned-run"
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                STONEBASE_HOST: host_record("kiosk", OLD_SHA),
                "raspi4-fjv60-80": fjv,
            },
            hosts=[
                {"host": "pi5", "role": "server"},
                terminal,
                {
                    "host": "raspi4-fjv60-80",
                    "role": "kiosk",
                    "terminalType": "kiosk",
                    "clientId": "raspi4-fjv60-80-kiosk1",
                },
            ],
            plan=self.local_plan(terminal),
            targets=[terminal],
        )
        runtime.abandoned_run_id = "abandoned-run"
        runtime.selected_hosts = lambda _inventory, _limit: [
            "pi5",
            STONEBASE_HOST,
        ]
        runtime.release_hosts = lambda _inventory, selected=None: [
            host
            for host in runtime.hosts
            if selected is None or host["host"] in set(selected)
        ]

        with self.assertRaisesRegex(RuntimeError, "outside Pi5 \\+ StoneBase"):
            coordinator.execute(
                coordinator_args(
                    limit="raspberrypi5:raspi4-kensaku-stonebase01",
                    stonebase_local_ansible_poc=True,
                ),
                runtime=runtime,
                token=FakeToken(runtime.events),
            )
        self.assertFalse(
            any(
                "raspi4-fjv60-80" in event
                for event in runtime.events
                if not event.startswith("legacy:save:")
            ),
            runtime.events,
        )
        self.assertEqual(runtime.states[-1].payload["state"], "failed")
        self.assertEqual(runtime.states[-1].payload["phase"], "completed")
        self.assertEqual(
            runtime.states[-1].payload["outsideRecoveryHosts"],
            ["raspi4-fjv60-80"],
        )

    def test_success_order_persists_acceptance_before_wait_and_clears_last(self) -> None:
        terminal = {
            "host": STONEBASE_HOST,
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "raspi4-kensaku-stonebase01-kiosk1",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                STONEBASE_HOST: host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan=self.local_plan(terminal),
            targets=[terminal],
        )
        runtime.selected_hosts = lambda _inventory, _limit: ["pi5", STONEBASE_HOST]
        runtime.release_hosts = lambda _inventory, selected=None: [
            host
            for host in runtime.hosts
            if selected is None or host["host"] in set(selected)
        ]
        runtime.select_terminal_executor = lambda *_args, **_kwargs: {
            "requestedExecutor": LOCAL_EXECUTOR,
            "effectiveExecutor": LOCAL_EXECUTOR,
            "fallbackReason": None,
            "changedPaths": ["clients/nfc-agent/app.py"],
            "publicContract": self.public_contract(),
            "runnerPreflight": self.runner_preflight(),
        }

        def maintenance_authority(*_args):
            runtime.events.append("local:maintenance-authority")
            return "9" * 64

        def prepare(_inventory, _target_spec, _target, run_id, authority):
            runtime.events.append("local:artifact-seal")
            return {
                "schemaVersion": 2,
                "runId": run_id,
                "artifactPath": f"/sealed/{run_id}/candidate.zip",
                "artifactSha256": "e" * 64,
                "payloadSha256": "f" * 64,
                "artifactSize": 1024,
                "previousSha": OLD_SHA,
                "candidateSha": NEW_SHA,
                "rollbackManifestSha256": "c" * 64,
                "runtimeManifestSha256": "d" * 64,
                "maintenanceStateSha256": authority,
                "unitName": "raspi-local-ansible-run-1.service",
            }

        def submit(_inventory, _target_spec, target, *_args):
            self.assertEqual(target["submissionState"], "pending")
            runtime.events.append("local:single-transfer")
            return {
                "submission": "accepted",
                "runId": "run-1",
                "artifactSha256": "e" * 64,
                "unitName": "raspi-local-ansible-run-1.service",
            }

        def await_completion(_inventory, _target_spec, target):
            self.assertEqual(target["submissionState"], "accepted")
            runtime.events.append("local:unit-success")
            runtime.deployed_sha[STONEBASE_HOST] = NEW_SHA
            return {"state": "success", "returnCode": 0}

        def prove_ready(_inventory, _target_spec, _run_id, sha, *_args):
            self.assertEqual(sha, NEW_SHA)
            runtime.events.append("local:candidate-ready")

        def cleanup(_inventory, _target_spec, target):
            self.assertEqual(target["evidence"], "unknown")
            runtime.events.append("local:residue-cleanup")
            return {
                "cleaned": True,
                "runId": "run-1",
                "unitName": "raspi-local-ansible-run-1.service",
            }

        runtime.maintenance_ack_authority_sha256 = maintenance_authority
        runtime.prepare_local_terminal_candidate = prepare
        runtime.submit_local_terminal_candidate = submit
        runtime.await_local_terminal_candidate = await_completion
        runtime.prove_local_terminal_ready = prove_ready
        runtime.cleanup_local_terminal_candidate = cleanup
        runtime.reconcile_local_terminal_candidate = lambda *_args: {
            "state": "stopped",
            "unitName": "raspi-local-ansible-run-1.service",
            "quiesced": True,
            "result": {"state": "success"},
        }

        result = coordinator.execute(
            coordinator_args(
                limit="raspberrypi5:raspi4-kensaku-stonebase01",
                stonebase_local_ansible_poc=True,
            ),
            runtime=runtime,
            token=FakeToken(runtime.events),
        )
        self.assertEqual(result, 0)
        ordered = [
            f"manifest:capture:{STONEBASE_HOST}:{OLD_SHA}",
            "local:maintenance-authority",
            "local:artifact-seal",
            "local:single-transfer",
            "local:unit-success",
            "local:candidate-ready",
            f"observe:terminal:{STONEBASE_HOST}",
            "local:residue-cleanup",
            f"status:remove-client:--run-id:run-1:--client:{terminal['clientId']}",
        ]
        positions = [runtime.events.index(event) for event in ordered]
        self.assertEqual(positions, sorted(positions), runtime.events)
        target = runtime.states[-1].target(STONEBASE_HOST)
        self.assertEqual(target["submissionState"], "accepted")
        self.assertEqual(target["effectiveExecutor"], LOCAL_EXECUTOR)
        self.assertEqual(target["evidence"], "verified")
        self.assertEqual(target["expectedLocalReadySha"], NEW_SHA)
        self.assertEqual(target["expectedReadySha"], OLD_SHA)
        verification_events = [
            event
            for event in runtime.events
            if event.startswith(f"status:verification:{terminal['clientId']}:")
        ]
        self.assertEqual(len(verification_events), 2, runtime.events)
        self.assertIn(f":{NEW_SHA}:", verification_events[0])
        self.assertIn(f":{OLD_SHA}:", verification_events[1])
        claims = target["releaseClaims"]
        self.assertEqual(
            set(claims),
            {
                "controlPlaneWeb",
                "terminalRepository",
                "localArtifact",
                "runtime",
            },
        )
        self.assertTrue(
            all(claim["state"] == "verified" for claim in claims.values())
        )
        self.assertEqual(
            claims["localArtifact"]["expectedIdentity"], "sha256:" + "e" * 64
        )
        self.assertEqual(
            claims["runtime"]["expectedIdentity"],
            local_execution.runtime_claim_identity(),
        )

    def test_preflight_fallback_is_sealed_before_pi5_and_never_promoted(self) -> None:
        terminal = {
            "host": STONEBASE_HOST,
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "raspi4-kensaku-stonebase01-kiosk1",
        }
        plan = self.local_plan(terminal)
        plan["pi5Required"] = True
        server = plan["hosts"][0]
        server["targeted"] = True
        server["desiredSha"] = NEW_SHA
        plan["terminalWork"][0]["claimRequirements"][0] = {
            "kind": "controlPlaneWeb",
            "expectedIdentity": NEW_SHA,
            "status": "stale-or-unverified",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                STONEBASE_HOST: host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan=plan,
            targets=[terminal],
        )
        runtime.selected_hosts = lambda _inventory, _limit: ["pi5", STONEBASE_HOST]
        runtime.release_hosts = lambda _inventory, selected=None: [
            host
            for host in runtime.hosts
            if selected is None or host["host"] in set(selected)
        ]

        def fallback_selection(*_args, **_kwargs):
            runtime.events.append("local:fallback-selection")
            return {
                "requestedExecutor": LOCAL_EXECUTOR,
                "effectiveExecutor": SSH_EXECUTOR,
                "fallbackReason": "history-ineligible: candidate is not a descendant of the terminal SHA",
                "changedPaths": [],
                "publicContract": None,
                "runnerPreflight": None,
            }

        runtime.select_terminal_executor = fallback_selection

        result = coordinator.execute(
            coordinator_args(
                limit="raspberrypi5:raspi4-kensaku-stonebase01",
                stonebase_local_ansible_poc=True,
            ),
            runtime=runtime,
            token=FakeToken(runtime.events),
        )

        self.assertEqual(result, 0)
        self.assertEqual(runtime.events.count("local:fallback-selection"), 1)
        self.assertLess(
            runtime.events.index("local:fallback-selection"),
            runtime.events.index("pi5:ensure"),
        )
        target = runtime.states[-1].target(STONEBASE_HOST)
        self.assertEqual(target["effectiveExecutor"], SSH_EXECUTOR)
        self.assertEqual(
            target["fallbackReason"],
            "history-ineligible: candidate is not a descendant of the terminal SHA",
        )
        self.assertRegex(target["executorDecisionSha256"], r"^sha256:[0-9a-f]{64}$")
        self.assertEqual(
            runtime.states[-1].payload["plan"]["effectiveExecutor"], SSH_EXECUTOR
        )
        self.assertEqual(
            runtime.states[-1].payload["routeContract"]["scenarioId"],
            "pi5-and-ssh-success",
        )
        self.assertFalse(any(event.startswith("local:artifact") for event in runtime.events))

    def test_changed_terminal_head_after_seal_fails_before_maintenance(self) -> None:
        terminal = {
            "host": STONEBASE_HOST,
            "role": "kiosk",
            "terminalType": "kiosk",
            "clientId": "raspi4-kensaku-stonebase01-kiosk1",
        }
        plan = self.local_plan(terminal)
        plan["pi5Required"] = True
        server = plan["hosts"][0]
        server["targeted"] = True
        server["desiredSha"] = NEW_SHA
        plan["terminalWork"][0]["claimRequirements"][0] = {
            "kind": "controlPlaneWeb",
            "expectedIdentity": NEW_SHA,
            "status": "stale-or-unverified",
        }
        runtime = FakeRuntime(
            fleet={
                "pi5": host_record("server", OLD_SHA),
                STONEBASE_HOST: host_record("kiosk", OLD_SHA),
            },
            hosts=[{"host": "pi5", "role": "server"}, terminal],
            plan=plan,
            targets=[terminal],
        )
        runtime.selected_hosts = lambda _inventory, _limit: ["pi5", STONEBASE_HOST]
        runtime.release_hosts = lambda _inventory, selected=None: [
            host
            for host in runtime.hosts
            if selected is None or host["host"] in set(selected)
        ]
        baselines = iter(
            [
                {"head": OLD_SHA, "repairedLegacyDocs": False, "count": 0},
                {"head": NEW_SHA, "repairedLegacyDocs": False, "count": 0},
            ]
        )
        runtime.prepare_terminal_repository = lambda *_args: next(baselines)
        runtime.select_terminal_executor = lambda *_args: {
            "requestedExecutor": LOCAL_EXECUTOR,
            "effectiveExecutor": SSH_EXECUTOR,
            "fallbackReason": "history-ineligible: candidate is not a descendant of the terminal SHA",
            "changedPaths": [],
            "publicContract": None,
            "runnerPreflight": None,
        }

        with self.assertRaisesRegex(
            RuntimeError, "terminal repository changed after sealed executor decision"
        ):
            coordinator.execute(
                coordinator_args(
                    limit="raspberrypi5:raspi4-kensaku-stonebase01",
                    stonebase_local_ansible_poc=True,
                ),
                runtime=runtime,
                token=FakeToken(runtime.events),
            )

        self.assertIn("pi5:ensure", runtime.events)
        self.assertFalse(
            any(event.startswith("status:maintenance") for event in runtime.events)
        )
        self.assertFalse(any(event.startswith("manifest:capture") for event in runtime.events))


if __name__ == "__main__":
    unittest.main()
