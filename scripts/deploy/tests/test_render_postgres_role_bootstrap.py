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
        source = (
            "SELECT :'app_password'; SELECT :'migration_password'; "
            'ALTER DATABASE :"database_name" OWNER TO raspi_migrator;'
        )
        rendered = MODULE.render(
            source,
            "postgresql://raspi_app:application-pass%27word@db:5432/borrow_return",
            "postgresql://raspi_migrator:migration-password@db:5432/borrow_return",
        )
        self.assertEqual(
            rendered,
            "SELECT 'application-pass''word'; SELECT 'migration-password'; "
            'ALTER DATABASE "borrow_return" OWNER TO raspi_migrator;',
        )

    def test_renders_staging_database_name_from_matching_urls(self) -> None:
        rendered = MODULE.render(
            'GRANT CONNECT ON DATABASE :"database_name" TO raspi_app;',
            "postgresql://raspi_app:application-password@db:5432/borrow_return_staging",
            "postgresql://raspi_migrator:migration-password@db:5432/borrow_return_staging",
        )
        self.assertEqual(
            rendered,
            'GRANT CONNECT ON DATABASE "borrow_return_staging" TO raspi_app;',
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

    def test_rejects_mismatched_database_names(self) -> None:
        with self.assertRaises(ValueError):
            MODULE.render(
                'ALTER DATABASE :"database_name" OWNER TO raspi_migrator;',
                "postgresql://raspi_app:application-password@db:5432/borrow_return_staging",
                "postgresql://raspi_migrator:migration-password@db:5432/borrow_return",
            )


if __name__ == "__main__":
    unittest.main()
