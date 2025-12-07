#!/bin/bash
set -euo pipefail

# Unit test: verifier skips when DEPLOY_VERIFIER_ENABLE!=1

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/verifier.sh"

input='{"results":[{"target":"server","status":"success"}]}'
output=$(echo "$input" | "${SCRIPT}")

python3 - <<'PY' "$output"
import sys, json
out = json.loads(sys.argv[1])
assert out["overall_status"] == "skipped", out
assert out["verification_results"] == [], out
print("verifier unit test (skip mode): OK")
PY
