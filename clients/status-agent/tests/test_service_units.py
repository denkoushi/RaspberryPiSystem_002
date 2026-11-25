"""status-agent の systemd ユニットの実行内容と制限を検証する。"""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
UNITS = {
    "client": (ROOT / "clients/status-agent/status-agent.service", "/opt/RaspberryPiSystem_002/clients/status-agent/status-agent.py"),
    "release": (
        ROOT / "infrastructure/ansible/roles/release_kiosk/templates/status-agent.service.j2",
        "/usr/local/lib/raspi-status-agent/status-agent.py",
    ),
}
REQUIRED = {
    "NoNewPrivileges": "yes",
    "PrivateTmp": "yes",
    "ProtectSystem": "strict",
    "ProtectHome": "read-only",
    "RuntimeDirectory": "raspi-status-agent",
    "RuntimeDirectoryPreserve": "yes",
}


def service_section(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    in_service = False
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("["):
            in_service = line == "[Service]"
        elif in_service and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


class StatusAgentUnitTest(unittest.TestCase):
    def test_units_run_expected_script_with_restrictions(self) -> None:
        for name, (path, script) in UNITS.items():
            with self.subTest(unit=name):
                service = service_section(path)
                self.assertEqual(service["Type"], "oneshot")
                self.assertEqual(service["ExecStart"], f"/usr/bin/env python3 {script}")
                if name == "client":
                    self.assertNotIn("User", service)
                for key, value in REQUIRED.items():
                    self.assertEqual(service.get(key), value)

    def test_writable_paths_cover_log_and_update_state(self) -> None:
        for name, (path, _) in UNITS.items():
            with self.subTest(unit=name):
                paths = service_section(path)["ReadWritePaths"].split()
                if name == "client":
                    self.assertIn("-/var/log", paths)
                    self.assertIn("-/var/lib/raspi-os-security-update", paths)
                else:
                    self.assertEqual(paths, ["-/var/log/raspi-status-agent.log"])

    def test_release_units_run_as_the_dedicated_user(self) -> None:
        pi3 = ROOT / "infrastructure/ansible/roles/signage/templates/status-agent-artifact.service.j2"
        for name, path in (("pi4", UNITS["release"][0]), ("pi3", pi3)):
            with self.subTest(unit=name):
                service = service_section(path)
                self.assertIn("raspi-status-agent" if name == "pi3" else "status_agent_user", service["User"])
                self.assertEqual(service["SupplementaryGroups"], "systemd-journal video")
                self.assertEqual(service["StateDirectory"], "raspi-os-security-update/requests")
        self.assertEqual(service_section(pi3)["RuntimeDirectory"], "raspi-status-agent")
        self.assertEqual(service_section(pi3)["RuntimeDirectoryPreserve"], "yes")


if __name__ == "__main__":
    unittest.main()
