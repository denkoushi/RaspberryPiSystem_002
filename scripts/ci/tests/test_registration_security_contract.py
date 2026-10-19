from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


class RegistrationSecurityContractTests(unittest.TestCase):
    def test_registration_requires_explicit_authentication(self) -> None:
        script = (ROOT / "scripts/register-clients.sh").read_text(encoding="utf-8")
        self.assertIn('ADMIN_ACCESS_TOKEN="${ADMIN_ACCESS_TOKEN:-}"', script)
        self.assertIn('Set ADMIN_ACCESS_TOKEN or both ADMIN_USERNAME and ADMIN_PASSWORD.', script)
        self.assertNotIn('ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin1234}"', script)
        self.assertNotIn('ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"', script)

    def test_tls_verification_and_inventory_resolution_fail_closed(self) -> None:
        script = (ROOT / "scripts/register-clients.sh").read_text(encoding="utf-8")
        self.assertIn('CURL_INSECURE="${CURL_INSECURE:-0}"', script)
        self.assertIn('ansible-inventory -i "${path}" --list', script)
        self.assertIn('Could not resolve inventory.yml with ansible-inventory.', script)
        self.assertNotIn('Registering example entries.', script)


if __name__ == "__main__":
    unittest.main()
