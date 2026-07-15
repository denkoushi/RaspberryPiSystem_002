#!/usr/bin/env bash
set -euo pipefail

echo "[ERROR] scripts/deploy/deploy-executor.sh is retired; direct executor access is disabled." >&2
echo "Use: scripts/update-all-clients.sh <branch> <inventory>" >&2
exit 2
