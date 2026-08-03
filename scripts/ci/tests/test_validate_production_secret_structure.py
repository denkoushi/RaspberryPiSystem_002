from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from validate_production_secret_structure import Finding, scan, validate  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
