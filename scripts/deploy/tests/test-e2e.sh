#!/bin/bash
set -euo pipefail

# E2E (local dry-run): deploy-all without --dry-run (executor/verifier stay skipped by default)

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

output=$("$ROOT/scripts/deploy/deploy-all.sh")

python3 - <<'PY' "$output"
import sys, json
out = json.loads(sys.argv[1])
assert out["overall_status"] in ("success","skipped"), out
print("e2e (default skip) test: OK")
PY
