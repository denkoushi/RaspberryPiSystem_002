from __future__ import annotations

import unittest
from pathlib import Path

import yaml
from jinja2 import Environment


ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure/ansible"
TASKS = yaml.safe_load((ANSIBLE / "roles/common/tasks/disable-mptcp.yml").read_text())[0]["block"]


def task_named(prefix: str) -> dict:
    return next(task for task in TASKS if task["name"].startswith(prefix))


class DisableMptcpTests(unittest.TestCase):
    def test_sysctl_is_persisted_off(self) -> None:
        copy = task_named("Persist")["ansible.builtin.copy"]
        self.assertEqual(copy["dest"], "/etc/sysctl.d/90-raspi-disable-mptcp.conf")
        self.assertIn("net.mptcp.enabled = 0", copy["content"])

    def test_restart_follows_mptcp_only_listing(self) -> None:
        # With -t, ss would add plain TCP listeners and restart tailscaled every run.
        listing = task_named("List MPTCP listeners that were")["ansible.builtin.command"]
        self.assertIn("--mptcp", listing.split())
        self.assertNotIn("-t", listing)
        condition = Environment().compile_expression(task_named("Reopen")["when"])
        self.assertFalse(condition(common_mptcp_listeners_before={"stdout": ""}))
        self.assertTrue(
            condition(common_mptcp_listeners_before={"stdout": "LISTEN 0 4096 100.101.113.95:54283 0.0.0.0:*"})
        )

    def test_every_release_play_and_provisioning_imports_it(self) -> None:
        plays = yaml.safe_load((ANSIBLE / "playbooks/deploy-release-standard.yml").read_text())
        for host_group in ("server", "kiosk", "signage"):
            with self.subTest(host_group=host_group):
                release_plays = [
                    play
                    for play in plays
                    if play["hosts"] == host_group and play.get("roles")
                ]
                self.assertTrue(release_plays)
                for play in release_plays:
                    imported = [
                        task["ansible.builtin.import_role"]["tasks_from"]
                        for task in play.get("pre_tasks", [])
                        if "ansible.builtin.import_role" in task
                    ]
                    self.assertIn("disable-mptcp", imported)
        main = yaml.safe_load((ANSIBLE / "roles/common/tasks/main.yml").read_text())
        self.assertIn(
            "disable-mptcp.yml",
            [task.get("ansible.builtin.import_tasks") for task in main],
        )


if __name__ == "__main__":
    unittest.main()
