from __future__ import annotations

import unittest
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


class RegistrationSecurityContractTests(unittest.TestCase):
    def test_registration_requires_explicit_authentication(self) -> None:
        script = (ROOT / "scripts/register-clients.sh").read_text(encoding="utf-8")
        self.assertIn('ADMIN_ACCESS_TOKEN="${ADMIN_ACCESS_TOKEN:-}"', script)
        self.assertIn('Set ADMIN_ACCESS_TOKEN or both ADMIN_USERNAME and ADMIN_PASSWORD.', script)
        self.assertNotIn('ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin1234}"', script)
        self.assertNotIn('ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"', script)

    def test_tls_verification_and_inventory_resolution_fail_closed(self) -> None:
        script = (ROOT / "scripts/register-clients.sh").read_text(encoding="utf-8")
        self.assertIn('CURL_INSECURE="${CURL_INSECURE:-0}"', script)
        self.assertIn('ansible-inventory -i "${path}" --list', script)
        self.assertIn('Could not resolve inventory.yml with ansible-inventory.', script)
        self.assertNotIn('Registering example entries.', script)


class RegistrationScriptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        (self.root / "scripts").mkdir()
        self.ansible_dir = self.root / "infrastructure/ansible"
        self.ansible_dir.mkdir(parents=True)
        (self.ansible_dir / "inventory.yml").write_text("# Stub inventory only\n")
        self.script = self.root / "scripts/register-clients.sh"
        shutil.copyfile(ROOT / "scripts/register-clients.sh", self.script)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.key = "fixture-secret-do-not-print-12345"
        self.location = 'Assembly "02"'
        self.env = {
            **os.environ,
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "DRY_RUN": "1",
            "REGISTER_CLIENT_HOST": "pi4-new",
            "ADMIN_ACCESS_TOKEN": "fixture-admin",
            "FIXTURE_ROOT": str(self.root),
            "FIXTURE_KEY": self.key,
            "FIXTURE_LOCATION": self.location,
            "RESOLUTION_MODE": "success",
            "API_MODE": "success",
        }
        stub = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root = Path(os.environ["FIXTURE_ROOT"])
tool = Path(sys.argv[0]).name
args = sys.argv[1:]
if tool in ("ansible", "ansible-inventory"):
    assert Path.cwd() == root / "infrastructure/ansible"
    assert os.environ["ANSIBLE_LOG_PATH"] == "/dev/null"
    assert os.environ["ANSIBLE_DEBUG"] == "0"
    assert args[args.index("-i") + 1] == str(root / "infrastructure/ansible/inventory.yml")
if tool == "ansible-inventory":
    assert "--list" in args
    print((root / "inventory.json").read_text())
elif tool == "ansible":
    assert args[2] == "pi4-new"
    assert args[args.index("-c") + 1] == "local"
    assert args[args.index("-m") + 1] == "ansible.builtin.debug"
    assert "-o" in args
    assert os.environ["ANSIBLE_CALLBACKS_ENABLED"] == "ansible.builtin.oneline"
    assert os.environ["ANSIBLE_LOAD_CALLBACK_PLUGINS"] == "0"
    variable = args[args.index("-a") + 1].removeprefix("var=")
    with (root / "resolved.jsonl").open("a") as f:
        f.write(json.dumps(variable) + "\\n")
    mode = os.environ["RESOLUTION_MODE"]
    if mode == "fail" or (mode == "location_fail" and variable == "status_agent_location"):
        print(os.environ["FIXTURE_KEY"])
        print(os.environ["FIXTURE_KEY"], file=sys.stderr)
        sys.exit(1)
    value = os.environ["FIXTURE_KEY"] if variable == "status_agent_client_key" else os.environ["FIXTURE_LOCATION"]
    if mode == "unresolved":
        value = "{{ vault_unresolved }}"
    if mode == "undefined":
        value = "VARIABLE IS NOT DEFINED!"
    print("pi4-new | SUCCESS => " + json.dumps({variable: value, "changed": False}))
