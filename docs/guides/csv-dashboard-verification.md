# CSVダッシュボード可視化機能の実機検証手順

最終更新: 2026-01-09

## 検証前の準備

### 1. デプロイ確認

以下のコマンドでデプロイが正常に完了していることを確認：

```bash
# APIヘルスチェック
curl -k https://100.106.158.2/api/system/health

# マイグレーション確認
ssh denkon5sd02@100.106.158.2 "docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma migrate status"

# 新APIエンドポイント確認（認証エラーが返れば正常）
curl -k https://100.106.158.2/api/csv-dashboards
```

### 2. 環境変数確認

```bash
# CSV_DASHBOARD_STORAGE_DIRが設定されていることを確認
ssh denkon5sd02@100.106.158.2 "grep CSV_DASHBOARD_STORAGE_DIR /opt/RaspberryPiSystem_002/infrastructure/docker/.env"
```

**期待される出力**: `CSV_DASHBOARD_STORAGE_DIR=/app/storage/csv-dashboards`

## 検証項目

### ✅ 検証1: CSVダッシュボードの作成

**目的**: 管理コンソールでCSVダッシュボードを作成できることを確認

**手順**:
1. 管理コンソールにログイン: `https://100.106.158.2/admin`
2. 「サイネージ」タブを開く
3. 「CSVダッシュボード」セクションで「新規作成」をクリック
4. 以下の情報を入力：
   - **名前**: テストダッシュボード
   - **Gmail件名パターン**: `点検記録.*\.csv`
   - **日付列**: `date`（またはCSVの日付列名）
   - **取り込みモード**: 「機械的追加（重複無視）」または「重複除去」
   - **表示期間**: 「当日分のみ」
   - **テンプレート**: 「テーブル形式」または「カードグリッド形式」
5. 「保存」をクリック

**期待される結果**:
- ✅ CSVダッシュボードが作成される
- ✅ 一覧に表示される
- ✅ 編集・削除が可能

### ✅ 検証2: CSVファイルの手動アップロード

**目的**: CSVファイルを手動でアップロードしてデータを取り込めることを確認

**手順**:
1. 検証1で作成したCSVダッシュボードを開く
2. 「CSVアップロード」タブを開く
3. テスト用CSVファイルを選択（日付列を含む）
4. 「アップロード」をクリック

**期待される結果**:
- ✅ CSVファイルがアップロードされる
- ✅ データが取り込まれる
- ✅ プレビューでデータが表示される

**テスト用CSV例**:
```csv
date,name,value
2026/1/8 8:13,項目A,100
2026/1/8 9:15,項目B,200
2026/1/7 10:20,項目C,300
```

### ✅ 検証3: CSVプレビュー機能

**目的**: CSVファイルの構造を解析してプレビューできることを確認

**手順**:
1. CSVダッシュボードの「CSVアップロード」タブを開く
2. CSVファイルを選択（まだアップロードしない）
3. 「プレビュー」ボタンをクリック

**期待される結果**:
- ✅ CSVの列名が検出される
- ✅ データ型が自動検出される（文字列、数値、日付）
- ✅ サンプルデータが表示される

### ✅ 検証4: 列定義の設定

**目的**: CSVの列名マッピング、列順序、データ型を設定できることを確認

**手順**:
1. CSVダッシュボードの編集画面を開く
2. 「列定義」セクションで以下を設定：
   - **内部名**: CSVの列名（例: `date`）
   - **表示名**: 画面に表示する名前（例: `日付`）
   - **データ型**: `date`、`number`、`string`、`boolean`から選択
   - **表示順序**: 数値で指定（小さい順に表示）
3. 「保存」をクリック

**期待される結果**:
- ✅ 列定義が保存される
- ✅ 表示名が反映される
- ✅ 表示順序が反映される

### ✅ 検証5: サイネージスケジュールでのCSVダッシュボード選択

**目的**: サイネージスケジュールでCSVダッシュボードを選択できることを確認

**手順**:
1. 「サイネージ」タブの「スケジュール」セクションを開く
2. 新規スケジュールを作成または既存スケジュールを編集
3. **レイアウト**: 「全体表示（FULL）」または「左右分割表示（SPLIT）」を選択
4. **コンテンツ種別**: 「CSVダッシュボード」を選択
5. **CSVダッシュボード**: 検証1で作成したダッシュボードを選択
6. 「保存」をクリック

