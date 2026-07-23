from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
GUARD = ROOT / "infrastructure/ansible/roles/client/files/torque-bluetooth-guard.py"
SPEC = importlib.util.spec_from_file_location("torque_bluetooth_guard", GUARD)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class TorqueBluetoothGuardIntentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.intent = Path(self.temporary.name) / "intent.json"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write(self, payload: object) -> None:
        self.intent.write_text(json.dumps(payload), encoding="utf-8")

    def test_missing_malformed_expired_and_wrong_boot_intents_fail_closed(self) -> None:
        self.assertEqual(MODULE.valid_intent(self.intent, "boot-a", 100), (False, "INTENT_MISSING"))
        self.intent.write_text("{broken", encoding="utf-8")
        self.assertEqual(MODULE.valid_intent(self.intent, "boot-a", 100)[0], False)
        self.write({
            "version": 1,
            "bootId": "boot-a",
            "leaseId": "lease",
            "generation": 1,
            "validUntilMonotonic": 99,
        })
        self.assertEqual(MODULE.valid_intent(self.intent, "boot-a", 100), (False, "INTENT_EXPIRED"))
        self.write({
            "version": 1,
            "bootId": "old-boot",
            "leaseId": "lease",
            "generation": 1,
            "validUntilMonotonic": 101,
        })
        self.assertEqual(MODULE.valid_intent(self.intent, "boot-a", 100), (False, "INTENT_BOOT_MISMATCH"))

    def test_only_complete_fresh_current_boot_intent_enables_power(self) -> None:
        self.write({
            "version": 1,
            "bootId": "boot-a",
            "leaseId": "lease",
            "generation": 2,
            "validUntilMonotonic": 101,
        })
        self.assertEqual(MODULE.valid_intent(self.intent, "boot-a", 100), (True, "LEASE_INTENT_VALID"))

    def test_reconcile_switches_once_and_turns_off_at_deadline(self) -> None:
        boot_id = Path(self.temporary.name) / "boot_id"
        boot_id.write_text("boot-a\n", encoding="utf-8")
        runtime = Path(self.temporary.name) / "run"
        runtime.mkdir()
        guard = MODULE.Guard(
            helper=Path("/unused"),
            runtime_directory=runtime,
            boot_id_path=boot_id,
            poll_seconds=1,
            command_timeout_seconds=1,
        )
        calls: list[tuple[bool, str]] = []

        def apply(powered: bool, reason: str) -> bool:
            calls.append((powered, reason))
            return powered

        guard.apply = apply
        guard.intent_path.write_text(json.dumps({
            "version": 1,
            "bootId": "boot-a",
            "leaseId": "lease",
            "generation": 1,
            "validUntilMonotonic": 108,
        }), encoding="utf-8")

        state = guard.reconcile(False, 100)
        self.assertTrue(state)
        state = guard.reconcile(state, 107.999)
        self.assertTrue(state)
        state = guard.reconcile(state, 108)
        self.assertFalse(state)
        self.assertEqual(calls, [
            (True, "LEASE_INTENT_VALID"),
            (False, "INTENT_EXPIRED"),
        ])


if __name__ == "__main__":
    unittest.main()
