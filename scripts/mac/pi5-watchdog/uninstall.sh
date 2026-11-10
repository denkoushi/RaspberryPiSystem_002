#!/usr/bin/env bash
set -euo pipefail
DOMAIN="gui/$(id -u)"
PLIST="$HOME/Library/LaunchAgents/com.raspi.pi5-watchdog.plist"
if launchctl print "$DOMAIN/com.raspi.pi5-watchdog" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/com.raspi.pi5-watchdog"
fi
if [[ -f "$PLIST" ]]; then
  rm "$PLIST"
fi
echo 'Pi5見張りを停止・解除しました。状態ファイルとログは保持しています。'
