from __future__ import annotations

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


ANSIBLE_ROOT = ROOT / "infrastructure/ansible"
TORQUE_HELPER = ANSIBLE_ROOT / "roles/client/templates/torque-bluetooth-adapter.sh.j2"


class AnsibleTemplateContractTests(unittest.TestCase):
    def test_every_repository_template_parses(self) -> None:
        templates = discover_templates(ANSIBLE_ROOT)

        self.assertGreater(len(templates), 0)
        self.assertIn(TORQUE_HELPER, templates)
        self.assertEqual(validate_template_tree(ANSIBLE_ROOT), ())

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
