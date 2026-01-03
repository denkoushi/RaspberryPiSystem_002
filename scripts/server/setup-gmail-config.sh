#!/bin/bash
# Gmail設定をAPI経由で更新するスクリプト
# 使用方法: ./setup-gmail-config.sh <Client ID> <Client Secret> [Subject Pattern] [From Email]
# 例: ./setup-gmail-config.sh 993241073118-taao8eakjghtp608engeg93m7nlgdv7d.apps.google "client-secret-here" "[Pi5 CSV Import]" "powerautomate@example.com"

set -euo pipefail

# 引数チェック
if [ $# -lt 2 ]; then
  echo "使用方法: $0 <Client ID> <Client Secret> [Subject Pattern] [From Email]"
  echo ""
  echo "例:"
  echo "  $0 993241073118-taao8eakjghtp608engeg93m7nlgdv7d.apps.google \"client-secret-here\" \"[Pi5 CSV Import]\" \"powerautomate@example.com\""
  echo ""
  echo "引数:"
  echo "  Client ID: Google Cloud Consoleで取得したClient ID"
  echo "  Client Secret: Google Cloud Consoleで取得したClient Secret"
  echo "  Subject Pattern: (任意) メール検索時に使用する件名パターン"
  echo "  From Email: (任意) メール検索時に使用する送信元アドレス"
  exit 1
fi

CLIENT_ID="$1"
CLIENT_SECRET="$2"
SUBJECT_PATTERN="${3:-}"
FROM_EMAIL="${4:-}"
REDIRECT_URI="https://raspberrypi.tail7312a3.ts.net/api/gmail/oauth/callback"

# Pi5のIPアドレス（Tailscale経由）
PI5_HOST="100.106.158.2"

echo "Gmail設定を更新します..."
echo "Client ID: $CLIENT_ID"
echo "Subject Pattern: ${SUBJECT_PATTERN:-（未設定）}"
echo "From Email: ${FROM_EMAIL:-（未設定）}"
echo "Redirect URI: $REDIRECT_URI"
echo ""

# 認証トークンを取得
# 環境変数から認証情報を取得（設定されている場合）
if [ -z "${PI5_ADMIN_USERNAME:-}" ] || [ -z "${PI5_ADMIN_PASSWORD:-}" ]; then
  echo "⚠️  管理者の認証情報が必要です。"
  echo "環境変数 PI5_ADMIN_USERNAME と PI5_ADMIN_PASSWORD を設定するか、"
  echo "以下の情報を入力してください:"
  read -p "ユーザー名またはメールアドレス: " USERNAME
  read -sp "パスワード: " PASSWORD
  echo ""
else
  USERNAME="${PI5_ADMIN_USERNAME}"
  PASSWORD="${PI5_ADMIN_PASSWORD}"
  echo "環境変数から認証情報を取得しました。"
fi

# ログインしてトークンを取得
echo "ログイン中..."
LOGIN_RESPONSE=$(curl -s -k -X POST "https://${PI5_HOST}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}")

# トークンを抽出
ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

if [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ ログインに失敗しました。"
  echo "レスポンス: $LOGIN_RESPONSE"
  exit 1
fi

echo "✓ ログイン成功"
echo ""

# Gmail設定を更新
echo "Gmail設定を更新中..."
UPDATE_BODY="{"
UPDATE_BODY+="\"clientId\":\"${CLIENT_ID}\","
UPDATE_BODY+="\"clientSecret\":\"${CLIENT_SECRET}\","
UPDATE_BODY+="\"redirectUri\":\"${REDIRECT_URI}\""

if [ -n "$SUBJECT_PATTERN" ]; then
  UPDATE_BODY+=",\"subjectPattern\":\"${SUBJECT_PATTERN}\""
fi

if [ -n "$FROM_EMAIL" ]; then
  UPDATE_BODY+=",\"fromEmail\":\"${FROM_EMAIL}\""
fi

UPDATE_BODY+="}"

UPDATE_RESPONSE=$(curl -s -k -X PUT "https://${PI5_HOST}/api/gmail/config" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -d "$UPDATE_BODY")

# レスポンスを確認
if echo "$UPDATE_RESPONSE" | grep -q '"success":true'; then
  echo "✓ Gmail設定の更新が完了しました"
  echo ""
  echo "次のステップ:"
  echo "1. Pi5の管理コンソール（https://${PI5_HOST}/admin/gmail/config）にアクセス"
  echo "2. 「OAuth認証」ボタンをクリックして認証を完了"
  echo ""
else
  echo "❌ Gmail設定の更新に失敗しました"
  echo "レスポンス: $UPDATE_RESPONSE"
  exit 1
fi

