#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <signage-url>" >&2
  echo "Example: $0 https://192.168.10.230/signage" >&2
  exit 1
fi

TARGET_URL="$1"

if [[ $EUID -ne 0 ]]; then
  echo "root 権限で実行してください (sudo ./scripts/client/setup-signage.sh <url>)" >&2
  exit 1
fi

# Chromiumのインストール確認
if ! command -v chromium-browser >/dev/null 2>&1; then
  echo "chromium-browser をインストールしています..."
  apt-get update
  apt-get install -y chromium-browser
fi

KIOSK_USER="${SUDO_USER:-pi}"
LAUNCHER_PATH="/usr/local/bin/signage-launch.sh"
SERVICE_PATH="/etc/systemd/system/signage-display.service"

# ランチャースクリプトの作成
cat >"$LAUNCHER_PATH" <<EOF
#!/usr/bin/env bash
export DISPLAY=:0
export XAUTHORITY=/home/$KIOSK_USER/.Xauthority

# 画面の自動オフを無効化（サイネージは常時表示）
xset s off
xset -dpms
xset s noblank

# Chromiumをキオスクモードで起動
exec chromium-browser \\
  --kiosk \\
  --app="$TARGET_URL" \\
  --start-fullscreen \\
  --noerrdialogs \\
  --disable-session-crashed-bubble \\
  --autoplay-policy=no-user-gesture-required \\
  --disable-translate \\
  --overscroll-history-navigation=0 \\
  --disable-infobars \\
  --disable-features=TranslateUI \\
  --disable-background-networking \\
  --disable-background-timer-throttling \\
  --disable-backgrounding-occluded-windows \\
  --disable-renderer-backgrounding \\
  --disable-features=TranslateUI \\
  --force-color-profile=srgb \\
  --metrics-recording-only \\
  --mute-audio \\
  --no-first-run \\
  --safebrowsing-disable-auto-update \\
  --enable-automation \\
  --password-store=basic \\
  --use-mock-keychain
EOF
chmod +x "$LAUNCHER_PATH"

# systemdサービスの作成
cat >"$SERVICE_PATH" <<EOF
[Unit]
Description=Digital Signage Display
After=graphical.target network-online.target
Wants=graphical.target network-online.target

[Service]
Type=simple
User=$KIOSK_USER
Environment=DISPLAY=:0
Environment=XAUTHORITY=/home/$KIOSK_USER/.Xauthority
ExecStart=$LAUNCHER_PATH
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=graphical.target
EOF

# サービスを有効化・起動
systemctl daemon-reload
systemctl enable signage-display.service
systemctl restart signage-display.service

cat <<'EOM'
✅ デジタルサイネージのセットアップが完了しました。

📋 管理コマンド:
- 停止: sudo systemctl stop signage-display
- 開始: sudo systemctl start signage-display
- 再起動: sudo systemctl restart signage-display
- ログ確認: journalctl -u signage-display -f
- ステータス確認: systemctl status signage-display

🔄 自動起動:
ディスプレイを接続済みの状態で Raspberry Pi を再起動すると、
自動的にフルスクリーンでサイネージが表示されます。

⚠️  注意事項:
- サイネージURLは管理画面で設定したURLを指定してください
- 例: https://192.168.10.230/signage
- HTTPS接続が必要な場合は、自己署名証明書の警告を無視する設定が必要です
EOM

