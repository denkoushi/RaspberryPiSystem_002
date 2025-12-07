#!/bin/bash
set -euo pipefail

# Real-world smoke test for change-detector.sh against current repo working tree.
# - Runs change-detector and validates JSON schema minimally.
# - Does not modify repository state.

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/change-detector.sh"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for this test." >&2
  exit 1
fi

output=$("$SCRIPT")

echo "$output" | jq -e 'has("config_changes") and has("code_changes") and has("detection_time")' >/dev/null

echo "change-detector real test (smoke): OK"

