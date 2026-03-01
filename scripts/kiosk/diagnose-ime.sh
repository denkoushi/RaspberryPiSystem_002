#!/usr/bin/env bash
# キオスク備考欄 IME 不具合の診断スクリプト
# Pi4 キオスク端末上でキオスクユーザーとして実行する。
# Ansible タスクから呼び出されるか、手動で SSH 経由で実行可能。
# 出力はログ用の人間が読めるテキスト。終了コード 0=成功、1=一部失敗（デプロイは継続）。
set -e

exit_code=0
uid=$(id -u 2>/dev/null || echo "0")
runtime_dir="/run/user/${uid}"
export XDG_RUNTIME_DIR="${runtime_dir}"
export DBUS_SESSION_BUS_ADDRESS="unix:path=${runtime_dir}/bus"
desired_signature="${IBUS_DESIRED_SIGNATURE:---replace --single --panel=disable}"
competing_pattern="${IBUS_COMPETING_PATTERN:---daemonize --xim}"

section() {
  echo ""
  echo "=== $1 ==="
}

run_or_fail() {
  if "$@" 2>/dev/null; then
    true
  else
    echo "(取得失敗)"
    exit_code=1
  fi
}

section "IBus プロセス (pgrep -af ibus)"
pgrep -af ibus 2>/dev/null || echo "(プロセスなし)" || true
# pgrep はマッチなしで 1 を返すので、プロセス数も表示
count=$(pgrep -c ibus 2>/dev/null || echo "0")
echo "プロセス数: $count"

section "IBus 単一オーナー判定"
daemon_lines="$(pgrep -af ibus-daemon 2>/dev/null || true)"
desired_count=$(printf "%s\n" "${daemon_lines}" | grep -F -- "${desired_signature}" 2>/dev/null | wc -l | tr -d ' ')
competing_count=$(printf "%s\n" "${daemon_lines}" | grep -F -- "${competing_pattern}" 2>/dev/null | wc -l | tr -d ' ')
echo "期待シグネチャ(${desired_signature}) 件数: ${desired_count}"
echo "競合シグネチャ(${competing_pattern}) 件数: ${competing_count}"
if [[ "${desired_count}" == "1" && "${competing_count}" == "0" ]]; then
  echo "判定: PASS (単一オーナー構成)"
else
  echo "判定: FAIL (競合起動の可能性)"
  exit_code=1
fi

section "IBus 現在エンジン (ibus engine)"
run_or_fail ibus engine 2>/dev/null || echo "(ibus 未起動またはエンジン未設定)"

section "gsettings engines-order"
run_or_fail gsettings get org.freedesktop.ibus.general engines-order

section "gsettings hotkey triggers"
run_or_fail gsettings get org.freedesktop.ibus.general.hotkey triggers

section "gsettings panel show"
run_or_fail gsettings get org.freedesktop.ibus.panel show

section "gsettings panel show-im-name"
run_or_fail gsettings get org.freedesktop.ibus.panel show-im-name

section "XDG_SESSION_TYPE"
echo "${XDG_SESSION_TYPE:-未設定}"

section "kiosk-launch.sh の --ozone-platform 確認"
if [[ -f /usr/local/bin/kiosk-launch.sh ]]; then
  if grep -q 'ozone-platform' /usr/local/bin/kiosk-launch.sh 2>/dev/null; then
    echo "ozone-platform が含まれる: はい"
    grep 'ozone-platform' /usr/local/bin/kiosk-launch.sh || true
  else
    echo "ozone-platform が含まれる: いいえ"
    exit_code=1
  fi
else
  echo "/usr/local/bin/kiosk-launch.sh が存在しません"
  exit_code=1
fi

section "ibus-autostart.desktop の Exec 確認"
autostart_desktop="$HOME/.config/autostart/ibus.desktop"
if [[ -f "$autostart_desktop" ]]; then
  grep '^Exec=' "$autostart_desktop" 2>/dev/null || echo "(Exec 行なし)"
else
  echo "ibus.desktop が存在しません: $autostart_desktop"
  exit_code=1
fi

section "単一オーナー補助設定の確認"
owner_desktop="$HOME/.config/autostart/ibus-owner.desktop"
if [[ -f "$owner_desktop" ]]; then
  echo "ibus-owner.desktop: あり"
  grep '^Exec=' "$owner_desktop" 2>/dev/null || true
else
  echo "ibus-owner.desktop: なし（legacyモードの可能性）"
fi

im_launch_override="$HOME/.config/autostart/im-launch.desktop"
if [[ -f "$im_launch_override" ]]; then
  hidden_value="$(grep '^Hidden=' "$im_launch_override" 2>/dev/null || true)"
  echo "im-launch.desktop override: ${hidden_value:-設定なし}"
else
  echo "im-launch.desktop override: なし"
fi

echo ""
echo "=== 診断完了 (exit_code=$exit_code) ==="
exit "$exit_code"
