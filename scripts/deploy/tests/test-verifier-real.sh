#!/bin/bash
set -euo pipefail

# Real-environment smoke test (uses local HTTP server)

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/verifier.sh"
TMPDIR="$(mktemp -d)"
PORT=8010

cleanup() {
  if [[ -n "${HTTP_PID:-}" ]]; then
    kill "${HTTP_PID}" 2>/dev/null || true
  fi
  rm -rf "${TMPDIR}"
}
trap cleanup EXIT

cat > "${TMPDIR}/verification-map.yml" <<EOF
verification_map:
  server:
    - name: local_http
      type: http_get
      url: "http://127.0.0.1:${PORT}/"
      expected_status: 200
EOF

python3 -m http.server "${PORT}" --directory "${TMPDIR}" >/dev/null 2>&1 &
HTTP_PID=$!
sleep 1

export VERIFICATION_MAP_PATH="${TMPDIR}/verification-map.yml"
export DEPLOY_VERIFIER_ENABLE=1

input='{"results":[{"target":"server","status":"success"}]}'
output=$(echo "$input" | "${SCRIPT}")

python3 - <<'PY' "$output"
import sys, json
out = json.loads(sys.argv[1])
assert out["overall_status"] in ("passed","success","passed"), out
srv = out["verification_results"][0]
assert srv["overall_status"] in ("pass","passed","success"), srv
print("verifier real dry-run test: OK")
PY
