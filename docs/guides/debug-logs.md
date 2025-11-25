# デバッグログ取得ガイド

429エラーや404エラーの原因を特定するために、デバッグエンドポイントを使用してログを取得できます。

## 前提条件

- 管理者権限が必要です
- ラズパイ5でAPIサーバーが起動している必要があります

## 手順

### 1. ラズパイ5のIPアドレスを確認

```bash
hostname -I
```

通常は `192.168.10.230` です。

### 2. 管理者トークンを取得

```bash
# ログインしてトークンを取得
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin1234"}' \
  | jq -r '.accessToken')

echo "Token: $TOKEN"
```

### 3. デバッグログを取得

#### 429エラーのログを取得

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/system/debug/logs?level=warn&limit=20" | jq
```

#### 404エラーのリクエストログを取得

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/system/debug/requests?statusCode=404&limit=20" | jq
```

#### 429エラーのリクエストログを取得

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/system/debug/requests?statusCode=429&limit=20" | jq
```

#### すべてのエラーログを取得

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/system/debug/logs?limit=50" | jq
```

#### すべてのリクエストログを取得

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/system/debug/requests?limit=50" | jq
```

## 注意事項

- ログはメモリ内に最大100件まで保持されます
- サーバーを再起動するとログは消去されます
- `jq`がインストールされていない場合は、`| jq`を削除してください

## 例：一括実行スクリプト

```bash
#!/bin/bash

# ラズパイ5のIPアドレス（必要に応じて変更）
API_URL="http://localhost:8080/api"

# ログイン
echo "ログイン中..."
TOKEN=$(curl -s -X POST ${API_URL}/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin1234"}' \
  | jq -r '.accessToken')

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "ログインに失敗しました"
  exit 1
fi

echo "トークンを取得しました"
echo ""

# 429エラーのログを取得
echo "=== 429エラーのログ ==="
curl -s -H "Authorization: Bearer $TOKEN" \
  "${API_URL}/system/debug/logs?level=warn&limit=20" | jq '.logs[] | select(.data.statusCode == 429)'

echo ""
echo "=== 404エラーのリクエストログ ==="
curl -s -H "Authorization: Bearer $TOKEN" \
  "${API_URL}/system/debug/requests?statusCode=404&limit=20" | jq

echo ""
echo "=== 429エラーのリクエストログ ==="
curl -s -H "Authorization: Bearer $TOKEN" \
  "${API_URL}/system/debug/requests?statusCode=429&limit=20" | jq
```

