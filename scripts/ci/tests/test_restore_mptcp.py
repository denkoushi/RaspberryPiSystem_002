from __future__ import annotations

import unittest
from pathlib import Path

import yaml
from jinja2 import Environment


ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure/ansible"
RESTORE = yaml.safe_load((ANSIBLE / "roles/common/tasks/restore-mptcp.yml").read_text())[0]
TASKS = RESTORE["block"]
FIXED = TASKS[2]
ENV = Environment()


def evaluate(expression: str, **variables):
    if expression.startswith("{{"):
        expression = expression[2:-2].strip()
    return ENV.compile_expression(expression)(**variables)


def fixed_kernel(kernel: str) -> bool:
    version = evaluate(
        RESTORE["vars"]["common_mptcp_kernel_version"],
        common_mptcp_kernel={"stdout": kernel},
    )
    return evaluate(
        RESTORE["vars"]["common_mptcp_kernel_fixed"],
        common_mptcp_kernel_version=version,
    )


def walk_tasks(tasks):
    for task in tasks:
        yield task
        for section in ("block", "rescue", "always"):
            yield from walk_tasks(task.get(section, []))


class RestoreMptcpTests(unittest.TestCase):
    def test_running_kernel_versions(self) -> None:
        for kernel, expected in (
            ("6.18.60+rpt-rpi-2712", True),
            ("6.18.56", True),
            ("6.18.55", False),
            ("6.12.113", True),
            ("6.12.112", False),
            ("6.19.1", True),
            ("6.19.0-rc1", True),
            ("7.0.0", True),
            ("6.6.80", False),
            ("6.11.999", False),
            ("6.13.999", False),
            ("6.17.999", False),
            ("", False),
        ):
            with self.subTest(kernel=kernel):
                self.assertEqual(fixed_kernel(kernel), expected)

    def test_only_fixed_kernels_remove_file_and_restore_sysctl(self) -> None:
        self.assertTrue(RESTORE["become"])
        self.assertNotIn("when", RESTORE)
        self.assertEqual(TASKS[0]["ansible.builtin.command"], "uname -r")
        self.assertFalse(TASKS[0]["changed_when"])
        self.assertFalse(TASKS[0]["failed_when"])
        self.assertIn("ansible.builtin.debug", TASKS[1])
        removal, read, restore = FIXED["block"]
        self.assertEqual(removal["ansible.builtin.file"], {
            "path": "/etc/sysctl.d/90-raspi-disable-mptcp.conf", "state": "absent",
        })
        self.assertNotIn("when", removal)
        self.assertNotIn("when", read)
        self.assertEqual(read["ansible.builtin.command"], "sysctl -n net.mptcp.enabled")
        self.assertFalse(read["changed_when"])
        self.assertFalse(read["failed_when"])
        self.assertEqual(restore["ansible.builtin.command"], "sysctl -w net.mptcp.enabled=1")
        self.assertFalse(restore["failed_when"])
        for kernel in ("6.18.60+rpt-rpi-2712", "6.18.55", "6.12.113", "6.12.112", "6.19.1", "6.6.80"):
            fixed = fixed_kernel(kernel)
            variables = {"common_mptcp_kernel_fixed": fixed}
            self.assertEqual(evaluate(FIXED["when"], **variables), fixed)
            self.assertEqual(evaluate(TASKS[1]["when"], **variables), not fixed)
            for rc, stdout in ((0, "0\n"), (0, "1\n"), (1, ""), (127, "")):
                with self.subTest(kernel=kernel, rc=rc, stdout=stdout):
                    run_restore = evaluate(FIXED["when"], **variables) and all(
                        evaluate(condition, common_mptcp_enabled_current={"rc": rc, "stdout": stdout})
                        for condition in restore["when"]
                    )
                    self.assertEqual(run_restore, fixed and rc == 0 and stdout.strip() == "0")
        for rc in (0, 1, 127):
            self.assertEqual(
                evaluate(restore["changed_when"], common_mptcp_restore={"rc": rc}), rc == 0,
            )
        # No additional command, service restart, or write outside the guarded block.
        self.assertEqual(len(TASKS), 3)
        self.assertEqual(len(FIXED["block"]), 3)
        self.assertNotIn("tailscaled", yaml.safe_dump(RESTORE))

    def test_all_four_release_imports_and_provisioning(self) -> None:
        plays = yaml.safe_load((ANSIBLE / "playbooks/deploy-release-standard.yml").read_text())
        imports = []
        for play in plays:
            for section in ("pre_tasks", "tasks", "post_tasks"):
                for task in walk_tasks(play.get(section, [])):
                    role = task.get("ansible.builtin.import_role", {})
                    if role.get("tasks_from") == "restore-mptcp":
                        self.assertEqual(role["name"], "common")
                        imports.append(play["hosts"])
        self.assertEqual(len(imports), 4)
        for group in ("server", "kiosk", "signage"):
            self.assertTrue(any(group in hosts for hosts in imports))
        main = yaml.safe_load((ANSIBLE / "roles/common/tasks/main.yml").read_text())
        self.assertEqual(
            [task.get("ansible.builtin.import_tasks") for task in main].count("restore-mptcp.yml"), 1,
        )

    def test_no_old_task_references(self) -> None:
        old_name = "disable" + "-mptcp"
        # The persistent filename must remain literal so Ansible can remove it.
        persistent_path = "/etc/sysctl.d/90-raspi-" + old_name + ".conf"
        self.assertFalse((ANSIBLE / "roles/common/tasks" / (old_name + ".yml")).exists())
        for directory in (ROOT / "infrastructure", ROOT / "scripts", ROOT / "docs/guides"):
            for path in directory.rglob("*"):
                if path.is_file() and path.suffix in (".yml", ".yaml", ".py", ".sh", ".md"):
                    with self.subTest(path=str(path.relative_to(ROOT))):
                        self.assertNotIn(old_name, path.read_text().replace(persistent_path, ""))


if __name__ == "__main__":
    unittest.main()
