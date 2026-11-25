#!/usr/bin/env bash
# setup-signage-lite.sh の TLS 検証の既定値を確かめる。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="${ROOT}/scripts/client/setup-signage-lite.sh"

# 対象スクリプトは ${var,,} を使うため bash 4 以上が要る(macOS 標準の 3.2 では動かない)
BASH_BIN="bash"
if (( BASH_VERSINFO[0] < 4 )); then
  BASH_BIN="/opt/homebrew/bin/bash"
  [[ -x "${BASH_BIN}" ]] || { echo "skip: bash 4 以上がありません"; exit 0; }
fi

# ALLOW_INSECURE_TLS から CURL_OPTIONS_STR を決める部分だけを取り出す
SNIPPET="$(sed -n '/^ALLOW_INSECURE_TLS=/,/^CURL_OPTIONS_STR=/p' "${SCRIPT}")"
[[ -n "${SNIPPET}" ]] || { echo "TLS 設定の部分が見つかりません" >&2; exit 1; }

default_opts="$(env -u SIGNAGE_ALLOW_INSECURE_TLS "${BASH_BIN}" -c "${SNIPPET}; printf '%s' \"\${CURL_OPTIONS_STR}\"")"
[[ "${default_opts}" == "-s -f" ]] || { echo "既定で -k が付いています: ${default_opts}" >&2; exit 1; }

for value in true TRUE; do
  opts="$(SIGNAGE_ALLOW_INSECURE_TLS="${value}" "${BASH_BIN}" -c "${SNIPPET}; printf '%s' \"\${CURL_OPTIONS_STR}\"")"
  [[ "${opts}" == "-s -f -k" ]] || { echo "true を渡しても -k が付きません: ${opts}" >&2; exit 1; }
done

opts="$(SIGNAGE_ALLOW_INSECURE_TLS=false "${BASH_BIN}" -c "${SNIPPET}; printf '%s' \"\${CURL_OPTIONS_STR}\"")"
[[ "${opts}" == "-s -f" ]] || { echo "false で -k が付いています: ${opts}" >&2; exit 1; }

# 生成される更新スクリプトの書式は signage-runtime-proof.py が受け付ける形のまま
grep -qF 'CURL_OPTIONS="${CURL_OPTIONS_STR}"' "${SCRIPT}"

echo "ok"
