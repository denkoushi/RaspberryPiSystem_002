#!/usr/bin/env bash
# Post-deploy checks for Hermes tools profile (Phase D1 / D2 / D3).
# Run on private Pi5 as root or via ansible script module.
set -euo pipefail

HERMES_USER="${HERMES_USER:-hermes}"
TOOLS_DATA="/home/${HERMES_USER}/.hermes-tools"
TOOLS_HOME="${TOOLS_DATA}/home"
TOOLS_CONFIG="${TOOLS_HOME}/.hermes/config.yaml"
DGX_BASE="${DGX_BASE:-http://100.118.82.72:38081}"
# d1 = gateway inactive, file disabled
# d2 = gateway active, file enabled + workspace mount
# d3 = gateway active, file+web enabled + website_blocklist
HERMES_TOOLS_PHASE="${HERMES_TOOLS_PHASE:-d1}"

expect_gateway_inactive() {
  [[ "${HERMES_TOOLS_PHASE}" == "d1" ]]
}

expect_gateway_active() {
  [[ "${HERMES_TOOLS_PHASE}" == "d2" || "${HERMES_TOOLS_PHASE}" == "d3" ]]
}

echo "== tools phase (${HERMES_TOOLS_PHASE}) =="

echo "== tools gateway =="
if systemctl is-active hermes-tools-gateway >/dev/null 2>&1; then
  gateway_state="active"
else
  gateway_state="inactive"
fi

if expect_gateway_inactive; then
  if [[ "${gateway_state}" == "active" ]]; then
    echo "FAIL: hermes-tools-gateway is active (expected inactive for phase d1)"
    exit 1
  fi
  echo "hermes-tools-gateway=inactive (ok)"
else
  if [[ "${gateway_state}" != "active" ]]; then
    echo "FAIL: hermes-tools-gateway is inactive (expected active for phase ${HERMES_TOOLS_PHASE})"
    exit 1
  fi
  echo "hermes-tools-gateway=active (ok)"
fi

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
check_path "${TOOLS_CONFIG}"

echo "== tools config contract =="
if ! sudo -u "${HERMES_USER}" test -r "${TOOLS_CONFIG}"; then
  echo "FAIL: cannot read ${TOOLS_CONFIG}"
  exit 1
fi

config_text="$(sudo -u "${HERMES_USER}" cat "${TOOLS_CONFIG}")"
workspace_mount="${TOOLS_DATA}/workspace:/workspace"

file_must_be_disabled() {
  awk '/disabled_toolsets:/{f=1;next} f && /^[[:space:]]*-[[:space:]]*file[[:space:]]*$/{found=1} f && /^[^[:space:]]/{f=0} END{exit !found}' <<<"${config_text}"
}

file_must_be_enabled() {
  ! file_must_be_disabled
}

web_must_be_disabled() {
  awk '/disabled_toolsets:/{f=1;next} f && /^[[:space:]]*-[[:space:]]*web[[:space:]]*$/{found=1} f && /^[^[:space:]]/{f=0} END{exit !found}' <<<"${config_text}"
}

web_must_be_enabled() {
  ! web_must_be_disabled
}

case "${HERMES_TOOLS_PHASE}" in
  d3)
    if [[ "${config_text}" != *"${workspace_mount}"* ]]; then
      echo "FAIL: missing docker_volumes workspace mount: ${workspace_mount}"
      exit 1
    fi
    if file_must_be_disabled; then
      echo "FAIL: file must not be in agent.disabled_toolsets for phase d3"
      exit 1
    fi
    if web_must_be_disabled; then
      echo "FAIL: web must not be in agent.disabled_toolsets for phase d3"
      exit 1
    fi
    if [[ "${config_text}" != *"website_blocklist:"* ]] || [[ "${config_text}" != *"enabled: true"* ]]; then
      echo "FAIL: security.website_blocklist must be enabled for phase d3"
      exit 1
    fi
    echo "ok: workspace mount; file+web enabled; website_blocklist present"
    ;;
  d2)
    if [[ "${config_text}" != *"${workspace_mount}"* ]]; then
      echo "FAIL: missing docker_volumes workspace mount: ${workspace_mount}"
      exit 1
    fi
    if file_must_be_disabled; then
      echo "FAIL: file must not be in agent.disabled_toolsets for phase d2"
      exit 1
    fi
    if web_must_be_enabled; then
      echo "FAIL: web must remain in agent.disabled_toolsets for phase d2"
      exit 1
    fi
    echo "ok: workspace mount present; file toolset enabled; web disabled"
    ;;
  d1|*)
    if [[ "${config_text}" == *"${workspace_mount}"* ]]; then
      echo "FAIL: unexpected workspace docker mount for phase d1"
      exit 1
    fi
    if ! file_must_be_disabled; then
      echo "FAIL: file must be in agent.disabled_toolsets for phase d1"
      exit 1
    fi
    if ! web_must_be_disabled; then
      echo "FAIL: web must be in agent.disabled_toolsets for phase d1"
      exit 1
    fi
    echo "ok: file and web toolsets disabled; no workspace docker mount"
    ;;
esac

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
