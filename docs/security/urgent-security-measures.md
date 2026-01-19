# 緊急に実装すべき安全対策機能

最終更新: 2026-01-18

## 概要

本ドキュメントは、セキュリティ評価の結果を踏まえ、**USBメモリ運用予定がない**ことを前提として、緊急に実装すべき安全対策機能を特定したものです。

**評価実施日**: 2026-01-18  
**評価実施者**: AI Assistant（実機検証 + コードレビュー）

## 結論：緊急に実装すべき項目は2件

USBメモリ運用予定がないことを前提として、**緊急に実装すべき安全対策機能は2件**です：

1. **🔴 ログの機密情報保護**（中優先度だが影響が大きい）
2. **🔴 デフォルトパスワードの変更**（本番環境では必須）

## 緊急に実装すべき項目（優先順位順）

### 1. ログの機密情報保護 🔴 緊急

**リスク**: 中優先度だが影響が大きい

**問題点**:
- `x-client-key`がログに平文で出力されている
- ログファイルが漏洩した場合、`x-client-key`が悪用される可能性がある
- Webhook URLの部分文字列もログに出力される可能性がある

**影響範囲**:
- ログファイルが漏洩した場合、キオスクAPIへの不正アクセスが可能になる
- キオスクAPI経由での個人情報列挙が可能になる

**実装箇所**:
- [apps/api/src/plugins/request-logger.ts](../../apps/api/src/plugins/request-logger.ts): 17行目、40行目
- [apps/api/src/routes/kiosk.ts](../../apps/api/src/routes/kiosk.ts): 119行目、131行目、228行目

**実装内容**:
```typescript
// 修正前
'x-client-key': request.headers['x-client-key'],

// 修正後
'x-client-key': request.headers['x-client-key'] ? '[REDACTED]' : undefined,
```

**想定工数**: 0.5日

**実装難易度**: 低

**副作用**: ログの可読性が低下する可能性があるが、セキュリティを優先

### 2. デフォルトパスワードの変更 🔴 緊急（本番環境では必須）

**リスク**: 中優先度（本番環境では高優先度）

**問題点**:
- 管理ユーザー: `admin/admin1234`（シードデータ）
- PostgreSQL: `postgres/postgres`（デフォルト値）
- JWTシークレット: `dev-access-secret-change-me`（デフォルト値）

**影響範囲**:
- デフォルトパスワードが漏洩した場合、管理画面への不正アクセスが可能になる
- PostgreSQLのデフォルトパスワードが漏洩した場合、データベースへの不正アクセスが可能になる（ただし、外部露出なしのため実質的なリスクは低い）

**実装方法**:
1. **管理ユーザーのパスワード変更**:
   - 管理画面の「セキュリティ」ページからパスワードを変更
   - または、データベースで直接変更:
     ```sql
     -- bcryptでハッシュ化したパスワードに更新
     UPDATE "User" SET "passwordHash" = '<bcrypt-hash>' WHERE username = 'admin';
     ```

2. **PostgreSQLパスワードの変更**:
   - `infrastructure/docker/.env`ファイルに`POSTGRES_PASSWORD`を設定
   - 強力なパスワードを生成（例: `openssl rand -base64 32`）
   - Docker Composeを再起動

3. **JWTシークレットの変更**:
   - `apps/api/.env`ファイルに`JWT_ACCESS_SECRET`と`JWT_REFRESH_SECRET`を設定
   - 強力なシークレットを生成（例: `openssl rand -base64 32`）
   - APIコンテナを再起動

**想定工数**: 0.5日

**実装難易度**: 低

**副作用**: 既存のセッションが無効になる可能性がある

## 中優先度の項目（1ヶ月以内に実施推奨）

### 3. CSRF対策の実装 🟡 中優先度

**リスク**: 中優先度（JWT認証によりリスクは低減されているが、追加対策でより安全に）

**問題点**:
- CSRFトークンの実装が未確認
- SameSite Cookie属性の設定が未確認

