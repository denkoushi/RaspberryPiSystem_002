#!/usr/bin/env python3
from __future__ import annotations

import re
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure/ansible"
PLAYBOOK = (ANSIBLE / "playbooks/deploy-release-standard.yml").read_text(
    encoding="utf-8"
)


def role_text(role: str) -> str:
    root = ANSIBLE / "roles" / role
    return "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted(root.rglob("*.yml"))
    )


class StandardReleaseAnsibleTests(unittest.TestCase):
    def test_top_level_route_is_explicit_and_serial(self) -> None:
        self.assertEqual(PLAYBOOK.count("  serial: 1\n"), 3)
        self.assertLess(PLAYBOOK.index("role: release_pi5"), PLAYBOOK.index("role: release_kiosk"))
        self.assertLess(
            PLAYBOOK.index("role: release_kiosk"),
            PLAYBOOK.index("role: release_signage"),
        )
        self.assertNotIn("terminal-profile-registry", PLAYBOOK)
        self.assertNotIn("rolling_release", PLAYBOOK)

    def test_every_profile_uses_prepare_block_rescue_always(self) -> None:
        for role in ("release_pi5", "release_kiosk", "release_signage"):
            main_path = (
                ANSIBLE / "roles" / role / "tasks/main.yml"
            )
            main = yaml.safe_load(main_path.read_text(encoding="utf-8"))
            with self.subTest(role=role):
                self.assertEqual(len(main), 1)
                outer = main[0]
                self.assertEqual(
                    outer["block"][0]["ansible.builtin.import_tasks"],
                    "prepare.yml",
                )
                switch_health = outer["block"][1]
                self.assertEqual(
                    [task["ansible.builtin.import_tasks"] for task in switch_health["block"]],
                    ["switch.yml", "health.yml"],
                )
                self.assertEqual(
                    [task["ansible.builtin.import_tasks"] for task in switch_health["rescue"]],
                    ["rollback.yml"],
                )
                self.assertEqual(
                    [task["ansible.builtin.import_tasks"] for task in outer["always"]],
                    ["cleanup.yml"],
                )

    def test_pi4_builds_are_outside_the_terminal_route(self) -> None:
        kiosk = role_text("release_kiosk")
        prepare = (
            ANSIBLE / "roles/release_kiosk/tasks/prepare.yml"
        ).read_text(encoding="utf-8")
        switch = (
            ANSIBLE / "roles/release_kiosk/tasks/switch.yml"
        ).read_text(encoding="utf-8")
        self.assertNotIn("--build", kiosk)
        self.assertNotRegex(kiosk, r"\bbuild:\s*")
        self.assertIn("docker\n      - image\n      - pull", prepare)
        self.assertIn("up -d --no-build", switch)

    def test_pi4_removes_only_this_run_backups_after_verified_outcome(self) -> None:
        cleanup_path = ANSIBLE / "roles/release_kiosk/tasks/cleanup.yml"
        cleanup_tasks = yaml.safe_load(cleanup_path.read_text(encoding="utf-8"))
        backup_cleanup = next(
            task
            for task in cleanup_tasks
            if task["name"] == "Remove this run's Pi4 file backups after a verified outcome"
        )
        self.assertEqual(
            backup_cleanup["ansible.builtin.file"],
            {"path": "{{ item.backup_file }}", "state": "absent"},
        )
        self.assertEqual(
            backup_cleanup["loop"],
            "{{ release_kiosk_install.results | default([]) }}",
        )
        self.assertEqual(
            backup_cleanup["when"],
            [
                "item.changed | default(false) | bool",
                "item.backup_file is defined",
                "release_kiosk_healthy | default(false) | bool or release_kiosk_rolled_back | default(false) | bool",
            ],
        )
        self.assertTrue(backup_cleanup["no_log"])

    def test_pi3_has_one_target_hash_and_no_target_network_fetch(self) -> None:
        signage = role_text("release_signage")
        prepare = (
            ANSIBLE / "roles/release_signage/tasks/prepare.yml"
        ).read_text(encoding="utf-8")
        switch = (
            ANSIBLE / "roles/release_signage/tasks/switch.yml"
        ).read_text(encoding="utf-8")
        self.assertEqual(signage.count("sha256sum"), 1)
        self.assertIn("delegate_to: localhost", prepare)
        target_section = prepare.split(
            "- name: Select the controller-local Pi3 artifact", 1
        )[1]
        controller_section = prepare.split(
            "- name: Extract the complete Pi3 artifact from GHCR on the controller",
            1,
        )[1].split("- name: Select the controller-local Pi3 artifact", 1)[0]
        self.assertIn(
            'docker image pull --platform linux/arm/v7 "${image}"',
            controller_section,
        )
        for forbidden in ("git fetch", "git clone", "docker image pull", "curl ", "wget "):
            self.assertNotIn(forbidden, target_section)
        self.assertIn("/current", switch)
        self.assertIn("/previous", switch)
        self.assertGreaterEqual(switch.count("mv -Tf"), 2)

    def test_pi3_scratch_artifact_create_has_an_explicit_command(self) -> None:
        prepare_tasks = yaml.safe_load(
            (ANSIBLE / "roles/release_signage/tasks/prepare.yml").read_text(
                encoding="utf-8"
            )
        )
        extraction = next(
            task
            for task in prepare_tasks
            if task["name"] == "Extract the complete Pi3 artifact from GHCR on the controller"
        )
        shell = extraction["ansible.builtin.shell"]
        self.assertIn('docker create "${image}" /signage-release.tar', shell)

    def test_pi3_does_not_rewrite_the_verified_candidate_tree(self) -> None:
        prepare = (
            ANSIBLE / "roles/release_signage/tasks/prepare.yml"
        ).read_text(encoding="utf-8")
        after_hash = prepare.split(
            "- name: Require the Pi3 artifact bytes to match the one expected SHA-256",
            1,
        )[1]
        self.assertNotRegex(
            after_hash,
            r"ansible\.builtin\.(?:copy|template):[\s\S]{0,300}"
            r"dest:.*release_signage_candidate",
        )
        self.assertIn("dest: \"{{ release_signage_config_root }}/runtime.env\"", after_hash)
        self.assertNotIn(".artifact-sha256", after_hash)

    def test_pi3_publishes_only_a_complete_atomic_candidate(self) -> None:
        prepare = (
            ANSIBLE / "roles/release_signage/tasks/prepare.yml"
        ).read_text(encoding="utf-8")
        cleanup_path = (
            ANSIBLE / "roles/release_signage/tasks/cleanup.yml"
        )
        cleanup = cleanup_path.read_text(encoding="utf-8")
        cleanup_tasks = yaml.safe_load(cleanup)
        self.assertIn("validate-layout", prepare)
        self.assertIn('dest: "{{ release_signage_candidate_temp }}"', prepare)
        self.assertNotIn('dest: "{{ release_signage_candidate }}"', prepare)
        self.assertRegex(
            prepare,
            r"(?s)Validate the fixed Pi3 payload allowlist before extraction"
            r".*Expand the complete Pi3 artifact"
            r".*Validate the extracted Pi3 tree against the fixed payload allowlist"
            r".*Make the expanded Pi3 release tree immutable"
            r".*Atomically publish the complete Pi3 candidate directory",
        )
        self.assertIn('path: "{{ release_signage_candidate_temp }}"', cleanup)
        self.assertEqual(
            cleanup_tasks[0]["ansible.builtin.file"],
            {"path": "{{ release_signage_candidate_temp }}", "state": "absent"},
        )
        self.assertNotIn(
            {"path": "{{ release_signage_candidate }}", "state": "absent"},
            [task.get("ansible.builtin.file") for task in cleanup_tasks],
        )

    def test_new_route_has_no_historical_admission_contract(self) -> None:
        route = "\n".join(
            [PLAYBOOK, role_text("release_pi5"), role_text("release_kiosk"), role_text("release_signage")]
        ).lower()
        for forbidden in (
            "readinessadmission",
            "releaseclaims",
            "fleet-release-state",
            "route_preflight",
            "manifestsha256",
            "payloaddigest",
        ):
            self.assertNotIn(forbidden, route)

    def test_pi5_reuses_blue_green_under_ansible_rollback(self) -> None:
        pi5 = role_text("release_pi5")
        for command in ("prepare", "switch", "monitor", "rollback", "cleanup"):
            self.assertRegex(
                pi5,
                rf"pi5-blue-green\.sh[\s\S]{{0,180}}- {re.escape(command)}",
            )
        self.assertIn("validate-expand-only-migrations.py", pi5)

    def test_pi5_standard_route_has_no_sealed_release_evidence(self) -> None:
        pi5 = role_text("release_pi5")
        for forbidden in (
            "pi5-release-evidence.py",
            "resource-evidence",
            "migration-plan",
            "--resource-evidence",
            "--migration-plan",
        ):
            self.assertNotIn(forbidden, pi5)
        self.assertIn("validate-expand-only-migrations.py", pi5)
        self.assertIn("Require enough Pi5 capacity", pi5)


if __name__ == "__main__":
    unittest.main()
