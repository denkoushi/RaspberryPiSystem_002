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
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--daily-state",
        choices=("present", "absent"),
        required=True,
        help="Desired state for the global /daily command.",
    )
    parser.add_argument(
        "--base-url",
        default=DISCORD_API_BASE,
        help=argparse.SUPPRESS,
    )
    args = parser.parse_args()

    token = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
    try:
        result = sync_daily_command(token, args.daily_state, args.base_url)
    except DiscordCommandSyncError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, sort_keys=True))
        return 1

    print(json.dumps({"ok": True, **result}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