**影響範囲**:
- 認証済みユーザーが意図しない操作を実行される可能性（JWT認証によりリスクは低減）

**実装内容**:
- SameSite Cookie属性の設定（Caddy設定で実装可能）
- CSRFトークンの実装（重要な操作エンドポイントに追加）

**想定工数**: 1-2日

**実装難易度**: 中

### 4. PostgreSQL SSL/TLS接続の強制 🟡 中優先度

**リスク**: 中優先度（Docker内部ネットワークは比較的安全だが、より厳密な設定が推奨）

**問題点**:
- PostgreSQLのSSL/TLS接続が未強制

**影響範囲**:
- Docker内部ネットワークでの通信傍受リスク（低リスク）

**実装内容**:
- PostgreSQLのSSL設定の有効化（`postgresql.conf`の`ssl = on`）
- クライアント接続でのSSL/TLS接続の強制（`pg_hba.conf`の設定）

**想定工数**: 1日

**実装難易度**: 中

### 5. PostgreSQL監査ログの設定 🟡 中優先度

**リスク**: 中優先度（データベース操作の追跡が困難）

**問題点**:
- PostgreSQLの監査ログ設定が未実施

**影響範囲**:
- データベース操作の追跡が困難

**実装内容**:
- PostgreSQLの監査ログ設定（`log_statement`、`log_connections`など）
- 監査ログの外部保存と分析

**想定工数**: 0.5日

**実装難易度**: 低

## 低優先度の項目（必要に応じて実施）

### 6. Docker設定の強化 🟢 低優先度

**リスク**: 低優先度

**項目**:
- readOnlyRootFilesystemの実装
- securityContextの設定
- ヘルスチェックの実装

**想定工数**: 1-2日

**実装難易度**: 中

## 実装優先順位のまとめ

| 優先度 | 項目 | リスク | 想定工数 | 実装難易度 | 緊急度 |
|--------|------|--------|---------|-----------|--------|
| 🔴 **緊急** | **ログの機密情報保護** | 中（影響大） | 0.5日 | 低 | **高** |
| 🔴 **緊急** | **デフォルトパスワードの変更** | 中（本番では高） | 0.5日 | 低 | **高** |
| 🟡 中優先度 | CSRF対策の実装 | 中 | 1-2日 | 中 | 中 |
| 🟡 中優先度 | PostgreSQL SSL/TLS接続の強制 | 中 | 1日 | 中 | 中 |
| 🟡 中優先度 | PostgreSQL監査ログの設定 | 中 | 0.5日 | 低 | 中 |
| 🟢 低優先度 | Docker設定の強化 | 低 | 1-2日 | 中 | 低 |

## 緊急実装項目の詳細

### 1. ログの機密情報保護

**実装ファイル**:
1. `apps/api/src/plugins/request-logger.ts`
2. `apps/api/src/routes/kiosk.ts`

**実装内容**:

#### ファイル1: `apps/api/src/plugins/request-logger.ts`

```typescript
// 17行目を修正
'x-client-key': request.headers['x-client-key'] ? '[REDACTED]' : undefined,

// 40行目を修正
'x-client-key': request.headers['x-client-key'] ? '[REDACTED]' : undefined,
```

#### ファイル2: `apps/api/src/routes/kiosk.ts`

```typescript
// 119行目を修正（ログ出力を削除または[REDACTED]に置換）
app.log.info({ 
  clientKey: clientKey ? '[REDACTED]' : undefined, 
  rawClientKey: '[REDACTED]', 
  headers: { ...request.headers, 'x-client-key': '[REDACTED]' } 
}, 'Kiosk config request');

// 131行目を修正（ログ出力を削除または[REDACTED]に置換）
app.log.info({ 
  client: client ? { ...client, apiKey: '[REDACTED]' } : null, 
  clientKey: '[REDACTED]', 
  found: !!client, 
  defaultMode: client?.defaultMode 
}, 'Client device lookup result');

// 228行目を修正（ログ出力を削除または[REDACTED]に置換）
app.log.info({ 
  hasClientKey: !!clientKey, 
  clientKeyLength: clientKey?.length || 0 
}, 'clientKey normalized');
```

