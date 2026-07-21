from __future__ import annotations

import importlib.util
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.deploy.rolling_release import local_execution


MODULE_PATH = Path(__file__).parents[1] / "stonebase-local-runtime-install.py"
SPEC = importlib.util.spec_from_file_location(
    "stonebase_local_runtime_install_tested", MODULE_PATH
)
assert SPEC is not None and SPEC.loader is not None
runtime_install = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = runtime_install
SPEC.loader.exec_module(runtime_install)


class StoneBaseLocalRuntimeInstallTest(unittest.TestCase):
    def test_phase_wrapper_maps_raw_failures_to_closed_codes(self) -> None:
        phases = {
            "lock-validate": "lock-invalid",
            "staging-prepare": "staging-preparation-failed",
            "python-download": "python-download-failed",
            "python-extract": "python-extract-failed",
            "collection-download": "collection-download-failed",
        }
        with tempfile.TemporaryDirectory() as temporary:
            for phase, code in phases.items():
                with self.subTest(phase=phase):
                    observation = runtime_install.Observation(
                        Path(temporary) / f"{phase}.json"
                    )

                    def fail():
                        raise RuntimeError("raw secret-like process output")

                    with self.assertRaises(runtime_install.InstallFailure) as caught:
                        runtime_install._phase(observation, phase, code, fail)
                    self.assertEqual(caught.exception.phase, phase)
                    self.assertEqual(caught.exception.code, code)
                    self.assertNotIn(
                        "raw secret-like",
                        (Path(temporary) / f"{phase}.json").read_text(
                            encoding="utf-8"
                        ),
                    )

    def test_observation_rejects_group_writable_parent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary) / "unsafe"
            parent.mkdir(mode=0o777)
            parent.chmod(0o777)
            observation = runtime_install.Observation(parent / "bootstrap.json")
            with self.assertRaisesRegex(
                runtime_install.InstallError, "directory is unsafe"
            ):
                observation.phase("initializing")

    def test_checked_in_lock_matches_installer_and_candidate_artifact(self) -> None:
        lock_path = (
            Path(__file__).parents[3]
            / "infrastructure/ansible/files/stonebase-local-ansible/runtime-lock.json"
        )
        lock = json.loads(lock_path.read_text(encoding="utf-8"))

        self.assertEqual(lock["schemaVersion"], 2)
        self.assertEqual(local_execution.RUNTIME_VERSION, runtime_install.VERSION)
        self.assertEqual(lock["python"], runtime_install.PYTHON_VERSION)
        self.assertEqual(
            local_execution.runtime_lock_payload()["python"],
            runtime_install.PYTHON_VERSION,
        )
        self.assertEqual(
            lock["pythonDistribution"],
            {
                "version": runtime_install.PYTHON_VERSION,
                "source": runtime_install.PYTHON_SOURCE,
                "sha256": runtime_install.PYTHON_SHA256,
            },
        )
        self.assertEqual(
            local_execution.runtime_lock_payload()["pythonDistribution"],
            lock["pythonDistribution"],
        )
        self.assertEqual(
            lock["collections"]["community.general"],
            {
                "version": "11.4.1",
                "source": runtime_install.COLLECTION_SOURCE,
                "sha256": runtime_install.COLLECTION_SHA256,
            },
        )
        with patch.object(runtime_install, "LOCK", lock_path):
            loaded, digest = runtime_install._load_lock()
            self.assertEqual(loaded, lock)
            self.assertEqual(
                digest,
                "sha256:" + hashlib.sha256(lock_path.read_bytes()).hexdigest(),
            )

    def test_python_distribution_rejects_member_outside_fixed_root(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive_path = root / "python.tar.gz"
            with tarfile.open(archive_path, "w:gz") as archive:
                payload = b"escape"
                info = tarfile.TarInfo("../escape")
                info.size = len(payload)
                archive.addfile(info, io.BytesIO(payload))

            with self.assertRaisesRegex(
                runtime_install.InstallError, "escaped its root"
            ):
                runtime_install._extract_python_distribution(
                    archive_path, root / "extract"
                )
            self.assertFalse((root / "escape").exists())

    def test_incomplete_existing_runtime_is_invalid_not_an_unbounded_exception(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Path(temporary) / "runtime"
            runtime.mkdir()
            self.assertFalse(runtime_install._valid(runtime))

    def test_python_distribution_accepts_internal_relative_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive_path = root / "python.tar.gz"
            with tarfile.open(archive_path, "w:gz") as archive:
                payload = b"python"
                binary = tarfile.TarInfo("python/bin/python3.11")
                binary.mode = 0o755
                binary.size = len(payload)
                archive.addfile(binary, io.BytesIO(payload))
                link = tarfile.TarInfo("python/bin/python3")
                link.type = tarfile.SYMTYPE
                link.linkname = "python3.11"
                archive.addfile(link)

            runtime = runtime_install._extract_python_distribution(
                archive_path, root / "extract"
            )
            self.assertEqual(runtime, root / "extract/python")
            self.assertEqual((runtime / "bin/python3").readlink(), Path("python3.11"))

    def test_python_distribution_rejects_symlink_outside_fixed_root(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive_path = root / "python.tar.gz"
            with tarfile.open(archive_path, "w:gz") as archive:
                link = tarfile.TarInfo("python/bin/python3")
                link.type = tarfile.SYMTYPE
                link.linkname = "../../../outside"
                archive.addfile(link)

            with self.assertRaisesRegex(
                runtime_install.InstallError, "link escaped its root"
            ):
                runtime_install._extract_python_distribution(
                    archive_path, root / "extract"
                )
            self.assertFalse((root / "outside").exists())

    def test_install_uses_pinned_distribution_without_system_python_311(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "runtime"
            requirements = Path(temporary) / "requirements.lock"
            requirements.write_text("locked\n", encoding="utf-8")
            lock = {
                "pythonDistribution": {
                    "version": runtime_install.PYTHON_VERSION,
                    "source": runtime_install.PYTHON_SOURCE,
                    "sha256": runtime_install.PYTHON_SHA256,
                },
                "collections": {
                    "community.general": {
                        "version": "11.4.1",
                        "source": "https://example.invalid/community-general.tar.gz",
                        "sha256": "1" * 64,
                    }
                },
            }
            downloads: list[dict[str, str]] = []

            def download(
                destination: Path,
                metadata: dict[str, str],
                *,
                maximum_bytes: int,
            ) -> None:
                self.assertGreater(maximum_bytes, 0)
                downloads.append(metadata)
                destination.write_bytes(b"archive")

            def extract(_archive: Path, destination: Path) -> Path:
                runtime = destination / "python"
                (runtime / "bin").mkdir(parents=True)
                (runtime / "bin/python3").write_text("binary", encoding="utf-8")
                return runtime

            completed = subprocess.CompletedProcess([], 0, "", "")
            with (
                patch.object(runtime_install, "ROOT", root),
                patch.object(runtime_install, "REQUIREMENTS", requirements),
                patch.object(runtime_install.os, "geteuid", return_value=0),
                patch.object(runtime_install.platform, "machine", return_value="aarch64"),
                patch.object(
                    runtime_install,
                    "_load_lock",
                    return_value=(lock, "sha256:" + "d" * 64),
                ),
                patch.object(
                    runtime_install, "_valid", side_effect=[False, True]
                ),
                patch.object(runtime_install, "_download_file", side_effect=download),
                patch.object(
                    runtime_install,
                    "_extract_python_distribution",
                    side_effect=extract,
                ),
                patch.object(runtime_install, "_run", return_value=completed),
            ):
                observation = runtime_install.Observation(
                    Path(temporary) / "bootstrap.json"
                )
                self.assertTrue(runtime_install.install(observation))

            destination = root / "versions" / runtime_install.VERSION
            self.assertTrue(destination.is_dir())
            self.assertEqual((root / "active").resolve(), destination.resolve())
            self.assertEqual(
                downloads,
                [
                    lock["pythonDistribution"],
                    lock["collections"]["community.general"],
                ],
            )

    def test_pipeline_failures_keep_exact_closed_phase_codes(self) -> None:
        expected = {
            "python-packages": "python-packages-failed",
            "collection-download": "collection-download-failed",
            "collection-install": "collection-install-failed",
            "runtime-verify": "runtime-verification-failed",
            "runtime-publish": "runtime-publish-conflict",
            "active-link": "active-link-failed",
        }

        for failed_phase, failure_code in expected.items():
            with self.subTest(phase=failed_phase), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / "runtime"
                requirements = Path(temporary) / "requirements.lock"
                requirements.write_text("locked\n", encoding="utf-8")
                destination = root / "versions" / runtime_install.VERSION
                if failed_phase in {"runtime-publish", "active-link"}:
                    destination.mkdir(parents=True)
                if failed_phase == "active-link":
                    (root / "active").mkdir()
                lock = {
                    "pythonDistribution": {
                        "version": runtime_install.PYTHON_VERSION,
                        "source": runtime_install.PYTHON_SOURCE,
                        "sha256": runtime_install.PYTHON_SHA256,
                    },
                    "collections": {
                        "community.general": {
                            "version": "11.4.1",
                            "source": runtime_install.COLLECTION_SOURCE,
                            "sha256": runtime_install.COLLECTION_SHA256,
                        }
                    },
                }
                download_count = 0
                run_count = 0

                def valid(path: Path) -> bool:
                    if path == destination:
                        return failed_phase == "active-link"
                    return failed_phase != "runtime-verify"

                def download(
                    path: Path,
                    _metadata: dict[str, str],
                    *,
                    maximum_bytes: int,
                ) -> None:
                    nonlocal download_count
                    self.assertGreater(maximum_bytes, 0)
                    download_count += 1
                    if failed_phase == "collection-download" and download_count == 2:
                        raise runtime_install.InstallError("raw collection failure")
                    path.write_bytes(b"sealed")

                def extract(_archive: Path, path: Path) -> Path:
                    runtime = path / "python"
                    (runtime / "bin").mkdir(parents=True)
                    (runtime / "bin/python3").write_bytes(b"sealed")
                    return runtime

                def run(_arguments, **_kwargs):
                    nonlocal run_count
                    run_count += 1
                    return_code = 0
                    if failed_phase == "python-packages" and run_count == 1:
                        return_code = 19
                    if failed_phase == "collection-install" and run_count == 2:
                        return_code = 23
                    return subprocess.CompletedProcess([], return_code, "", "")

                observation = runtime_install.Observation(
                    Path(temporary) / "bootstrap.json"
                )
                with (
                    patch.object(runtime_install, "ROOT", root),
                    patch.object(runtime_install, "REQUIREMENTS", requirements),
                    patch.object(runtime_install.os, "geteuid", return_value=0),
                    patch.object(
                        runtime_install.platform, "machine", return_value="aarch64"
                    ),
                    patch.object(
                        runtime_install,
                        "_load_lock",
                        return_value=(lock, "sha256:" + "d" * 64),
                    ),
                    patch.object(runtime_install, "_valid", side_effect=valid),
                    patch.object(
                        runtime_install, "_download_file", side_effect=download
                    ),
                    patch.object(
                        runtime_install,
                        "_extract_python_distribution",
                        side_effect=extract,
                    ),
                    patch.object(runtime_install, "_run", side_effect=run),
                ):
                    with self.assertRaises(runtime_install.InstallFailure) as caught:
                        runtime_install.install(observation)

                self.assertEqual(caught.exception.phase, failed_phase)
                self.assertEqual(caught.exception.code, failure_code)

    def test_failure_is_atomic_bounded_and_queryable_without_raw_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            observation_path = Path(temporary) / "state/bootstrap.json"
            secret = "CLIENT_SECRET=must-not-be-recorded"
            with (
                patch.object(runtime_install, "OBSERVATION", observation_path),
                patch.object(runtime_install.os, "geteuid", return_value=0),
                patch.object(
                    runtime_install.platform, "machine", return_value="aarch64"
                ),
                patch.object(
                    runtime_install,
                    "_load_lock",
                    side_effect=runtime_install.InstallError(secret),
                ),
            ):
                self.assertEqual(runtime_install.main([]), 1)
                value = json.loads(observation_path.read_text(encoding="utf-8"))
                self.assertEqual(value["status"], "failed")
                self.assertEqual(value["phase"], "lock-validate")
                self.assertEqual(value["failureCode"], "lock-invalid")
                self.assertEqual(value["cleanup"], "complete")
                self.assertNotIn(secret, json.dumps(value))
                self.assertEqual(os.stat(observation_path).st_mode & 0o777, 0o644)
                with patch("builtins.print") as output:
                    self.assertEqual(runtime_install.main(["status"]), 0)
                marker = output.call_args.args[0]
                self.assertRegex(
                    marker,
                    r"^RUNTIME_INSTALL_OBSERVATION:failed:lock-validate:"
                    r"lock-invalid:complete:[0-9a-f]{32}:none$",
                )

    def test_interrupted_phase_remains_running_and_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "bootstrap.json"
            observation = runtime_install.Observation(path)
            observation.lock_sha256 = "sha256:" + "d" * 64
            observation.phase("python-packages")

            value = runtime_install._validated_observation(path)
            self.assertEqual(value["status"], "running")
            self.assertEqual(value["phase"], "python-packages")
            self.assertEqual(value["cleanup"], "pending")
            self.assertEqual(
                local_execution.validate_runtime_bootstrap_observation(value),
                value,
            )

    def test_cleanup_failure_preserves_primary_failed_phase(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "runtime"
            requirements = Path(temporary) / "requirements.lock"
            requirements.write_text("locked\n", encoding="utf-8")
            lock = {
                "pythonDistribution": {
                    "version": runtime_install.PYTHON_VERSION,
                    "source": runtime_install.PYTHON_SOURCE,
                    "sha256": runtime_install.PYTHON_SHA256,
                },
                "collections": {
                    "community.general": {
                        "version": "11.4.1",
                        "source": runtime_install.COLLECTION_SOURCE,
                        "sha256": runtime_install.COLLECTION_SHA256,
                    }
                },
            }
            observation = runtime_install.Observation(
                Path(temporary) / "bootstrap.json"
            )
            with (
                patch.object(runtime_install, "ROOT", root),
                patch.object(runtime_install, "REQUIREMENTS", requirements),
                patch.object(runtime_install.os, "geteuid", return_value=0),
                patch.object(
                    runtime_install.platform, "machine", return_value="aarch64"
                ),
                patch.object(
                    runtime_install,
                    "_load_lock",
                    return_value=(lock, "sha256:" + "d" * 64),
                ),
                patch.object(runtime_install, "_valid", return_value=False),
                patch.object(
                    runtime_install,
                    "_download_file",
                    side_effect=runtime_install.InstallError("raw download detail"),
                ),
                patch.object(
                    runtime_install.shutil,
                    "rmtree",
                    side_effect=OSError("raw cleanup detail"),
                ),
            ):
                with self.assertRaises(runtime_install.InstallFailure) as caught:
                    runtime_install.install(observation)

            self.assertEqual(caught.exception.phase, "python-download")
            self.assertEqual(caught.exception.code, "python-download-failed")
            self.assertEqual(caught.exception.cleanup, "failed")


if __name__ == "__main__":
    unittest.main()
