#!/usr/bin/env python3
"""Validate newly added Prisma migrations for the Pi5 Expand-only deploy gate."""

from __future__ import annotations

import argparse
import hashlib
import pathlib
import re
import sys
from typing import TextIO

ALLOWED_STATEMENT = re.compile(
    r"^\s*(CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX|TYPE|EXTENSION|SEQUENCE|SCHEMA|ENUM)\b"
    r"|ALTER\s+TABLE\b[\s\S]*?\bADD\s+(COLUMN|CONSTRAINT)\b|COMMENT\s+ON\b)",
    re.IGNORECASE,
)
FORBIDDEN_STATEMENT = re.compile(
    r"\b(DROP|RENAME|SET\s+NOT\s+NULL|ALTER\s+COLUMN|TRUNCATE|DELETE\s+FROM)\b",
    re.IGNORECASE,
)
MIGRATION_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
CHECKSUM = re.compile(r"^[0-9a-f]{64}$")


def load_applied_checksums(stream: TextIO) -> dict[str, str]:
    applied: dict[str, str] = {}
    for line_number, raw in enumerate(stream, start=1):
        line = raw.rstrip("\r\n")
        if not line:
            continue
        parts = line.split("|")
        if (
            len(parts) != 2
            or MIGRATION_NAME.fullmatch(parts[0]) is None
            or CHECKSUM.fullmatch(parts[1]) is None
        ):
            raise ValueError(f"invalid applied-migration row at line {line_number}")
        name, checksum = parts
        previous = applied.get(name)
        if previous is not None and previous != checksum:
            raise ValueError(f"conflicting applied checksums for {name}")
        applied[name] = checksum
    return applied


def file_checksum(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_applied_history(
    migration_root: pathlib.Path, applied: dict[str, str]
) -> None:
    for migration_name, expected_checksum in applied.items():
        path = migration_root / migration_name / "migration.sql"
        if not path.is_file():
            raise ValueError(f"applied migration is missing from candidate: {migration_name}")
        actual_checksum = file_checksum(path)
        if actual_checksum != expected_checksum:
            raise ValueError(f"applied migration checksum mismatch: {migration_name}")


def validate_migration(path: pathlib.Path, applied: dict[str, str]) -> None:
    raw = path.read_bytes()
    migration_name = path.parent.name
    checksum = hashlib.sha256(raw).hexdigest()
    if applied.get(migration_name) == checksum:
        print(
            f"already-applied migration checksum verified: {migration_name}",
            file=sys.stderr,
        )
        return

    text = raw.decode("utf-8")
    text = re.sub(r"--.*?$", "", text, flags=re.MULTILINE)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    for raw_statement in text.split(";"):
        statement = raw_statement.strip()
        if statement and (
            ALLOWED_STATEMENT.match(statement) is None
            or FORBIDDEN_STATEMENT.search(statement) is not None
        ):
            raise ValueError(f"disallowed statement in {path}: {statement[:120]}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--applied-checksums",
        required=True,
        help="Pipe-delimited migration_name|checksum rows, or - for stdin",
    )
    parser.add_argument("--migration-root", required=True)
    # An empty added-migration set is meaningful: every release still verifies
    # the complete applied history before it trusts the candidate checkout.
    parser.add_argument("migrations", nargs="*")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.applied_checksums == "-":
            applied = load_applied_checksums(sys.stdin)
        else:
            with open(args.applied_checksums, encoding="utf-8") as stream:
                applied = load_applied_checksums(stream)
        validate_applied_history(pathlib.Path(args.migration_root), applied)
        for migration in args.migrations:
            validate_migration(pathlib.Path(migration), applied)
    except (OSError, UnicodeError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
