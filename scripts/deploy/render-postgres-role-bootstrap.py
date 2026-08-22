#!/usr/bin/env python3
"""Render the value-free PostgreSQL role bootstrap from environment-only URLs.

The rendered SQL contains credentials and must be piped directly to psql under
an outer no-log boundary. This helper never writes a file or logs a URL.
"""

from __future__ import annotations

import os
import pathlib
import re
import sys
import urllib.parse


def _database_authority(raw_url: str, expected_role: str) -> tuple[str, str]:
    parsed = urllib.parse.urlsplit(raw_url)
    database_name = parsed.path.removeprefix("/")
    if (
        parsed.scheme != "postgresql"
        or parsed.username != expected_role
        or parsed.hostname != "db"
        or parsed.port != 5432
        or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", database_name)
        or parsed.fragment
        or parsed.password is None
    ):
        raise ValueError("database authority URL violates the bounded database endpoint")
    password = urllib.parse.unquote(parsed.password)
    if len(password) < 16 or password.lower() in {"postgres", "password", "changeme"}:
        raise ValueError("database authority password is missing or weak")
    return password, database_name


def _literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def render(source: str, app_url: str, migration_url: str) -> str:
    app_password, app_database = _database_authority(app_url, "raspi_app")
    migration_password, migration_database = _database_authority(
        migration_url, "raspi_migrator"
    )
    if app_database != migration_database:
        raise ValueError("application and migration URLs must target the same database")
    rendered = source.replace(":'app_password'", _literal(app_password))
    rendered = rendered.replace(":'migration_password'", _literal(migration_password))
    rendered = rendered.replace(':"database_name"', _identifier(app_database))
    if any(
        placeholder in rendered
        for placeholder in (
            ":'app_password'",
            ":'migration_password'",
            ':"database_name"',
        )
    ):
        raise ValueError("database role bootstrap placeholders were not fully resolved")
    return rendered


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: render-postgres-role-bootstrap.py BOOTSTRAP_SQL", file=sys.stderr)
        return 2
    try:
        source = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
        rendered = render(
            source,
            os.environ["APP_DATABASE_URL"],
            os.environ["MIGRATION_DATABASE_URL"],
        )
    except (KeyError, OSError, ValueError) as error:
        print(f"database role bootstrap rendering failed: {error}", file=sys.stderr)
        return 1
    sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
