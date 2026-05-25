#!/usr/bin/env bash
# Phase D5 Discord /task bridge smoke (policy + prompt validation; no Hermes LLM).
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
print("ok: prompt allow/deny checks")
PY

echo "== bridge CLI empty prompt (expect usage exit 1) =="
if python3 "${REPO_ROOT}/scripts/private-pi5-hermes/hermes-discord-task-bridge" 2>/dev/null; then
  echo "FAIL: expected non-zero exit for empty prompt"
  exit 1
fi
echo "ok: empty prompt rejected"

echo "== plugin register + /task handler smoke =="
python3 - <<'PY' "${REPO_ROOT}"
import sys
from pathlib import Path
from unittest import mock

root = Path(sys.argv[1])
sys.path.insert(0, str(root / "scripts/private-pi5-hermes"))

from lib import discord_task_bridge_plugin as plugin  # noqa: E402


class DummyCtx:
    def __init__(self):
        self.calls = []

    def register_command(self, name, handler, description=""):
        self.calls.append((name, handler, description))


ctx = DummyCtx()
plugin.register(ctx)
if len(ctx.calls) != 1 or ctx.calls[0][0] != "task":
    raise SystemExit("FAIL: plugin did not register /task")

with mock.patch.object(plugin, "load_task_bridge_policy", return_value=object()):
    with mock.patch.object(plugin, "run_task_bridge", return_value="ok: bridged"):
        result = ctx.calls[0][1]("list workspace files")
        if result != "ok: bridged":
            raise SystemExit("FAIL: plugin handler did not return bridge output")

print("ok: plugin /task registration and handler")
PY

echo "OK"
