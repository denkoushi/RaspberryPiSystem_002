#!/usr/bin/env python3
"""CLI wrapper for Hermes Discord command synchronization."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from lib.discord_command_sync import (  # noqa: E402
    DISCORD_API_BASE,
    DiscordCommandSyncError,
    sync_daily_command,
    sync_life_commands,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--daily-state",
        choices=("present", "absent"),
        default=None,
        help="Desired state for the global /daily command.",
    )
    parser.add_argument(
        "--life-state",
        choices=("present", "absent"),
        default=None,
        help="Desired state for global /memo, /digest, /remind, and /recommend commands.",
    )
    parser.add_argument(
        "--base-url",
        default=DISCORD_API_BASE,
        help=argparse.SUPPRESS,
    )
    args = parser.parse_args()
    if args.daily_state is None and args.life_state is None:
        parser.error("at least one of --daily-state or --life-state is required")

    token = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
    try:
        results: list[dict[str, object]] = []
        if args.daily_state is not None:
            results.append(
                {
                    "scope": "daily",
                    **sync_daily_command(token, args.daily_state, args.base_url),
                }
            )
        if args.life_state is not None:
            results.append(
                {
                    "scope": "life",
                    **sync_life_commands(token, args.life_state, args.base_url),
                }
            )
    except DiscordCommandSyncError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, sort_keys=True))
        return 1

    changed = any(bool(result.get("changed")) for result in results)
    payload: dict[str, object] = {"ok": True, "changed": changed, "results": results}
    if len(results) == 1:
        payload.update(results[0])
    print(json.dumps(payload, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
