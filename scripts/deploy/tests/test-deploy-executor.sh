#!/bin/bash
set -euo pipefail

# Unit test for deploy-executor.sh
# - Ensures skipped behavior when DEPLOY_EXECUTOR_ENABLE!=1

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/deploy-executor.sh"

input='{"deploy_targets":["server","pi4_kiosk"],"impact_scope":{"server":true,"pi4_kiosk":true}}'
output=$(echo "$input" | "$SCRIPT")

python3 - <<'PY' "$output"
import sys, json
out = json.loads(sys.argv[1])
assert out["overall_status"] == "skipped"
assert all(r["status"] == "skipped" for r in out["results"])
print("deploy-executor unit test: OK")
PY

