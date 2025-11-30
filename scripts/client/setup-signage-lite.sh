#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <server-url> <client-key>" >&2
  echo "Example: $0 https://192.168.128.131 abc123def456..." >&2
  exit 1
fi

SERVER_URL="$1"
CLIENT_KEY="$2"
IMAGE_URL="${SERVER_URL%/}/api/signage/current-image"
CACHE_DIR="/var/cache/signage"
CURRENT_IMAGE="${CACHE_DIR}/current.jpg"
UPDATE_INTERVAL="${SIGNAGE_UPDATE_INTERVAL:-30}" # デフォルト30秒

if [[ $EUID -ne 0 ]]; then
  echo "root 権限で実行してください (sudo ./scripts/client/setup-signage-lite.sh <url> <key>)" >&2
  exit 1
fi

# 既存のChromiumベースのサイネージサービスを停止・無効化
echo "既存のChromiumベースのサイネージサービスを確認中..."
if systemctl is-active --quiet signage-display.service 2>/dev/null; then
  echo "signage-display.service を停止・無効化中..."
  systemctl stop signage-display.service || true
  systemctl disable signage-display.service || true
fi

# 既存のキオスクブラウザサービスも確認
if systemctl is-active --quiet kiosk-browser.service 2>/dev/null; then
  echo "kiosk-browser.service を停止・無効化中..."
  systemctl stop kiosk-browser.service || true
  systemctl disable kiosk-browser.service || true
fi

# 実行中のChromiumプロセスを終了
echo "実行中のChromiumプロセスを終了中..."
pkill -f "chromium" || true
sleep 2

KIOSK_USER="${SUDO_USER:-pi}"
UPDATE_SCRIPT="/usr/local/bin/signage-update.sh"
DISPLAY_SCRIPT="/usr/local/bin/signage-display.sh"
SERVICE_PATH="/etc/systemd/system/signage-lite.service"

# 必要なパッケージのインストール確認
REQUIRED_PACKAGES=()
if ! command -v feh >/dev/null 2>&1; then
  REQUIRED_PACKAGES+=(feh)
fi
if ! command -v xset >/dev/null 2>&1; then
  REQUIRED_PACKAGES+=(x11-utils)
fi
if ! command -v curl >/dev/null 2>&1; then
  REQUIRED_PACKAGES+=(curl)
fi

