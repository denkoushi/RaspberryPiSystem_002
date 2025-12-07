#!/bin/bash
set -euo pipefail

# Real-environment smoke test (dry-run) for deploy-executor.sh
# - DEPLOY_EXECUTOR_ENABLE is left unset (defaults to dry-run/skipped)
# - Validates JSON output schema and planned commands

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/deploy-executor.sh"

input='{"deploy_targets":["server","pi4_kiosk","pi3_signage"],"impact_scope":{"server":true,"pi4_kiosk":true,"pi3_signage":true}}'
output=$(echo "$input" | "${SCRIPT}")

python3 - <<'PY' "$output"
import sys, json
out = json.loads(sys.argv[1])
assert out["overall_status"] == "skipped", out
assert len(out["results"]) == 3, out
for r in out["results"]:
    assert "planned_command" in r, r
    assert r["status"] == "skipped", r
print("deploy-executor real dry-run test: OK")
PY
