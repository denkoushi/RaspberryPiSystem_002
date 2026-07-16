import concurrent.futures
import json
import os
import stat
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch


DEPLOY_DIRECTORY = Path(__file__).parents[1]
if str(DEPLOY_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIRECTORY))

from rolling_release import fleet_state as fleet_state_module  # noqa: E402
from rolling_release.fleet_state import (  # noqa: E402
    FleetLock,
    FleetLockBusyError,
    FleetLockError,
    FleetRunConflictError,
    FleetStateCorruptError,
    FleetStateError,
    FleetStateStore,
    StaleFleetGenerationError,
    empty_fleet_state,
)
from terminal_profile_registry import load_registry  # noqa: E402


RUN_ID = "20260715-123456-a1b2c3"
OTHER_RUN_ID = "20260715-123457-d4e5f6"
SHA_A = "a" * 40
SHA_B = "b" * 40
SHA_C = "c" * 40
DIGEST_A = "sha256:" + "a" * 64
DIGEST_B = "sha256:" + "b" * 64
INVENTORY = "infrastructure/ansible/inventory.yml"


class FleetStateStoreTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "logs" / "deploy"
        self.state_path = self.root / "fleet-release-state.json"
        self.lock_path = self.root / "fleet-release-state.lock"
        self.times = iter(
            f"2026-07-15T00:00:{second:02d}Z" for second in range(60)
        )
        self.store = FleetStateStore(
            self.state_path,
            lock_path=self.lock_path,
            clock=lambda: next(self.times),
        )

    def tearDown(self):
        self.temporary.cleanup()

    def begin(self, *, expected_generation=0, run_id=RUN_ID):
        return self.store.begin_run(
            run_id,
            SHA_A,
            INVENTORY,
            expected_generation=expected_generation,
        )

    def test_missing_read_is_empty_and_creates_no_state_directory_or_lock(self):
        self.assertEqual(self.store.read_only(), empty_fleet_state())
        self.assertFalse(self.root.exists())
        self.assertFalse(self.state_path.exists())
        self.assertFalse(self.lock_path.exists())

    def test_begin_run_creates_generation_checked_active_summary(self):
        state = self.begin()

        self.assertEqual(state["generation"], 1)
        self.assertEqual(
            state["activeRun"],
            {
                "runId": RUN_ID,
                "status": "running",
                "desiredSha": SHA_A,
                "inventory": INVENTORY,
                "startedAt": "2026-07-15T00:00:00Z",
            },
        )
        self.assertIsNone(state["lastRun"])
        self.assertEqual(self.store.read_only(), state)
        self.assertEqual(stat.S_IMODE(self.state_path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.lock_path.stat().st_mode), 0o600)

    def test_begin_rejects_active_run_and_wrong_run_transitions(self):
        self.begin()
        with self.assertRaisesRegex(FleetRunConflictError, RUN_ID):
            self.store.begin_run(
                OTHER_RUN_ID,
                SHA_B,
                INVENTORY,
                expected_generation=1,
            )
        self.assertEqual(self.store.read_only()["generation"], 1)

        with self.assertRaisesRegex(FleetRunConflictError, OTHER_RUN_ID):
            self.store.mark_host_unknown(
                "kiosk-a",
                "kiosk",
                SHA_A,
                OTHER_RUN_ID,
                expected_generation=1,
            )
        self.assertEqual(self.store.read_only()["generation"], 1)

    def test_unknown_transition_preserves_only_the_last_confirmed_sha(self):
        state = self.begin()
        state = self.store.mark_host_verified(
            "kiosk-a",
            "kiosk",
            SHA_A,
            SHA_A,
            RUN_ID,
            expected_generation=state["generation"],
            previous_sha=SHA_C,
        )
        state = self.store.mark_host_unknown(
            "kiosk-a",
            "kiosk",
            SHA_B,
            RUN_ID,
            expected_generation=state["generation"],
        )

        self.assertEqual(
            state["fleet"]["kiosk-a"],
            {
                "role": "kiosk",
                "desiredSha": SHA_B,
                "currentSha": None,
                "previousSha": SHA_A,
                "evidence": "unknown",
                "verifiedAt": None,
                "lastRunId": RUN_ID,
            },
        )

        state = self.store.mark_host_verified(
            "kiosk-a",
            "kiosk",
            SHA_B,
            SHA_B,
            RUN_ID,
            expected_generation=state["generation"],
        )
        self.assertEqual(state["fleet"]["kiosk-a"]["previousSha"], SHA_A)

    def test_unknown_server_clears_runtime_identity_instead_of_reusing_stale_evidence(self):
        state = self.begin()
        state = self.store.mark_host_verified(
            "raspberrypi5",
            "server",
            SHA_A,
            SHA_A,
            RUN_ID,
            expected_generation=state["generation"],
            active_slot="green",
            api_image=f"raspi-api:{SHA_A}-aaaaaaaaaaaa",
            web_image=f"raspi-web:{SHA_A}-aaaaaaaaaaaa",
            config_digest=DIGEST_A,
            migration_digest=DIGEST_B,
        )
        state = self.store.mark_host_unknown(
            "raspberrypi5",
            "server",
            SHA_B,
            RUN_ID,
            expected_generation=state["generation"],
        )

        record = state["fleet"]["raspberrypi5"]
        self.assertEqual(record["previousSha"], SHA_A)
        self.assertIsNone(record["currentSha"])
        self.assertEqual(record["evidence"], "unknown")
        for field in (
            "activeSlot",
            "apiImage",
            "webImage",
            "configDigest",
            "migrationDigest",
        ):
            self.assertIsNone(record[field])

    def test_same_sha_unknown_transition_preserves_the_real_previous_sha(self):
        state = self.begin()
        state = self.store.mark_host_verified(
            "kiosk-a",
            "kiosk",
            SHA_A,
            SHA_A,
            RUN_ID,
            expected_generation=state["generation"],
            previous_sha=SHA_B,
        )
        state = self.store.mark_host_unknown(
            "kiosk-a",
            "kiosk",
            SHA_A,
            RUN_ID,
            expected_generation=state["generation"],
        )

        self.assertEqual(state["fleet"]["kiosk-a"]["previousSha"], SHA_B)

    def test_verified_terminal_may_record_a_verified_rollback_drift(self):
        state = self.begin()
        state = self.store.mark_host_verified(
            "signage-a",
            "signage",
            SHA_B,
            SHA_A,
            RUN_ID,
            expected_generation=state["generation"],
            previous_sha=SHA_A,
        )

        record = state["fleet"]["signage-a"]
        self.assertEqual(record["desiredSha"], SHA_B)
        self.assertEqual(record["currentSha"], SHA_A)
        self.assertEqual(record["evidence"], "verified")
        self.assertEqual(record["verifiedAt"], "2026-07-15T00:00:01Z")

    def test_verified_server_requires_complete_slot_image_and_digest_evidence(self):
        state = self.begin()
        invalid_arguments = (
            {},
            {
                "active_slot": "green",
                "api_image": "api:image",
                "web_image": "web:image",
                "config_digest": "sha256:short",
                "migration_digest": DIGEST_B,
            },
            {
                "active_slot": "green",
                "api_image": f"api:{SHA_B}-aaaaaaaaaaaa",
                "web_image": f"web:{SHA_B}-bbbbbbbbbbbb",
                "config_digest": DIGEST_A,
                "migration_digest": DIGEST_B,
            },
        )
        for arguments in invalid_arguments:
            with self.subTest(arguments=arguments), self.assertRaises(
                FleetStateCorruptError
            ):
                self.store.mark_host_verified(
                    "raspberrypi5",
                    "server",
                    SHA_A,
                    SHA_A,
                    RUN_ID,
                    expected_generation=state["generation"],
                    **arguments,
                )
        self.assertEqual(self.store.read_only()["generation"], 1)

        state = self.store.mark_host_verified(
            "raspberrypi5",
            "server",
            SHA_A,
            SHA_A,
            RUN_ID,
            expected_generation=state["generation"],
            active_slot="blue",
            api_image=f"api:{SHA_A}-aaaaaaaaaaaa",
            web_image=f"web:{SHA_A}-bbbbbbbbbbbb",
            config_digest=DIGEST_A,
            migration_digest=DIGEST_B,
        )
        self.assertEqual(state["fleet"]["raspberrypi5"]["activeSlot"], "blue")

        run_scoped = json.loads(json.dumps(state))
        run_digest = "9" * 64
        run_scoped["fleet"]["raspberrypi5"]["apiImage"] = (
            f"api:{SHA_A}-aaaaaaaaaaaa-{run_digest}"
        )
        run_scoped["fleet"]["raspberrypi5"]["webImage"] = (
            f"web:{SHA_A}-bbbbbbbbbbbb-{run_digest}"
        )
        self.assertEqual(
            fleet_state_module.validate_fleet_state(run_scoped), run_scoped
        )
        malformed = json.loads(json.dumps(run_scoped))
        malformed["fleet"]["raspberrypi5"]["apiImage"] = (
            f"api:{SHA_A}-aaaaaaaaaaaa-{'9' * 63}"
        )
        with self.assertRaisesRegex(FleetStateCorruptError, "does not match"):
            fleet_state_module.validate_fleet_state(malformed)

    def test_terminal_role_rejects_pi5_only_fields_before_mutation(self):
        state = self.begin()
        with self.assertRaisesRegex(ValueError, "server role"):
            self.store.mark_host_verified(
                "kiosk-a",
                "kiosk",
                SHA_A,
                SHA_A,
                RUN_ID,
                expected_generation=state["generation"],
                active_slot="blue",
            )
        self.assertEqual(self.store.read_only()["generation"], 1)

    def test_registered_synthetic_profile_uses_the_existing_json_shape(self):
        base = load_registry()
        synthetic = replace(
            base.profiles[0],
            id="inspection-panel",
            inventory_group="inspection_panels",
            rollout_order=15,
            impact_component="inspection-panel-role",
            canary_group="inspection_panel_canary",
        )
        registry = replace(
            base,
            profiles=(base.profiles[0], synthetic, base.profiles[1]),
        )
        self.begin()

        with patch.object(
            fleet_state_module, "load_registry", return_value=registry
        ):
            state = self.store.mark_host_unknown(
                "inspection-a",
                "inspection-panel",
                SHA_A,
                RUN_ID,
                expected_generation=1,
            )
            record = state["fleet"]["inspection-a"]
            self.assertEqual(record["role"], "inspection-panel")
            self.assertEqual(
                set(record),
                {
                    "role",
                    "desiredSha",
                    "currentSha",
                    "previousSha",
                    "evidence",
                    "verifiedAt",
                    "lastRunId",
                },
            )

    def test_finish_moves_active_run_to_last_run_and_abandon_uses_interrupted(self):
        state = self.begin()
        state = self.store.finish_run(
            RUN_ID,
            "success",
            expected_generation=state["generation"],
        )
        self.assertIsNone(state["activeRun"])
        self.assertEqual(state["lastRun"]["status"], "success")
        self.assertEqual(state["lastRun"]["endedAt"], "2026-07-15T00:00:01Z")

        state = self.store.begin_run(
            OTHER_RUN_ID,
            SHA_B,
            INVENTORY,
            expected_generation=state["generation"],
            kind="pi4-recovery",
        )
        state = self.store.mark_host_unknown(
            "kiosk-a",
            "kiosk",
            SHA_B,
            OTHER_RUN_ID,
            expected_generation=state["generation"],
        )
        state = self.store.abandon_active_run(
            OTHER_RUN_ID,
            expected_generation=state["generation"],
        )

        self.assertIsNone(state["activeRun"])
        self.assertEqual(state["lastRun"]["runId"], OTHER_RUN_ID)
        self.assertEqual(state["lastRun"]["status"], "interrupted")
        self.assertEqual(state["lastRun"]["kind"], "pi4-recovery")
        self.assertEqual(state["fleet"]["kiosk-a"]["evidence"], "unknown")

    def test_stale_generation_is_rejected_without_replacing_state(self):
        state = self.begin()
        before = self.state_path.read_bytes()

        with self.assertRaises(StaleFleetGenerationError) as raised:
            self.store.finish_run(RUN_ID, "success", expected_generation=0)

        self.assertEqual(raised.exception.expected, 0)
        self.assertEqual(raised.exception.actual, state["generation"])
        self.assertEqual(self.state_path.read_bytes(), before)

    def test_two_writers_from_one_generation_have_one_success_and_one_stale_result(self):
        state = self.begin()

        def write(host):
            try:
                result = self.store.mark_host_unknown(
                    host,
                    "kiosk",
                    SHA_A,
                    RUN_ID,
                    expected_generation=state["generation"],
                )
                return ("success", result["generation"])
            except StaleFleetGenerationError as error:
                return ("stale", error.actual)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(write, ("kiosk-a", "kiosk-b")))

        self.assertEqual(sorted(label for label, _generation in results), ["stale", "success"])
        self.assertEqual(self.store.read_only()["generation"], 2)
        self.assertEqual(len(self.store.read_only()["fleet"]), 1)

    def test_mutator_cannot_forge_generation_or_persist_unknown_fields(self):
        state = self.begin()

        updated = self.store.mutate(
            state["generation"],
            lambda value: value.update({"generation": 999}),
        )
        self.assertEqual(updated["generation"], 2)

        with self.assertRaisesRegex(FleetStateCorruptError, "root fields"):
            self.store.mutate(
                updated["generation"],
                lambda value: value.update({"unexpected": True}),
            )
        with self.assertRaisesRegex(TypeError, "replacement"):
            self.store.mutate(updated["generation"], lambda _value: [])
        self.assertEqual(self.store.read_only()["generation"], 2)

    def test_strict_reader_rejects_extra_fields_duplicates_and_invalid_verified_records(self):
        self.root.mkdir(parents=True)
        cases = (
            {**empty_fleet_state(), "unexpected": True},
            {
                "generation": 3,
                "activeRun": {
                    "runId": RUN_ID,
                    "status": "running",
                    "desiredSha": SHA_A,
                    "inventory": INVENTORY,
                    "startedAt": "2026-07-15T00:00:00Z",
                },
                "lastRun": {
                    "runId": RUN_ID,
                    "status": "interrupted",
                    "desiredSha": SHA_A,
                    "inventory": INVENTORY,
                    "startedAt": "2026-07-15T00:00:00Z",
                    "endedAt": "2026-07-15T00:00:01Z",
                },
                "fleet": {},
            },
            {
                **empty_fleet_state(),
                "fleet": {
                    "kiosk-a": {
                        "role": "kiosk",
                        "desiredSha": SHA_A,
                        "currentSha": SHA_A,
                        "previousSha": None,
                        "evidence": "verified",
                        "verifiedAt": None,
                        "lastRunId": RUN_ID,
                    }
                },
            },
            {
                **empty_fleet_state(),
                "fleet": {
                    "kiosk-a": {
                        "role": ["kiosk"],
                        "desiredSha": SHA_A,
                        "currentSha": None,
                        "previousSha": None,
                        "evidence": "unknown",
                        "verifiedAt": None,
                        "lastRunId": RUN_ID,
                    }
                },
            },
        )
        for payload in cases:
            with self.subTest(payload=payload):
                self.state_path.write_text(json.dumps(payload), encoding="utf-8")
                with self.assertRaises(FleetStateCorruptError):
                    self.store.read_only()

        self.state_path.write_text(
            '{"generation":0,"generation":1,"activeRun":null,"lastRun":null,"fleet":{}}',
            encoding="utf-8",
        )
        with self.assertRaisesRegex(FleetStateCorruptError, "duplicate key"):
            self.store.read_only()

        self.state_path.write_text(
            '{"generation":NaN,"activeRun":null,"lastRun":null,"fleet":{}}',
            encoding="utf-8",
        )
        with self.assertRaisesRegex(FleetStateCorruptError, "non-JSON value"):
            self.store.read_only()

    def test_reader_rejects_a_symlinked_state_file(self):
        target = self.root / "outside.json"
        target.parent.mkdir(parents=True)
        target.write_text(json.dumps(empty_fleet_state()), encoding="utf-8")
        self.state_path.symlink_to(target)

        with self.assertRaisesRegex(FleetStateError, "unreadable"):
            self.store.read_only()

        self.assertEqual(
            json.loads(target.read_text(encoding="utf-8")), empty_fleet_state()
        )

    def test_atomic_write_orders_file_fsync_replace_and_directory_fsync(self):
        events = []
        real_mkstemp = fleet_state_module.tempfile.mkstemp
        real_fsync = fleet_state_module.os.fsync
        real_replace = fleet_state_module.os.replace

        def tracked_mkstemp(*args, **kwargs):
            events.append("mkstemp")
            return real_mkstemp(*args, **kwargs)

        def tracked_fsync(descriptor):
            events.append(
                "dir-fsync" if stat.S_ISDIR(os.fstat(descriptor).st_mode) else "file-fsync"
            )
            return real_fsync(descriptor)

        def tracked_replace(source, destination):
            events.append("replace")
            return real_replace(source, destination)

        with patch.object(
            fleet_state_module.tempfile, "mkstemp", side_effect=tracked_mkstemp
        ), patch.object(
            fleet_state_module.os, "fsync", side_effect=tracked_fsync
        ), patch.object(
            fleet_state_module.os, "replace", side_effect=tracked_replace
        ):
            self.begin()

        self.assertEqual(events, ["mkstemp", "file-fsync", "replace", "dir-fsync"])

    def test_failed_replace_keeps_previous_generation_and_removes_temp_file(self):
        state = self.begin()
        before = self.state_path.read_bytes()

        with patch.object(
            fleet_state_module.os, "replace", side_effect=OSError("replace failed")
        ):
            with self.assertRaisesRegex(OSError, "replace failed"):
                self.store.finish_run(
                    RUN_ID,
                    "success",
                    expected_generation=state["generation"],
                )

        self.assertEqual(self.state_path.read_bytes(), before)
        self.assertEqual(list(self.root.glob("*.tmp")), [])

    def test_external_lease_is_reused_without_nested_flock_and_blocks_contenders(self):
        with FleetLock(self.lock_path) as lease:
            state = self.store.begin_run(
                RUN_ID,
                SHA_A,
                INVENTORY,
                expected_generation=0,
                lease=lease,
            )
            with self.assertRaises(FleetLockBusyError):
                FleetLock(self.lock_path, blocking=False).acquire()
            state = self.store.finish_run(
                RUN_ID,
                "success",
                expected_generation=state["generation"],
                lease=lease,
            )
            self.assertEqual(state["lastRun"]["status"], "success")

        with self.assertRaises(FleetLockError):
            lease.assert_for(self.lock_path)
        with FleetLock(self.lock_path, blocking=False):
            pass

    def test_invalid_primitive_arguments_do_not_create_state_or_lock_paths(self):
        with self.assertRaises(ValueError):
            self.store.mark_host_unknown(
                "../host",
                "kiosk",
                SHA_A,
                RUN_ID,
                expected_generation=0,
            )
        with self.assertRaises(FleetStateCorruptError):
            self.store.begin_run(
                RUN_ID,
                SHA_A,
                "bad\ninventory",
                expected_generation=0,
            )
        with self.assertRaises(FleetStateCorruptError):
            self.store.begin_run(
                RUN_ID,
                SHA_A,
                INVENTORY,
                expected_generation=0,
                started_at="",
            )
        self.assertFalse(self.root.exists())


if __name__ == "__main__":
    unittest.main()
