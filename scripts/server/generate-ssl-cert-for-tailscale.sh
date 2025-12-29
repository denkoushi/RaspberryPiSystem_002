#!/bin/bash
# TailscaleのMagicDNSドメイン用に自己署名証明書を生成するスクリプト
# 使用方法: ./generate-ssl-cert-for-tailscale.sh <Tailscale FQDN>
# 例: ./generate-ssl-cert-for-tailscale.sh raspberrypi.tail7312a3.ts.net

set -euo pipefail

# 引数チェック
if [ $# -lt 1 ]; then
  echo "使用方法: $0 <Tailscale FQDN>"
  echo "例: $0 raspberrypi.tail7312a3.ts.net"
  exit 1
fi

FQDN="$1"
CERT_DIR="/opt/RaspberryPiSystem_002/certs"
BACKUP_SUFFIX=$(date +%Y%m%d_%H%M%S)

# 証明書ディレクトリの確認
if [ ! -d "$CERT_DIR" ]; then
  echo "証明書ディレクトリが存在しません: $CERT_DIR"
  echo "作成しますか？ (y/n)"
  read -r response
  if [ "$response" != "y" ]; then
    echo "中止しました"
    exit 1
  fi
  sudo mkdir -p "$CERT_DIR"
fi

cd "$CERT_DIR"

# 既存の証明書をバックアップ
if [ -f cert.pem ]; then
  echo "既存の証明書をバックアップします..."
  sudo cp cert.pem "cert.pem.backup.$BACKUP_SUFFIX"
  echo "バックアップ完了: cert.pem.backup.$BACKUP_SUFFIX"
fi

if [ -f key.pem ]; then
  echo "既存の秘密鍵をバックアップします..."
  sudo cp key.pem "key.pem.backup.$BACKUP_SUFFIX"
  echo "バックアップ完了: key.pem.backup.$BACKUP_SUFFIX"
fi

# 証明書を生成
echo "証明書を生成します..."
echo "FQDN: $FQDN"
sudo openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 3650 -nodes \
  -subj "/C=JP/ST=Tokyo/L=Tokyo/O=Factory/CN=$FQDN"

# 権限設定
sudo chmod 644 cert.pem
sudo chmod 600 key.pem
sudo chown "$USER:$USER" cert.pem key.pem

# 証明書の内容を確認
echo ""
echo "証明書の内容を確認します:"
openssl x509 -in cert.pem -noout -subject -dates

echo ""
echo "証明書の生成が完了しました！"
echo "次に、Caddyコンテナを再起動してください:"
echo "  cd /opt/RaspberryPiSystem_002"
echo "  docker compose -f infrastructure/docker/docker-compose.server.yml restart web"

