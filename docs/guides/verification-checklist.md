# 検証チェックリスト

最終更新: 2025-12-27

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
0001,山田太郎,04C362E1330289,製造部,090-1234-5678,ACTIVE
0002,佐藤花子,04B34411340289,品質管理部,090-2345-6789,ACTIVE
```

アイテムCSV (`items.csv`):
```csv
itemCode,name,nfcTagUid,category,storageLocation,status,notes
TO0001,ドライバーセット,04DE8366BC2A81,工具,工具庫A,AVAILABLE,常用工具
TO0002,メジャー,04C393C1330289,測定器具,工具庫B,AVAILABLE,
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

### 4. デプロイプロセス改善機能の検証（未実施）

**実装状況**: ✅ 実装完了（2025-12-27）  
**実機検証状況**: ⏳ 未実施

#### 4.1 実装内容

**目的**: デプロイ失敗を防ぐため、デプロイ前の自動チェック機能とログ生成機能を実装

**実装された機能**:
1. **自動デプロイ前チェック** (`scripts/update-all-clients.sh`):
   - Pi5への接続確認（ping/SSH）
   - 既存Ansibleプロセスのkill（重複実行防止）
   - `network_mode`設定の確認
   - Pi5→Pi3/Pi4への疎通確認（ansible ping）
   - メモリ使用状況の確認（Pi3は120MB以上必須）
   - Pi3サイネージサービスの停止・無効化・マスク（KB-097準拠）

2. **構造化ログ生成**:
   - `logs/ansible-precheck-YYYYMMDD-HHMMSS.json`: デプロイ前チェック結果（JSON形式）
   - `logs/ansible-precheck-YYYYMMDD-HHMMSS.jsonl`: デプロイ前チェック結果（NDJSON形式）
   - `logs/ansible-update-YYYYMMDD-HHMMSS.log`: デプロイ実行ログ
   - `logs/ansible-update-YYYYMMDD-HHMMSS.summary.json`: デプロイ実行サマリー
   - `logs/ansible-diagnostics-YYYYMMDD-HHMMSS.json`: エラー時の診断情報

3. **エラーハンドリング強化**:
   - リトライ機能（`run_remotely`, `run_health_check_remotely`に1回リトライ）
   - エラー時の診断情報自動収集
   - 引数パース（`--skip-checks`, `--yes`, `-h/--help`）

4. **Ansibleロール改善**:
   - Git権限問題の自動修復（`roles/common/tasks/main.yml`）
   - Pi3メモリ不足の早期検出（`roles/client/tasks/main.yml`）

#### 4.2 実機検証手順

**前提条件**:
- MacからPi5へのSSH接続が確立されていること
- Pi5からPi3/Pi4へのSSH接続が確立されていること
- `network_mode`が適切に設定されていること

**検証手順**:

1. **デプロイスクリプトを実行**:
   ```bash
   # Macで実行
   cd /Users/tsudatakashi/RaspberryPiSystem_002
   export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
   ./scripts/update-all-clients.sh --yes feature/gmail-attachment-integration
   ```

2. **自動チェックの動作確認**:
   - スクリプト実行時に以下が自動実行されることを確認:
     - Pi5への接続確認
     - 既存Ansibleプロセスのkill
     - `network_mode`確認
     - ansible ping（Pi5→Pi3/Pi4）
     - メモリ確認
     - Pi3サービス停止

3. **ログファイルの生成確認**:
   ```bash
   # Macで実行
   ls -lt logs/ansible-precheck-*.json | head -1
   ls -lt logs/ansible-update-*.log | head -1
   ls -lt logs/ansible-update-*.summary.json | head -1
   ```
   - 各ログファイルが生成されていることを確認

4. **precheckログの内容確認**:
   ```bash
   # Macで実行
   cat logs/ansible-precheck-*.json | jq '.'
   ```
   - 各チェック項目の結果（`ok`, `fail`, `skip`）が記録されていることを確認
   - `network_mode`, `pi5_ping`, `pi5_ssh`, `ansible_ping`, `memory`, `pi3_service_stop`の結果を確認

5. **デプロイ成功の確認**:
   - デプロイが正常に完了することを確認
   - Pi5/Pi3/Pi4すべてが最新コミットに更新されていることを確認

**期待される結果**:
- ✅ 自動チェックが正常に動作する
- ✅ ログファイルが正しく生成される
- ✅ precheckログに各チェック項目の結果が記録される
- ✅ デプロイが1回で成功する
- ✅ エラー時は診断情報が生成される

**関連ドキュメント**:
- [デプロイメントガイド](./deployment.md)
- [デプロイ トラブルシューティング](./deployment-troubleshooting.md)
- [デプロイプロセス改善とドキュメント統合計画](../plans/デプロイプロセス改善とドキュメント統合計画_de416cb6.plan.md)

### 5. サイネージUIブラッシュアップの検証（未実施）

**実装状況**: ✅ 実装完了（2025-12-27）  
**実機検証状況**: ⏳ 未実施（2025-12-27時点）

#### 5.1 実装内容

**目的**: サイネージモニタの表示領域を最大化し、既存仕様に準拠したUI改善

**変更内容**:
- SPLITモードの左ペインを3列から2列に変更
- 左ペインのタイトルを「Items On Loan」に変更
- 各アイテムの表示を仕様に合わせて修正（アイテム名・管理番号・従業員名・日時の位置とフォントサイズ）
- 右ペインのタイトルを「Document」に変更し、ファイル名を右側に表示

#### 5.2 実機検証手順

**前提条件**:
- Pi3サイネージクライアントが正常に動作していること
- サイネージモニタが接続されていること

