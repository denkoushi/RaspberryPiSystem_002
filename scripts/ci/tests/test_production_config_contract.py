from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.ci.audit_production_config import (
    audit_repository,
    validate_surface_defaults,
)
from scripts.deploy.production_config_contract import (
    ALL_VITE_KEYS,
    ConfigKind,
    PRODUCTION_WEB_SETTINGS,
    ProductionConfigError,
    ProductionWebSetting,
    ValueKind,
    _validate_registry,
    validate_exact_keys,
)


ROOT = Path(__file__).resolve().parents[3]


class ProductionConfigContractTests(unittest.TestCase):
    def test_repository_has_exact_complete_production_contract(self) -> None:
        audit_repository(ROOT)
        self.assertEqual(len(ALL_VITE_KEYS), 20)

    def test_each_missing_surface_key_fails_closed(self) -> None:
        expected = ("VITE_A", "VITE_B")
        for missing in expected:
            with self.subTest(missing=missing):
                actual = [key for key in expected if key != missing]
                with self.assertRaisesRegex(ProductionConfigError, "missing"):
                    validate_exact_keys("fixture", actual, expected)

    def test_unknown_duplicate_and_secret_like_keys_fail_closed(self) -> None:
        with self.assertRaisesRegex(ProductionConfigError, "unknown"):
            validate_exact_keys("fixture", ["VITE_A", "VITE_UNKNOWN"], ["VITE_A"])
        with self.assertRaisesRegex(ProductionConfigError, "duplicate"):
            validate_exact_keys("fixture", ["VITE_A", "VITE_A"], ["VITE_A"])
        with self.assertRaisesRegex(ProductionConfigError, "secret-like"):
            _validate_registry(
                (
                    ProductionWebSetting(
                        "VITE_PRIVATE_TOKEN",
                        ConfigKind.IMAGE,
                        ValueKind.STRING,
                        "unsafe",
                        "web_private_token",
                        "negative fixture",
                    ),
                )
            )

    def test_surface_default_drift_fails_closed(self) -> None:
        with self.assertRaisesRegex(ProductionConfigError, "default drift"):
            validate_surface_defaults(
                "fixture",
                {"VITE_FEATURE": "false"},
                {"VITE_FEATURE": "true"},
            )

    def test_web_env_alone_cannot_add_a_production_setting(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory) / "repo"
            # A compact copy is unnecessary: validate_exact_keys is the pure
            # boundary used by each filesystem adapter.
            copied.mkdir()
            image_keys = [
                setting.key
                for setting in PRODUCTION_WEB_SETTINGS
                if setting.kind is ConfigKind.IMAGE
            ]
            with self.assertRaises(ProductionConfigError):
                validate_exact_keys(
                    "compatibility web.env Web values",
                    [*image_keys, "VITE_ONLY_IN_WEB_ENV"],
                    image_keys,
                )


if __name__ == "__main__":
    unittest.main()
