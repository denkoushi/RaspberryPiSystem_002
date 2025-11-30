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
ALLOW_INSECURE_TLS="${SIGNAGE_ALLOW_INSECURE_TLS:-true}"
CURL_OPTIONS=(-s -f)
if [[ "${ALLOW_INSECURE_TLS,,}" == "true" ]]; then
  CURL_OPTIONS+=(-k)
fi
CURL_OPTIONS_STR="${CURL_OPTIONS[*]}"

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
STOP_SCRIPT="/usr/local/bin/signage-stop.sh"
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
CURL_OPTIONS="${CURL_OPTIONS_STR}"

# 画像を取得（失敗時は既存画像を保持）
if curl \${CURL_OPTIONS} -H "x-client-key: \${CLIENT_KEY}" \
  -o "\$TEMP_IMAGE" \
  --max-time 10 \
  --connect-timeout 5 \
  "\$IMAGE_URL" 2>/dev/null; then
  # 取得成功時のみ更新
  if [[ -s "\$TEMP_IMAGE" ]]; then
    mv "\$TEMP_IMAGE" "\$CURRENT_IMAGE"
    echo "\$(date): Image updated successfully"
  else
    echo "\$(date): Downloaded file is empty, keeping cached version"
    rm -f "\$TEMP_IMAGE"
  fi
else
  # ネットワーク遮断時は既存画像を保持（エラーでも終了しない）
  if [[ -f "\$CURRENT_IMAGE" ]]; then
    echo "\$(date): Network unavailable, using cached image (\$(stat -c %y "\$CURRENT_IMAGE" | cut -d. -f1))"
  else
    echo "\$(date): Network unavailable and no cached image available"
  fi
  rm -f "\$TEMP_IMAGE"
fi
EOFSCRIPT

chmod +x "$UPDATE_SCRIPT"
chown "$KIOSK_USER:$KIOSK_USER" "$UPDATE_SCRIPT"

# サービス停止スクリプトの作成（qキーで呼び出し）
cat >"$STOP_SCRIPT" <<EOFSTOP
#!/usr/bin/env bash
# サイネージサービスを停止するスクリプト
# qキーで呼び出される
sudo systemctl stop signage-lite
EOFSTOP

chmod +x "$STOP_SCRIPT"
chown "$KIOSK_USER:$KIOSK_USER" "$STOP_SCRIPT"

# sudoersでパスワードなしで実行できるように設定
SUDOERS_LINE="$KIOSK_USER ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop signage-lite, /usr/bin/systemctl start signage-lite, /usr/bin/systemctl restart signage-lite"
if ! grep -q "signage-lite" /etc/sudoers.d/* 2>/dev/null; then
  echo "$SUDOERS_LINE" > /etc/sudoers.d/signage-lite
  chmod 0440 /etc/sudoers.d/signage-lite
fi

# 表示スクリプトの作成
cat >"$DISPLAY_SCRIPT" <<EOFSCRIPT
#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:0
export XAUTHORITY=/home/${KIOSK_USER}/.Xauthority

CURRENT_IMAGE="${CACHE_DIR}/current.jpg"
UPDATE_SCRIPT="${UPDATE_SCRIPT}"
STOP_SCRIPT="${STOP_SCRIPT}"
MAX_RETRIES=12  # 最大60秒待機（5秒×12回）

# 画面の自動オフを無効化
xset s off
xset -dpms
xset s noblank

# 初回画像取得（存在しない場合は即時取得を試行）
if [[ ! -s "\$CURRENT_IMAGE" ]]; then
  echo "\$(date): No cached image found, attempting initial download..."
  "\$UPDATE_SCRIPT" || true
fi

# 画像が存在するまで待機（ネットワーク遮断時は既存画像があれば即座に表示）
retry_count=0
while [[ ! -s "\$CURRENT_IMAGE" ]] && [[ \$retry_count -lt \$MAX_RETRIES ]]; do
  echo "\$(date): Waiting for image download (attempt \$((retry_count + 1))/\$MAX_RETRIES)..."
  "\$UPDATE_SCRIPT" || true
  sleep 5
  retry_count=\$((retry_count + 1))
done

# 画像が存在しない場合でも、エラーで終了せずに既存画像を表示（ネットワーク遮断時のフォールバック）
if [[ ! -s "\$CURRENT_IMAGE" ]]; then
  echo "\$(date): WARNING: No image available after \$MAX_RETRIES attempts. Display will show cached image if available."
  # 既存の画像ファイルがあれば表示（サイズが0でも）
  if [[ -f "\$CURRENT_IMAGE" ]]; then
    echo "\$(date): Using existing cached image file"
  else
    echo "\$(date): ERROR: No image file available. Service will restart to retry."
    exit 1
  fi
fi

# fehでフルスクリーン表示（ファイル変更を自動検知してリロード）
# ネットワーク遮断時でも、既存画像を表示し続ける
# qキーでサービスを停止（標準的な終了キー）
exec feh \
  --fullscreen \
  --auto-reload \
  --no-menus \
  --hide-pointer \
  --quiet \
  --action "q;/usr/local/bin/signage-stop.sh" \
  "\$CURRENT_IMAGE"
EOFSCRIPT

chmod +x "$DISPLAY_SCRIPT"
chown "$KIOSK_USER:$KIOSK_USER" "$DISPLAY_SCRIPT"

# systemdサービスの作成
cat >"$SERVICE_PATH" <<EOFSERVICE
[Unit]
Description=Digital Signage Lite (feh-based)
After=graphical.target
Wants=graphical.target
# ネットワーク接続を待たない（オフライン時でも既存画像を表示）
# network-online.target への依存を削除

[Service]
Type=simple
User=$KIOSK_USER
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/$KIOSK_USER/.Xauthority
# 画像表示（内部で画像取得を試行）
ExecStart=$DISPLAY_SCRIPT

# ネットワーク遮断時でもサービスを再起動し続ける
# 既存画像があれば表示し続ける
Restart=always
RestartSec=10
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
# ネットワーク接続を待たない（オフライン時でもエラーで終了しない）
# After=network-online.target を削除

[Service]
Type=oneshot
User=$KIOSK_USER
ExecStart=$UPDATE_SCRIPT
# ネットワーク遮断時でもエラーで終了しない（既存画像を保持）
SuccessExitStatus=0
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
- オフライン対応: ネットワーク遮断時は、最後に取得した画像を表示し続けます
- 初回起動時: 画像が取得できない場合は最大60秒待機し、その後も取得できない場合は既存画像があれば表示します

⚠️  注意事項:
- サーバーURLとクライアントキーが必要です
- 例: sudo ./scripts/client/setup-signage-lite.sh https://192.168.128.131 abc123...
- HTTPS接続が必要な場合は、自己署名証明書の警告を無視する設定が必要です
EOM