**検証手順**:

1. **SPLITモードでサイネージを表示**:
   - Pi3サイネージクライアントでSPLITモードを選択
   - サイネージ画面が表示されることを確認

2. **左ペインの確認**:
   - 左ペインが2列表示されることを確認
   - タイトルが「Items On Loan」であることを確認
   - 各アイテムの表示を確認:
     - アイテム名が左揃えで、フォントサイズが半分であること
     - 管理番号がアイテム名の右側に表示されること
     - 従業員名が左揃えであること
     - 日時が従業員名の右側に表示され、連続表示（空白なし）であること

3. **右ペインの確認**:
   - タイトルが「Document」であることを確認
   - ファイル名がタイトルの右側に右揃えで表示されることを確認

4. **レイアウトの確認**:
   - サイネージモニタのアスペクト比に合わせて表示されていることを確認
   - 表示領域が最大化されていることを確認

**期待される結果**:
- ✅ 左ペインが2列表示される
- ✅ タイトル・各アイテムの表示が仕様通りである
- ✅ レイアウトがサイネージモニタに最適化されている
- ✅ 表示領域が最大化されている

**関連ドキュメント**:
- [サイネージ軽量モード計画](../modules/signage/signage-lite.md)

### 6. Gmail添付ファイル連携機能の検証（未実施）

**実装状況**: ✅ 実装完了（2025-12-27）  
**実機検証状況**: ⏳ 未実施（2025-12-27時点）

#### 6.1 実装内容

**目的**: PowerAutomateからGmailにCSVファイルを添付ファイルとして送信し、Raspberry Pi 5が自動的にGmailから添付ファイルを取得してインポートする統合機能

**実装された機能**:
1. **Gmail OAuth 2.0認証**:
   - 認証URL生成（`GET /api/backup/oauth/gmail/authorize`）
   - 認証コード交換（`GET /api/backup/oauth/gmail/callback`）
   - リフレッシュトークンによる自動アクセストークン更新

2. **Gmail設定管理**:
   - Gmail設定の取得・更新（`GET /api/backup/config/gmail`, `PUT /api/backup/config/gmail`）
   - `backup.json`設定ファイルとの連携

3. **CSVインポート**:
   - GmailからCSVファイルを取得してインポート（`POST /api/imports/master/from-gmail`）
   - 件名パターンによるメール検索
   - 処理済みメールのラベル追加・既読化

4. **スケジュール実行**:
   - `backup.json`の`csvImports`設定による定期実行
   - cron形式のスケジュール設定

#### 6.2 実機検証手順

**前提条件**:
- Pi5上でシステムが正常に動作していること
- Gmail OAuth 2.0アプリが作成済みであること（`clientId`, `clientSecret`を取得済み）
- PowerAutomateからGmailへのメール送信が設定済みであること

**検証手順**:

1. **Gmail OAuth認証の設定**:
   ```bash
   # Pi5上で実行
   # 1. 認証URLを取得
   curl -X GET "http://localhost:8080/api/backup/oauth/gmail/authorize" \
     -H "Authorization: Bearer <admin-token>"
   
   # 2. ブラウザで認証URLを開き、認証コードを取得
   # 3. 認証コードを交換
   curl -X GET "http://localhost:8080/api/backup/oauth/gmail/callback?code=<auth-code>&state=<state>" \
     -H "Authorization: Bearer <admin-token>"
   
   # 4. 取得したaccessTokenとrefreshTokenをbackup.jsonに設定
   ```

2. **Gmail設定の確認**:
   ```bash
   # Pi5上で実行
   curl -X GET "http://localhost:8080/api/backup/config/gmail" \
     -H "Authorization: Bearer <admin-token>"
   ```
   - `clientId`, `subjectPattern`, `labelName`が正しく設定されていることを確認

3. **PowerAutomateからGmailへのメール送信**:
   - PowerAutomateでCSVファイルを添付してGmailに送信
   - 件名が`subjectPattern`と一致することを確認（例: `CSV Import: employees-20251227`）

4. **手動インポートの実行**:
   ```bash
   # Pi5上で実行
   curl -X POST "http://localhost:8080/api/imports/master/from-gmail" \
     -H "Authorization: Bearer <admin-token>" \
     -H "Content-Type: application/json" \
     -d '{"replaceExisting": false}'
   ```
   - インポートが成功することを確認
   - 従業員・アイテムデータが正しく登録されることを確認

5. **処理済みメールの確認**:
   - Gmailでメールに`Pi5/Processed`ラベルが追加されていることを確認
   - メールが既読になっていることを確認

6. **スケジュール実行の確認**:
   ```bash
   # Pi5上で実行
   # backup.jsonのcsvImports設定を確認
   cat /opt/RaspberryPiSystem_002/config/backup.json | jq '.csvImports'
   ```
   - スケジュール設定が正しいことを確認
   - スケジュール実行時に自動的にインポートが実行されることを確認

**期待される結果**:
- ✅ Gmail OAuth認証が正常に動作する
- ✅ Gmail設定が正しく保存・取得される
- ✅ PowerAutomateから送信されたメールの添付ファイルが取得できる
- ✅ CSVインポートが正常に実行される
- ✅ 処理済みメールにラベルが追加され、既読化される
- ✅ スケジュール実行が正常に動作する

**関連ドキュメント**:
- [Gmail添付ファイル統合ガイド](./gmail-attachment-integration.md)
- [PowerAutomate Gmail統合ガイド](./powerautomate-gmail-integration.md)

### 7. CI/CDパイプラインの検証

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

