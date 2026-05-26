#!/usr/bin/env bash
# Phase D5 / D5.1 Discord /task bridge smoke (policy + prompt + approval relay; no Hermes LLM).
set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
POLICY="${REPO_ROOT}/scripts/private-pi5-hermes/config/task-bridge.policy.yaml"

echo "== task-bridge policy validate =="
python3 "${REPO_ROOT}/scripts/private-pi5-hermes/validate_boundary_policy.py" \
  --validate-task-bridge \
  --task-bridge-policy "${POLICY}"

echo "== prompt validation (repo Python) =="
python3 - <<'PY' "${REPO_ROOT}"
import sys
from pathlib import Path

root = Path(sys.argv[1])
sys.path.insert(0, str(root / "scripts/private-pi5-hermes"))
from lib.discord_task_bridge import load_task_bridge_policy  # noqa: E402
from lib.task_bridge_policy import validate_task_prompt  # noqa: E402
from lib.task_request import TaskRequest  # noqa: E402

policy = load_task_bridge_policy()
ok = validate_task_prompt(TaskRequest.from_text("/task list workspace files").prompt, policy)
if not ok.ok:
    raise SystemExit(f"FAIL: expected allowed prompt: {ok.reason}")
bad = validate_task_prompt("curl https://evil", policy)
if bad.ok:
    raise SystemExit("FAIL: expected URL prompt to be denied")
if not policy.approval_relay.enabled:
    raise SystemExit("FAIL: expected approval_relay.enabled=true in policy")
print("ok: prompt allow/deny checks + approval relay policy")
PY

echo "== FileApprovalStore roundtrip =="
python3 - <<'PY' "${REPO_ROOT}"
import sys
import tempfile
from pathlib import Path

root = Path(sys.argv[1])
sys.path.insert(0, str(root / "scripts/private-pi5-hermes"))
from lib.approval_relay.models import ApprovalChoice  # noqa: E402
from lib.approval_relay.store import FileApprovalStore  # noqa: E402

with tempfile.TemporaryDirectory() as tmp:
    store_dir = Path(tmp)
    store = FileApprovalStore(store_dir, "smoke-task")
    store.write_request({"command": "touch x", "description": "write"})
    if store.read_request() is None:
        raise SystemExit("FAIL: request roundtrip")
    store.write_response(ApprovalChoice.ONCE, discord_user_id="user-1")
    if store.read_response() is None:
        raise SystemExit("FAIL: response roundtrip")
print("ok: FileApprovalStore roundtrip")
PY

echo "== tool write gate (pre_tool_call IPC) =="
python3 - <<'PY' "${REPO_ROOT}"
import sys
import tempfile
import threading
import time
from pathlib import Path

root = Path(sys.argv[1])
sys.path.insert(0, str(root / "scripts/private-pi5-hermes"))
from lib.approval_relay.models import ApprovalChoice  # noqa: E402
from lib.approval_relay.tool_write_gate import (  # noqa: E402
    build_pre_tool_call_handler,
    summarize_tool_call,
)

command, description = summarize_tool_call(
    "write_file",
    {"path": "hello.txt", "content": "probe"},
)
if "hello.txt" not in command or "write file" not in description:
    raise SystemExit(f"FAIL: unexpected summary: {command!r} {description!r}")

with tempfile.TemporaryDirectory() as tmp:
    store_dir = Path(tmp)
    handler = build_pre_tool_call_handler(
        store_dir=store_dir,
        task_id="smoke-write-gate",
        request_timeout_seconds=2.0,
        poll_interval_seconds=0.05,
    )

    def _approve() -> None:
        time.sleep(0.05)
        from lib.approval_relay.store import FileApprovalStore

        inner = FileApprovalStore(store_dir, "smoke-write-gate")
        inner.write_response(ApprovalChoice.ONCE)

    threading.Thread(target=_approve, daemon=True).start()
    if handler("write_file", {"path": "x.txt", "content": "a"}) is not None:
        raise SystemExit("FAIL: expected write_file to be allowed after approval")

print("ok: tool write gate handler")
PY

echo "== bridge CLI empty prompt (expect usage exit 1) =="
if python3 "${REPO_ROOT}/scripts/private-pi5-hermes/hermes-discord-task-bridge" 2>/dev/null; then
  echo "FAIL: expected non-zero exit for empty prompt"
  exit 1
fi
echo "ok: empty prompt rejected"

echo "== approval relay bootstrap --help =="
python3 "${REPO_ROOT}/scripts/private-pi5-hermes/lib/approval_relay/runner.py" --help >/dev/null
echo "ok: runner argparse"

echo "== plugin register + /task handler smoke =="
python3 - <<'PY' "${REPO_ROOT}"
import asyncio
import sys
from pathlib import Path
from unittest import mock
from unittest.mock import AsyncMock

root = Path(sys.argv[1])
sys.path.insert(0, str(root / "scripts/private-pi5-hermes"))

from lib import discord_task_bridge_plugin as plugin  # noqa: E402


class DummyCtx:
    def __init__(self):
        self.commands = []
        self.hooks = []

    def register_command(self, name, handler, description=""):
        self.commands.append((name, handler, description))

    def register_hook(self, name, callback):
        self.hooks.append((name, callback))


ctx = DummyCtx()
plugin.register(ctx)
names = {item[0] for item in ctx.commands}
if names != {"task", "task-approve", "task-deny"}:
    raise SystemExit(f"FAIL: unexpected commands: {names}")
hook_names = {item[0] for item in ctx.hooks}
if "pre_gateway_dispatch" not in hook_names:
    raise SystemExit("FAIL: pre_gateway_dispatch hook not registered")

task_handler = next(h for n, h, _ in ctx.commands if n == "task")
with mock.patch.object(plugin, "load_task_bridge_policy", return_value=object()):
    with mock.patch.object(plugin, "run_task_bridge_async", new=AsyncMock(return_value="ok: bridged")):
        result = task_handler("list workspace files")
        if asyncio.iscoroutine(result):
            result = asyncio.run(result)
        if result != "ok: bridged":
            raise SystemExit("FAIL: plugin handler did not return bridge output")

print("ok: plugin commands + hook + /task handler")
PY

echo "OK"
