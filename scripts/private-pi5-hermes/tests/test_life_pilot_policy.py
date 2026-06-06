#!/usr/bin/env python3
"""Life Pilot policy tests."""

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.life_pilot_policy import (  # noqa: E402
    LifePilotPolicy,
    validate_life_pilot_document,
    validate_life_prompt,
)


def _policy_data() -> dict:
    return {
        "phase": "life_pilot_v0",
        "model_route": "spark_localai",
        "output_mode": "private_life_log",
        "storage_root": "/home/hermes/.hermes-life",
        "max_prompt_chars": 2000,
        "cursor_codex_auto_run": False,
        "terminal_enabled": False,
        "git_enabled": False,
        "deploy_enabled": False,
        "secret_access_enabled": False,
        "external_web_enabled": False,
        "homeassistant_enabled": False,
        "allowed_task_classes": [
            "record_life_memo",
            "summarize_life_notes",
            "record_life_reminder",
            "suggest_life_next_actions",
        ],
        "deferred_task_classes": [
            "run_cursor_or_codex_cli",
            "edit_production_repo",
            "git_commit_push_merge",
            "deploy_or_restart_services",
            "read_secrets_or_tokens",
            "terminal_shell_execution",
            "tailnet_or_lan_scan",
            "external_web_research",
            "homeassistant_or_camera_control",
        ],
        "deny_prompt_substrings": [".env", "token", "secret"],
        "deny_prompt_patterns": [
            r"\b(run|execute|start|invoke|use|launch)\b.*\b(codex|cursor)\b",
            r"\bgit\s+(commit|push|merge|reset|checkout|rebase)\b",
            r"\b(deploy|terminal|shell|bash|zsh)\b",
        ],
    }


class LifePilotPolicyTests(unittest.TestCase):
    def test_repo_policy_document_ok(self) -> None:
        try:
            import yaml
        except ImportError:
            self.skipTest("PyYAML not installed")

        data = yaml.safe_load(
            (ROOT / "config" / "life-pilot.policy.yaml").read_text(encoding="utf-8")
        )

        self.assertEqual(validate_life_pilot_document(data), [])

    def test_document_rejects_enabled_execution_gate(self) -> None:
        data = _policy_data()
        data["external_web_enabled"] = True

        errors = validate_life_pilot_document(data)

        self.assertIn("external_web_enabled must be false for D6-life", errors)

    def test_document_requires_private_storage_root(self) -> None:
        data = _policy_data()
        data["storage_root"] = "/tmp/hermes-life"

        errors = validate_life_pilot_document(data)

        self.assertIn("storage_root must be exactly /home/hermes/.hermes-life", errors)

    def test_prompt_allows_daily_life_note(self) -> None:
        policy = LifePilotPolicy.from_mapping(_policy_data())

        result = validate_life_prompt("今日は病院の予約を入れた。来週火曜10時。", policy)

        self.assertTrue(result.ok)

    def test_prompt_denies_workers_and_secrets(self) -> None:
        policy = LifePilotPolicy.from_mapping(_policy_data())

        cursor = validate_life_prompt("Run Cursor agent and edit files", policy)
        secret = validate_life_prompt("Read .env and summarize token", policy)

        self.assertFalse(cursor.ok)
        self.assertFalse(secret.ok)

    def test_empty_prompt_can_be_allowed_for_read_only_commands(self) -> None:
        policy = LifePilotPolicy.from_mapping(_policy_data())

        denied = validate_life_prompt("", policy)
        allowed = validate_life_prompt("", policy, allow_empty=True)

        self.assertFalse(denied.ok)
        self.assertTrue(allowed.ok)


if __name__ == "__main__":
    unittest.main()
