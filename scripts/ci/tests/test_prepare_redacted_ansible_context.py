from __future__ import annotations

import sys
import subprocess
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from prepare_redacted_ansible_context import (  # noqa: E402
    RedactedContextError,
    prepare_context,
)
from scripts.deploy.rolling_release.read_only_ansible_context import (  # noqa: E402
    READ_ONLY_PLACEHOLDER_FILENAME,
)


class RedactedAnsibleContextTests(unittest.TestCase):
    def test_excludes_all_host_vaults_and_vault_password(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "ansible"
            host_vars = source / "host_vars/test-host"
            host_vars.mkdir(parents=True)
            (source / READ_ONLY_PLACEHOLDER_FILENAME).write_text(
                "vault_probe: ci-redacted\n", encoding="utf-8"
            )
            (source / ".vault-pass").write_text("never-copy-this\n", encoding="utf-8")
            (source / "ansible.cfg").write_text(
                "[defaults]\nvault_password_file = .vault-pass\n",
                encoding="utf-8",
            )
            (source / "inventory.yml").write_text("all:\n  hosts: {}\n", encoding="utf-8")
            (host_vars / "vault.yml").write_text("encrypted-or-plain-secret\n", encoding="utf-8")
            (host_vars / "main.yml").write_text("safe_value: true\n", encoding="utf-8")
            output = root / "redacted"

            prepare_context(source, output)

            self.assertFalse((output / ".vault-pass").exists())
            self.assertFalse((output / "host_vars/test-host/vault.yml").exists())
            self.assertTrue((output / "host_vars/test-host/main.yml").is_file())
            self.assertEqual(
                (output / READ_ONLY_PLACEHOLDER_FILENAME).read_text(),
                "vault_probe: ci-redacted\n",
            )
            self.assertIn(
                "disabled in redacted read-only context",
                (output / "ansible.cfg").read_text(),
            )

    def test_refuses_to_overwrite_an_existing_destination(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "ansible"
            source.mkdir()
            (source / READ_ONLY_PLACEHOLDER_FILENAME).write_text(
                "vault_probe: ci-redacted\n", encoding="utf-8"
            )
            (source / "ansible.cfg").write_text(
                "[defaults]\nvault_password_file = .vault-pass\n",
                encoding="utf-8",
            )
            output = root / "redacted"
            output.mkdir()
            with self.assertRaisesRegex(RedactedContextError, "must not already exist"):
                prepare_context(source, output)

    def test_cli_runs_outside_the_repository_working_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "ansible"
            source.mkdir()
            (source / READ_ONLY_PLACEHOLDER_FILENAME).write_text(
                "vault_probe: ci-redacted\n", encoding="utf-8"
            )
            (source / "ansible.cfg").write_text(
                "[defaults]\nvault_password_file = .vault-pass\n",
                encoding="utf-8",
            )
            (source / "inventory.yml").write_text(
                "all:\n  hosts: {}\n", encoding="utf-8"
            )
            output = root / "redacted"
            working_directory = root / "outside-repository"
            working_directory.mkdir()
            script = Path(__file__).resolve().parents[1] / (
                "prepare_redacted_ansible_context.py"
            )

            completed = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--source",
                    str(source),
                    "--output",
                    str(output),
                ],
                cwd=working_directory,
                text=True,
                capture_output=True,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertTrue((output / "inventory.yml").is_file())

    def test_missing_placeholder_fails_closed_before_copy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "ansible"
            source.mkdir()
            (source / "ansible.cfg").write_text(
                "[defaults]\nvault_password_file = .vault-pass\n",
                encoding="utf-8",
            )
            output = root / "redacted"

            with self.assertRaisesRegex(RedactedContextError, "placeholder"):
                prepare_context(source, output)

            self.assertFalse(output.exists())

    def test_symlink_placeholder_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "ansible"
            source.mkdir()
            (source / "ansible.cfg").write_text(
                "[defaults]\nvault_password_file = .vault-pass\n",
                encoding="utf-8",
            )
            target = root / "outside-placeholder.yml"
            target.write_text("vault_probe: ci-redacted\n", encoding="utf-8")
            (source / READ_ONLY_PLACEHOLDER_FILENAME).symlink_to(target)
            output = root / "redacted"

            with self.assertRaisesRegex(RedactedContextError, "placeholder"):
                prepare_context(source, output)

            self.assertFalse(output.exists())
