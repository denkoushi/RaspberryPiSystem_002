#!/usr/bin/env bash
# 運用者が手で流す確認スクリプト用の curl の TLS 設定。source して使う。
# TLS は既定で検証する。
#   VERIFY_ALLOW_INSECURE_TLS=1 : 検証を外す(自己署名など、検証できない環境だけ)
#   VERIFY_CA_CERT=<path>       : 独自 CA を指定する(ssh 先で curl を動かす場合は ssh 先のパス)

VERIFY_CURL_TLS_ARGS=()
if [ "${VERIFY_ALLOW_INSECURE_TLS:-}" = "1" ]; then
  VERIFY_CURL_TLS_ARGS+=(-k)
fi
if [ -n "${VERIFY_CA_CERT:-}" ]; then
  VERIFY_CURL_TLS_ARGS+=(--cacert "${VERIFY_CA_CERT}")
fi

verify_tls_hint() {
  printf '[HINT] 証明書を確かめられませんでした。独自 CA なら VERIFY_CA_CERT=<path>、自己署名の環境だけ VERIFY_ALLOW_INSECURE_TLS=1 を付けて流し直してください。\n' >&2
}

# ローカルで curl を動かす。証明書の失敗(curl の終了コード 60)のときは案内を出す。
curl_tls() {
  local rc=0
  curl ${VERIFY_CURL_TLS_ARGS[@]+"${VERIFY_CURL_TLS_ARGS[@]}"} "$@" || rc=$?
  if [ "$rc" -eq 60 ]; then
    verify_tls_hint
  fi
  return "$rc"
}

# ssh 先で動かす curl に渡すオプションを、シェルに渡せる形の文字列で出す。
verify_curl_tls_remote_opts() {
  local out="" arg
  for arg in ${VERIFY_CURL_TLS_ARGS[@]+"${VERIFY_CURL_TLS_ARGS[@]}"}; do
    out="${out:+${out} }$(printf '%q' "$arg")"
  done
  printf '%s' "$out"
}
