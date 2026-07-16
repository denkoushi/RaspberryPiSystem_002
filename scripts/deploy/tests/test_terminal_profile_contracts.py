from __future__ import annotations

import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

DEPLOY_DIR = Path(__file__).resolve().parents[1]
if str(DEPLOY_DIR) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIR))

from terminal_profile_contracts import (  # noqa: E402
    CORE_MODULES,
    TerminalProfileContractError,
    registry_playbooks,
    validate_core_independence,
    validate_inventory_contracts,
    validate_profile_assets,
)
from terminal_profile_registry import load_registry  # noqa: E402


def synthetic_registry():
    registry = load_registry()
    base = registry.profile("kiosk")
    profile = replace(
        base,
        id="inspection-panel",
        inventory_group="inspection_panels",
        rollout_order=30,
        impact_component="inspection-panel-role",
        playbook="playbooks/deploy-terminal-profile.yml",
        canary_group="inspection_panel_canary",
        approval_policy="health-only",
        adapter_options=replace(
            base.adapter_options,
            ready_authority="terminal",
        ),
    )
    return replace(
        registry,
        profiles=(profile,),
        component_profiles=(
            ("inspection-panel-role", (profile.id,)),
            ("global", (profile.id,)),
        ),
    )


def synthetic_inventory():
    return {
        "_meta": {
            "hostvars": {
                "pi5": {"status_agent_client_id": "pi5-server"},
                "inspection-a": {
                    "status_agent_client_id": "inspection-a-client"
                },
            }
        },
        "server": {"hosts": ["pi5"]},
        "clients": {"children": ["inspection_panels"]},
        "inspection_panels": {"hosts": ["inspection-a"]},
        "inspection_panel_canary": {"hosts": ["inspection-a"]},
    }


class TerminalProfileContractTest(unittest.TestCase):
    def test_production_registry_assets_and_core_contract_pass(self):
        registry = load_registry()

        validate_profile_assets(registry)
        validate_core_independence(registry)

        self.assertEqual(
            registry_playbooks(registry), ("playbooks/deploy-staged.yml",)
        )

    def test_synthetic_profile_uses_shared_playbook_and_inventory_only(self):
        registry = synthetic_registry()

        validate_profile_assets(registry)
        validate_core_independence(registry)
        validate_inventory_contracts(
            registry, [("synthetic.json", synthetic_inventory())]
        )

    def test_inventory_contract_rejects_unregistered_client_group(self):
        inventory = synthetic_inventory()
        inventory["clients"]["children"] = ["unregistered"]
        inventory["unregistered"] = {"hosts": ["inspection-a"]}

        with self.assertRaisesRegex(
            TerminalProfileContractError, "unregistered unregistered"
        ):
            validate_inventory_contracts(
                synthetic_registry(), [("synthetic.json", inventory)]
            )

    def test_profile_playbook_requires_literal_serial_one(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            playbook = root / "infrastructure/ansible/playbooks/bad.yml"
            playbook.parent.mkdir(parents=True)
            playbook.write_text(
                """---
- name: Unsafe terminal play
  hosts: clients
  serial: 2
  pre_tasks:
    - ansible.builtin.import_tasks: ../tasks/assert-release-orchestration.yml
    - ansible.builtin.import_tasks: ../tasks/assert-terminal-release-mode.yml
""",
                encoding="utf-8",
            )
            registry = synthetic_registry()
            profile = replace(registry.profiles[0], playbook="playbooks/bad.yml")

            with self.assertRaisesRegex(
                TerminalProfileContractError, "must declare serial: 1"
            ):
                validate_profile_assets(
                    replace(registry, profiles=(profile,)), repository_root=root
                )

    def test_profile_playbook_requires_both_orchestration_guards(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            playbook = root / "infrastructure/ansible/playbooks/bad.yml"
            playbook.parent.mkdir(parents=True)
            playbook.write_text(
                """---
- name: Unguarded terminal play
  hosts: clients
  serial: 1
""",
                encoding="utf-8",
            )
            registry = synthetic_registry()
            profile = replace(registry.profiles[0], playbook="playbooks/bad.yml")

            with self.assertRaisesRegex(
                TerminalProfileContractError, "lacks orchestration guard"
            ):
                validate_profile_assets(
                    replace(registry, profiles=(profile,)), repository_root=root
                )

    def test_core_contract_rejects_profile_name_branch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for module in CORE_MODULES:
                path = root / module
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("value = True\n", encoding="utf-8")
            contaminated = root / CORE_MODULES[0]
            contaminated.write_text(
                "if terminal_type == 'inspection-panel':\n    pass\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                TerminalProfileContractError,
                "contains terminal profile name inspection-panel",
            ):
                validate_core_independence(
                    synthetic_registry(), repository_root=root
                )


if __name__ == "__main__":
    unittest.main()
