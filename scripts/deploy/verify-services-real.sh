#!/bin/bash
set -euo pipefail

# Pi5経由でPi3/Pi4のサービス状態を確認するスクリプト
# 実機検証用

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd)}"
cd "${REPO_ROOT}"

# Pi5 到達判定: verify-phase12-real.sh と同様（Tailscale 高遅延時の ICMP 偶発失敗対策）
pi5_reachable_tailscale() {
  local attempt
  for attempt in 1 2 3 4 5; do
    if ping -c 1 -W 5 100.106.158.2 >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

pi5_reachable_local() {
  local attempt
  for attempt in 1 2 3; do
    if ping -c 1 -W 5 192.168.10.230 >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# network_modeを確認し、到達可能なIPを選択
NETWORK_MODE=$(grep -E '^network_mode:' infrastructure/ansible/group_vars/all.yml | awk '{print $2}' | tr -d '"')

# Tailscale IPを優先的に試す（自宅から接続する場合）
if pi5_reachable_tailscale; then
  PI5_IP="100.106.158.2"
  PI3_IP="100.105.224.86"
  PI4_IP="100.74.144.79"
  ACTUAL_MODE="tailscale"
elif pi5_reachable_local; then
  PI5_IP="192.168.10.230"
  PI3_IP="192.168.10.109"
  PI4_IP="192.168.10.223"
  ACTUAL_MODE="local"
else
  echo "エラー: Pi5に到達できません"
  exit 1
fi

echo "=== 実機検証: Pi3/Pi4サービス状態確認 ==="
echo "設定Network mode: $NETWORK_MODE"
echo "実際に使用するNetwork mode: $ACTUAL_MODE"
echo "Pi5 IP: $PI5_IP"
echo ""

# Pi5経由でPi3のサービス状態を確認（inventory.ymlに基づくユーザー名）
echo "--- Pi3 (Signage) サービス状態 ---"
ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no denkon5sd02@${PI5_IP} \
  "ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no signageras3@${PI3_IP} 'systemctl is-active signage-lite.service signage-lite-update.timer' 2>&1" || echo "Pi3接続失敗"

echo ""
echo "--- Pi4 (Kiosk) サービス状態 ---"
ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no denkon5sd02@${PI5_IP} \
  "ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no tools03@${PI4_IP} 'systemctl is-active kiosk-browser.service' 2>&1" || echo "Pi4接続失敗"

echo ""
echo "=== 検証完了 ==="

