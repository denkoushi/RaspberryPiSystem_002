# 検証チェックリスト

最終更新: 2025-01-XX

## 概要

本ドキュメントでは、運用・保守性の向上機能のラズパイでの検証手順を説明します。

## 検証環境

- **Raspberry Pi 5**: サーバー（API/DB/Web UI）
- **Raspberry Pi 4**: クライアント（キオスク + NFCリーダー）

## 検証項目

### 1. オフライン耐性機能の検証

#### 1.1 オフライン時の動作確認

**問題**: ネットワークが切れている時、NFCカードをかざしてもイベントが失われてしまう

**解決策**: オフライン時にイベントをキューに保存し、ネットワークが復旧したら自動的に再送する

**検証手順**:

1. **準備**
   ```bash
   # ラズパイ4でNFCエージェントを起動
   cd /opt/RaspberryPiSystem_002/clients/nfc-agent
   poetry run python -m nfc_agent
   ```

2. **ブラウザでキオスク画面を開く**
   - `http://<ラズパイ5のIP>:4173/kiosk` にアクセス
   - WebSocket接続が確立される

3. **オフライン時の動作確認**
   - ブラウザを閉じる（WebSocket接続を切断）
   - NFCカードをかざす（複数回かざしてもOK）
   - キューに保存されているか確認：
     ```bash
     curl http://localhost:7071/api/agent/queue
     ```
     - 結果に `"events": [...]` が表示されればOK
     - イベントが保存されていることを確認

4. **オンライン復帰後の再送確認**
   - ブラウザでキオスク画面を再度開く（WebSocket接続を再確立）
   - キューが空になることを確認：
     ```bash
     curl http://localhost:7071/api/agent/queue
     ```
     - `"events": []` が表示されればOK
     - イベントが再送されたことを確認
   - キオスク画面でイベントが処理されることを確認

**期待される結果**: 
- ✅ オフライン時にかざしたカードのイベントが、オンライン復帰後に自動的に再送され、キオスク画面で処理される
- ❌ イベントが失われる、または再送されない

#### 1.2 USB一括登録機能の検証

**検証概要**: USBメモリからのCSVファイル一括登録機能の実機検証

**CSVファイル形式**:

従業員CSV (`employees.csv`):
```csv
employeeCode,displayName,nfcTagUid,department,contact,status
EMP001,山田太郎,04C362E1330289,製造部,090-1234-5678,ACTIVE
EMP002,佐藤花子,04B34411340289,品質管理部,090-2345-6789,ACTIVE
```

アイテムCSV (`items.csv`):
```csv
itemCode,name,nfcTagUid,category,storageLocation,status,notes
ITEM001,ドライバーセット,04DE8366BC2A81,工具,工具庫A,ACTIVE,常用工具
ITEM002,メジャー,04C393C1330289,測定器具,工具庫B,ACTIVE,
```

**検証手順**:

1. **CSVファイルの準備**
   - `employees.csv` と `items.csv` を準備
   - UTF-8エンコーディングで保存
   - ヘッダー行を含める

2. **管理画面で一括登録ページにアクセス**
   - ブラウザで管理画面にログイン: `http://<ラズパイ5のIP>:4173/login`
   - ユーザー名: `admin`、パスワード: `admin1234`
   - 一括登録ページにアクセス: `http://<ラズパイ5のIP>:4173/admin/import`

3. **CSVファイルをアップロード**
   - 従業員CSVを選択
   - アイテムCSVを選択（オプション）
   - 「既存データをクリアしてから取り込み」にチェックを入れるか選択
   - 「取り込み開始」ボタンをクリック

4. **取り込み結果を確認**
   - 成功メッセージの確認（「最新ジョブ ID: ...」が表示される）
   - 取込履歴の確認（ステータスが「COMPLETED」であることを確認）

5. **データが正しく登録されているか確認**
   - 従業員一覧を確認
   - アイテム一覧を確認

**期待される結果**:
- ✅ CSVファイルが正常にアップロードされる
- ✅ 取り込みが完了する
- ✅ データが正しく登録される
- ✅ 取込履歴にジョブが記録される

**トラブルシューティング**:
- CSVファイルがアップロードされない → ファイルサイズ、エンコーディング、ヘッダー行を確認
- 取り込みが失敗する → ブラウザのコンソール、APIログを確認
- データが登録されない → 取込履歴でジョブのステータスを確認

### 2. バックアップ・リストア機能

#### 1.1 バックアップスクリプトの検証

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# バックアップを実行
./scripts/server/backup.sh

# バックアップファイルの確認
ls -lh /opt/backups/

