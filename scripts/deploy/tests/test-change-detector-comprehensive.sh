#!/bin/bash
set -euo pipefail

# Comprehensive unit test for change-detector.sh
# Covers all test cases: CD-001 to CD-008

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/scripts/deploy/change-detector.sh"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for this test." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pushd "$TMP" >/dev/null
git init -q
git config user.name "Test User"
git config user.email "test@example.com"

mkdir -p infrastructure/ansible/group_vars
mkdir -p apps/api/src/services/signage
mkdir -p apps/web/src/pages/kiosk

# Initial commit
cat > infrastructure/ansible/group_vars/all.yml <<'YML'
network_mode: local
server_ip: 192.168.10.10
kiosk_url: http://192.168.10.20/kiosk
YML

echo "// signage service" > apps/api/src/services/signage/signage.service.ts
echo "// kiosk return page" > apps/web/src/pages/kiosk/KioskReturnPage.tsx

git add .
git commit -qm "init"

export REPO_ROOT="$TMP"
failed=0

# CD-001: network_mode変更を検知
echo "Test CD-001: network_mode変更を検知"
cat > infrastructure/ansible/group_vars/all.yml <<'YML'
network_mode: tailscale
server_ip: 192.168.10.10
kiosk_url: http://192.168.10.20/kiosk
YML
output=$("$SCRIPT")
if ! echo "$output" | jq -e '.config_changes[0].changed_keys | index("network_mode")' >/dev/null 2>&1; then
  echo "  FAILED: CD-001"
  failed=$((failed + 1))
else
  echo "  PASSED: CD-001"
fi
git checkout -q infrastructure/ansible/group_vars/all.yml

# CD-002: server_ip変更を検知
echo "Test CD-002: server_ip変更を検知"
cat > infrastructure/ansible/group_vars/all.yml <<'YML'
network_mode: local
server_ip: 192.168.10.11
kiosk_url: http://192.168.10.20/kiosk
YML
output=$("$SCRIPT")
if ! echo "$output" | jq -e '.config_changes[0].changed_keys | index("server_ip")' >/dev/null 2>&1; then
  echo "  FAILED: CD-002"
  failed=$((failed + 1))
else
  echo "  PASSED: CD-002"
fi
git checkout -q infrastructure/ansible/group_vars/all.yml

# CD-003: 複数の設定項目を同時に変更
echo "Test CD-003: 複数の設定項目を同時に変更"
cat > infrastructure/ansible/group_vars/all.yml <<'YML'
network_mode: tailscale
server_ip: 192.168.10.11
kiosk_url: http://192.168.10.21/kiosk
YML
output=$("$SCRIPT")
keys=$(echo "$output" | jq -r '.config_changes[0].changed_keys | length')
if [ "$keys" -lt 3 ]; then
  echo "  FAILED: CD-003 (expected 3+ keys, got $keys)"
  failed=$((failed + 1))
else
  echo "  PASSED: CD-003"
fi
git checkout -q infrastructure/ansible/group_vars/all.yml

# CD-004: signage.service.ts変更を検知
echo "Test CD-004: signage.service.ts変更を検知"
echo "// modified" > apps/api/src/services/signage/signage.service.ts
output=$("$SCRIPT")
if ! echo "$output" | jq -e '.code_changes[] | select(.path == "apps/api/src/services/signage/signage.service.ts")' >/dev/null 2>&1; then
  echo "  FAILED: CD-004"
  failed=$((failed + 1))
else
  echo "  PASSED: CD-004"
fi
git checkout -q apps/api/src/services/signage/signage.service.ts

# CD-005: KioskReturnPage.tsx変更を検知
echo "Test CD-005: KioskReturnPage.tsx変更を検知"
echo "// modified" > apps/web/src/pages/kiosk/KioskReturnPage.tsx
output=$("$SCRIPT")
if ! echo "$output" | jq -e '.code_changes[] | select(.path == "apps/web/src/pages/kiosk/KioskReturnPage.tsx")' >/dev/null 2>&1; then
  echo "  FAILED: CD-005"
  failed=$((failed + 1))
else
  echo "  PASSED: CD-005"
fi
git checkout -q apps/web/src/pages/kiosk/KioskReturnPage.tsx

# CD-006: 複数のファイルを同時に変更
echo "Test CD-006: 複数のファイルを同時に変更"
echo "// modified" > apps/api/src/services/signage/signage.service.ts
echo "// modified" > apps/web/src/pages/kiosk/KioskReturnPage.tsx
output=$("$SCRIPT")
count=$(echo "$output" | jq '.code_changes | length')
if [ "$count" -lt 2 ]; then
  echo "  FAILED: CD-006 (expected 2+ files, got $count)"
  failed=$((failed + 1))
else
  echo "  PASSED: CD-006"
fi
git checkout -q apps/api/src/services/signage/signage.service.ts apps/web/src/pages/kiosk/KioskReturnPage.tsx

# CD-007: Gitリポジトリがクリーンな状態 → 変更なしを検知
echo "Test CD-007: Gitリポジトリがクリーンな状態"
# 全ての変更をコミットしてクリーンな状態にする
git add -A
if git diff --cached --quiet; then
  : # 変更なし
else
  git commit -qm "clean"
fi
output=$("$SCRIPT")
config_count=$(echo "$output" | jq '.config_changes | length')
code_count=$(echo "$output" | jq '.code_changes | length')
if [ "$config_count" -ne 0 ] || [ "$code_count" -ne 0 ]; then
  echo "  FAILED: CD-007 (expected no changes, got config:$config_count code:$code_count)"
  failed=$((failed + 1))
else
  echo "  PASSED: CD-007"
fi

# CD-008: 変更がない場合の処理（CD-007と同じ）
echo "Test CD-008: 変更がない場合の処理"
if [ "$config_count" -eq 0 ] && [ "$code_count" -eq 0 ]; then
  echo "  PASSED: CD-008"
else
  echo "  FAILED: CD-008"
  failed=$((failed + 1))
fi

popd >/dev/null

if [ $failed -eq 0 ]; then
  echo ""
  echo "All change-detector tests passed (CD-001 to CD-008)"
  exit 0
else
  echo ""
  echo "$failed test(s) failed"
  exit 1
fi

