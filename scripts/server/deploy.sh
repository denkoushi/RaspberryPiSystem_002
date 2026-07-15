#!/usr/bin/env bash
set -euo pipefail

echo "[ERROR] scripts/server/deploy.sh is retired; direct server deployment is disabled." >&2
echo "Use: scripts/update-all-clients.sh <branch> <inventory>" >&2
exit 2
