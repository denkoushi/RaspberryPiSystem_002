#!/bin/bash
# サイネージレイアウト設定の実機検証スクリプト

set -euo pipefail

PI5_HOST="denkon5sd02@100.106.158.2"
PI3_HOST="signageras3@100.105.224.86"
BASE_URL="https://100.106.158.2"
CLIENT_KEY="${PI3_SIGNAGE_CLIENT_KEY:?PI3_SIGNAGE_CLIENT_KEY must be set}"

# TLS は既定で検証する。自己署名など検証できない環境だけ VERIFY_ALLOW_INSECURE_TLS=1 で検証を外す。
# 独自 CA を使う場合は VERIFY_CA_CERT=<Pi5 上のパス> を渡す。
CURL_TLS_OPTS=""
if [ "${VERIFY_ALLOW_INSECURE_TLS:-}" = "1" ]; then
  CURL_TLS_OPTS="-k"
fi
if [ -n "${VERIFY_CA_CERT:-}" ]; then
  CURL_TLS_OPTS="${CURL_TLS_OPTS} --cacert $(printf '%q' "${VERIFY_CA_CERT}")"
fi

echo "=========================================="
echo "サイネージレイアウト設定の実機検証"
echo "=========================================="
echo ""

# 1. 現在のスケジュール状態を確認
echo "【1】現在のスケジュール状態を確認"
echo "----------------------------------------"
ssh "$PI5_HOST" "curl $CURL_TLS_OPTS -s -H \"x-client-key: $CLIENT_KEY\" $BASE_URL/api/signage/schedules | jq '.schedules[] | {id, name, contentType, pdfId, layoutConfig: (.layoutConfig != null), enabled}'"
echo ""

# 2. 現在のコンテンツを確認
echo "【2】現在のコンテンツを確認"
echo "----------------------------------------"
ssh "$PI5_HOST" "curl $CURL_TLS_OPTS -s $BASE_URL/api/signage/content | jq '{contentType, displayMode, layoutConfig}'"
echo ""

# 3. サイネージ画像の取得確認
echo "【3】サイネージ画像の取得確認"
echo "----------------------------------------"
HTTP_STATUS=$(ssh "$PI5_HOST" "curl $CURL_TLS_OPTS -s -o /dev/null -w '%{http_code}' -H 'x-client-key: $CLIENT_KEY' $BASE_URL/api/signage/current-image")
if [ "$HTTP_STATUS" = "200" ]; then
  echo "✅ サイネージ画像の取得に成功 (HTTP $HTTP_STATUS)"
else
  echo "❌ サイネージ画像の取得に失敗 (HTTP $HTTP_STATUS)"
fi
echo ""

# 4. Pi3での画像ファイル確認
echo "【4】Pi3での画像ファイル確認"
echo "----------------------------------------"
ssh "$PI5_HOST" "ssh $PI3_HOST 'ls -lh /var/cache/signage/current.jpg 2>/dev/null || echo \"画像ファイルが見つかりません\"'"
echo ""

# 5. Pi3でのサイネージサービス状態確認
echo "【5】Pi3でのサイネージサービス状態確認"
echo "----------------------------------------"
ssh "$PI5_HOST" "ssh $PI3_HOST 'systemctl is-active signage-lite.service 2>/dev/null || echo \"サービスが停止しています\"'"
echo ""

echo "=========================================="
echo "検証完了"
echo "=========================================="
echo ""
echo "次のステップ:"
echo "1. 管理コンソール（$BASE_URL/admin/signage/schedules）で新形式のスケジュールを作成"
echo "2. Pi3のサイネージ画面で表示を確認"
echo "3. レガシー形式のスケジュールが正しく変換されて表示されることを確認"
