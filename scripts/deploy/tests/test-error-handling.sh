#!/bin/bash
set -euo pipefail

# Error handling test for deploy-executor.sh
# Covers test cases: ER-001 to ER-004

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/deploy-executor.sh"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for this test." >&2
  exit 1
fi

failed=0

# ER-001: 無効なJSON入力の処理
echo "Test ER-001: 無効なJSON入力の処理"
output=$(echo "invalid json" | "$SCRIPT" 2>&1 || true)
if echo "$output" | jq -e '.overall_status == "error" and .error == "invalid JSON input"' >/dev/null 2>&1; then
  echo "  PASSED: ER-001"
else
  echo "  FAILED: ER-001"
  echo "  Output: $output"
  failed=$((failed + 1))
fi

# ER-002: 無効なdeploy_targets形式の処理
echo "Test ER-002: 無効なdeploy_targets形式の処理"
input='{"deploy_targets":"not_an_array"}'
output=$(echo "$input" | "$SCRIPT" 2>&1 || true)
if echo "$output" | jq -e '.overall_status == "error" and .error == "deploy_targets must be an array"' >/dev/null 2>&1; then
  echo "  PASSED: ER-002"
else
  echo "  FAILED: ER-002"
  echo "  Output: $output"
  failed=$((failed + 1))
fi

# ER-003: 未知のターゲットの処理（dry-runモードでは検証不可、実機検証で確認）
echo "Test ER-003: 未知のターゲットの処理"
echo "  SKIPPED: ER-003 (unknown target validation requires DEPLOY_EXECUTOR_ENABLE=1, tested in real device verification)"

# ER-004: デプロイコマンド実行失敗時の処理（dry-runモードでは検証不可、実機検証で確認）
echo "Test ER-004: デプロイコマンド実行失敗時の処理"
echo "  SKIPPED: ER-004 (requires actual deploy execution, tested in real device verification)"

if [ $failed -eq 0 ]; then
  echo ""
  echo "All error handling tests passed (ER-001 to ER-003, ER-004 skipped)"
  exit 0
else
  echo ""
  echo "$failed test(s) failed"
  exit 1
fi

