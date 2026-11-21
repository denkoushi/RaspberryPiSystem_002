"""The agent on/off inputs must be fixed values where they are defined.

If one of the three inputs that decide whether an agent is enabled were a Jinja expression, the decision on Pi5
before the release and the decision in the release itself could disagree. This only checks that every definition
line in a tracked YAML file is a fixed value; it does not reproduce Ansible's variable lookup (plan decision 8).
"""
from __future__ import annotations

import re
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
INPUT_LINE = re.compile(r"^\s*(nfc_agent_client_id|barcode_agent_enabled|torque_agent_enabled)\s*:(.*)$")


def problem(line: str) -> str | None:
    """Why a definition line is not a fixed value, or None when it is (or is not a definition)."""
    match = INPUT_LINE.match(line)
    if not match:
        return None
    value = match.group(2).strip()
    if value.startswith("#"):
        value = ""
    if "{{" in value or "{%" in value:
        return "Jinja in the value"
    if value == "" or value[0] in "|>":
        return "value is not on the same line as a plain scalar"
    return None


def tracked_yaml() -> list[str]:
    out = subprocess.run(["git", "ls-files", "*.yml", "*.yaml"], cwd=ROOT, capture_output=True, text=True, check=True)
    return [name for name in out.stdout.splitlines() if "vault" not in name]


class AgentGuardInputsLiteralTest(unittest.TestCase):
    def test_tracked_yaml_defines_the_inputs_with_fixed_values(self) -> None:
        failures = []
        for name in tracked_yaml():
            text = (ROOT / name).read_text(encoding="utf-8", errors="replace")
            for number, line in enumerate(text.splitlines(), 1):
                reason = problem(line)
                if reason:
                    failures.append(f"{name}:{number}: {reason}: {line.strip()}")
        self.assertEqual(failures, [])

    def test_the_check_rejects_jinja_and_block_scalars_and_passes_plain_values(self) -> None:
        for line in (
            "  barcode_agent_enabled: \"{{ x }}\"",
            "torque_agent_enabled: {% if a %}true{% endif %}",
            "nfc_agent_client_id: >-",
            "nfc_agent_client_id: |",
            "barcode_agent_enabled:",
            "barcode_agent_enabled: # note",
        ):
            self.assertIsNotNone(problem(line), line)
        for line in (
            "barcode_agent_enabled: true",
            "  nfc_agent_client_id: \"client-1\"",
            "torque_agent_enabled: false  # fixed",
            "other_key: \"{{ x }}\"",
        ):
            self.assertIsNone(problem(line), line)


if __name__ == "__main__":
    unittest.main()
