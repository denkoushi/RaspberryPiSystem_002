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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[INFO] HTTPS/ヘッダー確認を実行します..."
bash "${SCRIPT_DIR}/check-caddy-https-headers.sh"

if [[ -n "${ADMIN_URL:-}" && -n "${ADMIN_EXPECT_STATUS:-}" ]]; then
  echo "[INFO] 管理画面アクセス確認: ${ADMIN_URL} (expect ${ADMIN_EXPECT_STATUS})"
  status=$(curl -k -s -o /dev/null -w "%{http_code}" "${ADMIN_URL}")
  echo "[INFO] admin status=${status}"
  if [[ "${status}" != "${ADMIN_EXPECT_STATUS}" ]]; then
    echo "[ERROR] 管理画面ステータスが期待と異なります (got=${status}, expect=${ADMIN_EXPECT_STATUS})"
    exit 1
  fi
else
  echo "[INFO] ADMIN_URL/ADMIN_EXPECT_STATUS が未設定のため管理画面チェックはスキップします。"
fi

echo "[OK] セキュリティE2Eチェック完了"
