# PostgreSQLパスワードポリシー強化の実装

最終更新: 2025-12-18

## 概要

標準セキュリティチェックリスト監査で指摘された高優先度項目「PostgreSQLのパスワードポリシーの強化」を実装しました。

## 実装内容

### 1. Docker Compose設定の変更

`infrastructure/docker/docker-compose.server.yml`を変更し、環境変数からパスワードを取得するようにしました。

**変更前**:
```yaml
services:
  db:
    environment:
      POSTGRES_PASSWORD: postgres
  
  api:
    environment:
      DATABASE_URL: postgresql://postgres:postgres@db:5432/borrow_return
```

**変更後**:
```yaml
services:
  db:
    environment:
      # セキュリティ強化: 環境変数からパスワードを取得（デフォルト値は開発環境用）
      # 本番環境では強力なパスワードを環境変数で設定すること
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
  
  api:
    environment:
      # セキュリティ強化: 環境変数からデータベースURLを構築（パスワードは環境変数から取得）
      # 本番環境では強力なパスワードを環境変数で設定すること
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD:-postgres}@db:5432/borrow_return
```

### 2. 環境変数ファイルの更新

`apps/api/.env.example`に`POSTGRES_PASSWORD`環境変数を追加しました。

**追加内容**:
```bash
# Prisma / PostgreSQL
# セキュリティ強化: 本番環境では強力なパスワードを設定すること
# デフォルト値（postgres）は開発環境用のみ
POSTGRES_PASSWORD="postgres"
DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/borrow_return"
SHADOW_DATABASE_URL="postgresql://postgres:${POSTGRES_PASSWORD}@db-shadow:5432/borrow_return"
```

## 本番環境での設定方法

### ステップ1: 強力なパスワードを生成

```bash
# ランダムな強力なパスワードを生成（例）
openssl rand -base64 32
```

### ステップ2: 環境変数を設定

Pi5上で環境変数を設定します：

```bash
# /opt/RaspberryPiSystem_002/.env ファイルを作成または更新
cat > /opt/RaspberryPiSystem_002/.env <<EOF
POSTGRES_PASSWORD=your-strong-password-here
EOF
```

### ステップ3: Docker Composeで環境変数を読み込む

`docker-compose.server.yml`の`env_file`セクションに追加：

```yaml
services:
  db:
    env_file:
      - /opt/RaspberryPiSystem_002/.env
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
  
  api:
    env_file:
      - /opt/RaspberryPiSystem_002/.env
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD:-postgres}@db:5432/borrow_return
```

### ステップ4: 既存データベースのパスワード変更

既存のデータベースが起動している場合、パスワードを変更する必要があります：

```bash
# 1. データベースコンテナに接続
docker compose -f infrastructure/docker/docker-compose.server.yml exec db psql -U postgres

# 2. パスワードを変更
ALTER USER postgres WITH PASSWORD 'your-strong-password-here';

# 3. コンテナを再起動して環境変数を反映
docker compose -f infrastructure/docker/docker-compose.server.yml down
docker compose -f infrastructure/docker/docker-compose.server.yml up -d
```

## セキュリティ上の注意事項

1. **`.env`ファイルの保護**
   - `.env`ファイルは`.gitignore`に追加されていることを確認
   - ファイルのパーミッションを`600`に設定（所有者のみ読み書き可能）
   ```bash
   chmod 600 /opt/RaspberryPiSystem_002/.env
   ```

2. **パスワードの管理**
   - パスワードは環境変数で管理し、コードに直接記述しない
   - Ansible Vaultなどのツールを使用してパスワードを暗号化することを推奨

3. **デフォルトパスワードの使用**
   - デフォルトパスワード（`postgres`）は開発環境でのみ使用
   - 本番環境では必ず強力なパスワードに変更すること

## 検証方法

### 1. 環境変数の確認

```bash
# Docker Composeで環境変数が正しく読み込まれているか確認
docker compose -f infrastructure/docker/docker-compose.server.yml config | grep POSTGRES_PASSWORD
```

### 2. データベース接続の確認

```bash
# APIコンテナからデータベースに接続できるか確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec api \
  sh -c 'psql "$DATABASE_URL" -c "SELECT version();"'
```

### 3. パスワード変更の確認

```bash
# データベースコンテナに接続してパスワードが変更されているか確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
  psql -U postgres -c "\du"
```

## 関連ドキュメント

- [標準セキュリティチェックリスト監査レポート](./standard-security-checklist-audit.md)
- [セキュリティ要件定義](./requirements.md)
- [セキュリティ実装の妥当性評価](./implementation-assessment.md)
