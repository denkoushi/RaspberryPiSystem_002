from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "scripts/deploy/pi5-release-evidence.py"
SPEC = importlib.util.spec_from_file_location("pi5_release_evidence", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
evidence = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evidence)


class Pi5ReleaseEvidenceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.sha = "a" * 40
        self.run_id = "run-123"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def migration_args(self, **changes: object) -> object:
        ledger = self.root / "ledger.txt"
        ledger.write_text("migration_1|" + "b" * 64 + "\n", encoding="utf-8")
        values: dict[str, object] = {
            "output": self.root / "migration.json",
            "run_id": self.run_id,
            "sha": self.sha,
            "base_sha": "c" * 40,
            "ledger": ledger,
            "ttl": 3600,
        }
        values.update(changes)
        return type("Args", (), values)()

    def resource_args(self, **changes: object) -> object:
        values: dict[str, object] = {
            "output": self.root / "resource.json",
            "run_id": self.run_id,
            "sha": self.sha,
            "api_image": f"api:{self.sha}-abc123def456",
            "web_image": f"web:{self.sha}-abc123def456",
            "api_image_id": "sha256:" + "1" * 64,
            "web_image_id": "sha256:" + "2" * 64,
            "memory_mb": 2048.0,
            "disk_gb": 20.0,
            "min_memory_mb": 768.0,
            "min_disk_gb": 10.0,
            "max_load": 3.0,
            "samples_json": json.dumps(
                [
                    {"atEpoch": 960, "load": 0.2},
                    {"atEpoch": 980, "load": 0.3},
                    {"atEpoch": 1000, "load": 0.4},
                ]
            ),
            "ttl": 300,
        }
        values.update(changes)
        return type("Args", (), values)()

    def test_migration_plan_binds_run_sha_and_ledger(self) -> None:
        with mock.patch.object(evidence.time, "time", return_value=1000):
            evidence.create_migration(self.migration_args())
            verify = type(
                "Args",
                (),
                {
                    "path": self.root / "migration.json",
                    "run_id": self.run_id,
                    "sha": self.sha,
                    "ledger": self.root / "ledger.txt",
                },
            )()
            evidence.verify_migration(verify)

        (self.root / "ledger.txt").write_text("", encoding="utf-8")
        with mock.patch.object(evidence.time, "time", return_value=1001):
            with self.assertRaisesRegex(evidence.EvidenceError, "ledger changed"):
                evidence.verify_migration(verify)

    def test_resource_rejects_wrong_run_image_and_expiry(self) -> None:
        with mock.patch.object(evidence.time, "time", return_value=1000):
            evidence.create_resource(self.resource_args())
        base = {
            "path": self.root / "resource.json",
            "run_id": self.run_id,
            "sha": self.sha,
            "api_image": f"api:{self.sha}-abc123def456",
            "web_image": f"web:{self.sha}-abc123def456",
            "api_image_id": "sha256:" + "1" * 64,
            "web_image_id": "sha256:" + "2" * 64,
            "min_memory_mb": 768.0,
            "min_disk_gb": 10.0,
            "max_load": 3.0,
            "sample_interval": 20,
        }
        with mock.patch.object(evidence.time, "time", return_value=1001):
            evidence.verify_resource(type("Args", (), base)())
            wrong_run = dict(base, run_id="other-run")
            with self.assertRaisesRegex(evidence.EvidenceError, "different run"):
                evidence.verify_resource(type("Args", (), wrong_run)())
            wrong_image = dict(base, api_image_id="sha256:" + "3" * 64)
            with self.assertRaisesRegex(evidence.EvidenceError, "exact candidate"):
                evidence.verify_resource(type("Args", (), wrong_image)())
        with mock.patch.object(evidence.time, "time", return_value=1301):
            with self.assertRaisesRegex(evidence.EvidenceError, "expired"):
                evidence.verify_resource(type("Args", (), base)())

    def test_tampering_and_insecure_permissions_fail_closed(self) -> None:
        with mock.patch.object(evidence.time, "time", return_value=1000):
            evidence.create_resource(self.resource_args())
        path = self.root / "resource.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        payload["data"]["values"]["memoryMb"] = 999999
        path.write_text(json.dumps(payload), encoding="utf-8")
        path.chmod(0o600)
        with self.assertRaisesRegex(evidence.EvidenceError, "seal"):
            evidence._read(path)
        with mock.patch.object(evidence.time, "time", return_value=1000):
            evidence.create_resource(self.resource_args())
        path.chmod(0o644)
        with self.assertRaisesRegex(evidence.EvidenceError, "permissions"):
            evidence._read(path)

    def test_resource_creation_rejects_failed_threshold(self) -> None:
        with self.assertRaisesRegex(evidence.EvidenceError, "thresholds"):
            evidence.create_resource(self.resource_args(memory_mb=100.0))

    def test_non_finite_bool_and_short_interval_fail_closed(self) -> None:
        with self.assertRaisesRegex(evidence.EvidenceError, "finite"):
            evidence.create_resource(self.resource_args(memory_mb=float("nan")))
        with self.assertRaisesRegex(evidence.EvidenceError, "malformed"):
            evidence.create_resource(
                self.resource_args(
                    samples_json=json.dumps(
                        [
                            {"atEpoch": True, "load": 0.1},
                            {"atEpoch": 980, "load": 0.2},
                            {"atEpoch": 1000, "load": 0.3},
                        ]
                    )
                )
            )
        with self.assertRaisesRegex(evidence.EvidenceError, "non-finite"):
            evidence.create_resource(
                self.resource_args(samples_json='[{"atEpoch":960,"load":NaN}]')
            )
        with self.assertRaisesRegex(evidence.EvidenceError, "TTL"):
            evidence.create_resource(self.resource_args(ttl=301))
        with self.assertRaisesRegex(evidence.EvidenceError, "required interval"):
            evidence.create_resource(
                self.resource_args(
                    samples_json=json.dumps(
                        [
                            {"atEpoch": 990, "load": 0.1},
                            {"atEpoch": 995, "load": 0.2},
                            {"atEpoch": 1000, "load": 0.3},
                        ]
                    )
                )
            )


if __name__ == "__main__":
    unittest.main()
