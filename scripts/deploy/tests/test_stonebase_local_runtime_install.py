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


def _small_lock() -> dict[str, object]:
    package = {
        "name": "ansible-core",
        "version": "2.19.4",
        "filename": "ansible_core.whl",
        "source": "https://files.pythonhosted.org/ansible_core.whl",
        "sha256": "a" * 64,
        "size": 7,
    }
    return {
        "pythonDistribution": {
            "version": runtime_install.PYTHON_VERSION,
            "filename": runtime_install.PYTHON_FILENAME,
            "source": runtime_install.PYTHON_SOURCE,
            "sha256": runtime_install.PYTHON_SHA256,
            "size": runtime_install.PYTHON_SIZE,
        },
        "pythonPackages": [package],
        "collections": {
            "community.general": {
                "version": "11.4.1",
                "filename": runtime_install.COLLECTION_FILENAME,
                "source": runtime_install.COLLECTION_SOURCE,
                "sha256": runtime_install.COLLECTION_SHA256,
                "size": runtime_install.COLLECTION_SIZE,
            }
        },
    }


class StoneBaseLocalRuntimeInstallTest(unittest.TestCase):
    def test_checked_in_lock_matches_installer_and_candidate_artifact(self) -> None:
        lock_path = (
            Path(__file__).parents[3]
            / "infrastructure/ansible/files/stonebase-local-ansible/runtime-lock.json"
        )
        lock = json.loads(lock_path.read_text(encoding="utf-8"))

        self.assertEqual(lock["schemaVersion"], 3)
        self.assertEqual(local_execution.RUNTIME_VERSION, runtime_install.VERSION)
        self.assertEqual(lock["python"], runtime_install.PYTHON_VERSION)
        self.assertEqual(
            lock["pythonDistribution"],
            {
                "version": runtime_install.PYTHON_VERSION,
                "filename": runtime_install.PYTHON_FILENAME,
                "source": runtime_install.PYTHON_SOURCE,
                "sha256": runtime_install.PYTHON_SHA256,
                "size": runtime_install.PYTHON_SIZE,
            },
        )
        self.assertEqual(
            local_execution.runtime_lock_payload()["pythonDistribution"],
            lock["pythonDistribution"],
        )
        self.assertEqual(local_execution.runtime_lock_payload()["schemaVersion"], 4)
        self.assertEqual(
            local_execution.runtime_lock_payload()["runtimeVersion"],
            runtime_install.VERSION,
        )
        self.assertEqual(len(lock["pythonPackages"]), 9)
        self.assertEqual(
            lock["collections"]["community.general"],
            {
                "version": "11.4.1",
                "filename": runtime_install.COLLECTION_FILENAME,
                "source": runtime_install.COLLECTION_SOURCE,
                "sha256": runtime_install.COLLECTION_SHA256,
                "size": runtime_install.COLLECTION_SIZE,
            },
        )
        requirements = (
            lock_path.parent / "requirements-aarch64-py311.lock"
        ).read_text(encoding="utf-8")
        for package in lock["pythonPackages"]:
            self.assertIn(f"{package['name']}=={package['version']}", requirements)
            self.assertIn(f"sha256:{package['sha256']}", requirements)
        with patch.object(runtime_install, "LOCK", lock_path):
            loaded, digest = runtime_install._load_lock()
        self.assertEqual(loaded, lock)
        self.assertEqual(
            digest, "sha256:" + hashlib.sha256(lock_path.read_bytes()).hexdigest()
        )
        self.assertEqual(digest, local_execution.RUNTIME_BOOTSTRAP_LOCK_SHA256)

    def test_installer_has_no_network_download_boundary(self) -> None:
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertNotIn("urllib", source)
        self.assertFalse(hasattr(runtime_install, "_download_file"))

    def test_phase_wrapper_maps_raw_failures_to_closed_codes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            observation = runtime_install.Observation(Path(temporary) / "phase.json")

            def fail():
                raise RuntimeError("TOKEN=must-not-escape")

            with self.assertRaises(runtime_install.InstallFailure) as caught:
                runtime_install._phase(
                    observation,
                    "artifact-cache",
                    "artifact-cache-invalid",
                    fail,
                )
            self.assertEqual(caught.exception.phase, "artifact-cache")
            self.assertEqual(caught.exception.code, "artifact-cache-invalid")
            self.assertNotIn(
                "must-not-escape",
                (Path(temporary) / "phase.json").read_text(encoding="utf-8"),
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

    def test_cache_rejects_wrong_identity_extra_member_and_digest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lock_sha = "sha256:" + "d" * 64
            base = root / "cache"
            cache = base / ("d" * 64)
            cache.mkdir(parents=True)
            payloads = {
                runtime_install.PYTHON_FILENAME: b"python",
                "ansible_core.whl": b"ansible",
                runtime_install.COLLECTION_FILENAME: b"collection",
            }
            lock = _small_lock()
            members = [
                lock["pythonDistribution"],
                *lock["pythonPackages"],
                lock["collections"]["community.general"],
            ]
            for member in members:
                data = payloads[member["filename"]]
                member["size"] = len(data)
                member["sha256"] = hashlib.sha256(data).hexdigest()
                (cache / member["filename"]).write_bytes(data)

            with patch.object(runtime_install, "CACHE_BASE", base):
                self.assertEqual(
                    runtime_install._validated_cache(lock, lock_sha, cache), cache
                )
                with self.assertRaisesRegex(
                    runtime_install.InstallError, "identity does not match"
                ):
                    runtime_install._validated_cache(lock, lock_sha, root / "other")
                (cache / "extra").write_bytes(b"extra")
                with self.assertRaisesRegex(
                    runtime_install.InstallError, "membership does not match"
                ):
                    runtime_install._validated_cache(lock, lock_sha, cache)
                (cache / "extra").unlink()
                (cache / "ansible_core.whl").write_bytes(b"corrupt")
                with self.assertRaisesRegex(
                    runtime_install.InstallError, "member does not match"
                ):
                    runtime_install._validated_cache(lock, lock_sha, cache)

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

    def test_runtime_environment_satisfies_ansible_utf8_locale_contract(self) -> None:
        runtime = Path("/sealed/runtime")
        environment = runtime_install._runtime_environment(runtime, collections=True)
        self.assertEqual(environment["LANG"], "C.UTF-8")
        self.assertEqual(environment["LC_ALL"], "C.UTF-8")
        locale_probe = subprocess.run(
            [
                sys.executable,
                "-c",
                "import locale; locale.setlocale(locale.LC_ALL, ''); "
                "assert locale.getpreferredencoding(False).upper() == 'UTF-8'",
            ],
            check=False,
            capture_output=True,
            text=True,
            env=environment,
        )
        self.assertEqual(locale_probe.returncode, 0, locale_probe.stderr)

    def test_install_uses_only_sealed_cache_and_no_index(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "runtime"
            cache = Path(temporary) / "cache"
            cache.mkdir()
            requirements = Path(temporary) / "requirements.lock"
            requirements.write_text("locked\n", encoding="utf-8")
            lock = _small_lock()
            (cache / runtime_install.PYTHON_FILENAME).write_bytes(b"archive")
            (cache / runtime_install.COLLECTION_FILENAME).write_bytes(b"collection")

            def extract(_archive: Path, destination: Path) -> Path:
                runtime = destination / "python"
                (runtime / "bin").mkdir(parents=True)
                (runtime / "bin/python3").write_text("binary", encoding="utf-8")
                for name in runtime_install.ANSIBLE_CONSOLE_SCRIPTS:
                    script = runtime / "bin" / name
                    script.write_text(
                        f"#!{runtime / 'bin/python3'}\nentry-point\n",
                        encoding="utf-8",
                    )
                    script.chmod(0o755)
                return runtime

            commands: list[list[str]] = []

            def run(arguments, **_options):
                commands.append(list(arguments))
                return subprocess.CompletedProcess([], 0, "", "")

            with (
                patch.object(runtime_install, "ROOT", root),
                patch.object(runtime_install, "REQUIREMENTS", requirements),
                patch.object(
                    runtime_install.os,
                    "geteuid",
                    side_effect=[0] + [os.geteuid()] * 32,
                ),
                patch.object(runtime_install.platform, "machine", return_value="aarch64"),
                patch.object(
                    runtime_install,
                    "_load_lock",
                    return_value=(lock, "sha256:" + "d" * 64),
                ),
                patch.object(runtime_install, "_validated_cache", return_value=cache),
                patch.object(
                    runtime_install, "_valid", side_effect=[False, True, True]
                ),
                patch.object(runtime_install, "_extract_python_distribution", side_effect=extract),
                patch.object(runtime_install, "_run", side_effect=run),
            ):
                observation = runtime_install.Observation(Path(temporary) / "state.json")
                self.assertTrue(runtime_install.install(observation, cache_root=cache))

            self.assertEqual(len(commands), 2)
            pip_command = commands[0]
            self.assertIn("--no-index", pip_command)
            self.assertEqual(pip_command[pip_command.index("--find-links") + 1], str(cache))
            collection_command = commands[1]
            self.assertEqual(
                collection_command[3], str(cache / runtime_install.COLLECTION_FILENAME)
            )
            self.assertFalse(
                any(
                    "http" in argument
                    for command in commands
                    for argument in command
                )
            )
            destination = root / "versions" / runtime_install.VERSION
            for name in runtime_install.ANSIBLE_CONSOLE_SCRIPTS:
                self.assertEqual(
                    (destination / "bin" / name)
                    .read_bytes()
                    .splitlines()[0],
                    f"#!{destination / 'bin/python3'}".encode("utf-8"),
                )

    def test_publish_revalidates_relocated_console_scripts_before_activation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "runtime"
            cache = Path(temporary) / "cache"
            cache.mkdir()
            requirements = Path(temporary) / "requirements.lock"
            requirements.write_text("locked\n", encoding="utf-8")
            destination = root / "versions" / runtime_install.VERSION

            def extract(_archive: Path, staging: Path) -> Path:
                runtime = staging / "python"
                (runtime / "bin").mkdir(parents=True)
                (runtime / "bin/python3").write_bytes(b"python")
                for name in runtime_install.ANSIBLE_CONSOLE_SCRIPTS:
                    script = runtime / "bin" / name
                    script.write_text(
                        f"#!{runtime / 'bin/python3'}\nentry-point\n",
                        encoding="utf-8",
                    )
                    script.chmod(0o755)
                return runtime

            def valid(path: Path) -> bool:
                if path == destination and not path.exists():
                    return False
                if not path.exists():
                    return False
                expected = f"#!{path / 'bin/python3'}".encode("utf-8")
                return all(
                    (path / "bin" / name).read_bytes().splitlines()[0] == expected
                    for name in runtime_install.ANSIBLE_CONSOLE_SCRIPTS
                )

            with (
                patch.object(runtime_install, "ROOT", root),
                patch.object(runtime_install, "REQUIREMENTS", requirements),
                patch.object(
                    runtime_install.os,
                    "geteuid",
                    side_effect=[0] + [os.geteuid()] * 32,
                ),
                patch.object(runtime_install.platform, "machine", return_value="aarch64"),
                patch.object(
                    runtime_install,
                    "_load_lock",
                    return_value=(_small_lock(), "sha256:" + "d" * 64),
                ),
                patch.object(runtime_install, "_validated_cache", return_value=cache),
                patch.object(
                    runtime_install, "_extract_python_distribution", side_effect=extract
                ),
                patch.object(
                    runtime_install,
                    "_run",
                    return_value=subprocess.CompletedProcess([], 0, "", ""),
                ),
                patch.object(runtime_install, "_valid", side_effect=valid),
            ):
                observation = runtime_install.Observation(Path(temporary) / "state.json")
                self.assertTrue(runtime_install.install(observation, cache_root=cache))

            self.assertEqual(
                (root / "active").readlink(),
                Path("versions") / runtime_install.VERSION,
            )
            self.assertTrue(valid(destination))

    def test_publish_rejects_unexpected_console_script_shebang(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "runtime"
            staging = root / "versions" / ".staging" / "python"
            destination = root / "versions" / runtime_install.VERSION
            (staging / "bin").mkdir(parents=True)
            for name in runtime_install.ANSIBLE_CONSOLE_SCRIPTS:
                script = staging / "bin" / name
                interpreter = staging / "bin/python3"
                if name == "ansible-playbook":
                    interpreter = Path("/unsealed/python3")
                script.write_text(f"#!{interpreter}\nentry-point\n", encoding="utf-8")
                script.chmod(0o755)
            with patch.object(runtime_install, "ROOT", root):
                with self.assertRaisesRegex(
                    runtime_install.InstallError,
                    "console script interpreter is unexpected",
                ):
                    runtime_install._rewrite_console_script_shebangs(
                        staging, destination
                    )

    def test_failed_post_publish_validation_removes_unactivated_version(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "runtime"
            cache = Path(temporary) / "cache"
            cache.mkdir()
            requirements = Path(temporary) / "requirements.lock"
            requirements.write_text("locked\n", encoding="utf-8")
            destination = root / "versions" / runtime_install.VERSION

            def extract(_archive: Path, staging: Path) -> Path:
                runtime = staging / "python"
                (runtime / "bin").mkdir(parents=True)
                (runtime / "bin/python3").write_bytes(b"python")
                return runtime

            with (
                patch.object(runtime_install, "ROOT", root),
                patch.object(runtime_install, "REQUIREMENTS", requirements),
                patch.object(runtime_install.os, "geteuid", return_value=0),
                patch.object(runtime_install.platform, "machine", return_value="aarch64"),
                patch.object(
                    runtime_install,
                    "_load_lock",
                    return_value=(_small_lock(), "sha256:" + "d" * 64),
                ),
                patch.object(runtime_install, "_validated_cache", return_value=cache),
                patch.object(
                    runtime_install, "_extract_python_distribution", side_effect=extract
                ),
                patch.object(
                    runtime_install,
                    "_run",
                    return_value=subprocess.CompletedProcess([], 0, "", ""),
                ),
                patch.object(
                    runtime_install, "_valid", side_effect=[False, True, False]
                ),
                patch.object(
                    runtime_install, "_rewrite_console_script_shebangs"
                ),
            ):
                observation = runtime_install.Observation(Path(temporary) / "state.json")
                with self.assertRaises(runtime_install.InstallFailure) as caught:
                    runtime_install.install(observation, cache_root=cache)

            self.assertEqual(caught.exception.phase, "runtime-verify")
            self.assertEqual(caught.exception.code, "runtime-verification-failed")
            self.assertEqual(caught.exception.cleanup, "complete")
            self.assertFalse(destination.exists())
            self.assertFalse((root / "active").exists())

    def test_offline_pipeline_failures_keep_exact_closed_phase_codes(self) -> None:
        expected = {
            "python-packages": "python-packages-failed",
            "collection-install": "collection-install-failed",
            "runtime-verify": "runtime-verification-failed",
            "runtime-publish": "runtime-publish-conflict",
            "active-link": "active-link-failed",
        }
        for failed_phase, failure_code in expected.items():
            with self.subTest(phase=failed_phase), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / "runtime"
                cache = Path(temporary) / "cache"
                cache.mkdir()
                requirements = Path(temporary) / "requirements.lock"
                requirements.write_text("locked\n", encoding="utf-8")
                destination = root / "versions" / runtime_install.VERSION
                if failed_phase in {"runtime-publish", "active-link"}:
                    destination.mkdir(parents=True)
                if failed_phase == "active-link":
                    (root / "active").mkdir()

                def extract(_archive: Path, path: Path) -> Path:
                    runtime = path / "python"
                    (runtime / "bin").mkdir(parents=True)
                    (runtime / "bin/python3").write_bytes(b"sealed")
                    return runtime

                run_count = 0

                def run(_arguments, **_options):
                    nonlocal run_count
                    run_count += 1
                    return_code = 0
                    if failed_phase == "python-packages" and run_count == 1:
                        return_code = 19
                    if failed_phase == "collection-install" and run_count == 2:
                        return_code = 23
                    return subprocess.CompletedProcess([], return_code, "", "")

                def valid(path: Path) -> bool:
                    if path == destination:
                        return failed_phase == "active-link"
                    return failed_phase != "runtime-verify"

                observation = runtime_install.Observation(
                    Path(temporary) / "state.json"
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
                        return_value=(_small_lock(), "sha256:" + "d" * 64),
                    ),
                    patch.object(
                        runtime_install, "_validated_cache", return_value=cache
                    ),
                    patch.object(runtime_install, "_valid", side_effect=valid),
                    patch.object(
                        runtime_install, "_rewrite_console_script_shebangs"
                    ),
                    patch.object(
                        runtime_install,
                        "_extract_python_distribution",
                        side_effect=extract,
                    ),
                    patch.object(runtime_install, "_run", side_effect=run),
                ):
                    with self.assertRaises(
                        runtime_install.InstallFailure
                    ) as caught:
                        runtime_install.install(observation, cache_root=cache)

                self.assertEqual(caught.exception.phase, failed_phase)
                self.assertEqual(caught.exception.code, failure_code)
                self.assertEqual(caught.exception.cleanup, "complete")

    def test_artifact_cache_failure_is_bounded_before_staging(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            requirements = Path(temporary) / "requirements.lock"
            requirements.write_text("locked\n", encoding="utf-8")
            observation = runtime_install.Observation(Path(temporary) / "state.json")
            with (
                patch.object(runtime_install, "REQUIREMENTS", requirements),
                patch.object(runtime_install.os, "geteuid", return_value=0),
                patch.object(runtime_install.platform, "machine", return_value="aarch64"),
                patch.object(
                    runtime_install,
                    "_load_lock",
                    return_value=(_small_lock(), "sha256:" + "d" * 64),
                ),
                patch.object(
                    runtime_install,
                    "_validated_cache",
                    side_effect=runtime_install.InstallError("TOKEN=hidden"),
                ),
            ):
                with self.assertRaises(runtime_install.InstallFailure) as caught:
                    runtime_install.install(observation)
            self.assertEqual(caught.exception.phase, "artifact-cache")
            self.assertEqual(caught.exception.code, "artifact-cache-invalid")

    def test_failure_is_atomic_bounded_and_queryable_without_raw_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            observation_path = Path(temporary) / "state/bootstrap.json"
            secret = "CLIENT_SECRET=must-not-be-recorded"
            with (
                patch.object(runtime_install, "OBSERVATION", observation_path),
                patch.object(runtime_install.os, "geteuid", return_value=0),
                patch.object(runtime_install.platform, "machine", return_value="aarch64"),
                patch.object(
                    runtime_install,
                    "_load_lock",
                    side_effect=runtime_install.InstallError(secret),
                ),
            ):
                self.assertEqual(runtime_install.main([]), 1)
                value = json.loads(observation_path.read_text(encoding="utf-8"))
                self.assertEqual(value["failureCode"], "lock-invalid")
                self.assertNotIn(secret, json.dumps(value))
                with patch("builtins.print") as output:
                    self.assertEqual(runtime_install.main(["status"]), 0)
                self.assertRegex(
                    output.call_args.args[0],
                    r"^RUNTIME_INSTALL_OBSERVATION:failed:lock-validate:"
                    r"lock-invalid:complete:[0-9a-f]{32}:none$",
                )

    def test_interrupted_phase_remains_running_and_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "bootstrap.json"
            observation = runtime_install.Observation(path)
            observation.lock_sha256 = "sha256:" + "d" * 64
            observation.phase("artifact-cache")
            value = runtime_install._validated_observation(path)
            self.assertEqual(value["status"], "running")
            self.assertEqual(value["phase"], "artifact-cache")
            self.assertEqual(
                local_execution.validate_runtime_bootstrap_observation(value), value
            )

    def test_cleanup_failure_preserves_primary_failed_phase(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "runtime"
            cache = Path(temporary) / "cache"
            cache.mkdir()
            requirements = Path(temporary) / "requirements.lock"
            requirements.write_text("locked\n", encoding="utf-8")
            observation = runtime_install.Observation(Path(temporary) / "state.json")
            with (
                patch.object(runtime_install, "ROOT", root),
                patch.object(runtime_install, "REQUIREMENTS", requirements),
                patch.object(runtime_install.os, "geteuid", return_value=0),
                patch.object(runtime_install.platform, "machine", return_value="aarch64"),
                patch.object(
                    runtime_install,
                    "_load_lock",
                    return_value=(_small_lock(), "sha256:" + "d" * 64),
                ),
                patch.object(runtime_install, "_validated_cache", return_value=cache),
                patch.object(runtime_install, "_valid", return_value=False),
                patch.object(
                    runtime_install,
                    "_extract_python_distribution",
                    side_effect=runtime_install.InstallError("raw extract detail"),
                ),
                patch.object(
                    runtime_install.shutil,
                    "rmtree",
                    side_effect=OSError("raw cleanup detail"),
                ),
            ):
                with self.assertRaises(runtime_install.InstallFailure) as caught:
                    runtime_install.install(observation, cache_root=cache)
            self.assertEqual(caught.exception.phase, "python-extract")
            self.assertEqual(caught.exception.code, "python-extract-failed")
            self.assertEqual(caught.exception.cleanup, "failed")


if __name__ == "__main__":
    unittest.main()
