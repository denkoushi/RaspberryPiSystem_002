# ログ出力ガイド

## 概要

このガイドでは、Raspberry Pi System 002のAPIにおけるログ出力の仕組み、ログレベルの設定方法、ログローテーションの設定について説明します。

## ログレベル

ログレベルは環境変数`LOG_LEVEL`で制御できます。

### 利用可能なログレベル

| レベル | 説明 | 用途 |
|--------|------|------|
| `debug` | すべてのログを出力 | 開発環境での詳細なデバッグ |
| `info` | 情報ログ以上を出力 | デフォルト（開発環境） |
| `warn` | 警告ログ以上を出力 | デフォルト（本番環境） |
| `error` | エラーログのみ出力 | 本番環境のトラブルシューティング時 |

### ログレベルの設定方法

#### 環境変数で設定

`.env`ファイルまたは環境変数で設定します。

```bash
# .envファイル
LOG_LEVEL=info

# または環境変数として設定
export LOG_LEVEL=warn
```

#### Docker Composeで設定

`infrastructure/docker/docker-compose.server.yml`で設定します。

```yaml
services:
  api:
    environment:
      LOG_LEVEL: warn
```

### デフォルト値

- **開発環境** (`NODE_ENV=development`): `info`
- **本番環境** (`NODE_ENV=production`): `warn`

## ログ出力の実装

### ロガーの使用

アプリケーション全体で統一されたロガー（Pino）を使用します。

```typescript
import { logger } from '../lib/logger.js';

// デバッグログ
logger.debug({ data: 'debug information' }, 'Debug message');

// 情報ログ
logger.info({ userId: 'xxx' }, 'User logged in');

// 警告ログ
logger.warn({ requestId: 'req-xxx' }, 'Rate limit approaching');

// エラーログ
logger.error({ error: err }, 'Failed to process request');
```

### ログレベルの使い分け

#### `debug`レベル

開発環境での詳細なデバッグ情報に使用します。

```typescript
logger.debug({ 
  requestBody: sanitizedBody,
  queryParams: request.query 
}, 'Request details');
```

#### `info`レベル

通常の情報ログに使用します。

```typescript
logger.info({ 
  userId: user.id,
  action: 'create_employee' 
}, 'Employee created');
```

#### `warn`レベル

警告やリトライ可能なエラーに使用します。

```typescript
logger.warn({ 
  requestId: request.id,
  retryCount: 3 
}, 'Rate limit approaching');
```

#### `error`レベル

システムエラーや予期しないエラーに使用します。

```typescript
logger.error({ 
  error: err,
  requestId: request.id 
}, 'Unexpected error occurred');
```

## ログローテーション

Docker環境では、ログローテーションが自動的に設定されています。

### 設定内容

`infrastructure/docker/docker-compose.server.yml`で以下の設定が行われています。

```yaml
services:
  api:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"      # 1ファイルあたりの最大サイズ
        max-file: "3"        # 保持するファイル数
        compress: "true"      # 古いログファイルを圧縮
  web:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
        compress: "true"
```

### ログファイルの管理

- **最大サイズ**: 10MB（1ファイルあたり）
- **保持ファイル数**: 3ファイル（合計30MB）
- **圧縮**: 有効（古いログファイルは自動的に圧縮される）

### ログファイルの場所

Dockerのログファイルは以下の場所に保存されます。

```bash
# Dockerのログファイルの場所（Linux）
/var/lib/docker/containers/<container-id>/<container-id>-json.log
```

## ログの確認方法

### Dockerでログを確認

Pi5 本番の API は `docker-compose.phase3.yml`（project `bluegreen`）の blue/green スロットで動く。`docker-compose.server.yml` の `api` サービスは本番では使われていないため、稼働中スロットのコンテナ（`bluegreen-api-blue-1` または `bluegreen-api-green-1`）のログを見る。

```bash
# 稼働中のAPIコンテナ名を確認
docker ps --format '{{.Names}}' | grep -E '^bluegreen-api-(blue|green)-1$'
API=bluegreen-api-green-1  # 上で表示されたコンテナ名

# APIコンテナのログを確認（最新50行）
docker logs "$API" --tail 50

# リアルタイムでログを確認（フォロー）
docker logs "$API" -f

# 特定の時間範囲のログを確認
docker logs "$API" --since 1h

# エラーログのみをフィルタリング
docker logs "$API" --tail 100 2>&1 | grep -i error

# 警告ログ以上をフィルタリング
docker logs "$API" --tail 100 2>&1 | grep -E '"level":(40|50)'
```

### ログの構造化出力

ログはJSON形式で出力されるため、`jq`を使用して構造化して確認できます。

```bash
# JSON形式で整形して表示
docker logs "$API" --tail 10 2>&1 | jq

# 特定のフィールドのみを抽出
docker logs "$API" --tail 100 2>&1 | jq 'select(.level >= 40) | {time, level, errorCode, requestId, url}'

# エラーコードでフィルタリング
docker logs "$API" --tail 100 2>&1 | jq 'select(.errorCode == "VALIDATION_ERROR")'
```

## ログ出力のベストプラクティス

### 1. 機密情報をログに出力しない

パスワード、トークン、個人情報などの機密情報はログに出力しないでください。

```typescript
// ❌ 悪い例
logger.info({ password: user.password }, 'User password');

// ✅ 良い例
logger.info({ userId: user.id }, 'User logged in');
```

### 2. 構造化ログを使用する

ログは構造化して出力することで、後で検索・分析が容易になります。

```typescript
// ❌ 悪い例
logger.info('User logged in: ' + user.id);

// ✅ 良い例
logger.info({ userId: user.id, action: 'login' }, 'User logged in');
```

### 3. 適切なログレベルを使用する

ログレベルを適切に使い分けることで、本番環境での不要なログ出力を削減できます。

```typescript
// デバッグ情報はdebugレベル
logger.debug({ requestBody }, 'Request body');

// 通常の情報はinfoレベル
logger.info({ userId }, 'User action');

// 警告はwarnレベル
logger.warn({ requestId }, 'Rate limit approaching');

// エラーはerrorレベル
logger.error({ error: err }, 'Failed to process');
```

### 4. エラーログにはコンテキストを含める

エラーログには、問題の特定に必要な情報を含めます。

```typescript
logger.error({
  error: err,
  requestId: request.id,
  userId: user?.id,
  url: request.url,
  method: request.method,
}, 'Failed to process request');
```

## トラブルシューティング

### ログが出力されない

**原因**: ログレベルが高すぎる可能性があります。

**解決方法**:
```bash
# ログレベルを確認（Pi5 の /opt/RaspberryPiSystem_002 で、稼働中スロット内で実行）
scripts/server/run-in-active-api.sh env | grep LOG_LEVEL
```

本番のログレベル変更は Pi5 上のファイル編集やコンテナの個別再作成ではなく、PR と標準デプロイ（[deployment.md](./deployment.md)）で行う。

### ログファイルが大きくなりすぎる

**原因**: ログローテーションが設定されていない、または設定が不適切です。

**解決方法**:
- `docker-compose.server.yml`でログローテーション設定を確認
- `max-size`と`max-file`を適切に設定

### ログの検索が困難

**原因**: ログが構造化されていない可能性があります。

**解決方法**:
- ログをJSON形式で出力（Pinoを使用）
- `jq`を使用してログを検索・フィルタリング

## 関連ドキュメント

- [エラーハンドリングガイド](./error-handling.md)
- [システム安定性向上計画](../plans/stability-improvement-plan.md)
- [モニタリングガイド](./monitoring.md)

