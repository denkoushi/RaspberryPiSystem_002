# ポートセキュリティ修正後の動作確認手順

最終更新: 2025-12-18

## 概要

Docker Composeのポートマッピング削除後、システムが正常に動作することを確認する手順です。

## 確認項目

### 1. Docker Compose設定の確認

```bash
# 設定ファイルの構文チェック
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml config
```

**期待される結果**:
- ✅ エラーなく設定が読み込まれる
- ✅ PostgreSQLとAPIの`ports`セクションがコメントアウトされている

### 2. コンテナ間通信の確認

#### 2.1 APIコンテナからPostgreSQLへの接続確認

```bash
# APIコンテナからPostgreSQLに接続できるか確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec api \
  sh -c 'nc -zv db 5432'
```

**期待される結果**:
- ✅ `db:5432 open` と表示される（接続成功）

#### 2.2 CaddyからAPIへの接続確認

```bash
# CaddyコンテナからAPIに接続できるか確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec web \
  sh -c 'nc -zv api 8080'
```

**期待される結果**:
- ✅ `api:8080 open` と表示される（接続成功）

### 3. 外部からのアクセス不可確認

#### 3.1 PostgreSQLポート（5432）の確認

```bash
# 外部からPostgreSQLにアクセスできないことを確認
# （Pi5上で実行）
telnet localhost 5432
# または
nc -zv localhost 5432
```

**期待される結果**:
- ✅ `Connection refused` またはタイムアウト（接続拒否）

#### 3.2 APIポート（8080）の確認

```bash
# 外部からAPIにアクセスできないことを確認
# （Pi5上で実行）
curl http://localhost:8080/api/system/health
```

**期待される結果**:
- ✅ `Connection refused` またはタイムアウト（接続拒否）

### 4. Web UI/APIの正常動作確認

#### 4.1 HTTPS経由でのアクセス確認

```bash
# HTTPS経由でWeb UIにアクセスできるか確認
curl -kI https://localhost/
```

**期待される結果**:
- ✅ `HTTP/2 200` または `HTTP/1.1 200 OK`（正常応答）

#### 4.2 APIエンドポイントの確認

```bash
# HTTPS経由でAPIにアクセスできるか確認
curl -k https://localhost/api/system/health
```

**期待される結果**:
- ✅ `{"status":"ok",...}` が返る（正常応答）

### 5. UFW設定の確認

```bash
# UFWの状態を確認
sudo ufw status numbered
```

**期待される結果**:
- ✅ UFWが有効（`Status: active`）
- ✅ HTTP（80）、HTTPS（443）のみ許可
- ✅ SSH（22）は信頼ネットワークのみ許可
- ✅ PostgreSQL（5432）、API（8080）は許可リストにない

## トラブルシューティング

### 問題1: APIコンテナからPostgreSQLに接続できない

**原因**: Docker内部ネットワークの問題

**確認方法**:
```bash
# Dockerネットワークの確認
docker network ls
docker network inspect docker_default
```

**対策**:
- Docker Composeを再起動: `docker compose down && docker compose up -d`

### 問題2: CaddyからAPIに接続できない

**原因**: Docker内部ネットワークの問題

**確認方法**:
```bash
# APIコンテナの状態確認
docker compose ps api
docker compose logs api --tail 50
```

**対策**:
- Docker Composeを再起動: `docker compose down && docker compose up -d`

### 問題3: Web UIにアクセスできない

**原因**: Caddyの設定問題

**確認方法**:
```bash
# Caddyコンテナのログ確認
docker compose logs web --tail 50
```

**対策**:
- Caddyの設定を確認: `docker compose exec web cat /srv/Caddyfile`
- Caddyを再起動: `docker compose restart web`

## デプロイ手順

### ステップ1: 最新コードを取得

```bash
# Pi5上で実行
cd /opt/RaspberryPiSystem_002
git fetch origin
git checkout feature/improve-visibility-color-theme
git pull origin feature/improve-visibility-color-theme
```

### ステップ2: Docker Composeを再起動

```bash
# コンテナを停止
docker compose -f infrastructure/docker/docker-compose.server.yml down

# コンテナを再起動（ポートマッピング削除が反映される）
docker compose -f infrastructure/docker/docker-compose.server.yml up -d
```

### ステップ3: 動作確認

上記の「確認項目」を順次実行し、すべて正常に動作することを確認してください。

## 関連ドキュメント

- [ポートセキュリティ監査レポート](./port-security-audit.md)
- [セキュリティ要件定義](./requirements.md)
- [セキュリティ実装の妥当性評価](./implementation-assessment.md)
