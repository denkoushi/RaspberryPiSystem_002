#!/usr/bin/env python3
"""Validate the complete candidate Prisma migration ledger.

The deployment checkout is mutable, so this validator reads migration bytes from
the candidate Git commit object.  Applied migrations must exist with their
recorded checksum; every other candidate migration must satisfy the conservative
Expand-only allow-list below.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import pathlib
import re
import subprocess
import sys
from typing import TextIO

MIGRATION_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
CHECKSUM = re.compile(r"^[0-9a-f]{64}$")
MIGRATION_ROOT = "apps/api/prisma/migrations"
IDENTIFIER = r"(?:Q|[A-Za-z_][A-Za-z0-9_$]*)"
QUALIFIED_IDENTIFIER = rf"{IDENTIFIER}(?:\s*\.\s*{IDENTIFIER}){{0,2}}"

CREATE_TABLE = re.compile(
    rf"^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"
    rf"{QUALIFIED_IDENTIFIER}\s*\(",
    re.IGNORECASE,
)
CREATE_INDEX = re.compile(
    rf"^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?"
    rf"(?:IF\s+NOT\s+EXISTS\s+)?{QUALIFIED_IDENTIFIER}\s+ON\s+"
    rf"(?:ONLY\s+)?{QUALIFIED_IDENTIFIER}(?:\s+USING\s+{IDENTIFIER})?\s*\(",
    re.IGNORECASE,
)
RAW_IDENTIFIER = r'(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)'
RAW_QUALIFIED_IDENTIFIER = rf"{RAW_IDENTIFIER}(?:\s*\.\s*{RAW_IDENTIFIER}){{0,2}}"
RAW_CREATE_TABLE = re.compile(
    rf"^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"
    rf"(?P<table>{RAW_QUALIFIED_IDENTIFIER})\s*\(",
    re.IGNORECASE,
)
RAW_CREATE_UNIQUE_INDEX = re.compile(
    rf"^\s*CREATE\s+UNIQUE\s+INDEX\s+(?:CONCURRENTLY\s+)?"
    rf"(?:IF\s+NOT\s+EXISTS\s+)?{RAW_QUALIFIED_IDENTIFIER}\s+ON\s+"
    rf"(?:ONLY\s+)?(?P<table>{RAW_QUALIFIED_IDENTIFIER})(?:\s+USING\s+{RAW_IDENTIFIER})?\s*\(",
    re.IGNORECASE,
)
CREATE_ENUM = re.compile(
    rf"^CREATE\s+TYPE\s+{QUALIFIED_IDENTIFIER}\s+AS\s+ENUM\s*\(",
    re.IGNORECASE,
)
CREATE_SEQUENCE = re.compile(
    rf"^CREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?"
    rf"{QUALIFIED_IDENTIFIER}(?:\s+(?:AS\s+{QUALIFIED_IDENTIFIER}|"
    r"INCREMENT(?:\s+BY)?\s+-?[0-9]+|MINVALUE\s+-?[0-9]+|NO\s+MINVALUE|"
    r"MAXVALUE\s+-?[0-9]+|NO\s+MAXVALUE|START(?:\s+WITH)?\s+-?[0-9]+|"
    r"CACHE\s+[0-9]+|CYCLE|NO\s+CYCLE))*$",
    re.IGNORECASE,
)
CREATE_SCHEMA = re.compile(
    rf"^CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?{QUALIFIED_IDENTIFIER}"
    rf"(?:\s+AUTHORIZATION\s+{IDENTIFIER})?$",
    re.IGNORECASE,
)
COMMENT_ON = re.compile(
    r"^COMMENT\s+ON\b[\s\S]*\s+IS\s+(?:S|NULL)\s*$", re.IGNORECASE
)
ALTER_ADD_COLUMN = re.compile(
    rf"^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?"
    rf"{QUALIFIED_IDENTIFIER}\s+ADD\s+COLUMN\s+"
    rf"(?:IF\s+NOT\s+EXISTS\s+)?{IDENTIFIER}\s+(?P<definition>[\s\S]+)$",
    re.IGNORECASE,
)
DISALLOWED_COLUMN_CLAUSE = re.compile(
    r"\b(DEFAULT|NULL|CONSTRAINT|UNIQUE|PRIMARY|REFERENCES|CHECK|GENERATED|"
    r"IDENTITY|SERIAL|BIGSERIAL|SMALLSERIAL|DROP|ALTER|RENAME|SET|ADD)\b",
    re.IGNORECASE,
)
BUILTIN_COLUMN_TYPE = re.compile(
    r"^(?:(?:BOOL|BOOLEAN)|"
    r"(?:INT2|SMALLINT|INT4|INT|INTEGER|INT8|BIGINT)|"
    r"(?:DECIMAL|NUMERIC)(?:\s*\(\s*[0-9]+\s*(?:,\s*[0-9]+\s*)?\))?|"
    r"(?:FLOAT4|REAL|FLOAT8|DOUBLE\s+PRECISION|FLOAT(?:\s*\(\s*[0-9]+\s*\))?)|"
    r"MONEY|"
    r"(?:CHARACTER(?:\s+VARYING)?|CHAR(?:\s+VARYING)?|VARCHAR)"
    r"(?:\s*\(\s*[0-9]+\s*\))?|"
    r"TEXT|BYTEA|"
    r"(?:TIMESTAMP|TIME)(?:\s*\(\s*[0-9]+\s*\))?"
    r"(?:\s+(?:WITH|WITHOUT)\s+TIME\s+ZONE)?|"
    r"TIMESTAMPTZ(?:\s*\(\s*[0-9]+\s*\))?|"
    r"TIMETZ(?:\s*\(\s*[0-9]+\s*\))?|DATE|"
    r"UUID|JSON|JSONB|XML|INET|CIDR|MACADDR|MACADDR8|"
    r"BIT(?:\s+VARYING)?(?:\s*\(\s*[0-9]+\s*\))?|"
    r"VARBIT(?:\s*\(\s*[0-9]+\s*\))?|"
    r"POINT|LINE|LSEG|BOX|PATH|POLYGON|CIRCLE|PG_LSN|TSVECTOR|TSQUERY)"
    r"(?:\s*\[\s*\])*$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class SqlStatement:
    text: str
    code: str


@dataclass(frozen=True)
class CandidateMigration:
    name: str
    path: str
    object_id: str
    content: bytes


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


def _is_identifier_continuation(character: str) -> bool:
    # PostgreSQL's lexer accepts every high-bit byte in an unquoted identifier.
    # Treat all non-ASCII code points conservatively after UTF-8 decoding.
    return ord(character) >= 128 or character.isalnum() or character in "_$"


def _quoted_token(
    text: str, start: int, delimiter: str, *, escape_backslash: bool = False
) -> tuple[str, int]:
    index = start + len(delimiter)
    if delimiter == "'":
        while index < len(text):
            if escape_backslash and text[index] == "\\":
                index += 2
                continue
            if text.startswith("''", index):
                index += 2
                continue
            if text[index] == "'":
                return text[start : index + 1], index + 1
            index += 1
        raise ValueError("unterminated single-quoted string")
    if delimiter == '"':
        while index < len(text):
            if text.startswith('""', index):
                index += 2
                continue
            if text[index] == '"':
                return text[start : index + 1], index + 1
            index += 1
        raise ValueError("unterminated double-quoted identifier")

    end = text.find(delimiter, index)
    if end < 0:
        raise ValueError(f"unterminated dollar-quoted string {delimiter}")
    end += len(delimiter)
    return text[start:end], end


def split_sql_statements(text: str) -> list[SqlStatement]:
    """Split SQL only at normal-state semicolons and mask quoted contents."""

    statements: list[SqlStatement] = []
    source: list[str] = []
    code: list[str] = []
    index = 0

    def finish() -> None:
        raw = "".join(source).strip()
        masked = "".join(code).strip()
        if raw:
            statements.append(SqlStatement(raw, masked))
        source.clear()
        code.clear()

    while index < len(text):
        if text.startswith("--", index):
            newline = text.find("\n", index + 2)
            if newline < 0:
                index = len(text)
                source.append(" ")
                code.append(" ")
            else:
                index = newline
                source.append("\n")
                code.append("\n")
            continue

        if text.startswith("/*", index):
            depth = 1
            index += 2
            while index < len(text) and depth:
                if text.startswith("/*", index):
                    depth += 1
                    index += 2
                elif text.startswith("*/", index):
                    depth -= 1
                    index += 2
                else:
                    index += 1
            if depth:
                raise ValueError("unterminated block comment")
            source.append(" ")
            code.append(" ")
            continue

        character = text[index]
        if character == "'":
            escape_string = (
                index > 0
                and text[index - 1] in "Ee"
                and (index < 2 or not _is_identifier_continuation(text[index - 2]))
            )
            token, index = _quoted_token(
                text, index, "'", escape_backslash=escape_string
            )
            source.append(token)
            if escape_string:
                code.pop()
            code.append(" S ")
            continue

        if character == '"':
            token, index = _quoted_token(text, index, '"')
            source.append(token)
            code.append(" Q ")
            continue

        if character == "$" and (
            index == 0
            or not _is_identifier_continuation(text[index - 1])
        ):
            match = re.match(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$", text[index:])
            if match is not None:
                delimiter = match.group(0)
                token, index = _quoted_token(text, index, delimiter)
                source.append(token)
                code.append(" S ")
                continue

        if character == ";":
            finish()
            index += 1
            continue

        source.append(character)
        code.append(character)
        index += 1

    finish()
    return statements


def _balanced_parentheses(code: str) -> bool:
    depth = 0
    for character in code:
        if character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def _has_top_level_comma(code: str) -> bool:
    depth = 0
    for character in code:
        if character == "(":
            depth += 1
        elif character == ")":
            depth -= 1
        elif character == "," and depth == 0:
            return True
    return False


def _parenthesized_body_ends_statement(code: str, opening: int) -> bool:
    depth = 0
    for index in range(opening, len(code)):
        if code[index] == "(":
            depth += 1
        elif code[index] == ")":
            depth -= 1
            if depth == 0:
                return not code[index + 1 :].strip()
    return False


def _parenthesized_index_has_where_suffix(code: str, opening: int) -> bool:
    depth = 0
    for index in range(opening, len(code)):
        if code[index] == "(":
            depth += 1
        elif code[index] == ")":
            depth -= 1
            if depth == 0:
                return bool(re.match(r"^\s+WHERE\s+.+$", code[index + 1 :], re.IGNORECASE))
    return False


def validate_statement(
    statement: SqlStatement, label: str, *, allow_new_table_partial_unique_index: bool = False
) -> None:
    code = statement.code.strip()
    if not _balanced_parentheses(code):
        raise ValueError(f"unbalanced parentheses in {label}: {statement.text[:120]}")

    create_table = CREATE_TABLE.match(code)
    if create_table is not None and _parenthesized_body_ends_statement(
        code, create_table.end() - 1
    ):
        return
    create_index = CREATE_INDEX.match(code)
    if create_index is not None:
        if _parenthesized_body_ends_statement(code, create_index.end() - 1):
            return
        if allow_new_table_partial_unique_index and _parenthesized_index_has_where_suffix(
            code, create_index.end() - 1
        ):
            return
    create_enum = CREATE_ENUM.match(code)
    if create_enum is not None and _parenthesized_body_ends_statement(
        code, create_enum.end() - 1
    ):
        return
    if CREATE_SEQUENCE.fullmatch(code) is not None:
        return
    if CREATE_SCHEMA.fullmatch(code) is not None:
        return
    if COMMENT_ON.fullmatch(code) is not None:
        return

    add_column = ALTER_ADD_COLUMN.fullmatch(code)
    if add_column is not None:
        definition = add_column.group("definition")
        if (
            DISALLOWED_COLUMN_CLAUSE.search(definition) is None
            and BUILTIN_COLUMN_TYPE.fullmatch(definition.strip()) is not None
            and not _has_top_level_comma(code)
        ):
            return

    raise ValueError(f"disallowed statement in {label}: {statement.text[:120]}")


def validate_sql(raw: bytes, label: str) -> None:
    text = raw.decode("utf-8")
    statements = split_sql_statements(text)
    if not statements:
        raise ValueError(f"migration contains no SQL statements: {label}")
    created_tables: set[str] = set()
    for statement in statements:
        # A UNIQUE index can reject a write or lock an existing production table.
        # It is safe in the expand-only contract only when it belongs to a table
        # created earlier in this same, not-yet-applied migration.
        unique_index = RAW_CREATE_UNIQUE_INDEX.match(statement.text)
        if unique_index is not None and unique_index.group("table") not in created_tables:
            raise ValueError(
                f"unique index must target a table created in the same migration: {label}: "
                f"{statement.text[:120]}"
            )
        validate_statement(
            statement,
            label,
            allow_new_table_partial_unique_index=unique_index is not None,
        )
        create_table = RAW_CREATE_TABLE.match(statement.text)
        if create_table is not None:
            created_tables.add(create_table.group("table"))


def _run_git(repository: pathlib.Path, arguments: list[str]) -> bytes:
    environment = {
        "HOME": "/nonexistent",
        "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "LANG": "C",
        "LC_ALL": "C",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_NOSYSTEM": "1",
    }
    try:
        result = subprocess.run(
            [
                "/usr/bin/git",
                "-c",
                "core.fsmonitor=false",
                "-c",
                "core.ignorestat=false",
                "-c",
                "core.trustctime=true",
                "-c",
                "extensions.worktreeConfig=false",
                "-C",
                str(repository),
                *arguments,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            env=environment,
        )
    except OSError as error:
        raise ValueError(f"could not execute git: {error}") from error
    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(f"git {' '.join(arguments[:2])} failed: {detail}")
    return result.stdout


def _resolve_commit(repository: pathlib.Path, ref: str, label: str) -> str:
    output = _run_git(
        repository, ["rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}"]
    )
    commit = output.decode("ascii").strip()
    if re.fullmatch(r"[0-9a-f]{40,64}", commit) is None:
        raise ValueError(f"{label} did not resolve to a commit")
    return commit


def _is_migration_path(path: str, migration_root: str) -> bool:
    prefix = re.escape(migration_root.rstrip("/"))
    return re.fullmatch(prefix + r"/[^/]+/migration\.sql", path) is not None


def validate_diff_contract(
    repository: pathlib.Path, base_commit: str, candidate_commit: str, migration_root: str
) -> None:
    output = _run_git(
        repository,
        [
            "diff",
            "--name-status",
            "-z",
            "--find-renames",
            "--find-copies",
            "--find-copies-harder",
            "--no-ext-diff",
            "--no-textconv",
            base_commit,
            candidate_commit,
            "--",
            migration_root,
        ],
    )
    if output and not output.endswith(b"\0"):
        raise ValueError("git diff returned a malformed name-status stream")
    fields = output.rstrip(b"\0").split(b"\0") if output else []
    index = 0
    while index < len(fields):
        try:
            status = fields[index].decode("ascii")
        except UnicodeDecodeError as error:
            raise ValueError("git diff returned a non-ASCII status") from error
        index += 1
        if not status or status[0] not in "ACDMRTUXB":
            raise ValueError(f"git diff returned an unknown status: {status!r}")
        path_count = 2 if status[0] in "RC" else 1
        if index + path_count > len(fields):
            raise ValueError("git diff returned a truncated name-status stream")
        try:
            paths = [field.decode("utf-8") for field in fields[index : index + path_count]]
        except UnicodeDecodeError as error:
            raise ValueError("migration path is not valid UTF-8") from error
        index += path_count
        if any(_is_migration_path(path, migration_root) for path in paths):
            if status != "A" or not _is_migration_path(paths[-1], migration_root):
                raise ValueError(
                    "base-to-candidate migration.sql changes must be additions only: "
                    f"{status} {' -> '.join(paths)}"
                )


def load_candidate_migrations(
    repository: pathlib.Path, candidate_commit: str, migration_root: str
) -> dict[str, CandidateMigration]:
    output = _run_git(
        repository, ["ls-tree", "-r", "-z", candidate_commit, "--", migration_root]
    )
    if output and not output.endswith(b"\0"):
        raise ValueError("git ls-tree returned a malformed stream")
    migrations: dict[str, CandidateMigration] = {}
    records = output.rstrip(b"\0").split(b"\0") if output else []
    for record in records:
        try:
            metadata, raw_path = record.split(b"\t", 1)
            mode, object_type, raw_object_id = metadata.split(b" ", 2)
            path = raw_path.decode("utf-8")
            object_id = raw_object_id.decode("ascii")
        except (ValueError, UnicodeDecodeError) as error:
            raise ValueError("git ls-tree returned a malformed record") from error
        if mode != b"100644" or object_type != b"blob":
            raise ValueError(f"candidate migration root contains a non-regular file: {path}")
        if path == f"{migration_root}/migration_lock.toml":
            continue
        if not _is_migration_path(path, migration_root):
            raise ValueError(f"unexpected file in candidate migration root: {path}")
        name = path.split("/")[-2]
        if MIGRATION_NAME.fullmatch(name) is None:
            raise ValueError(f"invalid candidate migration name: {name}")
        if name in migrations:
            raise ValueError(f"duplicate candidate migration name: {name}")
        content = _run_git(repository, ["cat-file", "blob", object_id])
        migrations[name] = CandidateMigration(name, path, object_id, content)
    return migrations


def validate_repository(
    repository: pathlib.Path,
    base_ref: str,
    candidate_ref: str,
    migration_root: str,
    applied: dict[str, str],
    require_all_candidate_applied: bool = False,
) -> None:
    root = pathlib.PurePosixPath(migration_root)
    if root.is_absolute() or ".." in root.parts or str(root) in ("", "."):
        raise ValueError("migration root must be a repository-relative path")
    migration_root = str(root)
    base_commit = _resolve_commit(repository, base_ref, "base ref")
    candidate_commit = _resolve_commit(repository, candidate_ref, "candidate ref")
    validate_diff_contract(repository, base_commit, candidate_commit, migration_root)
    migrations = load_candidate_migrations(repository, candidate_commit, migration_root)

    for migration_name, expected_checksum in applied.items():
        migration = migrations.get(migration_name)
        if migration is None:
            raise ValueError(f"applied migration is missing from candidate: {migration_name}")
        actual_checksum = hashlib.sha256(migration.content).hexdigest()
        if actual_checksum != expected_checksum:
            raise ValueError(f"applied migration checksum mismatch: {migration_name}")

    for migration in migrations.values():
        checksum = hashlib.sha256(migration.content).hexdigest()
        if applied.get(migration.name) == checksum:
            print(
                f"already-applied migration checksum verified: {migration.name}",
                file=sys.stderr,
            )
            continue
        if require_all_candidate_applied:
            raise ValueError(f"candidate migration is not applied: {migration.name}")
        validate_sql(migration.content, migration.path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--applied-checksums",
        required=True,
        help="Pipe-delimited migration_name|checksum rows, or - for stdin",
    )
    parser.add_argument("--repository", required=True)
    parser.add_argument("--base-ref", required=True)
    parser.add_argument("--candidate-ref", required=True)
    parser.add_argument("--migration-root", default=MIGRATION_ROOT)
    parser.add_argument(
        "--require-all-candidate-applied",
        action="store_true",
        help="Require every candidate migration and checksum in the applied ledger",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.applied_checksums == "-":
            applied = load_applied_checksums(sys.stdin)
        else:
            with open(args.applied_checksums, encoding="utf-8") as stream:
                applied = load_applied_checksums(stream)
        validate_repository(
            pathlib.Path(args.repository),
            args.base_ref,
            args.candidate_ref,
            args.migration_root,
            applied,
            args.require_all_candidate_applied,
        )
    except (OSError, UnicodeError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
