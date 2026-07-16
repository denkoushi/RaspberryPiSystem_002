from __future__ import annotations

import copy
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

from scripts.deploy.terminal_profile_registry import load_registry
from scripts.deploy.rolling_release import adapter_registry
from scripts.deploy.rolling_release.terminal_adapters import (
    GenericSystemdAdapter,
    TerminalAdapter,
)


OLD_SHA = "1" * 40
NEW_SHA = "2" * 40


class Runtime:
    ANSIBLE_DIRECTORY = Path("/ansible")

    def __init__(self):
        self.calls = []

    def remote_previous_sha(self, inventory, host):
        self.calls.append(("head", inventory, host))
        return NEW_SHA

    def run(self, command, **_kwargs):
        self.calls.append(("run", command))
        return ""

    def probe_terminal_identity(self, _inventory, _host, client_id):
        return {"authenticated": True, "statusClientId": client_id}

    def apply_terminal_profile(self, inventory, host, revision, run_id, profile):
        self.calls.append(
            ("apply", inventory, host, revision, run_id, profile.playbook)
        )

    def rollback_terminal(self, inventory, target_spec, _target, run_id):
        self.calls.append(("rollback", inventory, target_spec["host"], run_id))
        return True


def synthetic_profile(**overrides):
    base = load_registry().profile("kiosk")
    options = replace(
        base.adapter_options,
        systemd_units=(
            "lightdm.service",
            "status-agent.service",
            "status-agent.timer",
            "haizen-agent.service",
            "inspection-panel.service",
        ),
        health_probe_ids=("display-manager", "status-agent", "ready-sha"),
        ready_authority="terminal",
    )
    values = {
        "id": "inspection-panel",
        "inventory_group": "inspection_panels",
        "impact_component": "inspection-panel-role",
        "canary_group": "inspection_panel_canary",
        "playbook": "playbooks/deploy-terminal-profile.yml",
        "adapter_options": options,
    }
    values.update(overrides)
    return replace(base, **values)


class GenericTerminalAdapterTest(unittest.TestCase):
    def test_synthetic_profile_runs_forward_health_and_exact_rollback(self):
        runtime = Runtime()
        profile = synthetic_profile()
        adapter = GenericSystemdAdapter(profile, runtime)
        adapter.validate()

        adapter.apply("inventory.yml", "inspection-a", NEW_SHA, "run-1")
        evidence = adapter.observe_direct(
            "inventory.yml", "inspection-a", "inspection-a-client"
        )
        self.assertEqual(evidence["currentSha"], NEW_SHA)
        self.assertEqual(
            evidence["services"],
            [
                "lightdm.service",
                "inspection-panel.service",
                "status-agent.timer",
            ],
        )
        self.assertEqual(
            adapter.expected_ready_sha(
                type("State", (), {"payload": {}})(), {"desiredSha": NEW_SHA}
            ),
            NEW_SHA,
        )
        self.assertTrue(
            adapter.rollback(
                "inventory.yml",
                {"host": "inspection-a", "terminalType": profile.id},
                {"previousSha": OLD_SHA},
                "run-1",
            )
        )
        self.assertIn(
            ("rollback", "inventory.yml", "inspection-a", "run-1"), runtime.calls
        )

    def test_unique_adapter_is_added_only_to_registry_mapping(self):
        class UniqueAdapter(TerminalAdapter):
            adapter_id = "unique-inspection"
            supported_health_probe_ids = frozenset(
                {"display-manager", "status-agent", "ready-sha"}
            )

        runtime = Runtime()
        profile = synthetic_profile(adapter_id=UniqueAdapter.adapter_id)
        factories = copy.copy(adapter_registry._ADAPTER_FACTORIES)
        factories[UniqueAdapter.adapter_id] = UniqueAdapter
        with patch.object(adapter_registry, "_ADAPTER_FACTORIES", factories):
            adapter = adapter_registry.adapter_for_profile(
                profile.id, runtime=runtime, profile=profile
            )

        self.assertIsInstance(adapter, UniqueAdapter)
        self.assertEqual(adapter.profile.id, "inspection-panel")


if __name__ == "__main__":
    unittest.main()
