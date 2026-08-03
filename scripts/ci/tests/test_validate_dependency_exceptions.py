from __future__ import annotations

import datetime as dt
import json
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from validate_dependency_exceptions import validate  # noqa: E402


class DependencyExceptionTests(unittest.TestCase):
    def fixture(self, directory: str, *, expires_on: str = "2030-01-01", include_override: bool = True) -> Path:
        root = Path(directory)
        (root / "security").mkdir()
        (root / ".trivyignore").write_text("# reason\nCVE-2099-0001\n", encoding="utf-8")
        (root / "package.json").write_text(
            json.dumps({"pnpm": {"overrides": {"example": "1.0.1"}}}), encoding="utf-8"
        )
        overrides = []
        if include_override:
            overrides.append(
                {"id": "example", "owner": "team", "reason": "temporary pin", "expiresOn": expires_on}
            )
        ledger = {
            "schemaVersion": 1,
            "trivy": [
                {"id": "CVE-2099-0001", "owner": "team", "reason": "upstream fix pending", "expiresOn": expires_on}
            ],
            "pnpmOverrides": overrides,
        }
        (root / "security/dependency-exceptions.json").write_text(json.dumps(ledger), encoding="utf-8")
        return root

    def test_accepts_complete_unexpired_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory)
            self.assertEqual(validate(root, dt.date(2029, 1, 1)), [])

    def test_rejects_missing_and_expired_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = self.fixture(directory, expires_on="2020-01-01", include_override=False)
            errors = validate(root, dt.date(2029, 1, 1))
            self.assertTrue(any("expired" in error for error in errors))
            self.assertTrue(any("metadata is missing" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