if [[ ${#REQUIRED_PACKAGES[@]} -gt 0 ]]; then
  echo "必要なパッケージをインストールしています: ${REQUIRED_PACKAGES[*]}"
  apt-get update
  apt-get install -y "${REQUIRED_PACKAGES[@]}"
fi

# キャッシュディレクトリの作成
mkdir -p "$CACHE_DIR"
chown "$KIOSK_USER:$KIOSK_USER" "$CACHE_DIR"

# 画像更新スクリプトの作成
cat >"$UPDATE_SCRIPT" <<EOFSCRIPT
#!/usr/bin/env bash
set -euo pipefail

SERVER_URL="${SERVER_URL}"
CLIENT_KEY="${CLIENT_KEY}"
IMAGE_URL="\${SERVER_URL%/}/api/signage/current-image"
CURRENT_IMAGE="${CACHE_DIR}/current.jpg"
TEMP_IMAGE="${CACHE_DIR}/current.tmp.jpg"

# 画像を取得（失敗時は既存画像を保持）
if curl -s -f -H "x-client-key: \${CLIENT_KEY}" \
  -o "\$TEMP_IMAGE" \
  --max-time 10 \
  --connect-timeout 5 \
  "\$IMAGE_URL" 2>/dev/null; then
  # 取得成功時のみ更新
  mv "\$TEMP_IMAGE" "\$CURRENT_IMAGE"
  echo "\$(date): Image updated successfully"
else
  echo "\$(date): Failed to update image, using cached version"
  rm -f "\$TEMP_IMAGE"
fi
EOFSCRIPT

chmod +x "$UPDATE_SCRIPT"
chown "$KIOSK_USER:$KIOSK_USER" "$UPDATE_SCRIPT"

# 表示スクリプトの作成
cat >"$DISPLAY_SCRIPT" <<EOFSCRIPT
#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:0
export XAUTHORITY=/home/${KIOSK_USER}/.Xauthority

CURRENT_IMAGE="${CACHE_DIR}/current.jpg"

# 画面の自動オフを無効化
xset s off
xset -dpms
xset s noblank

# 初回画像取得（存在しない場合）
if [[ ! -f "\$CURRENT_IMAGE" ]]; then
  echo "Waiting for initial image download..."
  sleep 5
fi

# fehでフルスクリーン表示（ファイル変更を自動検知してリロード）
exec feh \
  --fullscreen \
  --auto-reload \
  --no-menus \
  --hide-pointer \
  --quiet \
  "\$CURRENT_IMAGE"
EOFSCRIPT

chmod +x "$DISPLAY_SCRIPT"
chown "$KIOSK_USER:$KIOSK_USER" "$DISPLAY_SCRIPT"

# systemdサービスの作成
cat >"$SERVICE_PATH" <<EOFSERVICE
[Unit]
Description=Digital Signage Lite (feh-based)
After=graphical.target network-online.target
Wants=graphical.target network-online.target

[Service]
Type=simple
User=$KIOSK_USER
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/$KIOSK_USER/.Xauthority
# 初回画像取得
ExecStartPre=$UPDATE_SCRIPT

# 画像表示
ExecStart=$DISPLAY_SCRIPT

# 定期的に画像を更新（タイマーサービスで実行）
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=graphical.target
EOFSERVICE

# タイマーサービスの作成（定期的な画像更新用）
TIMER_PATH="/etc/systemd/system/signage-lite-update.timer"
cat >"$TIMER_PATH" <<EOFTIMER
[Unit]
Description=Update signage image periodically
After=network-online.target

[Timer]
OnBootSec=1min
OnUnitActiveSec=${UPDATE_INTERVAL}s

[Install]
WantedBy=timers.target
EOFTIMER

UPDATE_SERVICE_PATH="/etc/systemd/system/signage-lite-update.service"
cat >"$UPDATE_SERVICE_PATH" <<EOFUPDATE
[Unit]
Description=Update signage image
After=network-online.target

[Service]
Type=oneshot
User=$KIOSK_USER
ExecStart=$UPDATE_SCRIPT
StandardOutput=journal
StandardError=journal
EOFUPDATE

# サービスを有効化・起動
systemctl daemon-reload
systemctl enable signage-lite.service
systemctl enable signage-lite-update.timer
systemctl start signage-lite-update.timer
systemctl restart signage-lite.service

cat <<'EOM'
✅ デジタルサイネージ軽量モードのセットアップが完了しました。

📋 管理コマンド:
- 停止: sudo systemctl stop signage-lite
- 開始: sudo systemctl start signage-lite
- 再起動: sudo systemctl restart signage-lite
- ログ確認: journalctl -u signage-lite -f
- ステータス確認: systemctl status signage-lite
- 画像更新タイマー確認: systemctl status signage-lite-update.timer

🔄 自動起動:
ディスプレイを接続済みの状態で Raspberry Pi を再起動すると、
自動的にフルスクリーンでサイネージが表示されます。

📸 画像更新:
- 更新間隔: ${UPDATE_INTERVAL}秒（環境変数 SIGNAGE_UPDATE_INTERVAL で変更可能）
- キャッシュディレクトリ: ${CACHE_DIR}
- ネットワーク断時はキャッシュされた画像を表示します

⚠️  注意事項:
- サーバーURLとクライアントキーが必要です
- 例: sudo ./scripts/client/setup-signage-lite.sh https://192.168.128.131 abc123...
- HTTPS接続が必要な場合は、自己署名証明書の警告を無視する設定が必要です
EOM

