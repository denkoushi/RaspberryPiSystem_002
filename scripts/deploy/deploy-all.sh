#!/usr/bin/env bash
set -euo pipefail

echo "[ERROR] scripts/deploy/deploy-all.sh is retired; the legacy deployment pipeline is disabled." >&2
echo "Use: scripts/update-all-clients.sh <branch> <inventory> --print-plan" >&2
exit 2
