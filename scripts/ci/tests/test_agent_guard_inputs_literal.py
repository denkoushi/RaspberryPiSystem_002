"""The agent coverage guard runs before the release body, so its inputs must not depend on later facts.

The enabled-agent expression (release_kiosk_enabled_agent_services) reads three
variables, and the image re-read reads the Compose project and image names.
If a tracked inventory computed any of them with Jinja, the guard and the body
could disagree, so they must be literals.
"""
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / "infrastructure" / "ansible"
INPUTS = {
    "nfc_agent_client_id", "barcode_agent_enabled", "torque_agent_enabled",
    "release_kiosk_compose_project", "release_kiosk_nfc_image",
    "release_kiosk_barcode_image", "release_kiosk_torque_image",
}


class _Loader(yaml.SafeLoader):
    pass


_Loader.add_multi_constructor("!", lambda loader, suffix, node: "<tagged>")


def _tracked_files() -> list[Path]:
    """Git-tracked inventories and group_vars/host_vars, never vault files."""
    listed = subprocess.run(
        ["git", "ls-files", "--", "infrastructure/ansible"],
        cwd=ROOT, check=True, capture_output=True, text=True,
    ).stdout.splitlines()
    files = []
    for name in sorted(listed):
        path = Path(name)
        if path.suffix not in {".yml", ".yaml"} or "vault" in path.name:
            continue
        if "group_vars" in path.parts or "host_vars" in path.parts or path.name.startswith("inventory"):
            files.append(ROOT / path)
    return files


def _walk(value, path, found):
    if isinstance(value, dict):
        for key, item in value.items():
            if key in INPUTS:
                found.append((path + [key], item))
            _walk(item, path + [str(key)], found)
    elif isinstance(value, list):
        for item in value:
            _walk(item, path, found)


class AgentGuardInputsAreLiteral(unittest.TestCase):
    def test_inputs_have_no_jinja(self) -> None:
        seen = 0
        for path in _tracked_files():
            found: list = []
            _walk(yaml.load(path.read_text(encoding="utf-8"), Loader=_Loader), [], found)
            for key_path, value in found:
                seen += 1
                where = f"{path.relative_to(ROOT)}:{'.'.join(key_path)}"
                self.assertIsInstance(value, (str, bool, int), where)
                if isinstance(value, str):
                    self.assertNotIn("{{", value, where)
                    self.assertNotIn("{%", value, where)
        self.assertGreater(seen, 0)

    def test_enabled_agent_expression_reads_only_the_three_inputs(self) -> None:
        text = (ANSIBLE / "roles/release_kiosk/vars/main.yml").read_text(encoding="utf-8")
        self.assertIn("scripts/ci/tests/test_agent_guard_inputs_literal.py", text)
        expression = yaml.safe_load(text)["release_kiosk_enabled_agent_services"]
        import re
        names = set(re.findall(r"[a-z_]+(?=\s*\|)", expression)) - {"default", "string", "bool"}
        self.assertEqual(names, {"nfc_agent_client_id", "barcode_agent_enabled", "torque_agent_enabled"})

    def test_image_read_inputs_do_not_depend_on_release_variables(self) -> None:
        defaults = yaml.safe_load((ANSIBLE / "roles/release_kiosk/defaults/main.yml").read_text(encoding="utf-8"))
        self.assertEqual(defaults["release_kiosk_compose_project"], "docker")
        self.assertEqual(defaults["release_sha"], "")


if __name__ == "__main__":
    unittest.main()
