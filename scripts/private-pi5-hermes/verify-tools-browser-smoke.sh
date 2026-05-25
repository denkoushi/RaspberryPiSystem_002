#!/usr/bin/env bash
# Phase D4 browser smoke: boundary policy, tools .env contract, agent-browser binary (best-effort).
# Does not invoke Hermes LLM or browser_navigate. Run as root or via ansible copy+shell.
set -euo pipefail

HERMES_USER="${HERMES_USER:-hermes}"
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
POLICY="${POLICY:-${REPO_ROOT}/scripts/private-pi5-hermes/config/boundary-policy.tools.yaml}"
TOOLS_DATA="/home/${HERMES_USER}/.hermes-tools"
TOOLS_ENV="${TOOLS_DATA}/.env"

run_as_hermes() {
  if id "${HERMES_USER}" >/dev/null 2>&1; then
    sudo -u "${HERMES_USER}" "$@"
  else
    "$@"
  fi
}

echo "== tools .env browser contract =="
if ! sudo -u "${HERMES_USER}" test -r "${TOOLS_ENV}" 2>/dev/null; then
  echo "FAIL: cannot read ${TOOLS_ENV}"
  exit 1
fi
env_text="$(sudo -u "${HERMES_USER}" cat "${TOOLS_ENV}")"
if [[ "${env_text}" != *"AGENT_BROWSER_ARGS="* ]]; then
  echo "FAIL: missing AGENT_BROWSER_ARGS in tools .env"
  exit 1
fi
for forbidden in BROWSERBASE_API_KEY BROWSER_USE_API_KEY FIRECRAWL_API_KEY CAMOFOX_URL; do
  if [[ "${env_text}" == *"${forbidden}="* ]]; then
    echo "FAIL: forbidden cloud browser env ${forbidden} in tools .env"
    exit 1
  fi
done
echo "ok: AGENT_BROWSER_ARGS present; no cloud browser API keys"

echo "== boundary validate_url (browser navigate policy) =="
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

denied = validate_url("http://127.0.0.1/", policy)
if denied.ok:
    raise SystemExit("FAIL: expected loopback URL to be denied")
print("ok: loopback URL denied")

allowed = validate_url("http://100.118.82.72:38081/healthz", policy)
if not allowed.ok:
    raise SystemExit(f"FAIL: expected DGX healthz allowed: {allowed.reason}")
print("ok: DGX healthz allowed for browser/web policy")
PY

echo "== agent-browser binary (best-effort on Pi5) =="
if run_as_hermes bash -lc 'export PATH="$HOME/.local/bin:/usr/bin:/bin"; command -v agent-browser'; then
  echo "ok: agent-browser on PATH for ${HERMES_USER}"
else
  echo "warn: agent-browser not on PATH (run install-browser-tooling or hermes setup tools on Pi5)"
fi

if command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1; then
  echo "ok: chromium system binary present"
else
  echo "warn: chromium not found on host (apt install may be required)"
fi

echo "OK"
