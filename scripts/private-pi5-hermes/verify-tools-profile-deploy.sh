#!/usr/bin/env bash
# Post-deploy checks for Hermes tools profile (Phase D1).
# Run on private Pi5 as root or via ansible script module.
set -euo pipefail

HERMES_USER="${HERMES_USER:-hermes}"
TOOLS_DATA="/home/${HERMES_USER}/.hermes-tools"
TOOLS_HOME="${TOOLS_DATA}/home"
DGX_BASE="${DGX_BASE:-http://100.118.82.72:38081}"

echo "== tools gateway (expect inactive) =="
if systemctl is-active hermes-tools-gateway >/dev/null 2>&1; then
  echo "FAIL: hermes-tools-gateway is active"
  exit 1
fi
echo "hermes-tools-gateway=inactive (ok)"

echo "== tools profile paths =="
check_path() {
  local p="$1"
  if sudo -u "${HERMES_USER}" test -e "$p"; then
    echo "ok: $p"
  else
    echo "missing: $p"
    exit 1
  fi
}
check_path "${TOOLS_DATA}/boundary-policy.tools.yaml"
check_path "${TOOLS_DATA}/workspace"
check_path "${TOOLS_DATA}/.env"
check_path "${TOOLS_HOME}/.hermes/config.yaml"

echo "== chat gateway (expect active) =="
systemctl is-active hermes-gateway

echo "== tools Bearer -> DGX =="
sudo -u "${HERMES_USER}" bash -lc "
  set -a
  source ${TOOLS_DATA}/.env
  set +a
  curl -sf -o /dev/null -w 'tools_bearer=%{http_code}\n' \
    -H \"Authorization: Bearer \$OPENAI_API_KEY\" \
    ${DGX_BASE}/v1/models
"

echo "== chat Bearer -> DGX =="
sudo -u "${HERMES_USER}" bash -lc "
  set -a
  source /home/${HERMES_USER}/.hermes/.env
  set +a
  curl -sf -o /dev/null -w 'chat_bearer=%{http_code}\n' \
    -H \"Authorization: Bearer \$OPENAI_API_KEY\" \
    ${DGX_BASE}/v1/models
"

echo "OK"
