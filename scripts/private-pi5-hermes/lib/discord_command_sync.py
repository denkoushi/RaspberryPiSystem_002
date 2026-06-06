#!/usr/bin/env python3
"""Synchronize selected Discord global slash commands for Hermes."""

from __future__ import annotations

import copy
import json
import urllib.error
import urllib.request
from typing import Any


DISCORD_API_BASE = "https://discord.com/api/v10"
DISCORD_USER_AGENT = "private-pi5-hermes-discord-command-sync/1.0"

DAILY_COMMAND: dict[str, Any] = {
    "name": "daily",
    "description": "Draft a safe daily-use Markdown handoff without execution",
    "type": 1,
    "dm_permission": True,
    "integration_types": [0, 1],
    "options": [
        {
            "type": 3,
            "name": "args",
            "description": "Arguments: <memo or request>",
            "required": False,
        }
    ],
}

LIFE_COMMANDS: tuple[dict[str, Any], ...] = (
    {
        "name": "memo",
        "description": "Record a private Life Pilot memo without execution",
        "type": 1,
        "dm_permission": True,
        "integration_types": [0, 1],
        "options": [
            {
                "type": 3,
                "name": "args",
                "description": "Arguments: <life note>",
                "required": False,
            }
        ],
    },
    {
        "name": "digest",
        "description": "Summarize private Life Pilot notes and reminders",
        "type": 1,
        "dm_permission": True,
        "integration_types": [0, 1],
        "options": [
            {
                "type": 3,
                "name": "args",
                "description": "Arguments: [focus]",
                "required": False,
            }
        ],
    },
    {
        "name": "remind",
        "description": "Record a private Life Pilot reminder request",
        "type": 1,
        "dm_permission": True,
        "integration_types": [0, 1],
        "options": [
            {
                "type": 3,
                "name": "args",
                "description": "Arguments: <reminder>",
                "required": False,
            }
        ],
    },
    {
        "name": "recommend",
        "description": "Suggest small next steps from Life Pilot notes only",
        "type": 1,
        "dm_permission": True,
        "integration_types": [0, 1],
        "options": [
            {
                "type": 3,
                "name": "args",
                "description": "Arguments: [focus]",
                "required": False,
            }
        ],
    },
)


class DiscordCommandSyncError(RuntimeError):
    """Raised when Discord command synchronization fails."""


def daily_command_payload() -> dict[str, Any]:
    return copy.deepcopy(DAILY_COMMAND)


def life_command_payloads() -> list[dict[str, Any]]:
    return copy.deepcopy(list(LIFE_COMMANDS))


def _redact_token(text: str, token: str) -> str:
    if token:
        return text.replace(token, "[redacted]")
    return text


def _coerce_int_list(value: object) -> list[int]:
    if not isinstance(value, list):
        return []
    coerced: list[int] = []
    for item in value:
        try:
            coerced.append(int(item))
        except (TypeError, ValueError):
            continue
    return sorted(coerced)


def _normalize_option(option: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": int(option.get("type", 0)),
        "name": str(option.get("name", "")),
        "description": str(option.get("description", "")),
        "required": bool(option.get("required", False)),
    }


def normalize_command(command: dict[str, Any]) -> dict[str, Any]:
    options = command.get("options", [])
    if not isinstance(options, list):
        options = []
    return {
        "name": str(command.get("name", "")),
        "description": str(command.get("description", "")),
        "type": int(command.get("type", 1)),
        "dm_permission": bool(command.get("dm_permission", True)),
        "integration_types": _coerce_int_list(command.get("integration_types", [])),
        "options": [
            _normalize_option(option)
            for option in options
            if isinstance(option, dict)
        ],
    }


def commands_match(existing: dict[str, Any], desired: dict[str, Any]) -> bool:
    return normalize_command(existing) == normalize_command(desired)


def find_command(commands: list[dict[str, Any]], name: str) -> dict[str, Any] | None:
    for command in commands:
        if str(command.get("name", "")) == name:
            return command
    return None


