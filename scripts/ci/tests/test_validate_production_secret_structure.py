from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from validate_production_secret_structure import (  # noqa: E402
    Finding,
    is_external_or_empty,
    scan,
    validate,
    validate_normal_factory_vault_contract,
)


class ProductionSecretStructureTests(unittest.TestCase):
    def write_baseline(self, root: Path, findings: dict[Finding, int]) -> Path:
        path = root / "security/production-secret-baseline.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        entries = [
            {
                "path": finding.path,
                "identifier": finding.identifier,
                "syntax": finding.syntax,
                "count": count,
                "reason": "legacy value pending rotation",
            }
            for finding, count in sorted(findings.items())
        ]
        path.write_text(json.dumps({"schemaVersion": 1, "allowedPlaintext": entries}), encoding="utf-8")
        return path

    def test_allows_external_references_and_redacted_legacy_baseline(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inventory = root / "infrastructure/ansible/inventory.yml"
            inventory.parent.mkdir(parents=True)
            inventory.write_text(
                "safe_secret: '{{ vault_safe_secret }}'\nlegacy_client_key: legacy-fixture-value\n",
                encoding="utf-8",
            )
            findings = scan(root)
            baseline = self.write_baseline(root, findings)
            self.assertEqual(validate(root, baseline), [])

    def test_treats_quoted_shell_environment_references_as_external(self) -> None:
        self.assertTrue(is_external_or_empty('"${ADMIN_ACCESS_TOKEN:-}"'))
        self.assertTrue(is_external_or_empty('"${ADMIN_ACCESS_TOKEN}"'))
        self.assertTrue(is_external_or_empty('env.VITE_DEFAULT_CLIENT_KEY || undefined'))
        self.assertTrue(is_external_or_empty('string;'))

    def test_rejects_new_plaintext_without_echoing_value(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inventory = root / "infrastructure/ansible/inventory.yml"
            inventory.parent.mkdir(parents=True)
            inventory.write_text("safe_secret: '{{ vault_safe_secret }}'\n", encoding="utf-8")
            baseline = self.write_baseline(root, {})
            injected = "do-not-print-this-value"
            inventory.write_text(f"safe_secret: '{{{{ vault_safe_secret }}}}'\nnew_api_key: {injected}\n", encoding="utf-8")
            errors = validate(root, baseline)
            rendered = "\n".join(errors)
            self.assertIn("new_api_key", rendered)
            self.assertNotIn(injected, rendered)

    def test_excludes_shared_read_only_placeholder_from_production_secret_scan(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            placeholder = root / (
                "infrastructure/ansible/normal-factory-vault-placeholders.yml"
            )
            placeholder.parent.mkdir(parents=True)
            placeholder.write_text(
                "vault_api_jwt_access_secret: ci-redacted-access-secret\n",
                encoding="utf-8",
            )

            self.assertEqual(scan(root), {})

    def test_accepts_tracked_ciphertext_and_exact_inventory_reference(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            vault_relative = "infrastructure/ansible/host_vars/test-host/vault.yml"
            vault = root / vault_relative
            vault.parent.mkdir(parents=True)
            vault.write_bytes(b"$ANSIBLE_VAULT;1.1;AES256\nfixture-ciphertext\n")
            inventory = root / "infrastructure/ansible/inventory.yml"
            inventory.parent.mkdir(parents=True, exist_ok=True)
            inventory.write_text(
                "all:\n  children:\n    kiosk:\n      hosts:\n        test-host:\n"
                '          status_agent_client_key: "{{ vault_test_status_agent_client_key }}"\n',
                encoding="utf-8",
            )
            errors = validate_normal_factory_vault_contract(
                root,
                vault_paths=(vault_relative,),
                required_references={
                    "test-host": {
                        "status_agent_client_key": "vault_test_status_agent_client_key",
                    }
                },
                tracked_paths={vault_relative},
            )
            self.assertEqual(errors, [])

    def test_rejects_plaintext_vault_and_inventory_fallback_without_echoing_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            vault_relative = "infrastructure/ansible/host_vars/test-host/vault.yml"
            vault = root / vault_relative
            vault.parent.mkdir(parents=True)
            hidden_vault_value = "never-print-vault-value"
            vault.write_text(f"vault_test_status_agent_client_key: {hidden_vault_value}\n", encoding="utf-8")
            inventory = root / "infrastructure/ansible/inventory.yml"
            inventory.parent.mkdir(parents=True, exist_ok=True)
            hidden_inventory_value = "never-print-inventory-value"
            inventory.write_text(
                "all:\n  children:\n    kiosk:\n      hosts:\n        test-host:\n"
                f"          status_agent_client_key: {hidden_inventory_value}\n",
                encoding="utf-8",
            )
            errors = validate_normal_factory_vault_contract(
                root,
                vault_paths=(vault_relative,),
                required_references={
                    "test-host": {
                        "status_agent_client_key": "vault_test_status_agent_client_key",
                    }
                },
                tracked_paths={vault_relative, "infrastructure/ansible/.vault-pass"},
            )
            rendered = "\n".join(errors)
            self.assertIn("must be Ansible Vault ciphertext", rendered)
            self.assertIn("must use required Vault reference", rendered)
            self.assertIn("Vault password must never be tracked", rendered)
            self.assertNotIn(hidden_vault_value, rendered)
            self.assertNotIn(hidden_inventory_value, rendered)


if __name__ == "__main__":
    unittest.main()
