#!/usr/bin/env python3
from __future__ import annotations

import errno
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[3]
VALIDATOR_PATH = ROOT / "scripts/deploy/validate-expand-only-migrations.py"
SPEC = importlib.util.spec_from_file_location("migration_validator", VALIDATOR_PATH)
assert SPEC is not None and SPEC.loader is not None
validator = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = validator
SPEC.loader.exec_module(validator)


class GitFixture:
    def __init__(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.path = pathlib.Path(self.temporary.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Migration Gate Test")
        self.git("config", "user.email", "migration-gate@example.invalid")
        self.git("config", "gc.auto", "0")
        self.git("config", "maintenance.auto", "false")
        self.git("config", "core.fsmonitor", "false")

    def close(self) -> None:
        for attempt in range(5):
            try:
                self.temporary.cleanup()
                return
            except OSError as error:
                if error.errno != errno.ENOTEMPTY or attempt == 4:
                    raise
                time.sleep(0.05 * (attempt + 1))

    def git(self, *arguments: str) -> str:
        result = subprocess.run(
            ["git", "-C", str(self.path), *arguments],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        return result.stdout.strip()

    def write_migration(self, name: str, sql: str) -> pathlib.Path:
        path = self.path / validator.MIGRATION_ROOT / name / "migration.sql"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(sql, encoding="utf-8")
        return path

    def write_lock(self) -> None:
        path = self.path / validator.MIGRATION_ROOT / "migration_lock.toml"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('provider = "postgresql"\n', encoding="utf-8")

    def write_repair_manifest(
        self,
        migration: str,
        old_checksum: str,
        new_checksum: str,
        *,
        reason: str = "Merged migration is confirmed unapplied and needs a safe replacement.",
    ) -> pathlib.Path:
        path = self.path / validator.REPAIR_MANIFEST
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "repairs": [
                        {
                            "migration": migration,
                            "oldChecksum": old_checksum,
                            "newChecksum": new_checksum,
                            "reason": reason,
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        return path

    def commit(self, message: str, *, allow_empty: bool = False) -> str:
        self.git("add", "-A")
        arguments = ["commit", "-q", "-m", message]
        if allow_empty:
            arguments.insert(1, "--allow-empty")
        self.git(*arguments)
        return self.git("rev-parse", "HEAD")


class SqlAllowListTests(unittest.TestCase):
    def assert_allowed(self, sql: str) -> None:
        validator.validate_sql(sql.encode(), "test/migration.sql")

    def assert_disallowed(self, sql: str) -> None:
        with self.assertRaises(ValueError):
            validator.validate_sql(sql.encode(), "test/migration.sql")

    def test_exact_expand_only_subset_is_allowed(self) -> None:
        statements = [
            'CREATE TABLE "Widget" ("id" INTEGER NOT NULL, CONSTRAINT "Widget_pkey" PRIMARY KEY ("id"));',
            'CREATE INDEX "Widget_note_idx" ON "Widget"("note");',
            'CREATE TABLE "UniqueWidget" ("id" INTEGER NOT NULL); CREATE UNIQUE INDEX "UniqueWidget_id_key" ON "UniqueWidget"("id") WHERE "id" IS NOT NULL;',
            "CREATE TYPE \"Mood\" AS ENUM ('calm', 'busy');",
            'CREATE SEQUENCE IF NOT EXISTS "Widget_counter" START WITH 1;',
            'CREATE SCHEMA IF NOT EXISTS "archive" AUTHORIZATION "postgres";',
            'ALTER TABLE "Widget" ADD COLUMN "note" TEXT;',
            'ALTER TABLE "Widget" ADD COLUMN "amount" NUMERIC(12, 3);',
            'ALTER TABLE "Widget" ADD COLUMN "seenAt" TIMESTAMP(3) WITH TIME ZONE;',
            'ALTER TABLE "Widget" ADD COLUMN "tags" TEXT[];',
            "COMMENT ON COLUMN \"Widget\".\"note\" IS 'shown to operators';",
        ]
        for statement in statements:
            with self.subTest(statement=statement):
                self.assert_allowed(statement)

    def test_comments_and_quoted_constructs_do_not_change_statement_boundaries(self) -> None:
        self.assert_allowed(
            '/* outer /* nested */ comment */ CREATE TABLE "dash--board" ("id" INTEGER);\n'
            "COMMENT ON TABLE \"dash--board\" IS $note$semi; -- DROP TABLE hidden$text$note$;"
        )

    def test_destructive_or_non_conservative_operations_are_rejected(self) -> None:
        statements = [
            'ALTER TABLE "Widget" ADD COLUMN "note" TEXT NOT NULL;',
            'ALTER TABLE "Widget" ADD COLUMN "note" TEXT DEFAULT \'x\';',
            'ALTER TABLE "Widget" ADD COLUMN "ownerId" INTEGER REFERENCES "Owner"("id");',
            'ALTER TABLE "Widget" ADD COLUMN "score" INTEGER CHECK ("score" > 0);',
            'ALTER TABLE "Widget" ADD COLUMN "slug" TEXT UNIQUE;',
            'ALTER TABLE "Widget" ADD COLUMN "id" INTEGER GENERATED ALWAYS AS IDENTITY;',
            'ALTER TABLE "Widget" ADD COLUMN "id" SERIAL;',
            'ALTER TABLE "Widget" ADD COLUMN "required" "RequiredText";',
            'ALTER TABLE "Widget" ADD COLUMN "required" required_text;',
            'ALTER TABLE "Widget" ADD COLUMN "required" public.required_text;',
            'ALTER TABLE "Widget" ADD COLUMN "a" TEXT, ADD COLUMN "b" TEXT;',
            'ALTER TABLE "Widget" ADD CONSTRAINT "exclude_overlap" EXCLUDE USING gist ("id" WITH =);',
            'ALTER TABLE "Widget" DROP COLUMN "note";',
            'CREATE UNIQUE INDEX "Widget_note_key" ON "Widget"("note");',
            'CREATE EXTENSION IF NOT EXISTS "pgcrypto";',
            'CREATE TYPE "Composite" AS ("value" INTEGER);',
            'INSERT INTO "Widget" ("id") VALUES (1);',
            'UPDATE "Widget" SET "id" = 2;',
            'DELETE FROM "Widget";',
            'DROP TABLE "Widget";',
        ]
        for statement in statements:
            with self.subTest(statement=statement):
                self.assert_disallowed(statement)

    def test_standard_string_backslash_cannot_hide_following_drop(self) -> None:
        statements = validator.split_sql_statements(
            "COMMENT ON TABLE \"Widget\" IS 'ends in backslash\\'; DROP TABLE \"Widget\";"
        )
        self.assertEqual(2, len(statements))
        self.assertTrue(statements[1].code.startswith("DROP TABLE"))
        self.assert_disallowed(
            "COMMENT ON TABLE \"Widget\" IS 'ends in backslash\\'; DROP TABLE \"Widget\";"
        )

    def test_line_comment_marker_inside_string_cannot_hide_following_drop(self) -> None:
        sql = (
            'COMMENT ON TABLE "Example" IS \'keep -- comment\'; '
            'DROP TABLE "Example";'
        )
        statements = validator.split_sql_statements(sql)
        self.assertEqual(2, len(statements))
        self.assertTrue(statements[1].code.startswith("DROP TABLE"))
        self.assert_disallowed(sql)

    def test_escape_string_does_not_hide_following_drop(self) -> None:
        statements = validator.split_sql_statements(
            "COMMENT ON TABLE \"Widget\" IS E'quote\\' and -- text;'; DROP TABLE \"Widget\";"
        )
        self.assertEqual(2, len(statements))
        self.assertTrue(statements[1].code.startswith("DROP TABLE"))
        self.assert_disallowed(
            "COMMENT ON TABLE \"Widget\" IS E'quote\\' and -- text;'; DROP TABLE \"Widget\";"
        )

    def test_e_prefix_after_unicode_identifier_continuation_is_not_escape_string(self) -> None:
        for continuation in ("\u0301", "\u200c"):
            sql = f"COMMENT ON TABLE x IS foo{continuation}e'backslash\\'; DROP TABLE y;"
            with self.subTest(continuation=continuation):
                statements = validator.split_sql_statements(sql)
                self.assertEqual(2, len(statements))
                self.assertTrue(statements[1].code.startswith("DROP TABLE"))
                self.assert_disallowed(sql)

    def test_dollar_quote_marker_inside_identifier_cannot_hide_drop(self) -> None:
        for type_name in ("foo", "foo\u0301", "foo\u200c"):
            sql = (
                f"CREATE TABLE x (id {type_name}$tag$); DROP TABLE y; "
                f"SELECT (NULL::{type_name}$tag$);"
            )
            with self.subTest(type_name=type_name):
                statements = validator.split_sql_statements(sql)
                self.assertEqual(3, len(statements))
                self.assertTrue(statements[1].code.startswith("DROP TABLE"))
                self.assert_disallowed(sql)

    def test_unterminated_lexical_constructs_fail_closed(self) -> None:
        statements = [
            "COMMENT ON TABLE x IS 'unterminated",
            'COMMENT ON TABLE "unterminated IS NULL',
            "COMMENT ON TABLE x IS $tag$unterminated",
            "/* unterminated CREATE TABLE x (id INTEGER);",
        ]
        for statement in statements:
            with self.subTest(statement=statement):
                self.assert_disallowed(statement)


class RepositoryGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = GitFixture()
        self.repo.write_lock()

    def tearDown(self) -> None:
        self.repo.close()

    def validate(
        self,
        base: str,
        candidate: str,
        applied: dict[str, str] | None = None,
        *,
        allow_repairs: bool = False,
    ) -> None:
        validator.validate_repository(
            self.repo.path,
            base,
            candidate,
            validator.MIGRATION_ROOT,
            applied or {},
            allow_declared_unapplied_repairs=allow_repairs,
        )

    def test_restored_applied_migration_accepts_dml_when_checksum_matches(self) -> None:
        base = self.repo.commit("base")
        path = self.repo.write_migration(
            "202607140001_restored",
            'UPDATE "Widget" SET "value" = 1;\nALTER TABLE "Widget" ADD CONSTRAINT "value_check" CHECK ("value" > 0);\n',
        )
        checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        candidate = self.repo.commit("restore applied migration")
        self.validate(base, candidate, {"202607140001_restored": checksum})

    def test_applied_migration_must_exist(self) -> None:
        base = self.repo.commit("base")
        with self.assertRaisesRegex(ValueError, "missing from candidate"):
            self.validate(base, base, {"202607140001_missing": "0" * 64})

    def test_applied_checksum_must_match(self) -> None:
        path = self.repo.write_migration(
            "202607140002_applied", 'CREATE TABLE "Widget" ("id" INTEGER);\n'
        )
        base = self.repo.commit("base")
        self.assertNotEqual("0" * 64, hashlib.sha256(path.read_bytes()).hexdigest())
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            self.validate(base, base, {"202607140002_applied": "0" * 64})

    def test_zero_new_migrations_still_verify_full_applied_history(self) -> None:
        path = self.repo.write_migration(
            "202607140003_historical", 'DELETE FROM "Widget";\n'
        )
        checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        base = self.repo.commit("base")
        candidate = self.repo.commit("no migration changes", allow_empty=True)
        self.validate(base, candidate, {"202607140003_historical": checksum})

    def test_base_existing_pending_migration_is_validated(self) -> None:
        self.repo.write_migration(
            "202607140004_pending", 'DELETE FROM "Widget";\n'
        )
        base = self.repo.commit("base")
        candidate = self.repo.commit("no migration changes", allow_empty=True)
        with self.assertRaisesRegex(ValueError, "disallowed statement"):
            self.validate(base, candidate)

    def test_base_existing_pending_nullable_column_is_accepted(self) -> None:
        self.repo.write_migration(
            "202607140004_safe_pending",
            'ALTER TABLE "Widget" ADD COLUMN "note" TEXT;\n',
        )
        base = self.repo.commit("base")
        candidate = self.repo.commit("no migration changes", allow_empty=True)
        self.validate(base, candidate)

    def test_safe_candidate_addition_is_accepted(self) -> None:
        base = self.repo.commit("base")
        self.repo.write_migration(
            "202607140005_expand", 'ALTER TABLE "Widget" ADD COLUMN "note" TEXT;\n'
        )
        candidate = self.repo.commit("safe expand")
        self.validate(base, candidate)

    def test_modified_migration_is_rejected_before_sql_validation(self) -> None:
        self.repo.write_migration(
            "202607140006_modified", 'CREATE TABLE "Widget" ("id" INTEGER);\n'
        )
        base = self.repo.commit("base")
        self.repo.write_migration(
            "202607140006_modified", 'CREATE TABLE "Widget" ("id" BIGINT);\n'
        )
        candidate = self.repo.commit("modify migration")
        with self.assertRaisesRegex(ValueError, "additions only"):
            self.validate(base, candidate)

    def test_exact_declared_unapplied_repair_is_revalidated_as_pending(self) -> None:
        name = "202607140006_declared_repair"
        path = self.repo.write_migration(
            name, 'ALTER TABLE "Widget" ADD COLUMN "note" TEXT NOT NULL;\n'
        )
        old_checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        base = self.repo.commit("base")
        path.write_text(
            'CREATE TABLE "WidgetNote" ("id" TEXT NOT NULL, '
            'CONSTRAINT "WidgetNote_pkey" PRIMARY KEY ("id"));\n',
            encoding="utf-8",
        )
        new_checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        self.repo.write_repair_manifest(name, old_checksum, new_checksum)
        candidate = self.repo.commit("repair unapplied migration")

        self.validate(
            base,
            candidate,
            {name: old_checksum},
            allow_repairs=True,
        )

    def test_declared_repair_checksum_mismatch_is_rejected(self) -> None:
        name = "202607140006_bad_repair_checksum"
        path = self.repo.write_migration(
            name, 'CREATE TABLE "Widget" ("id" INTEGER);\n'
        )
        old_checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        base = self.repo.commit("base")
        path.write_text('CREATE TABLE "Widget" ("id" BIGINT);\n', encoding="utf-8")
        new_checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        self.repo.write_repair_manifest(name, "0" * 64, new_checksum)
        candidate = self.repo.commit("bad repair checksum")

        with self.assertRaisesRegex(ValueError, "repair checksum mismatch"):
            self.validate(
                base,
                candidate,
                {name: old_checksum},
                allow_repairs=True,
            )

    def test_declared_repair_still_requires_expand_only_sql(self) -> None:
        name = "202607140006_unsafe_repair"
        path = self.repo.write_migration(
            name, 'CREATE TABLE "Widget" ("id" INTEGER);\n'
        )
        old_checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        base = self.repo.commit("base")
        path.write_text('DROP TABLE "Widget";\n', encoding="utf-8")
        new_checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        self.repo.write_repair_manifest(name, old_checksum, new_checksum)
        candidate = self.repo.commit("unsafe repair")

        with self.assertRaisesRegex(ValueError, "disallowed statement"):
            self.validate(
                base,
                candidate,
                {name: old_checksum},
                allow_repairs=True,
            )

    def test_repair_manifest_never_changes_default_production_behavior(self) -> None:
        name = "202607140006_production_applied"
        path = self.repo.write_migration(
            name, 'CREATE TABLE "Widget" ("id" INTEGER);\n'
        )
        old_checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        base = self.repo.commit("base")
        path.write_text('CREATE TABLE "Widget" ("id" BIGINT);\n', encoding="utf-8")
        new_checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        self.repo.write_repair_manifest(name, old_checksum, new_checksum)
        candidate = self.repo.commit("declared but production applied")

        with self.assertRaisesRegex(ValueError, "additions only"):
            self.validate(base, candidate, {name: old_checksum})

    def test_repair_manifest_is_read_from_candidate_commit(self) -> None:
        name = "202607140006_manifest_object"
        path = self.repo.write_migration(
            name, 'CREATE TABLE "Widget" ("id" INTEGER);\n'
        )
        old_checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        base = self.repo.commit("base")
        path.write_text('CREATE TABLE "Widget" ("id" BIGINT);\n', encoding="utf-8")
        new_checksum = hashlib.sha256(path.read_bytes()).hexdigest()
        manifest = self.repo.write_repair_manifest(name, old_checksum, new_checksum)
        candidate = self.repo.commit("repair candidate")
        manifest.write_text("{not-json", encoding="utf-8")

        self.validate(
            base,
            candidate,
            {name: old_checksum},
            allow_repairs=True,
        )

    def test_deleted_migration_is_rejected(self) -> None:
        path = self.repo.write_migration(
            "202607140007_deleted", 'CREATE TABLE "Widget" ("id" INTEGER);\n'
        )
        base = self.repo.commit("base")
        path.unlink()
        candidate = self.repo.commit("delete migration")
        with self.assertRaisesRegex(ValueError, "additions only"):
            self.validate(base, candidate)

    def test_renamed_migration_is_rejected(self) -> None:
        old_path = self.repo.write_migration(
            "202607140008_old", 'CREATE TABLE "Widget" ("id" INTEGER);\n'
        )
        base = self.repo.commit("base")
        new_path = old_path.parents[1] / "202607140008_new" / "migration.sql"
        new_path.parent.mkdir(parents=True)
        old_path.rename(new_path)
        old_path.parent.rmdir()
        candidate = self.repo.commit("rename migration")
        with self.assertRaisesRegex(ValueError, "additions only"):
            self.validate(base, candidate)

    def test_copied_migration_is_rejected(self) -> None:
        source = self.repo.write_migration(
            "202607140009_source", 'CREATE TABLE "Widget" ("id" INTEGER);\n'
        )
        source_checksum = hashlib.sha256(source.read_bytes()).hexdigest()
        base = self.repo.commit("base")
        self.repo.write_migration("202607140009_copy", source.read_text(encoding="utf-8"))
        candidate = self.repo.commit("copy migration")
        with self.assertRaisesRegex(ValueError, "additions only"):
            self.validate(base, candidate, {"202607140009_source": source_checksum})

    def test_git_diff_error_fails_closed(self) -> None:
        candidate = self.repo.commit("base")
        with self.assertRaisesRegex(ValueError, "git diff.*failed"):
            validator.validate_diff_contract(
                self.repo.path,
                "0" * 40,
                candidate,
                validator.MIGRATION_ROOT,
            )

    def test_candidate_commit_bytes_win_over_dirty_worktree(self) -> None:
        base = self.repo.commit("base")
        path = self.repo.write_migration(
            "202607140010_object", 'ALTER TABLE "Widget" ADD COLUMN "note" TEXT;\n'
        )
        candidate = self.repo.commit("safe candidate")
        path.write_text('DROP TABLE "Widget";\n', encoding="utf-8")
        self.validate(base, candidate)


if __name__ == "__main__":
    unittest.main()
