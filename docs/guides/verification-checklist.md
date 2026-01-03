# 検証チェックリスト

最終更新: 2025-12-31

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
employeeCode,lastName,firstName,nfcTagUid,department,contact,status
0001,山田,太郎,04C362E1330289,製造部,090-1234-5678,ACTIVE
0002,佐藤,花子,04B34411340289,品質管理部,090-2345-6789,ACTIVE
```

**注意**: `displayName`（氏名）は`lastName + firstName`で自動生成されます。CSVには含めません。

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

### 6. CSVフォーマット仕様実装の検証（2025-12-31）

**検証概要**: 新しく実装されたCSVフォーマット仕様（従業員の`lastName`/`firstName`、計測機器の`department`、吊具の`usableYears`）の実機検証

**関連ドキュメント**: [CSVインポート・エクスポート仕様](./csv-import-export.md)

#### 6.1 データベーススキーマ確認（自動検証済み）

- [x] Prismaマイグレーションが正常に適用されているか確認
- [x] `Employee`テーブルに`lastName`と`firstName`フィールドが追加されているか
- [x] `MeasuringInstrument`テーブルに`department`フィールドが追加されているか
- [x] `RiggingGear`テーブルに`usableYears`フィールドが追加されているか

**検証結果（2025-12-31）**: ✅ すべて正常

#### 6.2 従業員CSVインポート（新フォーマット）

**検証手順**:

1. **CSVファイルの準備**
   - 以下のCSVファイルを作成（UTF-8エンコーディング）:
   ```csv
   employeeCode,lastName,firstName,department,nfcTagUid,status
   9999,山田,太郎,製造部,04C362E1330289,ACTIVE
   9998,佐藤,花子,品質管理部,,ACTIVE
   9997,鈴木,一郎,製造部,04DE8366BC2A81,INACTIVE
   ```

2. **管理画面でCSVインポート**
   - 管理画面にログイン: `https://100.106.158.2/admin`
   - 「マスターデータインポート」ページにアクセス
   - CSVファイルをアップロード
   - インポート結果を確認

**確認ポイント**:
- [x] インポートが成功するか
- [x] `displayName`が「山田 太郎」「佐藤 花子」のように自動生成されているか
- [x] 管理画面の従業員一覧で`displayName`が正しく表示されるか
- [x] 編集画面で`lastName`と`firstName`が個別に表示・編集できるか

**検証日時**: 2025-12-31
**検証結果**: ✅ 成功

#### 6.3 計測機器CSVインポート（新フィールド）

**検証手順**:

1. **CSVファイルの準備**
   - 以下のCSVファイルを作成（UTF-8エンコーディング、BOMなし）:
   ```csv
   managementNumber,name,storageLocation,department,measurementRange,calibrationExpiryDate,status,rfidTagUid
   MI-TEST-001,テスト計測機器1,工具庫A,品質管理部,0-100mm,2025-12-31,AVAILABLE,04TEST001001
   MI-TEST-002,テスト計測機器2,工具庫B,製造部,0-200mm,2026-06-30,AVAILABLE,04TEST002002
   ```
   - ファイル名は `measuring-instruments.csv` として保存
   - 注意: `rfidTagUid`は既存データと重複しない値を使用してください

2. **管理画面でCSVインポート（UI経由）**
   - 管理画面にログイン: `https://100.106.158.2/admin`
   - 「一括登録」タブにアクセス: `https://100.106.158.2/admin/import`
   - 「計測機器CSV (measuring-instruments.csv)」セクションでCSVファイルを選択
   - 選択したファイル名が表示されることを確認
   - 「既存データをクリアしてから取り込み（計測機器CSVのみ）」にチェックを入れるか選択
   - 「取り込み開始」ボタンをクリック
   - インポート結果を確認

