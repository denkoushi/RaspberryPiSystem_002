from __future__ import annotations

import hashlib
import io
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
DEPLOY = ROOT / "scripts/deploy"
sys.path.insert(0, str(DEPLOY))
import controller_gh_verifier as verifier


class ControllerGhVerifierTests(unittest.TestCase):
    def config(
        self,
        directory: Path,
        *,
        version: str = "9.9.9",
        macos_sha256: str,
    ) -> Path:
        path = directory / "release-artifacts.yml"
        path.write_text(
            "\n".join(
                (
                    f'pi5_artifact_gh_version: "{version}"',
                    f'pi5_artifact_gh_arm64_sha256: "{"1" * 64}"',
                    f'pi5_artifact_gh_macos_arm64_sha256: "{macos_sha256}"',
                )
            )
            + "\n",
            encoding="utf-8",
        )
        return path

    @staticmethod
    def archive(version: str = "9.9.9") -> bytes:
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w") as package:
            package.writestr(f"gh_{version}_macOS_arm64/bin/gh", b"test gh")
        return payload.getvalue()

    @staticmethod
    def completed(
        command: list[str],
        stdout: str = "",
        *,
        returncode: int = 0,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(command, returncode, stdout, "")

    def runner(
        self,
        version: str,
        commands: list[list[str]],
        *,
        capability: str | None = None,
    ):
        def run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            commands.append(command)
            if command[1:] == ["--version"]:
                return self.completed(command, f"gh version {version} (test)\n")
            if command[1:] == ["attestation", "verify", "--help"]:
                return self.completed(
                    command,
                    capability
                    if capability is not None
                    else "\n".join(verifier.REQUIRED_ATTESTATION_OPTIONS),
                )
            raise AssertionError(f"unexpected command: {command}")

        return run

    def test_config_reuses_approved_version_and_linux_checksum(self) -> None:
        config = verifier.read_config(
            ROOT / "infrastructure/ansible/group_vars/server/release-artifacts.yml"
        )

        self.assertEqual(config.version, "2.96.0")
        self.assertEqual(
            config.linux_arm64_sha256,
            "334dd9c6704fc1656a48e475c5a3a9aa32bbadb87fa1777513bc626af4a99e89",
        )
        self.assertEqual(
            config.macos_arm64_sha256,
            "f23a0c37d963aacc3bed703ccbd59b41c5ca22101fab7f00eb2b7cad23aba463",
        )

    def test_macos_reuses_existing_approved_binary_without_download(self) -> None:
        commands: list[list[str]] = []
        with tempfile.TemporaryDirectory() as directory:
            payload = self.archive()
            config = self.config(
                Path(directory), macos_sha256=hashlib.sha256(payload).hexdigest()
            )
            with mock.patch.object(
                verifier.platform, "system", return_value="Darwin"
            ), mock.patch.object(
                verifier.platform, "machine", return_value="arm64"
            ), mock.patch.object(
                verifier.shutil, "which", return_value="/usr/local/bin/gh"
            ), mock.patch.object(
                verifier, "_download", side_effect=AssertionError("must not download")
            ):
                with verifier.resolve_attestation_verifier(
                    {}, config, runner=self.runner("9.9.9", commands)
                ) as gh:
                    self.assertEqual(gh, "/usr/local/bin/gh")

        self.assertEqual(
            [command[1:] for command in commands],
            [["--version"], ["attestation", "verify", "--help"]],
        )

    def test_macos_downloads_checksum_approved_asset_and_cleans_up(self) -> None:
        payload = self.archive()
        commands: list[list[str]] = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = self.config(root, macos_sha256=hashlib.sha256(payload).hexdigest())
            downloads: list[tuple[str, Path]] = []

            def download(url: str, destination: Path) -> None:
                downloads.append((url, destination))
                destination.write_bytes(payload)

            def run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
                commands.append(command)
                version = "8.8.8" if command[0] == "/usr/bin/gh" else "9.9.9"
                if command[1:] == ["--version"]:
                    return self.completed(command, f"gh version {version} (test)\n")
                if command[1:] == ["attestation", "verify", "--help"]:
                    return self.completed(
                        command, "\n".join(verifier.REQUIRED_ATTESTATION_OPTIONS)
                    )
                raise AssertionError(f"unexpected command: {command}")
            with mock.patch.object(verifier.platform, "system", return_value="Darwin"), mock.patch.object(
                verifier.platform, "machine", return_value="arm64"
            ), mock.patch.object(verifier.shutil, "which", return_value="/usr/bin/gh"), mock.patch.object(
                verifier, "_download", side_effect=download
            ):
                with verifier.resolve_attestation_verifier(
                    {"PATH": "/usr/bin"}, config, runner=run
                ) as gh:
                    self.assertTrue(Path(gh).is_file())
                    self.assertTrue(Path(gh).stat().st_mode & 0o100)
                    self.assertNotEqual(gh, "/usr/bin/gh")
                self.assertFalse(Path(gh).exists())

            self.assertEqual(
                downloads[0][0],
                "https://github.com/cli/cli/releases/download/v9.9.9/"
                "gh_9.9.9_macOS_arm64.zip",
            )
            self.assertEqual(
                [command[1:] for command in commands],
                [
                    ["--version"],
                    ["--version"],
                    ["attestation", "verify", "--help"],
                ],
            )

    def test_macos_download_rejects_checksum_and_cleans_up(self) -> None:
        payload = self.archive()
        downloaded: list[Path] = []
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = self.config(root, macos_sha256="0" * 64)

            def download(_url: str, destination: Path) -> None:
                downloaded.append(destination)
                destination.write_bytes(payload)

            with mock.patch.object(verifier.platform, "system", return_value="Darwin"), mock.patch.object(
                verifier.platform, "machine", return_value="arm64"
            ), mock.patch.object(verifier.shutil, "which", return_value=None), mock.patch.object(
                verifier, "_download", side_effect=download
            ), self.assertRaisesRegex(RuntimeError, "checksum"):
                with verifier.resolve_attestation_verifier(
                    {}, config, runner=self.runner("9.9.9", [])
                ):
                    pass

        self.assertEqual(len(downloaded), 1)
        self.assertFalse(downloaded[0].exists())

    def test_macos_download_rejects_version_and_capability_and_cleans_up(self) -> None:
        payload = self.archive()
        for expected, capability, message in (
            ("8.8.8", None, "pinned 9.9.9"),
            ("9.9.9", "--bundle-from-oci", "attestation policy"),
        ):
            with self.subTest(message=message), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                config = self.config(root, macos_sha256=hashlib.sha256(payload).hexdigest())
                downloaded: list[Path] = []

                def download(_url: str, destination: Path) -> None:
                    downloaded.append(destination)
                    destination.write_bytes(payload)

                with mock.patch.object(verifier.platform, "system", return_value="Darwin"), mock.patch.object(
                    verifier.platform, "machine", return_value="arm64"
                ), mock.patch.object(verifier.shutil, "which", return_value=None), mock.patch.object(
                    verifier, "_download", side_effect=download
                ), self.assertRaisesRegex(RuntimeError, message):
                    with verifier.resolve_attestation_verifier(
                        {},
                        config,
                        runner=self.runner(expected, [] , capability=capability),
                    ):
                        pass
                self.assertFalse(downloaded[0].exists())

    def test_linux_path_keeps_existing_binary_and_skips_bootstrap_capability_probe(self) -> None:
        commands: list[list[str]] = []
        with tempfile.TemporaryDirectory() as directory:
            payload = self.archive()
            config = self.config(
                Path(directory), macos_sha256=hashlib.sha256(payload).hexdigest()
            )
            run = self.runner("9.9.9", commands)
            with mock.patch.object(verifier.platform, "system", return_value="Linux"), mock.patch.object(
                verifier.platform, "machine", return_value="aarch64"
            ), mock.patch.object(verifier.shutil, "which", return_value="/usr/bin/gh"), mock.patch.object(
                verifier, "_download", side_effect=AssertionError("Linux must not download")
            ):
                with verifier.resolve_attestation_verifier(
                    {}, config, runner=run
                ) as gh:
                    self.assertEqual(gh, "/usr/bin/gh")
            self.assertEqual([command[1:] for command in commands], [["--version"]])

    def test_config_version_update_drives_linux_verifier_behavior(self) -> None:
        commands: list[list[str]] = []
        with tempfile.TemporaryDirectory() as directory:
            payload = self.archive("7.7.7")
            config = self.config(
                Path(directory), version="7.7.7", macos_sha256=hashlib.sha256(payload).hexdigest()
            )
            with mock.patch.object(verifier.platform, "system", return_value="Linux"), mock.patch.object(
                verifier.platform, "machine", return_value="aarch64"
            ), mock.patch.object(verifier.shutil, "which", return_value="/usr/bin/gh"):
                with verifier.resolve_attestation_verifier(
                    {}, config, runner=self.runner("7.7.7", commands)
                ) as gh:
                    self.assertEqual(gh, "/usr/bin/gh")
            self.assertEqual(commands[0][1:], ["--version"])


if __name__ == "__main__":
    unittest.main()
