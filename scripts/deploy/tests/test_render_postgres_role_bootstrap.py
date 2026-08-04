from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
HELPER = ROOT / "scripts/deploy/render-postgres-role-bootstrap.py"
SPEC = importlib.util.spec_from_file_location("render_postgres_role_bootstrap", HELPER)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RenderPostgresRoleBootstrapTests(unittest.TestCase):
    def test_renders_fixed_roles_with_sql_escaped_passwords(self) -> None:
        source = "SELECT :'app_password'; SELECT :'migration_password';"
        rendered = MODULE.render(
            source,
            "postgresql://raspi_app:application-pass%27word@db:5432/borrow_return",
            "postgresql://raspi_migrator:migration-password@db:5432/borrow_return",
        )
        self.assertEqual(
            rendered,
            "SELECT 'application-pass''word'; SELECT 'migration-password';",
        )

    def test_rejects_wrong_role_or_endpoint(self) -> None:
        for url in (
            "postgresql://postgres:application-password@db:5432/borrow_return",
            "postgresql://raspi_app:application-password@other:5432/borrow_return",
            "postgresql://raspi_app:application-password@db:5432/other",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                MODULE.render(
                    "SELECT :'app_password'; SELECT :'migration_password';",
                    url,
                    "postgresql://raspi_migrator:migration-password@db:5432/borrow_return",
                )

    def test_rejects_weak_password(self) -> None:
        with self.assertRaises(ValueError):
            MODULE.render(
                "SELECT :'app_password'; SELECT :'migration_password';",
                "postgresql://raspi_app:short@db:5432/borrow_return",
                "postgresql://raspi_migrator:migration-password@db:5432/borrow_return",
            )


if __name__ == "__main__":
    unittest.main()
