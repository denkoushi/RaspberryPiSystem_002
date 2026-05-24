#!/usr/bin/env bash
# Best-effort Phase D2 smoke: workspace seed file visible to hermes user.
# Does not invoke Hermes LLM; use after deploy when HERMES_TOOLS_PHASE=d2.
set -euo pipefail

HERMES_USER="${HERMES_USER:-hermes}"
WORKSPACE="/home/${HERMES_USER}/.hermes-tools/workspace"
SEED="${WORKSPACE}/.d2-smoke-seed"

mkdir -p "${WORKSPACE}"
echo "phase-d2-smoke" | sudo -u "${HERMES_USER}" tee "${SEED}" >/dev/null
sudo -u "${HERMES_USER}" test -f "${SEED}"
echo "ok: workspace seed ${SEED}"
