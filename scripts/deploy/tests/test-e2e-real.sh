#!/bin/bash
set -euo pipefail

# Real E2E (safe mode): deploy-all with --dry-run to ensure pipeline works on real repo

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

output=$("$ROOT/scripts/deploy/deploy-all.sh" --dry-run)

python3 - <<'PY' "$output"
import sys, json
out = json.loads(sys.argv[1])
assert "overall_status" in out, out
print("real e2e dry-run test: OK")
PY
