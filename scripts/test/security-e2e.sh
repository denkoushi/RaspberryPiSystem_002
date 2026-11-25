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


SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# TLS の設定(既定で検証。外すのは VERIFY_ALLOW_INSECURE_TLS=1 のときだけ)
# shellcheck source=../lib/verify-curl-tls.sh
source "${SCRIPT_DIR}/../lib/verify-curl-tls.sh"

echo "[INFO] HTTPS/ヘッダー確認を実行します..."
bash "${SCRIPT_DIR}/check-caddy-https-headers.sh"

if [[ -n "${ADMIN_URL:-}" && -n "${ADMIN_EXPECT_STATUS:-}" ]]; then
  echo "[INFO] 管理画面アクセス確認: ${ADMIN_URL} (expect ${ADMIN_EXPECT_STATUS})"
  status=$(curl_tls -s -o /dev/null -w "%{http_code}" "${ADMIN_URL}")
  echo "[INFO] admin status=${status}"
  if [[ "${status}" != "${ADMIN_EXPECT_STATUS}" ]]; then
    echo "[ERROR] 管理画面ステータスが期待と異なります (got=${status}, expect=${ADMIN_EXPECT_STATUS})"
    exit 1
  fi
else
  echo "[INFO] ADMIN_URL/ADMIN_EXPECT_STATUS が未設定のため管理画面チェックはスキップします。"
fi

echo "[OK] セキュリティE2Eチェック完了"
