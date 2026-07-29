from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from jinja2 import Environment, StrictUndefined


ROOT = Path(__file__).resolve().parents[3]
CI_DIR = ROOT / "scripts/ci"
if str(CI_DIR) not in sys.path:
    sys.path.insert(0, str(CI_DIR))

from ansible_template_contracts import (  # noqa: E402
    discover_templates,
    validate_template_tree,
)
from scripts.deploy.release_build_contract import parse_contract_json


ANSIBLE_ROOT = ROOT / "infrastructure/ansible"
TORQUE_HELPER = ANSIBLE_ROOT / "roles/client/templates/torque-bluetooth-adapter.sh.j2"
WEB_BUILD_VARS = ANSIBLE_ROOT / "group_vars/server/web-build.yml"
PRIMARY_INVENTORY = ANSIBLE_ROOT / "inventory.yml"
TALKPLAZA_INVENTORY = ANSIBLE_ROOT / "inventory-talkplaza.yml"
WEB_ENV_TEMPLATE = ANSIBLE_ROOT / "templates/web.env.j2"
RELEASE_BUILD_CONTRACT_TEMPLATE = (
    ANSIBLE_ROOT / "templates/release-build-contract.json.j2"
)
RELEASE_BUILD_CONTRACT_PLAYBOOK = (
    ANSIBLE_ROOT / "playbooks/render-release-build-contract.yml"
)
ARTIFACT_PROMOTION_TEMPLATE = (
    ANSIBLE_ROOT / "templates/artifact-promotion.json.j2"
)
ARTIFACT_PROMOTION_DEFAULTS = (
    ANSIBLE_ROOT / "group_vars/server/release-artifacts.yml"
)
PRIMARY_ARTIFACT_PROMOTION = (
    ANSIBLE_ROOT / "host_vars/raspberrypi5/release-artifacts.yml"
)
SERVER_ROLE_TASKS = ANSIBLE_ROOT / "roles/server/tasks/main.yml"