elif tool == "curl":
    assert os.environ["DRY_RUN"] == "0", "DRY_RUN must not contact an API"
    payload = json.loads(args[args.index("-d") + 1])
    (root / "payload.json").write_text(json.dumps(payload))
    if os.environ["API_MODE"] == "error":
        print(json.dumps({"error": "invalid", "message": os.environ["FIXTURE_KEY"]}))
    else:
        print(json.dumps({"client": {"id": "fixture-id", "apiKey": payload["apiKey"]}}))
else:
    sys.exit(99)
'''
        for tool in ("ansible-inventory", "ansible", "curl"):
            path = self.bin / tool
            path.write_text(stub)
            path.chmod(0o755)

    def run_registration(self, key: object, location: str = "", **env: str) -> subprocess.CompletedProcess:
        hosts = {"pi4-new": {
            "status_agent_client_id": "pi4-new-kiosk1",
            "status_agent_client_key": key,
            "status_agent_location": location,
        }, "unselected": {
            "status_agent_client_id": "other",
            "status_agent_client_key": "{{ vault_other_key }}",
        }}
        (self.root / "inventory.json").write_text(json.dumps({"_meta": {"hostvars": hosts}}))
        result = subprocess.run(
            ["bash", "-x", str(self.script)], cwd=self.root,
            env={**self.env, **env}, capture_output=True, text=True, check=False,
        )
        output = result.stdout + result.stderr
        self.assertNotIn(self.key, output)
        self.assertNotIn(self.key[:8], output)
        self.assertNotIn("vault_", output)
        self.assertNotIn("fixture-admin", output)
        self.assertNotIn("unselected", output)
        return result

    def test_templates_resolve_in_dry_run_without_disclosing_key(self) -> None:
        result = self.run_registration("{{ vault_pi4_key }}", "{{ vault_pi4_location }}")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("clientId=pi4-new-kiosk1, key: resolved (redacted)", result.stdout)
        self.assertNotIn("WARN", result.stderr)
        self.assertEqual((self.root / "resolved.jsonl").read_text().splitlines(), [
            '"status_agent_client_key"', '"status_agent_location"',
        ])
        self.assertFalse((self.root / "payload.json").exists())

    def test_plain_key_does_not_require_ansible_templating(self) -> None:
        result = self.run_registration(self.key, "Assembly")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("key: resolved (redacted)", result.stdout)
        self.assertFalse((self.root / "resolved.jsonl").exists())

    def test_resolved_values_are_sent_to_api_with_json_escaping(self) -> None:
        result = self.run_registration("{{ vault_pi4_key }}", "{{ vault_pi4_location }}", DRY_RUN="0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("[SUCCESS]", result.stdout)
        self.assertEqual(json.loads((self.root / "payload.json").read_text()), {
            "name": "pi4-new", "apiKey": self.key, "location": self.location,
        })

    def test_inline_vault_value_is_resolved(self) -> None:
        result = self.run_registration({"__ansible_vault": "$ANSIBLE_VAULT;fixture"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("key: resolved (redacted)", result.stdout)

    def test_resolution_errors_skip_host_without_printing_diagnostics(self) -> None:
        for mode in ("fail", "undefined", "unresolved", "location_fail"):
            with self.subTest(mode=mode):
                result = self.run_registration("{{ vault_pi4_key }}", "{{ vault_pi4_location }}", RESOLUTION_MODE=mode)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("[WARN] Skip client pi4-new:", result.stderr)
                self.assertNotIn("key: resolved", result.stdout)
                self.assertFalse((self.root / "payload.json").exists())

    def test_invalid_plain_key_is_redacted_and_skipped(self) -> None:
        result = self.run_registration("bad")
        self.assertIn("unresolved/invalid status_agent_client_key", result.stderr)
        self.assertNotIn("(bad)", result.stderr)
        self.assertNotIn("key: resolved", result.stdout)

    def test_api_error_cannot_echo_key(self) -> None:
        result = self.run_registration(self.key, DRY_RUN="0", API_MODE="error")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Failed to register client pi4-new", result.stderr)


if __name__ == "__main__":
    unittest.main()