**期待される結果**:
- ✅ CSVダッシュボードが選択肢に表示される
- ✅ スケジュールに保存される
- ✅ `layoutConfig`に`csv_dashboard`スロットが含まれる

### ✅ 検証6: サイネージでのCSVダッシュボード表示（FULLレイアウト）

**目的**: FULLレイアウトでCSVダッシュボードが表示されることを確認

**手順**:
1. 検証5で作成したスケジュールが有効な時間帯であることを確認
2. Pi3のサイネージ画面を確認
3. または、`/api/signage/content`でレスポンスを確認

**確認コマンド**:
```bash
# APIレスポンス確認
curl -k https://100.106.158.2/api/signage/content | jq '{contentType, layoutConfig, csvDashboardsById}'

# サイネージ画像確認
curl -k -H 'x-client-key: client-key-raspberrypi3-signage1' https://100.106.158.2/api/signage/current-image -o /tmp/signage-test.jpg && file /tmp/signage-test.jpg
```

**期待される結果**:
- ✅ `contentType: "FULL"`または`"SPLIT"`
- ✅ `layoutConfig.slots`に`kind: "csv_dashboard"`が含まれる
- ✅ `csvDashboardsById`にデータが含まれる
- ✅ サイネージ画像にCSVダッシュボードが表示される

### ✅ 検証7: サイネージでのCSVダッシュボード表示（SPLITレイアウト）

**目的**: SPLITレイアウトでCSVダッシュボードが表示されることを確認

**手順**:
1. スケジュールを編集し、SPLITレイアウトで左または右にCSVダッシュボードを設定
2. サイネージ画面を確認

**期待される結果**:
- ✅ 左または右のペインにCSVダッシュボードが表示される
- ✅ もう一方のペイン（PDF/工具管理）も正常に表示される

**実機検証結果**（2026-01-09）:
- ✅ **左にCSVダッシュボード、右にPDF**: 正常動作を確認
- ✅ **左にPDF、右にCSVダッシュボード**: UI修正後、正常動作を確認
  - **発見された問題**: 右スロットのドロップダウンでCSVダッシュボードの選択肢が表示されない
  - **修正内容**: `SignageSchedulesPage.tsx`の右スロットUIに`csv_dashboard`オプションとCSVダッシュボード選択UIを追加

### ✅ 検証8: Gmail経由のCSV取得（スケジュール実行）

**目的**: GmailスケジュールでCSVファイルが自動取得されることを確認

**前提条件**:
- Gmail OAuth認証が完了している
- CSVインポートスケジュールに`csvDashboards`ターゲットが追加されている

**手順**:
1. 「CSVインポート」タブを開く
2. 既存のスケジュールを編集、または新規作成
3. **ターゲット**: 「CSVダッシュボード」を選択
4. **CSVダッシュボード**: 検証1で作成したダッシュボードを選択
5. **Gmail件名パターン**: スケジュール側の設定は不要（ダッシュボードの`gmailSubjectPattern`を使用）
6. 「保存」をクリック
7. スケジュールを手動実行（またはスケジュール実行を待つ）

**補足**:
- `MeasuringInstrumentLoans`は`seed.ts`で事前作成されているため、対象IDを選ぶだけで取り込み対象にできる

**確認コマンド**:
```bash
# 取り込み履歴確認
ssh denkon5sd02@100.106.158.2 "docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma studio --browser none" &
# ブラウザで http://localhost:5555 を開き、CsvDashboardIngestRun テーブルを確認
```

**期待される結果**:
- ✅ GmailからCSVファイルが取得される
- ✅ CSVファイルが`CSV_DASHBOARD_STORAGE_DIR`に保存される
- ✅ データが`CsvDashboardRow`テーブルに取り込まれる
- ✅ `CsvDashboardIngestRun`テーブルに履歴が記録される

### ✅ 検証9: 表示期間フィルタ（完了）

**実施日時**: 2026-01-09

**目的**: 表示期間フィルタが正しく動作することを確認

**手順**:
1. 管理コンソールで「CSVダッシュボード」タブを開く
2. CSVダッシュボードの編集画面を開く
3. **表示期間（日数）**: `1`（当日分のみ）に設定して保存
4. 当日のデータと前日のデータを含むCSVをアップロード
5. サイネージ画面を確認

**期待される結果**:
- ✅ 当日分のデータのみが表示される
- ✅ 前日のデータは表示されない

