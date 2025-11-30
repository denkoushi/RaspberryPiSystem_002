# システム安定性向上機能の実機テスト手順

## 目的

Phase 1.1（エラーメッセージ詳細化）、Phase 1.2（エラーログ構造化）、Phase 2.1（ログレベル制御）、Phase 2.2（ログローテーション）の実機テストを実施します。

## 前提条件

- Raspberry Pi 5にSSH接続または直接ログインしていること
- プロジェクトディレクトリ: `/opt/RaspberryPiSystem_002`

## テスト手順

### 1. コードの更新とデプロイ

```bash
# Raspberry Pi 5で実行
cd /opt/RaspberryPiSystem_002
git fetch origin
git checkout feature/stability-improvement
git pull origin feature/stability-improvement

# APIコンテナを再ビルド・再起動
docker compose -f infrastructure/docker/docker-compose.server.yml up -d --build api

# コンテナが正常に起動したか確認
docker compose -f infrastructure/docker/docker-compose.server.yml ps
docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail 20
```

### 2. エラーメッセージの詳細化テスト

#### テスト1: バリデーションエラー（ZodError）

```bash
# 不正なリクエストを送信してバリデーションエラーを発生させる
curl -X POST http://localhost:8080/api/tools/employees \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -d '{"employeeCode": "123"}' | jq
```

**期待される結果**:
- レスポンスに`errorCode: "VALIDATION_ERROR"`が含まれる
- レスポンスに`requestId`が含まれる
- レスポンスに`timestamp`が含まれる
- レスポンスに`issues`配列が含まれる（バリデーションエラーの詳細）

#### テスト2: Prismaエラー（P2002: ユニーク制約違反）

```bash
# 既存の従業員コードで重複登録を試みる
curl -X POST http://localhost:8080/api/tools/employees \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -d '{"employeeCode": "0001", "displayName": "テスト従業員", "status": "ACTIVE"}' | jq
```

**期待される結果**:
- レスポンスに`errorCode: "P2002"`が含まれる
- レスポンスに`requestId`が含まれる
- レスポンスに`timestamp`が含まれる
- レスポンスに詳細メッセージ（「ユニーク制約違反: EmployeeのemployeeCodeが既に存在します。」など）が含まれる

#### テスト3: ApiError（認証エラー）

```bash
# 無効なトークンでリクエストを送信
curl -X GET http://localhost:8080/api/tools/employees \
  -H "Authorization: Bearer invalid-token" | jq
```

**期待される結果**:
- レスポンスに`errorCode`が含まれる（認証エラーのコード）
- レスポンスに`requestId`が含まれる
- レスポンスに`timestamp`が含まれる

### 3. エラーログの構造化テスト

```bash
# APIコンテナのログを確認（エラーが発生した後）
docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail 50 | grep -A 5 "error\|warn"
```

**期待される結果**:
- ログに`errorCode`フィールドが含まれる
- ログに`requestId`フィールドが含まれる
- ログに`method`フィールドが含まれる
- ログに`url`フィールドが含まれる
- ログに`userId`フィールドが含まれる（認証済みリクエストの場合）
- ログに`stack`フィールドが含まれる（エラーの場合）

**ログ例**:
```json
{
  "level": 40,
  "time": 1701234567890,
  "requestId": "req-123",
  "method": "POST",
  "url": "/api/tools/employees",
  "errorCode": "VALIDATION_ERROR",
  "errorName": "ZodError",
  "errorMessage": "...",
  "userId": "user-456",
  "issues": [...]
}
```

### 4. ログレベルの環境変数制御テスト

#### テスト1: デフォルトログレベル（info）

```bash
# 現在のログレベルを確認（環境変数を設定しない場合）
docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail 10
```

**期待される結果**:
- `info`レベルのログが出力される
- `debug`レベルのログは出力されない

#### テスト2: warnログレベルに変更

```bash
# docker-compose.server.ymlのapiセクションに以下を追加（または環境変数ファイルに設定）
# environment:
#   LOG_LEVEL: warn

# コンテナを再起動
docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate api

# ログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail 10
```

**期待される結果**:
- `warn`レベルのログのみが出力される
- `info`レベルのログは出力されない

### 5. Dockerログローテーションのテスト

```bash
# ログファイルの場所を確認
docker inspect docker-api-1 | grep -A 10 "LogPath"

# ログファイルのサイズを確認
sudo ls -lh /var/lib/docker/containers/$(docker inspect -f '{{.Id}}' docker-api-1)/$(docker inspect -f '{{.Id}}' docker-api-1)-json.log*

# 大量のログを生成してローテーションをテスト（オプション）
# 注意: 本番環境では実行しないでください
for i in {1..1000}; do
  curl -s http://localhost:8080/api/system/health > /dev/null
done

# ログファイルを再確認（10MBを超えるとローテーションされる）
sudo ls -lh /var/lib/docker/containers/$(docker inspect -f '{{.Id}}' docker-api-1)/$(docker inspect -f '{{.Id}}' docker-api-1)-json.log*
```

**期待される結果**:
- ログファイルが10MBを超えると新しいファイルが作成される
- 最大3ファイルまで保持される（例: `*-json.log`, `*-json.log.1`, `*-json.log.2`）
- 古いログファイルは圧縮される（`.gz`拡張子）

## トラブルシューティング

### エラーメッセージに`errorCode`が含まれない場合

- APIコンテナが最新のコードでビルドされているか確認
- `docker compose up -d --build api`で再ビルド

### ログに構造化された情報が含まれない場合

- エラーハンドラーが正しく登録されているか確認
- APIコンテナのログを確認してエラーハンドラーのエラーがないか確認

### ログローテーションが動作しない場合

- Docker Composeファイルの`logging`設定が正しく適用されているか確認
- `docker compose config`で設定を確認
- Dockerのバージョンが`json-file`ドライバーをサポートしているか確認

## テスト結果の記録

各テストの結果を以下の形式で記録してください：

- ✅ 成功: 期待される結果が確認できた
- ❌ 失敗: 期待される結果が確認できなかった（詳細を記録）

## 関連ドキュメント

- [システム安定性向上計画](../plans/stability-improvement-plan.md)
- [デプロイメントガイド](./deployment.md)

