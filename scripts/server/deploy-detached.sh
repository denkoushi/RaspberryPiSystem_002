#!/usr/bin/env bash
set -euo pipefail

echo "[ERROR] scripts/server/deploy-detached.sh is retired; the alternate detached backend is disabled." >&2
echo "Use: scripts/update-all-clients.sh <branch> <inventory> --detach" >&2
exit 2