**確認ポイント**:
- [x] インポートが成功するか
- [x] `department`フィールドが正しく保存されているか
- [x] 管理画面の計測機器一覧（`/admin/tools/measuring-instruments`）で`department`が表示されるか
- [x] 編集画面で`department`が表示・編集できるか
- [x] UIDの手動編集が反映されるか（キーボードで入力した値が保存後に表示されるか）

**検証日時**: 2025-01-XX
**検証結果**: ✅ 成功

**備考**: 
- UID編集時のバグ（複数タグ問題）を修正し、手動編集が正常に反映されることを確認
- 詳細は [knowledge-base/api.md#kb-118](./knowledge-base/api.md#kb-118-計測機器uid編集時の複数タグ問題の修正) / [knowledge-base/frontend.md#kb-119](./knowledge-base/frontend.md#kb-119-計測機器uid編集時の手動編集フラグ管理) を参照

#### 6.4 吊具CSVインポート（新フィールド）

**検証手順**:

1. **CSVファイルの準備**
   - 以下のCSVファイルを作成（UTF-8エンコーディング）:
   ```csv
   managementNumber,name,storageLocation,department,startedAt,usableYears,maxLoadTon,lengthMm,widthMm,thicknessMm,status,notes,rfidTagUid
   RG-TEST-001,テスト吊具1,工具庫A,製造部,2020-01-01,10,10,5000,100,20,AVAILABLE,テスト用,04C362E1330289
   RG-TEST-002,テスト吊具2,工具庫B,品質管理部,2021-06-01,5,5,3000,80,15,AVAILABLE,,04DE8366BC2A81
   ```

2. **管理画面でCSVインポート（UI経由）**
   - 管理画面にログイン: `https://100.106.158.2/admin`
   - 「一括登録」タブにアクセス: `https://100.106.158.2/admin/import`
   - 「吊具CSV (rigging-gears.csv)」セクションでCSVファイルを選択
   - 選択したファイル名が表示されることを確認
   - 「既存データをクリアしてから取り込み（吊具CSVのみ）」にチェックを入れるか選択
   - 「取り込み開始」ボタンをクリック
   - インポート結果を確認

**確認ポイント**:
- [x] インポートが成功するか
- [x] `usableYears`フィールドが正しく保存されているか
- [x] 管理画面の吊具一覧で`usableYears`が表示されるか
- [x] 編集画面で`usableYears`が表示・編集できるか

**検証日時**: 2025-01-XX
**検証結果**: ✅ 成功

**備考**: 
- CSVインポートが正常に動作し、`usableYears`フィールドが正しく保存・表示されることを確認
- レイアウト改善により、一覧表と編集フォームが重ならず、使いやすくなったことを確認

#### 6.5 バリデーションエラーの確認

**6.5.1 必須項目エラー**

**検証手順**:
1. `lastName`が空のCSVを作成:
   ```csv
   employeeCode,lastName,firstName,department
   9996,,太郎,製造部
   ```
2. アップロードしてエラーメッセージを確認

**確認ポイント**:
- [ ] 「苗字は必須です」というエラーメッセージが表示されるか

**検証日時**: _______________
**検証結果**: ☐ 成功 ☐ 失敗（エラー内容: _______________）

**6.5.2 フォーマットエラー**

**検証手順**:
1. `employeeCode`が数字4桁以外のCSVを作成:
   ```csv
   employeeCode,lastName,firstName
   ABC,山田,太郎
   ```
2. アップロードしてエラーメッセージを確認

**確認ポイント**:
- [ ] 「社員コードは数字4桁である必要があります」というエラーメッセージが表示されるか

**検証日時**: _______________
**検証結果**: ☐ 成功 ☐ 失敗（エラー内容: _______________）

#### 6.6 管理コンソールUI確認

**6.6.1 従業員管理画面（`/admin/tools/employees`）**

**確認ポイント**:
- [x] 一覧表示で`displayName`が正しく表示されるか
- [x] 「新規作成」ボタンをクリックしてフォームを開く
- [x] `lastName`と`firstName`の入力フィールドが表示されるか
- [x] `displayName`フィールドが表示されないか（自動生成のため）
- [x] 既存従業員を編集して`lastName`と`firstName`が個別に表示されるか
- [x] 保存時に`displayName`が自動生成されるか

**検証日時**: 2025-12-31
**検証結果**: ✅ 成功

**6.6.2 計測機器管理画面（`/admin/tools/measuring-instruments`）**

**確認ポイント**:
- [x] 一覧表示で`department`列が表示されるか（データがある場合）
- [x] 「新規作成」ボタンをクリックしてフォームを開く
- [x] `department`選択フィールド（ドロップダウン）が表示されるか
- [x] 部署候補が従業員マスターから取得されているか（`GET /api/tools/departments`）
- [x] `department`が正しく保存・更新されるか
- [x] 既存の計測機器を編集して`department`を変更できるか

**検証手順**:
1. 管理画面にログイン: `https://100.106.158.2/admin`
2. 「計測機器」タブにアクセス: `https://100.106.158.2/admin/tools/measuring-instruments`
3. 一覧表に「部署」列が表示されることを確認
4. 「新規作成」または既存の計測機器の「編集」をクリック
5. フォームに「部署」選択フィールドが表示されることを確認
6. ドロップダウンに従業員マスターの部署が候補として表示されることを確認
7. 部署を選択して保存
8. 一覧表で保存した部署が表示されることを確認

**検証日時**: 2026-01-03
**検証結果**: ✅ 成功

**6.6.3 吊具管理画面（`/admin/tools/rigging-gears`）**

**確認ポイント**:
- [x] 一覧表示で`usableYears`列が表示されるか（データがある場合）
- [x] 「新規作成」ボタンをクリックしてフォームを開く
- [x] `usableYears`入力フィールドが表示されるか
- [x] `usableYears`が正しく保存・更新されるか
- [x] 一覧表と編集フォームが重ならず、使いやすいか

**検証日時**: 2025-01-XX
**検証結果**: ✅ 成功

**備考**: 
- `usableYears`フィールドが正しく表示・編集できることを確認
- レイアウト改善により、一覧表と編集フォームが別のCardとして分離され、縦配置になったことを確認
- 編集フォーム内のフィールドが2列のグリッドレイアウトで表示されることを確認

#### 6.7 既存データとの互換性確認

**6.7.1 既存従業員データの確認**

**検証手順**:
1. 管理画面の従業員一覧を確認
2. 既存の従業員（`lastName`/`firstName`が`null`）が正常に表示されるか確認
3. 既存従業員を編集して`lastName`と`firstName`を追加できるか確認

**確認ポイント**:
- [ ] `lastName`/`firstName`が`null`でも`displayName`が表示されるか
- [ ] 既存データを編集して`lastName`/`firstName`を追加できるか
- [ ] 追加後に`displayName`が自動更新されるか

**検証日時**: _______________
**検証結果**: ☐ 成功 ☐ 失敗（エラー内容: _______________）

#### 6.8 CSVインポートスケジュール機能

**6.8.1 スケジュール作成（新フォーマット）**

**検証手順**:
1. CSVインポートスケジュールページ（`/admin/csv-import-schedule`）にアクセス
2. 「新規作成」ボタンをクリック
3. スケジュール名、cron式、プロバイダーを設定
4. 「ターゲットを追加」ボタンで複数のターゲットを追加:
   - データタイプ: `employees`
   - ソース: （Gmailの場合）件名パターンを選択
5. 保存

**確認ポイント**:
- [ ] スケジュールが正しく保存されるか
- [ ] 一覧表示でスケジュールが表示されるか
- [ ] スケジュールの表示が人間可読形式（例: "毎週月曜日の午前4時"）になっているか

**検証日時**: _______________
**検証結果**: ☐ 成功 ☐ 失敗（エラー内容: _______________）

#### 6.8.2 Gmail経由CSV取り込み（スケジュール実行）の実機検証

**検証概要**: Gmail経由でのCSVファイル自動取り込み（スケジュール実行）機能の実機検証

**前提条件**:
- Gmail OAuth認証が完了していること（`docs/guides/gmail-setup-guide.md`参照）
- Gmail設定が管理画面で正しく設定されていること（`clientId`, `clientSecret`, `refreshToken`）
- PowerAutomateなどから、指定した件名パターンに合致するCSVファイルが添付されたメールがGmailに送信されていること

**検証手順**:
1. 管理画面にログイン: `https://100.106.158.2/admin`
2. 「一括登録」タブにアクセス: `https://100.106.158.2/admin/import`
3. 「CSVインポートスケジュール」タブにアクセス: `https://100.106.158.2/admin/csv-import-schedule`
4. 「新規作成」ボタンをクリック
5. スケジュール名、cron式（例: 1分ごとに実行する`* * * * *`）、プロバイダーを`Gmail`に設定
6. 「ターゲットを追加」ボタンでターゲットを追加:
   - データタイプ: `measuring-instruments` (または`employees`, `items`, `rigging-gears`)
   - ソース: Gmailの件名パターン（例: `計測機器CSV`）
7. 「既存データをクリアしてから取り込み」にチェックを入れるか選択
8. 保存
9. スケジュール実行を待つ（cron式による）
10. インポート履歴（`/admin/import-history`）で、Gmailからのインポートジョブが`COMPLETED`になっていることを確認
11. インポートされたデータが管理画面の各一覧（例: 計測機器一覧）に正しく反映されていることを確認

**確認ポイント**:
- [x] スケジュールが正しく保存されるか
- [x] スケジュール実行時にGmailからCSVファイルが自動的に取得されるか
- [x] インポート履歴にジョブが記録され、ステータスが`COMPLETED`になるか
- [x] インポートされたデータが管理画面に正しく反映されるか
- [x] 既存データクリアオプションが正しく機能するか
- [x] エラー発生時に履歴に`FAILED`と記録されるか

**手動実行での検証結果（2026-01-03）**:
- ✅ 手動実行（`POST /api/imports/schedule/verify-run-001/run`）でGmailからのCSV取得が正常に動作することを確認
- ✅ Gmail検索クエリ（`subject:"吊具CSVインポート" is:unread`）が正常に動作し、メッセージを検出
- ✅ 添付ファイル（`rigging_tools.csv`, 363バイト）のダウンロードが成功
- ✅ メールのアーカイブ処理が正常に動作（処理済みメールとしてマーク）
- ✅ CSVインポート処理が完了（`riggingGears: processed=2, created=2, updated=0`）
- ✅ データベースに2件の吊具データが正しく保存されていることを確認
- ✅ ログにエラーがなく、すべての処理が正常に完了

**検証日時**: 2026-01-03
**検証結果**: ✅ 成功（手動実行での検証完了。スケジュール実行はPowerAutomate設定後に実施予定）

**備考**: 
- 手動実行ではインポート履歴（`ImportJob`テーブル）にレコードが作成されない（スケジュール実行時のみ作成される仕様）
- PowerAutomateからの自動送信設定後、スケジュール実行でのE2E検証を実施予定

#### 6.9 キオスクサポート機能（Slack通知）

**検証概要**: キオスクUIから管理者への問い合わせ機能（Slack通知）の実機検証

**前提条件**:
- Slackワークスペースが作成済みであること
- Slack Incoming Webhookが作成され、Webhook URLが取得済みであること
- Pi5側の環境変数に`SLACK_KIOSK_SUPPORT_WEBHOOK_URL`が設定されていること

**検証手順**:
1. 管理画面にログイン: `https://100.106.158.2/admin`
2. Pi5側の環境変数を確認:
   ```bash
   ssh denkon5sd02@100.106.158.2
   cd /opt/RaspberryPiSystem_002/infrastructure/docker
   docker compose -f docker-compose.server.yml exec api env | grep SLACK_KIOSK_SUPPORT_WEBHOOK_URL
   ```
3. キオスク画面にアクセス: `https://100.106.158.2/kiosk`
4. 画面右下の「お問い合わせ」ボタンをクリック
5. モーダルが表示されることを確認
6. 「よくある困りごと」から1つ選択（例: 「タグが読み取れない」）
7. 「詳細」欄に任意のメッセージを入力（任意）
8. 「送信」ボタンをクリック
9. モーダルが閉じ、送信成功が確認できることを確認
10. Slackチャンネルで通知が受信されることを確認
11. 管理画面の「クライアント」タブ（`/admin/clients`）で、サポートログが記録されていることを確認

**確認ポイント**:
- [x] 「お問い合わせ」ボタンが表示されるか（ヘッダーのナビゲーションメニューに移動）
- [x] モーダルが正しく表示されるか
- [x] 「よくある困りごと」の選択が機能するか
- [x] 詳細メッセージの入力が機能するか
- [x] 送信後、モーダルが閉じるか
- [x] Slack通知が正しく送信されるか（端末名、場所、画面、メッセージが含まれるか）
- [x] クライアントログに`[SUPPORT]`プレフィックス付きで記録されるか
- [x] レート制限が機能するか（1分に3件まで）
- [x] `x-client-key`なしで401エラーが返るか

**検証日時**: 2026-01-03（基本機能）、2026-01-03（レート制限・認証検証）
**検証結果**: ✅ 成功（全項目完了）

**検証詳細**:
- **UI確認**: ヘッダーのナビゲーションメニューに「お問い合わせ」ボタンが表示され、クリックでモーダルが開くことを確認
- **メッセージ送信**: 「よくある困りごと」から「タグが読み取れない」を選択し、送信を実行
- **Slack通知**: `#general`チャンネルに通知が正常に届き、以下の情報が含まれることを確認:
  - クライアントID: `d0da1434-b83b-4643-b213-5c1945b91406`
  - 端末名: `raspberrypi`
  - 場所: `不明`
  - 画面: `/kiosk/photo`
  - メッセージ: `タグが読み取れない`
  - Request ID: `req-j`
- **ClientLog記録**: データベースに以下のログが記録されていることを確認:
  - clientId: `d0da1434-b83b-4643-b213-5c1945b91406`
  - level: `INFO`
  - message: `[SUPPORT] タグが読み取れない`
  - kind: `kiosk-support`
  - page: `/kiosk/photo`
  - userMessage: `タグが読み取れない`
- **APIログ**: エラーなし、正常に処理されたことを確認（ステータスコード200、レスポンス時間77.77ms）
- **SlackWebhookログ**: `[SlackWebhook] Notification sent successfully`が記録されていることを確認
- **レート制限検証**: 1分間に4件連続送信し、1-3件目はHTTP 200 OK、4件目はHTTP 429 Too Many Requests（`RATE_LIMIT_EXCEEDED`）が返ることを確認
- **`x-client-key`なし検証**: `x-client-key`ヘッダーなしでリクエストを送信し、HTTP 401 Unauthorized（`CLIENT_KEY_REQUIRED`）が返ることを確認

**備考**: 
- Slack Webhook URLが設定されていない場合、通知はスキップされるが、ログは正常に保存される
- レート制限は端末単位（`x-client-key`）で適用される
- 送信失敗時もユーザー体験を優先し、APIは200を返す（エラーはログに記録）

## 検証の優先順位（CSVフォーマット仕様実装）

1. **最優先**: 6.2（従業員CSVインポート）、6.3（計測機器CSVインポート）、6.4（吊具CSVインポート）
2. **次**: 6.6（管理コンソールUI確認）
3. **最後**: 6.5（バリデーションエラー）、6.7（既存データ互換性）、6.8（スケジュール機能）

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

