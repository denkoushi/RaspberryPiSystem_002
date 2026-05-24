#!/usr/bin/env bash
# Phase D3 web smoke: boundary smoke_urls via curl + denied URL via Python validate_url.
# Best-effort on private Pi5 (no LLM calls). Run as root or via ansible copy+shell.
set -euo pipefail

HERMES_USER="${HERMES_USER:-hermes}"
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
POLICY="${POLICY:-${REPO_ROOT}/scripts/private-pi5-hermes/config/boundary-policy.tools.yaml}"
DGX_BASE="${DGX_BASE:-http://100.118.82.72:38081}"

run_as_hermes() {
  if id "${HERMES_USER}" >/dev/null 2>&1; then
    sudo -u "${HERMES_USER}" "$@"
  else
    "$@"
  fi
}

echo "== boundary policy smoke_urls (HTTP) =="
smoke_ok=0
smoke_fail=0
while IFS= read -r url; do
  [[ -z "${url}" ]] && continue
  if run_as_hermes curl -sf -o /dev/null -w "%{http_code}" --connect-timeout 5 "${url}" | grep -qE '^(200|204)$'; then
    echo "ok: ${url}"
    smoke_ok=$((smoke_ok + 1))
  else
    code="$(run_as_hermes curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "${url}" || true)"
    echo "warn: ${url} http_code=${code:-failed} (Tailscale/DGX unreachable is acceptable off-Pi5)"
    smoke_fail=$((smoke_fail + 1))
  fi
done < <(python3 - <<'PY' "${POLICY}"
import json, sys
from pathlib import Path
try:
    import yaml
except ImportError:
    yaml = None
path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
data = yaml.safe_load(text) if yaml else json.loads(text)
for url in data.get("smoke_urls") or []:
    print(url)
PY
)

echo "== boundary validate_url deny sample (no HTTP) =="
python3 - <<'PY' "${REPO_ROOT}" "${POLICY}"
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
policy_path = Path(sys.argv[2])
sys.path.insert(0, str(root / "scripts/private-pi5-hermes"))
from lib.boundary_policy import BoundaryPolicy, validate_url  # noqa: E402

try:
    import yaml
except ImportError:
    yaml = None

text = policy_path.read_text(encoding="utf-8")
data = yaml.safe_load(text) if yaml else json.loads(text)
policy = BoundaryPolicy.from_mapping(data)

denied = validate_url("http://127.0.0.1:38081/healthz", policy)
if denied.ok:
    raise SystemExit("FAIL: expected loopback URL to be denied")
print("ok: loopback URL denied by boundary policy")

allowed = validate_url("http://100.118.82.72:38081/healthz", policy)
if not allowed.ok:
    raise SystemExit(f"FAIL: expected DGX healthz allowed: {allowed.reason}")
print("ok: DGX healthz allowed by boundary policy")
PY

echo "== web smoke finished (curl failures=${smoke_fail}) =="
if [[ "${smoke_fail}" -gt 0 ]]; then
  echo "note: curl smoke is best-effort when not on private Pi5 with DGX reachability"
fi
echo "OK"
