from __future__ import annotations

import datetime as dt
import unittest

from scripts.deploy.rolling_release import terminal_device_maintenance as maintenance


NOW = dt.datetime(2026, 7, 30, 7, 30, tzinfo=dt.timezone.utc)


class TerminalDeviceMaintenanceTest(unittest.TestCase):
    def test_active_lease_is_normalized_to_sanitized_evidence(self) -> None:
        leases = maintenance.parse_active_leases(
            {
                "barcode-agent": {
                    "reasonCode": "temporary-development-detach",
                    "expiresAt": "2026-08-02T08:00:00Z",
                }
            },
            now=NOW,
        )

        self.assertEqual(
            leases["barcode-agent"].evidence(),
            {
                "agent": "barcode-agent",
                "reasonCode": "temporary-development-detach",
                "expiresAt": "2026-08-02T08:00:00Z",
            },
        )

    def test_expired_lease_does_not_suppress_health(self) -> None:
        self.assertEqual(
            maintenance.parse_active_leases(
                {
                    "nfc-agent": {
                        "reasonCode": "bench-maintenance",
                        "expiresAt": "2026-07-30T07:29:59Z",
                    }
                },
                now=NOW,
            ),
            {},
        )

    def test_unknown_overlong_and_malformed_leases_fail_closed(self) -> None:
        fixtures = (
            {"other-agent": {"reasonCode": "maintenance", "expiresAt": "2026-07-31T00:00:00Z"}},
            {"barcode-agent": {"reasonCode": "maintenance", "expiresAt": "2026-08-07T07:30:01Z"}},
            {"barcode-agent": {"reasonCode": "contains space", "expiresAt": "2026-07-31T00:00:00Z"}},
            {"barcode-agent": {"reasonCode": "maintenance", "expiresAt": "2026-07-31T00:00:00+00:00"}},
            {"barcode-agent": {"reasonCode": "maintenance", "expiresAt": "2026-07-31T00:00:00Z", "note": "extra"}},
        )
        for fixture in fixtures:
            with self.subTest(fixture=fixture):
                with self.assertRaises(maintenance.MaintenanceLeaseError):
                    maintenance.parse_active_leases(fixture, now=NOW)

    def test_naive_clock_is_rejected(self) -> None:
        with self.assertRaises(maintenance.MaintenanceLeaseError):
            maintenance.parse_active_leases({}, now=NOW.replace(tzinfo=None))

    def test_json_parser_rejects_duplicate_agents(self) -> None:
        raw = (
            '{"barcode-agent":{"reasonCode":"first","expiresAt":"2026-07-31T00:00:00Z"},'
            '"barcode-agent":{"reasonCode":"second","expiresAt":"2026-07-31T00:00:00Z"}}'
        )
        with self.assertRaises(maintenance.MaintenanceLeaseError):
            maintenance.parse_active_leases_json(raw, now=NOW)


if __name__ == "__main__":
    unittest.main()