**検証方法**:
1. ログファイルを確認し、`x-client-key`が`[REDACTED]`に置換されていることを確認
2. キオスクAPIにアクセスし、ログに`x-client-key`が出力されないことを確認

### 2. デフォルトパスワードの変更

**実装手順**:

#### ステップ1: 管理ユーザーのパスワード変更

**方法1: 管理画面から変更（推奨）**
1. 管理画面にログイン（`https://<pi5-ip>/admin`）
2. 「セキュリティ」ページに移動
3. パスワードを変更

**方法2: データベースで直接変更**
```bash
# Pi5上で実行
cd /opt/RaspberryPiSystem_002/infrastructure/docker
docker compose -f docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "
UPDATE \"User\" 
SET \"passwordHash\" = '<bcrypt-hash>' 
WHERE username = 'admin';
"
```

**bcryptハッシュの生成方法**:
```bash
# Node.jsで生成
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('your-strong-password', 10).then(hash => console.log(hash));"
```

#### ステップ2: PostgreSQLパスワードの変更

```bash
# Pi5上で実行
# 強力なパスワードを生成
openssl rand -base64 32

# infrastructure/docker/.envファイルに追加
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)" >> /opt/RaspberryPiSystem_002/infrastructure/docker/.env

# Docker Composeを再起動
cd /opt/RaspberryPiSystem_002/infrastructure/docker
docker compose -f docker-compose.server.yml down
docker compose -f docker-compose.server.yml up -d
```

#### ステップ3: JWTシークレットの変更

```bash
# Pi5上で実行
# 強力なシークレットを生成
openssl rand -base64 32

# apps/api/.envファイルに追加
echo "JWT_ACCESS_SECRET=$(openssl rand -base64 32)" >> /opt/RaspberryPiSystem_002/apps/api/.env
echo "JWT_REFRESH_SECRET=$(openssl rand -base64 32)" >> /opt/RaspberryPiSystem_002/apps/api/.env

# APIコンテナを再起動
cd /opt/RaspberryPiSystem_002/infrastructure/docker
docker compose -f docker-compose.server.yml restart api
```

**検証方法**:
1. 新しいパスワードでログインできることを確認
2. 古いパスワードでログインできないことを確認
3. PostgreSQLに新しいパスワードで接続できることを確認

## 実装後の検証

### ログの機密情報保護の検証

```bash
# Pi5上で実行
# キオスクAPIにアクセス
curl -H "x-client-key: test-key-12345" https://localhost/api/kiosk/config

# ログを確認（x-client-keyが[REDACTED]に置換されていることを確認）
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -i "x-client-key"
```

### デフォルトパスワード変更の検証

```bash
# Pi5上で実行
# 古いパスワードでログインできないことを確認
curl -k -X POST https://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin1234"}' | jq .

# 新しいパスワードでログインできることを確認
curl -k -X POST https://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<new-password>"}' | jq .
```

## まとめ

**緊急に実装すべき項目**: **2件**

1. **ログの機密情報保護**（0.5日、低難易度）
   - `x-client-key`をログから除外または`[REDACTED]`に置換
   - 影響が大きいため、緊急に実装推奨

2. **デフォルトパスワードの変更**（0.5日、低難易度）
   - 管理ユーザー、PostgreSQL、JWTシークレットのパスワードを変更
   - 本番環境では必須

**中優先度の項目**: 3件（1ヶ月以内に実施推奨）
- CSRF対策の実装
- PostgreSQL SSL/TLS接続の強制
- PostgreSQL監査ログの設定

**総工数**: 緊急項目は合計1日で実装可能

## 関連ドキュメント

- [セキュリティ評価報告書](./evaluation-report.md)
- [外部侵入リスク分析レポート](./external-intrusion-risk-analysis.md)
- [セキュリティ評価計画書](./evaluation-plan.md)
