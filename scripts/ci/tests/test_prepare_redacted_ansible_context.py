from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from prepare_redacted_ansible_context import (  # noqa: E402
    RedactedContextError,
    prepare_context,
)


class RedactedAnsibleContextTests(unittest.TestCase):
    def test_excludes_all_host_vaults_and_vault_password(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "ansible"
            host_vars = source / "host_vars/test-host"
            host_vars.mkdir(parents=True)
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
            self.assertIn("disabled in redacted CI context", (output / "ansible.cfg").read_text())

    def test_refuses_to_overwrite_an_existing_destination(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "ansible"
            source.mkdir()
            (source / "ansible.cfg").write_text(
                "[defaults]\nvault_password_file = .vault-pass\n",
                encoding="utf-8",
            )
            output = root / "redacted"
            output.mkdir()
            with self.assertRaisesRegex(RedactedContextError, "must not already exist"):
                prepare_context(source, output)