# 期待される結果:
# - db_backup_YYYYMMDD_HHMMSS.sql.gz が作成される
# - api_env_YYYYMMDD_HHMMSS.env が作成される
# - ファイルサイズが0でないことを確認
```

#### 1.2 リストアスクリプトの検証

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# テストデータを作成（既存データがある場合はスキップ）
# 管理画面から従業員やアイテムを追加

# バックアップを取得
./scripts/server/backup.sh
BACKUP_FILE=$(ls -t /opt/backups/db_backup_*.sql.gz | head -1)

# テストデータを削除（管理画面から）

# リストアを実行
./scripts/server/restore.sh "$BACKUP_FILE"

# 期待される結果:
# - リストアが成功する
# - 削除したデータが復元される
```

### 3. 監視・アラート機能

#### 2.1 システムヘルスチェックエンドポイント

```bash
# ラズパイ5で実行
curl http://localhost:8080/api/system/health

# 期待される結果:
# {
#   "status": "ok",
#   "timestamp": "2025-01-XXT...",
#   "checks": {
#     "database": { "status": "ok" },
#     "memory": { "status": "ok" }
#   },
#   "memory": { ... },
#   "uptime": ...
# }
```

#### 2.2 メトリクスエンドポイント

```bash
# ラズパイ5で実行
curl http://localhost:8080/api/system/metrics

# 期待される結果:
# Prometheus形式のメトリクスが返される
# - db_connections_total
# - loans_active_total
# - employees_active_total
# - items_active_total
# - process_memory_bytes
# - process_uptime_seconds
```

#### 2.3 監視スクリプトの検証

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# 監視スクリプトを実行
./scripts/server/monitor.sh

# 期待される結果:
# - すべてのチェックが成功する
# - /var/log/system-monitor.log にログが記録される

# ログの確認
tail -20 /var/log/system-monitor.log
```

#### 2.4 異常状態の検証

```bash
# ラズパイ5で実行

# APIコンテナを停止
docker compose -f infrastructure/docker/docker-compose.server.yml stop api

# 監視スクリプトを実行（エラーが検出されることを確認）
./scripts/server/monitor.sh
# 期待される結果: エラーが報告される

# APIコンテナを再起動
docker compose -f infrastructure/docker/docker-compose.server.yml start api
```

### 4. デプロイスクリプトの検証

#### 3.1 デプロイスクリプトの実行

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# 現在の状態を確認
docker compose -f infrastructure/docker/docker-compose.server.yml ps

# デプロイスクリプトを実行
./scripts/server/deploy.sh

# 期待される結果:
# - Gitリポジトリが更新される
# - 依存関係がインストールされる
# - ビルドが成功する
# - Dockerコンテナが再ビルド・再起動される
# - データベースマイグレーションが実行される
# - ヘルスチェックが成功する
```

#### 3.2 デプロイ後の動作確認

```bash
# ラズパイ5で実行

# APIヘルスチェック
curl http://localhost:8080/api/health

# 認証テスト
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin1234"}' | \
  grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

# APIリクエストテスト
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/tools/employees

# 期待される結果:
# - すべてのリクエストが成功する
# - データが正しく返される
```

### 5. CI/CDパイプラインの検証

#### 4.1 GitHub Actionsの確認

GitHubリポジトリのActionsタブで以下を確認：

- `main`ブランチへのプッシュ時にCIパイプラインが実行される
- `lint-and-test`ジョブが成功する
- `docker-build`ジョブが成功する

#### 4.2 ローカルでのCI実行（オプション）

```bash
# Macで実行（オプション）
cd /Users/tsudatakashi/RaspberryPiSystem_002

# 依存関係のインストール
pnpm install

# 共有型パッケージのビルド
cd packages/shared-types && pnpm build && cd ../..

# APIのビルド
cd apps/api && pnpm build && cd ../..

# APIのテスト（PostgreSQLが必要）
# DockerでPostgreSQLを起動してから実行
cd apps/api && pnpm test && cd ../..

# Webのビルド
cd apps/web && pnpm build && cd ../..
```

## 検証結果の記録

検証が完了したら、以下の情報を記録してください：

- 検証日時
- 検証環境（ラズパイ5/4のバージョン、OSバージョンなど）
- 検証結果（成功/失敗、エラーメッセージなど）
- 問題点と対応方法

## トラブルシューティング

### バックアップが失敗する

- バックアップディレクトリの権限を確認: `ls -ld /opt/backups`
- Dockerコンテナが起動しているか確認: `docker compose ps`

### 監視スクリプトがエラーを報告する

- APIが起動しているか確認: `curl http://localhost:8080/api/system/health`
- Dockerコンテナの状態を確認: `docker compose ps`
- ログを確認: `tail -50 /var/log/system-monitor.log`

### デプロイスクリプトが失敗する

- Gitリポジトリの状態を確認: `git status`
- ビルドエラーを確認: `cd apps/api && pnpm build`
- Dockerログを確認: `docker compose logs api`

