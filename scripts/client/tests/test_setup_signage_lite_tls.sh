#!/usr/bin/env bash
# setup-signage-lite.sh の TLS 設定と事前取得を確かめる。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="${ROOT}/scripts/client/setup-signage-lite.sh"

# ALLOW_INSECURE_TLS から CURL_OPTIONS_STR を決める部分だけを取り出す
SNIPPET="$(sed -n '/^ALLOW_INSECURE_TLS=/,/^CURL_OPTIONS_STR=/p' "${SCRIPT}")"
[[ -n "${SNIPPET}" ]] || { echo "TLS 設定の部分が見つかりません" >&2; exit 1; }

default_opts="$(env -u SIGNAGE_ALLOW_INSECURE_TLS bash -c "${SNIPPET}; printf '%s' \"\${CURL_OPTIONS_STR}\"")"
[[ "${default_opts}" == "-s -f" ]] || { echo "既定で -k が付いています: ${default_opts}" >&2; exit 1; }

for value in true TRUE; do
  opts="$(SIGNAGE_ALLOW_INSECURE_TLS="${value}" bash -c "${SNIPPET}; printf '%s' \"\${CURL_OPTIONS_STR}\"")"
  [[ "${opts}" == "-s -f -k" ]] || { echo "true を渡しても -k が付きません: ${opts}" >&2; exit 1; }
done

opts="$(SIGNAGE_ALLOW_INSECURE_TLS=false bash -c "${SNIPPET}; printf '%s' \"\${CURL_OPTIONS_STR}\"")"
[[ "${opts}" == "-s -f" ]] || { echo "false で -k が付いています: ${opts}" >&2; exit 1; }

# 生成される更新スクリプトの書式は signage-runtime-proof.py が受け付ける形のまま
grep -qF 'CURL_OPTIONS="${CURL_OPTIONS_STR}"' "${SCRIPT}"

scratch="$(mktemp -d /tmp/signage-lite-tls.XXXXXX)"
trap 'rm -r "$scratch"' EXIT
mkdir -p "$scratch/device"/{etc/tmpfiles.d,etc/systemd/system,etc/sudoers.d,usr/local/bin,run}
# root 判定を外し、インストール先への書き込みをテスト用ディレクトリに向ける。
sed -e 's/\$EUID -ne 0/0 -ne 0/' \
  -e "s|/etc/|$scratch/device/etc/|g" \
  -e "s|/usr/local/bin/|$scratch/device/usr/local/bin/|g" \
  -e "s|/run/signage|$scratch/device/run/signage|g" \
  "$SCRIPT" > "$scratch/setup.sh"

run_setup() {
  CURL_EXIT="$1" SIGNAGE_ALLOW_INSECURE_TLS="$2" PROBE_LOG="$scratch/events" \
    bash -c '
      curl() { printf "curl %s\n" "$*" >> "$PROBE_LOG"; return "$CURL_EXIT"; }
      systemctl() {
        printf "systemctl %s\n" "$*" >> "$PROBE_LOG"
        if [[ "$1" == stop ]]; then exit 99; fi
      }
      pkill() { exit 98; }
      apt-get() { exit 98; }
      chown() { exit 98; }
      systemd-tmpfiles() { exit 98; }
      source "$1" https://signage.example/ fixture-key
    ' bash "$scratch/setup.sh" > "$scratch/stdout" 2> "$scratch/stderr"
}

probe_args='-H x-client-key: fixture-key -o /dev/null --max-time 10 --connect-timeout 5 https://signage.example/api/signage/current-image'
status=0
run_setup 60 false || status=$?
[[ "$status" == 60 && "$(cat "$scratch/events")" == "curl -s -f $probe_args" ]]
[[ -z "$(find "$scratch/device" -type f)" && ! -e "$scratch/device/run/signage" ]]
grep -qF 'TLS 証明書の検証に失敗' "$scratch/stderr"
grep -qF 'CA 証明書' "$scratch/stderr"
grep -qF 'sudo SIGNAGE_ALLOW_INSECURE_TLS=true' "$scratch/stderr"

# 非 TLS エラーと明示的な検証スキップは、従来どおりサービス停止まで進む。
for case in '7 false -s -f' '0 true -s -f -k'; do
  read -r curl_exit insecure curl_opts <<< "$case"
  : > "$scratch/events"
  status=0
  run_setup "$curl_exit" "$insecure" || status=$?
  [[ "$status" == 99 ]]
  expected="$(printf '%s\n' "curl $curl_opts $probe_args" \
    'systemctl is-active --quiet signage-display.service' \
    'systemctl stop signage-display.service')"
  [[ "$(cat "$scratch/events")" == "$expected" ]]
done

echo "ok"
