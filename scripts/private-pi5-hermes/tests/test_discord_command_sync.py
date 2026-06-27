#!/usr/bin/env python3
"""Discord command synchronization tests."""

import io
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.discord_command_sync import (  # noqa: E402
    DiscordCommandSyncClient,
    DiscordCommandSyncError,
    commands_match,
    daily_command_payload,
    life_command_payloads,
    research_command_payload,
    sync_daily_command_with_client,
    sync_life_commands_with_client,
    sync_research_command_with_client,
)


class FakeDiscordClient:
    def __init__(self, commands: list[dict[str, object]]) -> None:
        self.commands = commands
        self.upserts: list[tuple[str, dict[str, object]]] = []
        self.deletes: list[tuple[str, str]] = []

    def get_application_id(self) -> str:
        return "app-1"

    def list_global_commands(self, app_id: str) -> list[dict[str, object]]:
        self.list_app_id = app_id
        return self.commands

    def upsert_global_command(
        self,
        app_id: str,
        payload: dict[str, object],
    ) -> dict[str, object]:
        self.upserts.append((app_id, payload))
        return {"id": "daily-1", **payload}

    def delete_global_command(self, app_id: str, command_id: str) -> None:
        self.deletes.append((app_id, command_id))


class DiscordCommandSyncTests(unittest.TestCase):
    def test_daily_payload_matches_expected_contract(self) -> None:
        payload = daily_command_payload()

        self.assertEqual(payload["name"], "daily")
        self.assertEqual(
            payload["description"],
            "Draft a safe daily-use Markdown handoff without execution",
        )
        self.assertEqual(payload["type"], 1)
        self.assertEqual(payload["dm_permission"], True)
        self.assertEqual(payload["integration_types"], [0, 1])
        self.assertEqual(
            payload["options"],
            [
                {
                    "type": 3,
                    "name": "args",
                    "description": "Arguments: <memo or request>",
                    "required": False,
                }
            ],
        )

    def test_life_payloads_match_expected_command_names(self) -> None:
        payloads = life_command_payloads()

        self.assertEqual(
            [payload["name"] for payload in payloads],
            ["memo", "inbox", "interest", "digest", "remind", "recommend", "life-reply"],
        )
        self.assertTrue(all(payload["dm_permission"] is True for payload in payloads))
        self.assertTrue(all(payload["integration_types"] == [0, 1] for payload in payloads))
        interest = payloads[2]
        self.assertEqual(
            interest["description"],
            "Show a personalized daily digest from safe public sources",
        )
        self.assertIn("like 1", interest["options"][0]["description"])
        self.assertIn("search query", interest["options"][0]["description"])
        remind = payloads[4]
        self.assertEqual(
            remind["description"],
            "Schedule a private Life Pilot reminder notification",
        )
        self.assertEqual(remind["options"][0]["required"], True)
        self.assertIn("明日の朝", remind["options"][0]["description"])

    def test_research_payload_matches_expected_contract(self) -> None:
        payload = research_command_payload()

        self.assertEqual(payload["name"], "ask")
        self.assertEqual(
            payload["description"],
            "Research the web with the isolated built-in web profile",
        )
        self.assertEqual(payload["type"], 1)
        self.assertEqual(payload["dm_permission"], True)
        self.assertEqual(payload["integration_types"], [0, 1])
        self.assertEqual(payload["options"][0]["name"], "args")
        self.assertEqual(payload["options"][0]["required"], True)

    def test_present_matching_command_is_unchanged(self) -> None:
        existing = {"id": "daily-1", **daily_command_payload(), "version": "99"}
        client = FakeDiscordClient([existing])

        result = sync_daily_command_with_client(client, "present")

        self.assertEqual(result["changed"], False)
        self.assertEqual(result["action"], "unchanged")
        self.assertEqual(client.upserts, [])
        self.assertEqual(client.deletes, [])

    def test_present_mismatched_command_is_updated(self) -> None:
        existing = {
            "id": "daily-1",
            **daily_command_payload(),
            "description": "Old description",
        }
        client = FakeDiscordClient([existing])

        result = sync_daily_command_with_client(client, "present")

        self.assertEqual(result["changed"], True)
        self.assertEqual(result["action"], "updated")
        self.assertEqual(len(client.upserts), 1)
        self.assertTrue(commands_match(client.upserts[0][1], daily_command_payload()))
        self.assertEqual(client.deletes, [])

    def test_absent_missing_command_leaves_other_commands_alone(self) -> None:
        client = FakeDiscordClient(
            [
                {"id": "task-1", "name": "task"},
                {"id": "novel-1", "name": "novel"},
            ]
        )

        result = sync_daily_command_with_client(client, "absent")

        self.assertEqual(result["changed"], False)
        self.assertEqual(result["action"], "absent")
        self.assertEqual(client.upserts, [])
        self.assertEqual(client.deletes, [])

    def test_absent_existing_command_is_deleted(self) -> None:
        existing = {"id": "daily-1", **daily_command_payload()}
        client = FakeDiscordClient([existing])

        result = sync_daily_command_with_client(client, "absent")

        self.assertEqual(result["changed"], True)
        self.assertEqual(result["action"], "deleted")
        self.assertEqual(client.deletes, [("app-1", "daily-1")])
        self.assertEqual(client.upserts, [])

    def test_present_life_commands_creates_missing_commands(self) -> None:
        client = FakeDiscordClient([])

        result = sync_life_commands_with_client(client, "present")

        self.assertEqual(result["changed"], True)
        self.assertEqual(result["state"], "present")
        self.assertEqual(
            [item["name"] for item in result["commands"]],
            ["memo", "inbox", "interest", "digest", "remind", "recommend", "life-reply"],
        )
        self.assertEqual(len(client.upserts), 7)
        self.assertEqual(client.deletes, [])

    def test_present_research_command_creates_missing_command(self) -> None:
        client = FakeDiscordClient([])

        result = sync_research_command_with_client(client, "present")

        self.assertEqual(result["changed"], True)
        self.assertEqual(result["state"], "present")
        self.assertEqual(result["name"], "ask")
        self.assertEqual(client.upserts[0][1]["name"], "ask")
        self.assertEqual(client.deletes, [])

    def test_absent_life_commands_deletes_existing_life_commands_only(self) -> None:
        existing = [
            {"id": f"{payload['name']}-1", **payload}
            for payload in life_command_payloads()
        ]
        client = FakeDiscordClient(existing + [{"id": "task-1", "name": "task"}])

        result = sync_life_commands_with_client(client, "absent")

        self.assertEqual(result["changed"], True)
        self.assertEqual(
            client.deletes,
            [
                ("app-1", "memo-1"),
                ("app-1", "inbox-1"),
                ("app-1", "interest-1"),
                ("app-1", "digest-1"),
                ("app-1", "remind-1"),
                ("app-1", "recommend-1"),
                ("app-1", "life-reply-1"),
            ],
        )
        self.assertEqual(client.upserts, [])

    def test_http_error_redacts_token(self) -> None:
        token = "secret-token-value"
        error = urllib.error.HTTPError(
            url="https://discord.example.test",
            code=403,
            msg="Forbidden",
            hdrs={},
            fp=io.BytesIO(f"body includes {token}".encode("utf-8")),
        )
        client = DiscordCommandSyncClient(token, "https://discord.example.test")

        with mock.patch("urllib.request.urlopen", side_effect=error):
            with self.assertRaises(DiscordCommandSyncError) as raised:
                client._request("GET", "/broken")

        self.assertNotIn(token, str(raised.exception))
        self.assertIn("[redacted]", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
