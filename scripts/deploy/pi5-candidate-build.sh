#!/usr/bin/env bash
set -euo pipefail

# Build-only adapter shared by Phase 2 and Phase 3.  It never changes public
# routing; Phase 3 receives the immutable pair through the existing candidate
# state file after this command succeeds.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat >&2 <<'EOF'
Usage: pi5-candidate-build.sh --ref FULL_SHA --run-id RUN_ID [--resource-evidence FILE] [--dry-run]

Build and validate immutable API/Web candidate images without changing the
legacy Compose services or the Blue/Green gateway.
EOF
}

[[ $# -ge 2 ]] || { usage; exit 2; }
exec env PI5_DEPLOY_SKIP_PHASE3_LEGACY_GUARD=1 "${SCRIPT_DIR}/pi5-image-deploy.sh" prepare "$@"
