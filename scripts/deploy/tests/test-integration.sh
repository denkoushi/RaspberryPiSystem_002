#!/bin/bash
set -euo pipefail

# Integration: change-detector -> impact-analyzer -> deploy-executor -> verifier (dry-run)

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

output=$("$ROOT/scripts/deploy/deploy-all.sh" --dry-run)

python3 - <<'PY' "$output"
import sys, json
out = json.loads(sys.argv[1])
assert "overall_status" in out, out
assert "changes" in out and "impact" in out, out
assert out["deploy"]["overall_status"] in ("skipped","success"), out
assert out["verify"]["overall_status"] in ("skipped","pass","passed","success"), out
print("integration (dry-run) test: OK")
PY
