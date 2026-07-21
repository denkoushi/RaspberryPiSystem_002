from __future__ import annotations

import importlib.util
import io
import json
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
    def test_checked_in_lock_matches_installer_and_candidate_artifact(self) -> None:
        lock_path = (
            Path(__file__).parents[3]
            / "infrastructure/ansible/files/stonebase-local-ansible/runtime-lock.json"
        )
        lock = json.loads(lock_path.read_text(encoding="utf-8"))

        self.assertEqual(lock["schemaVersion"], 2)
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
            self.assertEqual(runtime_install._load_lock(), lock)

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
                patch.object(runtime_install, "_load_lock", return_value=lock),
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
                self.assertTrue(runtime_install.install())

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


if __name__ == "__main__":
    unittest.main()