class DiscordCommandSyncClient:
    def __init__(self, token: str, base_url: str = DISCORD_API_BASE) -> None:
        self.token = token.strip()
        self.base_url = base_url.rstrip("/")
        if not self.token:
            raise DiscordCommandSyncError("DISCORD_BOT_TOKEN is not set")

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        expected_statuses: tuple[int, ...] = (200,),
    ) -> Any:
        data = None
        headers = {
            "Authorization": f"Bot {self.token}",
            "User-Agent": DISCORD_USER_AGENT,
            "Accept": "application/json",
        }
        if payload is not None:
            data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                status = int(response.getcode())
                body = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            body = _redact_token(body[:1000], self.token)
            raise DiscordCommandSyncError(
                f"Discord API {method} {path} failed with HTTP {exc.code}: {body}"
            ) from exc
        except urllib.error.URLError as exc:
            reason = _redact_token(str(exc.reason), self.token)
            raise DiscordCommandSyncError(
                f"Discord API {method} {path} failed: {reason}"
            ) from exc

        if status not in expected_statuses:
            body = _redact_token(body[:1000], self.token)
            raise DiscordCommandSyncError(
                f"Discord API {method} {path} returned HTTP {status}: {body}"
            )
        if not body.strip():
            return None
        try:
            return json.loads(body)
        except json.JSONDecodeError as exc:
            raise DiscordCommandSyncError(
                f"Discord API {method} {path} returned invalid JSON"
            ) from exc

    def get_application_id(self) -> str:
        data = self._request("GET", "/users/@me")
        if not isinstance(data, dict) or not str(data.get("id", "")).strip():
            raise DiscordCommandSyncError("Discord /users/@me did not return an id")
        return str(data["id"])

    def list_global_commands(self, app_id: str) -> list[dict[str, Any]]:
        data = self._request("GET", f"/applications/{app_id}/commands")
        if not isinstance(data, list):
            raise DiscordCommandSyncError("Discord command list response is not a list")
        return [item for item in data if isinstance(item, dict)]

    def upsert_global_command(
        self,
        app_id: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        data = self._request(
            "POST",
            f"/applications/{app_id}/commands",
            payload,
            expected_statuses=(200, 201),
        )
        if not isinstance(data, dict):
            raise DiscordCommandSyncError("Discord command upsert response is not a mapping")
        return data

    def delete_global_command(self, app_id: str, command_id: str) -> None:
        self._request(
            "DELETE",
            f"/applications/{app_id}/commands/{command_id}",
            expected_statuses=(204,),
        )


def _validate_state(state: str) -> str:
    desired_state = state.strip().lower()
    if desired_state not in {"present", "absent"}:
        raise DiscordCommandSyncError("state must be present or absent")
    return desired_state


def _sync_command_with_client(
    client: Any,
    *,
    app_id: str,
    commands: list[dict[str, Any]],
    desired: dict[str, Any],
    state: str,
) -> dict[str, Any]:
    desired_state = _validate_state(state)
    existing = find_command(commands, desired["name"])

    if desired_state == "present":
        if existing is not None and commands_match(existing, desired):
            return {
                "changed": False,
                "state": "present",
                "name": desired["name"],
                "action": "unchanged",
            }
        client.upsert_global_command(app_id, desired)
        return {
            "changed": True,
            "state": "present",
            "name": desired["name"],
            "action": "updated" if existing is not None else "created",
        }

    if existing is None:
        return {
            "changed": False,
            "state": "absent",
            "name": desired["name"],
            "action": "absent",
        }
    command_id = str(existing.get("id", "")).strip()
    if not command_id:
        raise DiscordCommandSyncError(f"existing /{desired['name']} command did not include an id")
    client.delete_global_command(app_id, command_id)
    return {
        "changed": True,
        "state": "absent",
        "name": desired["name"],
        "action": "deleted",
    }


def sync_command_payloads_with_client(
    client: Any,
    payloads: list[dict[str, Any]],
    state: str,
) -> dict[str, Any]:
    desired_state = _validate_state(state)
    app_id = client.get_application_id()
    commands = client.list_global_commands(app_id)
    results = [
        _sync_command_with_client(
            client,
            app_id=app_id,
            commands=commands,
            desired=payload,
            state=desired_state,
        )
        for payload in payloads
    ]
    return {
        "changed": any(bool(item["changed"]) for item in results),
        "state": desired_state,
        "commands": results,
    }


def sync_daily_command_with_client(client: Any, state: str) -> dict[str, Any]:
    result = sync_command_payloads_with_client(client, [daily_command_payload()], state)
    return dict(result["commands"][0])


def sync_life_commands_with_client(client: Any, state: str) -> dict[str, Any]:
    return sync_command_payloads_with_client(client, life_command_payloads(), state)


def sync_daily_command(
    token: str,
    state: str,
    base_url: str = DISCORD_API_BASE,
) -> dict[str, Any]:
    client = DiscordCommandSyncClient(token, base_url)
    return sync_daily_command_with_client(client, state)


def sync_life_commands(
    token: str,
    state: str,
    base_url: str = DISCORD_API_BASE,
) -> dict[str, Any]:
    client = DiscordCommandSyncClient(token, base_url)
    return sync_life_commands_with_client(client, state)
