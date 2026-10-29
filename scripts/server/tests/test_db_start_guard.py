from pathlib import Path
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
GUARD = ROOT / "infrastructure/docker/postgres/db-start-guard.sh"


class DbStartGuardTest(unittest.TestCase):
    def run_guard(self, legacy=False, current=False, override=False):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            for name, populated in (("legacy", legacy), ("new", current)):
                (base / name).mkdir()
                if populated:
                    (base / name / "PG_VERSION").write_text("15" if name == "legacy" else "18")
            target = base / "entrypoint.sh"
            target.write_text('#!/bin/sh\nprintf "exec:%s\\n" "$@"\n')
            target.chmod(0o755)
            env = dict(os.environ, PGDATA=str(base / "new"),
                       DB_START_GUARD_LEGACY_PGDATA=str(base / "legacy"),
                       DB_START_GUARD_ENTRYPOINT=str(target),
                       POSTGRES_MAJOR_UPGRADE_ALLOW_INITDB="1" if override else "0")
            return subprocess.run(["sh", str(GUARD), "postgres", "-c", "shared_buffers=16MB"],
                                  env=env, capture_output=True, text=True)

    def assert_exec(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "exec:postgres\nexec:-c\nexec:shared_buffers=16MB\n")

    def test_both_empty(self):
        self.assert_exec(self.run_guard())

    def test_legacy_data_refuses_empty_new(self):
        result = self.run_guard(legacy=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("exec:", result.stdout)
        self.assertIn("docs/runbooks/postgres-15-to-18-upgrade.md", result.stderr)

    def test_new_data(self):
        self.assert_exec(self.run_guard(legacy=True, current=True))

    def test_explicit_override(self):
        self.assert_exec(self.run_guard(legacy=True, override=True))


if __name__ == "__main__":
    unittest.main()
