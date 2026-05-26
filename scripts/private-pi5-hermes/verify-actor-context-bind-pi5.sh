#!/usr/bin/env bash
# Pi5 post-deploy: verify gateway actor stash enables by-user bind (D5.1 actor-context fix).
set -euo pipefail
PLUGIN="/home/hermes/.hermes/plugins/private-pi5-discord-task-bridge"
PY="/home/hermes/.hermes/hermes-agent/venv/bin/python3"
STORE="/home/hermes/.hermes/task-bridge/approvals"
USER_ID="verify-actor-$(date +%s)"

export PYTHONPATH="${PLUGIN}:${PYTHONPATH:-}"

"${PY}" - <<'PY'
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, "/home/hermes/.hermes/plugins/private-pi5-discord-task-bridge")

from approval_relay.gateway_actor_context import (
    clear_gateway_actor_context,
    stash_from_message_source,
)
from approval_relay.coordinator import DiscordApprovalRelayCoordinator
from approval_relay.policy import ApprovalRelayPolicy
from approval_relay.session_context import read_gateway_session_context
from approval_relay.store import FileApprovalStore

clear_gateway_actor_context()

class Platform:
    value = "discord"

class Source:
    user_id = "1507987368462782638"
    chat_id = "1508026887568490656"
    platform = Platform()

stash_from_message_source(Source())
user_id, channel_id = read_gateway_session_context()
if user_id != "1507987368462782638":
    raise SystemExit(f"FAIL: expected stashed user_id, got {user_id!r}")
if channel_id != "1508026887568490656":
    raise SystemExit(f"FAIL: expected stashed channel_id, got {channel_id!r}")

with tempfile.TemporaryDirectory() as tmp:
    relay = ApprovalRelayPolicy(
        enabled=True,
        store_dir=tmp,
        request_timeout_seconds=30,
        poll_interval_seconds=0.05,
    )
    coord = DiscordApprovalRelayCoordinator(relay)
    ctx = coord.new_task_context(discord_user_id=user_id, discord_channel_id=channel_id)
    index = Path(tmp) / "by-user" / f"{user_id}.json"
    if not index.is_file():
        raise SystemExit("FAIL: by-user index not created after new_task_context")
    active = FileApprovalStore.active_task_id(Path(tmp), user_id)
    if active != ctx.task_id:
        raise SystemExit(f"FAIL: active task mismatch {active!r} vs {ctx.task_id!r}")

print("OK: actor context bind verify")
PY
