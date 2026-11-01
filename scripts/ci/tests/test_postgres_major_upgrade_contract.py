from pathlib import Path
import re
import shlex
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[3]
GUARD = "/usr/local/bin/db-start-guard.sh"


def mount(value):
    if isinstance(value, dict):
        return value
    parts = value.split(":")
    return {"source": parts[0], "target": parts[1],
            "read_only": len(parts) > 2 and "ro" in parts[2].split(",")}


def argv(value):
    return shlex.split(value) if isinstance(value, str) else value


class PostgresMajorUpgradeContractTest(unittest.TestCase):
    def test_production_switch_contract(self):
        compose = yaml.safe_load((ROOT / "infrastructure/docker/docker-compose.server.yml").read_text())
        db = compose["services"]["db"]
        mounts = [mount(value) for value in db["volumes"]]
        self.assertIn("db-data", compose["volumes"])
        if re.search(r":pg15(?:[.\-][^@]*)?(?:@sha256:[a-f0-9]+)?$", db["image"]):
            self.assertIn({"source": "db-data", "target": "/var/lib/postgresql/data",
                           "read_only": False}, mounts)
            return
        self.assertEqual(argv(db.get("entrypoint")), [GUARD])
        self.assertEqual(argv(db.get("command")), ["postgres"])
        self.assertTrue(any(m["source"] == "db-data-pg18" and
                            m["target"] == "/var/lib/postgresql" and
                            not m.get("read_only", False) for m in mounts))
        environment = db.get("environment", {})
        if isinstance(environment, list):
            environment = dict(item.split("=", 1) for item in environment)
        legacy = environment.get("DB_START_GUARD_LEGACY_PGDATA", "/mnt/legacy-pgdata")
        self.assertTrue(any(m["source"] == "db-data" and m["target"] == legacy and
                            m.get("read_only", False) for m in mounts))
        guard_mount = next(m for m in mounts if m["target"] == GUARD)
        self.assertTrue(guard_mount.get("read_only", False))
        self.assertTrue(guard_mount["source"].endswith("postgres/db-start-guard.sh"))
        self.assertIn("db-data-pg18", compose["volumes"])
        dockerfile = (ROOT / "infrastructure/docker/Dockerfile.api").read_text()
        installed = re.findall(r"apt-get install\b[^;]*?postgresql-client-(\d+)", dockerfile)
        self.assertTrue(installed, "API backup pg_dump must explicitly install client >=18")
        self.assertTrue(all(int(version) >= 18 for version in installed), installed)

    def test_migration_artifacts_exist(self):
        for path in ("scripts/server/postgres-major-upgrade.sh",
                     "infrastructure/docker/postgres/db-start-guard.sh",
                     "docs/runbooks/postgres-15-to-18-upgrade.md"):
            self.assertTrue((ROOT / path).is_file(), path)


if __name__ == "__main__":
    unittest.main()
