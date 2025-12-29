#!/bin/bash
set -euo pipefail

# Macの/etc/hostsにTailscale FQDNの固定レコードを追加するスクリプト
# 使用方法: ./setup-etc-hosts-for-gmail-oauth.sh <TAILSCALE_IP> <TAILSCALE_FQDN>
# 例: ./setup-etc-hosts-for-gmail-oauth.sh 100.106.158.2 raspberrypi.tail7312a3.ts.net

if [ "$#" -ne 2 ]; then
  echo "エラー: 引数が不正です。"
  echo "使用方法: $0 <TAILSCALE_IP> <TAILSCALE_FQDN>"
  echo "例: $0 100.106.158.2 raspberrypi.tail7312a3.ts.net"
  exit 1
fi

TAILSCALE_IP="$1"
TAILSCALE_FQDN="$2"
HOSTS_FILE="/etc/hosts"
ENTRY="${TAILSCALE_IP} ${TAILSCALE_FQDN}"

echo "Macの/etc/hostsにTailscale FQDNの固定レコードを追加します..."
echo "IPアドレス: ${TAILSCALE_IP}"
echo "FQDN: ${TAILSCALE_FQDN}"
echo ""

# 既にエントリが存在するか確認
if grep -q "${TAILSCALE_FQDN}" "${HOSTS_FILE}" 2>/dev/null; then
  echo "⚠️  ${TAILSCALE_FQDN} のエントリが既に存在します。"
  echo "現在のエントリ:"
  grep "${TAILSCALE_FQDN}" "${HOSTS_FILE}" || true
  echo ""
  read -p "上書きしますか？ (y/N): " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "処理をキャンセルしました。"
    exit 0
  fi
  # 既存のエントリを削除
  sudo sed -i.bak "/${TAILSCALE_FQDN}/d" "${HOSTS_FILE}"
  echo "既存のエントリを削除しました。"
fi

# エントリを追加
echo "${ENTRY}" | sudo tee -a "${HOSTS_FILE}" > /dev/null

echo "✅ /etc/hostsにエントリを追加しました:"
echo "   ${ENTRY}"
echo ""

# DNS解決を確認
echo "DNS解決を確認中..."
if ping -c 1 "${TAILSCALE_FQDN}" > /dev/null 2>&1; then
  echo "✅ DNS解決が正常に動作しています。"
  echo "   解決先: $(ping -c 1 ${TAILSCALE_FQDN} | head -n 1 | awk '{print $3}' | tr -d '()')"
else
  echo "⚠️  DNS解決に失敗しました。設定を確認してください。"
  exit 1
fi

echo ""
echo "設定完了！"
echo "OAuth認証時に ${TAILSCALE_FQDN} が ${TAILSCALE_IP} に解決されます。"

