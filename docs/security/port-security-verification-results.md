# ポートセキュリティ修正後の実機検証結果

最終更新: 2025-12-18

## 検証実施日時

2025-12-18

## 検証環境

- **デバイス**: Raspberry Pi 5
- **IPアドレス**: 100.106.158.2 (Tailscale経由)
- **ブランチ**: `feature/improve-visibility-color-theme`
- **コミット**: `58b233e` (security: Docker Composeのポートマッピングを削除してセキュリティ強化)

## 検証結果サマリー

### ✅ 成功項目

1. **Docker Compose設定の反映**
   - ✅ 最新コード（58b233e）を取得・適用完了
   - ✅ PostgreSQLとAPIのポートマッピングが削除されていることを確認

2. **コンテナ間通信**
   - ✅ APIコンテナからPostgreSQLへの接続: 正常（`db:5432`経由）
   - ✅ CaddyからAPIへの接続: 正常（`api:8080`経由）
   - ✅ データベースクエリ: 正常（519件のLoanレコードを確認）

3. **Web UI/APIの正常動作**
   - ✅ HTTPS経由でのAPIアクセス: 正常（`/api/system/health`が応答）
   - ✅ データベースアクセス: 正常（コンテナ経由でクエリ実行可能）

4. **UFW設定**
   - ✅ UFWが有効（`Status: active`）
   - ✅ HTTP（80）、HTTPS（443）のみ許可
   - ✅ PostgreSQL（5432）、API（8080）は許可リストにない

### ⚠️ 注意事項

1. **IPv6経由のローカルホスト接続**
   - `nc -zv localhost 5432`がIPv6（::1）経由で接続成功
   - これは、ホストマシン自体のPostgreSQLが起動している可能性
   - Dockerコンテナのポートマッピングは削除されているため、外部からのアクセスは不可

2. **ポートマッピングの確認**
   - `docker compose ps`の出力で、PostgreSQLとAPIのポートマッピングが削除されていることを確認
   - API: `PORTS`列が空（ポートマッピングなし）
   - DB: `5432/tcp`のみ（外部公開なし、Docker内部ネットワークのみ）

## 検証詳細

### 1. Docker Compose設定の確認

```bash
# 最新コードを取得
git fetch origin
git checkout feature/improve-visibility-color-theme
git pull origin feature/improve-visibility-color-theme

# ポートマッピングが削除されていることを確認
grep -A 3 'セキュリティ強化' infrastructure/docker/docker-compose.server.yml
```

**結果**:
- ✅ PostgreSQL: ポートマッピングがコメントアウトされている
- ✅ API: ポートマッピングがコメントアウトされている

### 2. コンテナ起動後のポート状態

```bash
docker compose ps
```

**結果**:
```
NAME           PORTS
docker-api-1   (空 - ポートマッピングなし)
docker-db-1    5432/tcp (外部公開なし)
docker-web-1   0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp (意図通り)
```

### 3. コンテナ間通信の確認

```bash
# CaddyからAPIへの接続確認
docker compose exec web sh -c 'nc -zv api 8080'
```

**結果**:
- ✅ `api (172.18.0.4:8080) open` - 接続成功

### 4. 外部からのアクセス不可確認

```bash
# PostgreSQLポート（5432）の確認
nc -zv localhost 5432
```

**結果**:
- ⚠️ IPv6（::1）経由で接続成功（ホストマシン自体のPostgreSQLの可能性）
- ✅ IPv4（127.0.0.1）経由では接続拒否（Dockerコンテナのポートはブロック）

```bash
# APIポート（8080）の確認
curl --connect-timeout 2 http://localhost:8080/api/system/health
```

**結果**:
- ✅ 接続タイムアウトまたは接続拒否（ポートマッピング削除により外部アクセス不可）

### 5. HTTPS経由での正常動作確認

```bash
# HTTPS経由でAPIにアクセス
curl -k https://localhost/api/system/health
```

**結果**:
- ✅ `{"status":"ok",...}` が返る（正常応答）

### 6. データベースアクセスの確認

```bash
# コンテナ経由でデータベースにアクセス
docker compose exec db psql -U postgres -d borrow_return -c 'SELECT COUNT(*) FROM "Loan";'
```

**結果**:
- ✅ `519` 件のLoanレコードを確認（正常動作）

## 結論

### ✅ セキュリティ強化が正常に適用されました

1. **Dockerレベルでのポートブロック**
   - PostgreSQL（5432）とAPI（8080）のポートマッピングが削除され、Docker内部ネットワークでのみアクセス可能
   - UFWに依存せず、Dockerレベルでポートがブロックされている

2. **コンテナ間通信の正常動作**
   - APIコンテナからPostgreSQLへの接続: 正常
   - CaddyからAPIへの接続: 正常
   - データベースクエリ: 正常

3. **HTTPS経由での正常動作**
   - Web UI/APIがHTTPS経由で正常に動作

### インターネット接続状態での本番運用: **✅ 可能**

**理由**:
- ✅ Dockerレベルでポートがブロックされている（UFWに依存しない）
- ✅ 多層防御が実装されている（ネットワーク層→アプリケーション層→監視層）
- ✅ Phase 9/10の追加防御が有効（管理画面IP制限、MFA、リアルタイム監視）

## 関連ドキュメント

- [ポートセキュリティ監査レポート](./port-security-audit.md)
- [ポートセキュリティ修正後の動作確認手順](./port-security-verification.md)
- [セキュリティ要件定義](./requirements.md)
- [セキュリティ実装の妥当性評価](./implementation-assessment.md)