class AnsibleTemplateContractTests(unittest.TestCase):
    def test_pi5_web_build_values_have_one_server_owned_source(self) -> None:
        expected = {
            "web_api_base_url": "/api",
            "web_ws_base_url": "/ws",
            "web_agent_ws_url": "{{ websocket_agent_url }}",
            "web_agent_ws_mode": "local",
            "web_kiosk_due_mgmt_layout_v2_enabled": "true",
            "web_kiosk_sop_popup_enabled": "true",
            "web_kiosk_production_schedule_order_split_enabled": "false",
        }
        source = WEB_BUILD_VARS.read_text(encoding="utf-8")
        inventory = PRIMARY_INVENTORY.read_text(encoding="utf-8")
        for key, value in expected.items():
            with self.subTest(key=key):
                self.assertIn(f'{key}: "{value}"', source)
                self.assertNotIn(f"{key}:", inventory)

        rendered = Environment(undefined=StrictUndefined).from_string(
            WEB_ENV_TEMPLATE.read_text(encoding="utf-8")
        ).render(
            web_api_base_url="/api",
            web_ws_base_url="/ws",
            web_agent_ws_url="ws://localhost:7071/stream",
            web_agent_ws_mode="local",
            web_kiosk_due_mgmt_layout_v2_enabled="true",
            web_kiosk_sop_popup_enabled="true",
            web_kiosk_production_schedule_order_split_enabled="false",
        )
        self.assertIn("VITE_API_BASE_URL=/api", rendered)
        self.assertIn("VITE_KIOSK_SOP_POPUP_ENABLED=true", rendered)
        self.assertIn(
            "VITE_KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED=false",
            rendered,
        )

        talkplaza = TALKPLAZA_INVENTORY.read_text(encoding="utf-8")
        for key in (
            "web_kiosk_due_mgmt_layout_v2_enabled",
            "web_kiosk_sop_popup_enabled",
            "web_kiosk_production_schedule_order_split_enabled",
        ):
            with self.subTest(talkplaza_key=key):
                self.assertIn(f'{key}: "false"', talkplaza)

    def test_every_repository_template_parses(self) -> None:
        templates = discover_templates(ANSIBLE_ROOT)

        self.assertGreater(len(templates), 0)
        self.assertIn(TORQUE_HELPER, templates)
        self.assertEqual(validate_template_tree(ANSIBLE_ROOT), ())

    def test_release_build_renderer_contains_only_the_strict_allowlist(self) -> None:
        sha = "a" * 40
        environment = Environment(undefined=StrictUndefined)
        environment.filters["to_json"] = json.dumps
        rendered = environment.from_string(
            RELEASE_BUILD_CONTRACT_TEMPLATE.read_text(encoding="utf-8")
        ).render(
            api_install_playwright_chromium="true",
            web_agent_ws_url="ws://100.64.0.1:7071/stream",
            web_api_base_url="/api",
            web_kiosk_due_mgmt_layout_v2_enabled="true",
            web_kiosk_leaderboard_defer_residual_summary_enabled="false",
            web_kiosk_production_schedule_order_split_enabled="false",
            web_kiosk_sop_popup_enabled="true",
            web_kiosk_target_location_selector_enabled="true",
            release_build_contract_sha=sha,
        )
        contract = parse_contract_json(rendered, sha)
        self.assertEqual(contract.release_sha, sha)
        self.assertNotIn("vault_", rendered)
        self.assertNotIn("secret", rendered.lower())

        playbook = RELEASE_BUILD_CONTRACT_PLAYBOOK.read_text(encoding="utf-8")
        self.assertIn("delegate_to: localhost", playbook)
        self.assertIn("no_log: true", playbook)
        self.assertNotIn("ansible.builtin.shell", playbook)

    def test_artifact_promotion_policy_is_release_runner_only_and_opt_in(self) -> None:
        self.assertIn(
            "pi5_artifact_promotion_enabled: false",
            ARTIFACT_PROMOTION_DEFAULTS.read_text(encoding="utf-8"),
        )
        artifact_defaults = ARTIFACT_PROMOTION_DEFAULTS.read_text(encoding="utf-8")
        self.assertIn('pi5_artifact_gh_version: "2.96.0"', artifact_defaults)
        self.assertIn(
            'pi5_artifact_gh_arm64_sha256: '
            '"334dd9c6704fc1656a48e475c5a3a9aa32bbadb87fa1777513bc626af4a99e89"',
            artifact_defaults,
        )
        self.assertIn(
            "pi5_artifact_promotion_enabled: true",
            PRIMARY_ARTIFACT_PROMOTION.read_text(encoding="utf-8"),
        )
        self.assertNotIn(
            "pi5_artifact_promotion_enabled:",
            PRIMARY_INVENTORY.read_text(encoding="utf-8"),
        )
        self.assertNotIn(
            "pi5_artifact_promotion_enabled:",
            TALKPLAZA_INVENTORY.read_text(encoding="utf-8"),
        )
        environment = Environment(undefined=StrictUndefined)
        environment.filters["to_json"] = json.dumps
        environment.filters["bool"] = bool
        environment.filters["string"] = str
        rendered = environment.from_string(
            ARTIFACT_PROMOTION_TEMPLATE.read_text(encoding="utf-8")
        ).render(
            pi5_artifact_promotion_enabled=False,
            pi5_artifact_ghcr_username="denkoushi",
            pi5_artifact_ghcr_token="test-token",
        )
        policy = json.loads(rendered)
        self.assertFalse(policy["enabled"])
        self.assertEqual(
            set(policy),
            {
                "enabled",
                "repository",
                "workflow",
                "releaseSetRepository",
                "username",
                "token",
            },
        )
        self.assertEqual(
            policy["releaseSetRepository"],
            "ghcr.io/denkoushi/raspisys-release-set",
        )

        tasks = SERVER_ROLE_TASKS.read_text(encoding="utf-8")
        self.assertIn("dest: /etc/raspi-release/artifact-promotion.json", tasks)
        self.assertIn(
            "- name: Ensure release artifact configuration directory exists\n"
            "  ansible.builtin.file:\n"
            "    path: /etc/raspi-release\n"
            "    state: directory\n"
            "    owner: root\n"
            '    group: "{{ ansible_user }}"\n'
            "    mode: '0750'",
            tasks,
        )
        self.assertIn(
            "- name: Deploy release-runner-only artifact promotion policy\n"
            "  ansible.builtin.template:\n"
            '    src: "{{ playbook_dir }}/../templates/artifact-promotion.json.j2"\n'
            "    dest: /etc/raspi-release/artifact-promotion.json\n"
            "    owner: root\n"
            '    group: "{{ ansible_user }}"\n'
            "    mode: '0640'",
            tasks,
        )
        self.assertIn("no_log: true", tasks)
        self.assertIn(
            "when: pi5_artifact_promotion_enabled | default(false) | bool",
            tasks,
        )
        self.assertNotIn(
            "ansible.builtin.apt:\n    name: gh",
            tasks,
        )
        self.assertNotIn("ansible_architecture", tasks)
        self.assertIn(
            "- /usr/bin/dpkg\n"
            "      - --print-architecture",
            tasks,
        )
        self.assertIn(
            "pi5_artifact_debian_architecture.stdout | trim == 'arm64'",
            tasks,
        )
        self.assertIn(
            "gh_{{ pi5_artifact_gh_version }}_linux_arm64.deb",
            tasks,
        )
        self.assertIn(
            'checksum: "sha256:{{ pi5_artifact_gh_arm64_sha256 }}"',
            tasks,
        )
        self.assertIn(
            "- /usr/bin/gh\n"
            "      - attestation\n"
            "      - verify\n"
            "      - --help",
            tasks,
        )
        for required_option in (
            "--bundle-from-oci",
            "--deny-self-hosted-runners",
            "--source-digest",
            "--source-ref",
        ):
            with self.subTest(required_option=required_option):
                self.assertIn(required_option, tasks)

    def test_invalid_template_is_reported_with_source_location(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            template = root / "broken.conf.j2"
            template.write_text("valid\n{% if enabled %}\nmissing end\n", encoding="utf-8")

            violations = validate_template_tree(root)

        self.assertEqual(len(violations), 1)
        self.assertEqual(violations[0].path, template)
        self.assertGreaterEqual(violations[0].line, 2)
        self.assertIn("invalid Jinja syntax", violations[0].reason)

    def test_raw_shell_array_length_is_rejected_before_host_rendering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            template = root / "broken.sh.j2"
            template.write_text(
                '#!/usr/bin/env bash\necho "${#items[@]}"\n', encoding="utf-8"
            )

            violations = validate_template_tree(root)

        self.assertTrue(
            any("shell array-length syntax" in violation.reason for violation in violations)
        )

    def test_release_critical_torque_helper_renders_to_valid_bash(self) -> None:
        source = TORQUE_HELPER.read_text(encoding="utf-8")
        rendered = Environment(undefined=StrictUndefined).from_string(source).render(
            torque_agent_bluetooth_adapter={
                "usb_vendor_id": "2357",
                "usb_product_id": "0604",
            }
        )

        self.assertIn('match_count=$((match_count + 1))', rendered)
        self.assertNotIn("{{", rendered)
        syntax = subprocess.run(
            ["bash", "-n"],
            input=rendered,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(syntax.returncode, 0, syntax.stderr)
        runtime = subprocess.run(
            ["bash", "-s", "--", "--self-test"],
            input=rendered,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(runtime.returncode, 0, runtime.stderr)


if __name__ == "__main__":
    unittest.main()
