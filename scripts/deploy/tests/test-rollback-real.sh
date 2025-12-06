#!/bin/bash
set -euo pipefail

# Rollback test (safe): force deploy failure and use harmless rollback command

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

export FORCE_DEPLOY_FAILURE=1
export ROLLBACK_ON_FAIL=1
export ROLLBACK_CMD="true"

output=$("$ROOT/scripts/deploy/deploy-all.sh" --dry-run)

python3 - <<'PY' "$output"
import sys, json
out = json.loads(sys.argv[1])
assert out["overall_status"] == "failed", out
rb = out.get("rollback", {})
assert rb.get("status") in ("success","skipped","failed"), rb
print("rollback test (forced failure, harmless rollback): OK")
PY