**確認コマンド**:
```bash
# APIレスポンスでrowsを確認（当日分のみが含まれることを確認）
curl -k https://100.106.158.2/api/signage/content | jq '.csvDashboardsById."<dashboard-id>".rows | map({date: .date, name: .name})'

# データベースで日付フィルタリングを確認
ssh denkon5sd02@100.106.158.2 "docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api psql postgresql://postgres:postgres@db:5432/borrow_return -c \"SELECT COUNT(*) as total_rows, COUNT(CASE WHEN \\\"occurredAt\\\" >= '2026-01-08 15:00:00'::timestamp AND \\\"occurredAt\\\" <= '2026-01-09 14:59:59'::timestamp THEN 1 END) as today_rows, COUNT(CASE WHEN \\\"occurredAt\\\" < '2026-01-08 15:00:00'::timestamp THEN 1 END) as yesterday_rows FROM \\\"CsvDashboardRow\\\" WHERE \\\"csvDashboardId\\\" = '<dashboard-id>';\""
```

**検証結果**（2026-01-09）:
- ✅ **データベースのデータ**: 全10行（当日分8行、前日分2行）
- ✅ **サイネージAPIのレスポンス**: `rows`の長さが8行（当日分のみ）
- ✅ **表示期間フィルタの動作**: 当日分（`2026/1/9`）のみが表示され、前日分（`2026/1/8`）は除外されている
- ✅ **日付計算の正確性**: JSTの「今日の0:00」から「今日の23:59:59」をUTCに正しく変換（UTC `2026-01-08 15:00:00` 〜 `2026-01-09 14:59:59`）

**検証で使用したテストデータ**:
```csv
date,name,value
2026/1/9 8:13,項目A（当日）,100
2026/1/9 9:15,項目B（当日）,200
2026/1/8 10:20,項目C（前日）,300
2026/1/8 14:30,項目D（前日）,400
```

**検証結果の詳細**:
- サイネージAPIの`rows`に含まれているデータはすべて`2026/1/9`の日付（当日分）
- 前日分のデータ（`2026/1/8`）は含まれていない
- 表示期間フィルタ（`displayPeriodDays: 1`）が正しく動作していることを確認

### ✅ 検証10: データ保持期間の自動削除

**目的**: データ保持期間に基づいて古いデータが自動削除されることを確認

**手順**:
1. データ保持期間の設定を確認（前年分保持、2年前削除、当年前月削除）
2. クリーンアップジョブが実行されるのを待つ（または手動実行）

**確認コマンド**:
```bash
# クリーンアップログ確認
ssh denkon5sd02@100.106.158.2 "docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml logs api | grep -i 'csv.*cleanup\|csv.*retention' | tail -20"
```

**期待される結果**:
- ✅ 2年前のデータが削除される
- ✅ 当年前月のデータが削除される
- ✅ 前年分のデータは保持される

## トラブルシューティング

### 問題1: CSVダッシュボードが表示されない

**確認事項**:
- スケジュールが有効な時間帯であるか
- `layoutConfig`に`csv_dashboard`スロットが含まれているか
- `csvDashboardsById`にデータが含まれているか

**確認コマンド**:
```bash
curl -k https://100.106.158.2/api/signage/content | jq '{contentType, layoutConfig, csvDashboardsById}'
```

### 問題2: CSVファイルがアップロードできない

**確認事項**:
- CSVファイルの形式が正しいか（UTF-8、カンマ区切り）
- 日付列が正しく指定されているか
- APIログを確認

**確認コマンド**:
```bash
ssh denkon5sd02@100.106.158.2 "docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml logs api | tail -50"
```

### 問題3: GmailからCSVが取得できない

**確認事項**:
- Gmail OAuth認証が完了しているか
- Gmail件名パターンが正しいか
- CSVインポートスケジュールに`csvDashboards`ターゲットが追加されているか

**確認コマンド**:
```bash
# Gmail設定確認
curl -k -H "Authorization: Bearer <JWT_TOKEN>" https://100.106.158.2/api/gmail/config

# CSVインポートスケジュール確認
curl -k -H "Authorization: Bearer <JWT_TOKEN>" https://100.106.158.2/api/imports/schedules
```

## 関連ドキュメント

- [サイネージモジュール仕様](../modules/signage/README.md)
- [Gmail連携セットアップガイド](./gmail-setup-guide.md)
- [CSVインポート・エクスポートガイド](./csv-import-export.md)
- [デプロイメントガイド](./deployment.md)
- [KB-155: CSVダッシュボード可視化機能実装完了](../knowledge-base/infrastructure/signage.md#kb-155-csvダッシュボード可視化機能実装完了)
