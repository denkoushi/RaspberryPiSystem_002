#!/bin/bash
set -euo pipefail

# Comprehensive unit test for deploy-executor.sh
# Covers test cases: DE-001 to DE-003 (DE-004 requires lockfile implementation)

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/deploy-executor.sh"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for this test." >&2
  exit 1
fi

failed=0

# DE-001: サーバー側デプロイを実行（dry-run）
echo "Test DE-001: サーバー側デプロイを実行（dry-run）"
input='{"deploy_targets":["server"],"impact_scope":{"server":true}}'
output=$(echo "$input" | "$SCRIPT")
if ! echo "$output" | jq -e '.results[0].target == "server" and .results[0].status == "skipped"' >/dev/null 2>&1; then
  echo "  FAILED: DE-001"
  failed=$((failed + 1))
else
  if echo "$output" | jq -e '.results[0].planned_command | contains("scripts/server/deploy.sh")' >/dev/null 2>&1; then
    echo "  PASSED: DE-001"
  else
    echo "  FAILED: DE-001 (planned_command not found)"
    failed=$((failed + 1))
  fi
fi

# DE-002: Pi4キオスクデプロイを実行（dry-run）
echo "Test DE-002: Pi4キオスクデプロイを実行（dry-run）"
input='{"deploy_targets":["pi4_kiosk"],"impact_scope":{"pi4_kiosk":true}}'
output=$(echo "$input" | "$SCRIPT")
if ! echo "$output" | jq -e '.results[0].target == "pi4_kiosk" and .results[0].status == "skipped"' >/dev/null 2>&1; then
  echo "  FAILED: DE-002"
  failed=$((failed + 1))
else
  if echo "$output" | jq -e '.results[0].planned_command | contains("ansible-playbook") and contains("pi4_kiosk")' >/dev/null 2>&1; then
    echo "  PASSED: DE-002"
  else
    echo "  FAILED: DE-002 (planned_command not found)"
    failed=$((failed + 1))
  fi
fi

# DE-003: Pi3サイネージデプロイを実行（dry-run）
echo "Test DE-003: Pi3サイネージデプロイを実行（dry-run）"
input='{"deploy_targets":["pi3_signage"],"impact_scope":{"pi3_signage":true}}'
output=$(echo "$input" | "$SCRIPT")
if ! echo "$output" | jq -e '.results[0].target == "pi3_signage" and .results[0].status == "skipped"' >/dev/null 2>&1; then
  echo "  FAILED: DE-003"
  failed=$((failed + 1))
else
  if echo "$output" | jq -e '.results[0].planned_command | contains("ansible-playbook") and contains("pi3_signage")' >/dev/null 2>&1; then
    echo "  PASSED: DE-003"
  else
    echo "  FAILED: DE-003 (planned_command not found)"
    failed=$((failed + 1))
  fi
fi

# DE-004: ロックファイル機構（未実装のためスキップ）
echo "Test DE-004: ロックファイル機構"
echo "  SKIPPED: DE-004 (lockfile mechanism not implemented yet)"

if [ $failed -eq 0 ]; then
  echo ""
  echo "All deploy-executor tests passed (DE-001 to DE-003, DE-004 skipped)"
  exit 0
else
  echo ""
  echo "$failed test(s) failed"
  exit 1
fi

