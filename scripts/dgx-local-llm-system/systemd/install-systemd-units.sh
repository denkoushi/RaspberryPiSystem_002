#!/usr/bin/env bash
# DGX 上で unit を /etc/systemd/system/ へコピーし有効化する補助スクリプト（要 root）。
# 使用前に control-server.env / gateway-server.env を secrets に配置すること。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNITS=(dgx-llm-embedding.service dgx-llm-control.service dgx-llm-gateway.service)
SYSTEM_PROD_DIR="${DGX_SYSTEM_PROD_DIR:-/srv/dgx/system-prod}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "run as root (sudo)" >&2
  exit 1
fi

if [[ ! -d "${SYSTEM_PROD_DIR}" ]]; then
  echo "system-prod directory not found: ${SYSTEM_PROD_DIR}" >&2
  exit 1
fi

RUN_USER="${DGX_LLM_RUN_USER:-$(stat -f '%Su' "${SYSTEM_PROD_DIR}")}"
RUN_GROUP="${DGX_LLM_RUN_GROUP:-$(stat -f '%Sg' "${SYSTEM_PROD_DIR}")}"

if ! id "${RUN_USER}" >/dev/null 2>&1; then
  echo "run user not found: ${RUN_USER}" >&2
  exit 1
fi

for u in "${UNITS[@]}"; do
  sed \
    -e "s/__DGX_LLM_USER__/${RUN_USER}/g" \
    -e "s/__DGX_LLM_GROUP__/${RUN_GROUP}/g" \
    "${SCRIPT_DIR}/${u}" > "/etc/systemd/system/${u}"
  chmod 0644 "/etc/systemd/system/${u}"
done

systemctl daemon-reload
systemctl enable dgx-llm-embedding.service dgx-llm-control.service dgx-llm-gateway.service
systemctl start dgx-llm-embedding.service dgx-llm-control.service dgx-llm-gateway.service

echo "enabled and started: ${UNITS[*]} (user=${RUN_USER} group=${RUN_GROUP})"
