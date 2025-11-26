#!/bin/bash
# Validation 7: USB一括登録の検証スクリプト
# 使用方法: ./scripts/validation/validate-import.sh

set -e

echo "=========================================="
echo "Validation 7: USB一括登録の検証"
echo "=========================================="
echo ""

# 環境変数の確認
if [ -z "$API_BASE_URL" ]; then
  API_BASE_URL="http://localhost:8080"
fi

if [ -z "$ADMIN_USERNAME" ]; then
  ADMIN_USERNAME="admin"
fi

if [ -z "$ADMIN_PASSWORD" ]; then
  ADMIN_PASSWORD="admin1234"
fi

echo "API Base URL: $API_BASE_URL"
echo "Admin Username: $ADMIN_USERNAME"
echo ""

# 1. 認証トークンの取得
echo "1. 認証トークンを取得中..."
TOKEN_RESPONSE=$(curl -s -X POST "$API_BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}")

if [ $? -ne 0 ]; then
  echo "❌ 認証に失敗しました"
  exit 1
fi

TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ トークンの取得に失敗しました"
  echo "レスポンス: $TOKEN_RESPONSE"
  exit 1
fi

echo "✅ 認証成功"
echo ""

# 2. インポート前のデータ件数を確認
echo "2. インポート前のデータ件数を確認中..."
BEFORE_EMPLOYEES=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_BASE_URL/api/tools/employees" | grep -o '"id"' | wc -l | tr -d ' ')

BEFORE_ITEMS=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "$API_BASE_URL/api/tools/items" | grep -o '"id"' | wc -l | tr -d ' ')

echo "  従業員数: $BEFORE_EMPLOYEES 件"
echo "  アイテム数: $BEFORE_ITEMS 件"
echo ""

# 3. CSVファイルの存在確認
CSV_DIR="test-data/validation-7"
if [ ! -f "$CSV_DIR/employees.csv" ] || [ ! -f "$CSV_DIR/items.csv" ]; then
  echo "❌ CSVファイルが見つかりません: $CSV_DIR"
  exit 1
fi

echo "3. CSVファイルを確認..."
echo "  ✅ employees.csv が見つかりました"
echo "  ✅ items.csv が見つかりました"
echo ""

# 4. CSVファイルの内容を確認
echo "4. CSVファイルの内容を確認..."
echo "  employees.csv:"
head -3 "$CSV_DIR/employees.csv" | sed 's/^/    /'
echo ""
echo "  items.csv:"
head -3 "$CSV_DIR/items.csv" | sed 's/^/    /'
echo ""

# 5. インポート実行（手動で実行する必要がある）
echo "=========================================="
echo "次のステップ:"
echo "=========================================="
echo "1. ブラウザで管理画面にアクセス:"
echo "   http://<ラズパイ5のIP>:4173/login"
echo ""
echo "2. ログイン情報:"
echo "   ユーザー名: $ADMIN_USERNAME"
echo "   パスワード: $ADMIN_PASSWORD"
echo ""
echo "3. 一括登録ページにアクセス:"
echo "   http://<ラズパイ5のIP>:4173/admin/import"
echo ""
echo "4. CSVファイルをアップロード:"
echo "   - employees.csv: $CSV_DIR/employees.csv"
echo "   - items.csv: $CSV_DIR/items.csv"
echo ""
echo "5. インポート完了後、このスクリプトを再実行して結果を確認:"
echo "   ./scripts/validation/validate-import.sh --check-only"
echo ""

# --check-only オプションが指定されている場合は、インポート後の確認のみ実行
if [ "$1" = "--check-only" ]; then
  echo "=========================================="
  echo "インポート結果の確認"
  echo "=========================================="
  
  # インポート後のデータ件数を確認
  AFTER_EMPLOYEES=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "$API_BASE_URL/api/tools/employees" | grep -o '"id"' | wc -l | tr -d ' ')
  
  AFTER_ITEMS=$(curl -s -H "Authorization: Bearer $TOKEN" \
    "$API_BASE_URL/api/tools/items" | grep -o '"id"' | wc -l | tr -d ' ')
  
  echo "インポート後のデータ件数:"
  echo "  従業員数: $AFTER_EMPLOYEES 件（増加: $((AFTER_EMPLOYEES - BEFORE_EMPLOYEES)) 件）"
  echo "  アイテム数: $AFTER_ITEMS 件（増加: $((AFTER_ITEMS - BEFORE_ITEMS)) 件）"
  echo ""
  
  # import_jobsテーブルの確認（PostgreSQLに直接接続する場合）
  echo "import_jobsテーブルの確認（Dockerコンテナ経由）:"
  echo "  docker compose -f infrastructure/docker/docker-compose.server.yml exec db \\"
  echo "    psql -U postgres -d borrow_return \\"
  echo "    -c \"SELECT id, file_name, status, created_at FROM import_jobs ORDER BY created_at DESC LIMIT 5;\""
  echo ""
  
  # 検証結果の判定
  if [ $AFTER_EMPLOYEES -gt $BEFORE_EMPLOYEES ] || [ $AFTER_ITEMS -gt $BEFORE_ITEMS ]; then
    echo "✅ インポートが成功した可能性があります"
  else
    echo "⚠️  データ件数に変化がありません。インポートが実行されていない可能性があります"
  fi
fi

