#!/bin/bash
set -euo pipefail

# Real-world smoke test for impact-analyzer.sh against current repo working tree.
# - Feeds minimal input JSON
# - Validates JSON schema keys

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/impact-analyzer.sh"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for this test." >&2
  exit 1
fi

input='{"config_changes":[],"code_changes":[]}'
output=$(echo "$input" | "$SCRIPT")

echo "$output" | jq -e 'has("impact_scope") and has("deploy_targets") and has("reason")' >/dev/null

echo "impact-analyzer real test (smoke): OK"

