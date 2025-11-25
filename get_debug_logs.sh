#!/bin/bash

# デバッグログ取得スクリプト
# ラズパイ5で実行してください

API_URL="http://localhost:8080/api"

echo "=== ステップ1: ログインしてトークンを取得 ==="
TOKEN=$(curl -s -X POST ${API_URL}/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin1234"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "エラー: ログインに失敗しました"
  exit 1
fi

echo "トークンを取得しました"
echo ""

echo "=== ステップ2: 429エラーのログを取得 ==="
curl -s -H "Authorization: Bearer $TOKEN" \
  "${API_URL}/system/debug/logs?level=warn&limit=20"
echo ""
echo ""

echo "=== ステップ3: 404エラーのリクエストログを取得 ==="
curl -s -H "Authorization: Bearer $TOKEN" \
  "${API_URL}/system/debug/requests?statusCode=404&limit=20"
echo ""
echo ""

echo "=== ステップ4: 429エラーのリクエストログを取得 ==="
curl -s -H "Authorization: Bearer $TOKEN" \
  "${API_URL}/system/debug/requests?statusCode=429&limit=20"
echo ""

