#!/usr/bin/env bash
# Coordinator takeover hook for candidate-build residue. It does not build an
# image or change public routing.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec env PI5_DEPLOY_SKIP_PHASE3_LEGACY_GUARD=1 \
  "${SCRIPT_DIR}/pi5-image-deploy.sh" reconcile-workload
