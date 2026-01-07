#!/bin/bash
# サイネージ表示の実機検証スクリプト

set -euo pipefail

PI5_HOST="denkon5sd02@100.106.158.2"
PI3_HOST="signageras3@100.105.224.86"
BASE_URL="https://100.106.158.2"
CLIENT_KEY="client-key-raspberrypi3-signage1"

echo "=========================================="
echo "サイネージ表示の実機検証"
echo "=========================================="
echo ""

# 1. 現在のコンテンツを確認
echo "【1】現在のコンテンツ確認"
echo "----------------------------------------"
ssh "$PI5_HOST" "curl -k -s https://$BASE_URL/api/signage/content | jq '{contentType, layoutConfig: (.layoutConfig | {layout, slots: [.slots[] | {position, kind}]})}'" || echo "コンテンツ取得に失敗しました"
echo ""

# 2. サイネージ画像の取得確認
echo "【2】サイネージ画像の取得確認"
echo "----------------------------------------"
HTTP_STATUS=$(ssh "$PI5_HOST" "curl -k -s -o /dev/null -w '%{http_code}' -H 'x-client-key: $CLIENT_KEY' https://$BASE_URL/api/signage/current-image")
if [ "$HTTP_STATUS" = "200" ]; then
  echo "✅ サイネージ画像の取得に成功 (HTTP $HTTP_STATUS)"
  
  # 画像ファイルの詳細を取得
  ssh "$PI5_HOST" "curl -k -s -H 'x-client-key: $CLIENT_KEY' https://$BASE_URL/api/signage/current-image -o /tmp/current-signage.jpg && file /tmp/current-signage.jpg && ls -lh /tmp/current-signage.jpg"
else
  echo "❌ サイネージ画像の取得に失敗 (HTTP $HTTP_STATUS)"
fi
echo ""

# 3. Pi3での画像ファイル確認
echo "【3】Pi3での画像ファイル確認"
echo "----------------------------------------"
PI3_IMAGE_INFO=$(ssh "$PI5_HOST" "ssh $PI3_HOST 'ls -lh /var/cache/signage/current.jpg 2>/dev/null && stat -c \"%y\" /var/cache/signage/current.jpg 2>/dev/null || echo \"画像ファイルが見つかりません\"'")
echo "$PI3_IMAGE_INFO"
echo ""

# 4. Pi3でのサイネージサービス状態確認
echo "【4】Pi3でのサイネージサービス状態確認"
echo "----------------------------------------"
SERVICE_STATUS=$(ssh "$PI5_HOST" "ssh $PI3_HOST 'systemctl is-active signage-lite.service 2>/dev/null || echo \"サービスが停止しています\"'")
echo "サービス状態: $SERVICE_STATUS"
echo ""

# 5. 画像の更新時刻比較
echo "【5】画像の更新時刻比較"
echo "----------------------------------------"
PI5_TIME=$(ssh "$PI5_HOST" "stat -c '%y' /tmp/current-signage.jpg 2>/dev/null | cut -d'.' -f1" || echo "取得失敗")
PI3_TIME=$(ssh "$PI5_HOST" "ssh $PI3_HOST 'stat -c \"%y\" /var/cache/signage/current.jpg 2>/dev/null | cut -d\".\" -f1'" || echo "取得失敗")
echo "Pi5側画像: $PI5_TIME"
echo "Pi3側画像: $PI3_TIME"
echo ""

echo "=========================================="
echo "検証結果"
echo "=========================================="
echo ""
if [ "$HTTP_STATUS" = "200" ] && [ "$SERVICE_STATUS" = "active" ]; then
  echo "✅ 基本的な動作は正常です"
  echo ""
  echo "次のステップ:"
  echo "1. Pi3のサイネージ画面を直接確認"
  echo "2. 管理コンソールで新形式のスケジュールを作成"
  echo "3. 各レイアウトパターンで表示を確認"
else
  echo "⚠️  問題が検出されました"
  echo "- HTTPステータス: $HTTP_STATUS"
  echo "- サービス状態: $SERVICE_STATUS"
fi

