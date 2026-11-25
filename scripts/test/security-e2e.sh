#!/usr/bin/env bash
set -euo pipefail

# 簡易セキュリティE2Eチェック
# - HTTPSリダイレクト＆主要セキュリティヘッダー確認（check-caddy-https-headers.sh）
# - 管理画面到達性チェック（任意。ENVでURLと期待ステータスを指定）
#
# 環境変数:
#   TARGET_HOST / TARGET_DOMAIN / HTTP_PORT / HTTPS_PORT: ヘッダー確認に使用
#   ADMIN_URL: 管理画面URL（例: https://localhost/admin）
#   ADMIN_EXPECT_STATUS: 期待ステータス（例: 403 または 200）。未指定なら管理画面チェックはスキップ。
#   VERIFY_ALLOW_INSECURE_TLS=1: 管理画面チェックの証明書検証を外す（自己署名環境のみ）。VERIFY_CA_CERT=<path>: CA を指定。

# TLS は既定で検証する。自己署名など検証できない環境だけ VERIFY_ALLOW_INSECURE_TLS=1 で検証を外す。
# 独自 CA を使う場合は VERIFY_CA_CERT=<path> を渡す。
CURL_TLS_ARGS=()
if [ "${VERIFY_ALLOW_INSECURE_TLS:-}" = "1" ]; then
  CURL_TLS_ARGS+=(-k)
fi
if [ -n "${VERIFY_CA_CERT:-}" ]; then
  CURL_TLS_ARGS+=(--cacert "${VERIFY_CA_CERT}")
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[INFO] HTTPS/ヘッダー確認を実行します..."
bash "${SCRIPT_DIR}/check-caddy-https-headers.sh"

if [[ -n "${ADMIN_URL:-}" && -n "${ADMIN_EXPECT_STATUS:-}" ]]; then
  echo "[INFO] 管理画面アクセス確認: ${ADMIN_URL} (expect ${ADMIN_EXPECT_STATUS})"
  status=$(curl ${CURL_TLS_ARGS[@]+"${CURL_TLS_ARGS[@]}"} -s -o /dev/null -w "%{http_code}" "${ADMIN_URL}")
  echo "[INFO] admin status=${status}"
  if [[ "${status}" != "${ADMIN_EXPECT_STATUS}" ]]; then
    echo "[ERROR] 管理画面ステータスが期待と異なります (got=${status}, expect=${ADMIN_EXPECT_STATUS})"
    exit 1
  fi
else
  echo "[INFO] ADMIN_URL/ADMIN_EXPECT_STATUS が未設定のため管理画面チェックはスキップします。"
fi

echo "[OK] セキュリティE2Eチェック完了"
