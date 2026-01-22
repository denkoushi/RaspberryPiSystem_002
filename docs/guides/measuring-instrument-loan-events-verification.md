# 計測機器持出返却イベント機能 実機検証メニュー

最終更新: 2026-01-22

## 概要

計測機器持出返却のイベント履歴機能とGmail全件取り込み機能の実機検証手順です。

## 検証環境

- **Raspberry Pi 5**: サーバー（API/DB/Web UI）
- **Gmail**: PowerAutomate経由でCSV添付メールが送信される

## 実装機能の概要

1. **Gmail未読全件処理**: 未読メールを全件取得し、成功後に既読化→ゴミ箱移動
2. **イベントテーブル投影**: CSV行を`MeasuringInstrumentLoanEvent`テーブルに正規化して保存（冪等化）
3. **サイネージ表示**: JST「今日」の持ち出しのみ表示、返却は非表示
4. **年次削除ジョブ**: 前々年のイベントを年1回（1月中）で削除

## 検証項目

### 1. Gmail未読全件処理の検証

**目的**: 複数の未読メールが存在する場合、すべて処理されることを確認

**前提条件**:
- Gmailに「計測機器持出状況」件名の未読メールが複数件存在する

**検証手順**:

1. **未読メールの確認**
   ```bash
   # Gmailで「計測機器持出状況」件名の未読メール数を確認
   # 例: 3件の未読メールがある状態
   ```

2. **CSVインポートスケジュールを手動実行**
   - 管理コンソール `/admin/imports/schedule` にアクセス
   - `MeasuringInstrumentLoans` のスケジュールを選択
   - 「実行」ボタンをクリック

3. **処理結果の確認**
   ```bash
   # APIログで複数メールの処理を確認
   ssh denkon5sd02@100.106.158.2 "docker logs docker-api-1 --tail 100 | grep -i 'measuring\|gmail\|message'"
   ```
   - 期待されるログ:
     - `[CsvDashboardImportService] Processing X messages`
     - `[GmailApiClient] Message marked as read`
     - `[GmailApiClient] Message trashed`

4. **Gmailの状態確認**
   - Gmailで該当メールが既読化され、ゴミ箱に移動されていることを確認
   - 未読メールが0件になっていることを確認

**期待される結果**:
- ✅ 複数の未読メールがすべて処理される
- ✅ 処理成功後にメールが既読化・ゴミ箱移動される
- ✅ エラーが発生しない

---

### 2. イベントテーブルへの投影確認

**目的**: CSV取り込み後、`MeasuringInstrumentLoanEvent`テーブルにデータが正しく保存されることを確認

**検証手順**:

1. **CSVインポート実行**
   - 管理コンソール `/admin/imports/schedule` で手動実行

2. **イベントテーブルの確認**
   ```bash
   ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml exec db psql -U postgres -d raspberry_pi_system -c \"SELECT COUNT(*) as total_events, action, COUNT(DISTINCT \"managementNumber\") as unique_items FROM \"MeasuringInstrumentLoanEvent\" GROUP BY action ORDER BY action;\""
   ```
   - 期待される結果:
     - `持ち出し` と `返却` の両方のイベントが存在する
     - 各 `managementNumber` ごとに複数のイベントが存在する可能性がある

3. **イベント詳細の確認**
   ```bash
   ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml exec db psql -U postgres -d raspberry_pi_system -c \"SELECT \"managementNumber\", \"eventAt\", action, \"sourceMessageSubject\" FROM \"MeasuringInstrumentLoanEvent\" ORDER BY \"eventAt\" DESC LIMIT 10;\""
   ```
   - 期待される結果:
     - `eventAt` がUTC時刻として保存されている（`Z`付き）
     - `sourceMessageSubject` にGmail件名が記録されている
     - `raw` フィールドにCSV行の原本が保存されている

4. **冪等性の確認（再実行）**
   - 同じCSVファイルを含むメールを再度送信（または手動実行を2回実行）
   - イベントテーブルの件数が増えないことを確認（`skipDuplicates: true`により重複がスキップされる）

**期待される結果**:
- ✅ CSV取り込み後にイベントテーブルにデータが保存される
- ✅ `managementNumber`, `eventAt`, `action` が正しく抽出されている
- ✅ 再実行時に重複がスキップされる（冪等性）

---

### 3. サイネージ表示の検証（JST今日・持ち出しのみ・返却非表示）

**目的**: サイネージでJST「今日」の持ち出しのみが表示され、返却は非表示になることを確認

**前提条件**:
- CSVに「今日」の持ち出しイベントと返却イベントが含まれている

**検証手順**:

1. **CSVインポート実行**
   - 管理コンソール `/admin/imports/schedule` で手動実行
   - CSVに以下のデータが含まれていることを確認:
     - `day`: 今日の日付（UTC `Z`付き）
     - `shiyou_henkyaku`: `持ち出し` と `返却` の両方

2. **サイネージAPIの確認**
   ```bash
   curl -s "http://100.106.158.2/api/signage/content" | jq '.csvDashboards[] | select(.id == "a1b2c3d4-e5f6-7890-abcd-ef1234567890") | .rows[] | {managementNumber, shiyou_henkyaku, day}'
   ```
   - 期待される結果:
     - `shiyou_henkyaku` が `持ち出し` の行のみが表示される
     - `返却` の行は表示されない
     - `day` がJST「今日」の範囲内のイベントのみが表示される

3. **返却済みアイテムの非表示確認**
   ```bash
   # イベントテーブルで「今日」の持ち出しと返却を確認
   ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml exec db psql -U postgres -d raspberry_pi_system -c \"SELECT \"managementNumber\", \"eventAt\", action FROM \"MeasuringInstrumentLoanEvent\" WHERE \"eventAt\" >= CURRENT_DATE - INTERVAL '1 day' ORDER BY \"eventAt\" DESC;\""
   ```
   - 期待される結果:
     - 同じ `managementNumber` で「持ち出し」→「返却」の順にイベントがある場合、サイネージには表示されない
     - 「持ち出し」のみ、または「返却」より後の「持ち出し」がある場合のみ表示される

4. **サイネージ画面での確認**
   - サイネージ画面（`/signage`）にアクセス
   - `MeasuringInstrumentLoans` のデータが表示されることを確認
   - 返却済みアイテムが非表示になっていることを確認

**期待される結果**:
- ✅ JST「今日」の持ち出しのみが表示される
- ✅ 返却済みアイテムは非表示になる
- ✅ サイネージ画面で正しく表示される

---

### 4. 10分間隔での自動反映確認

**目的**: スケジュール実行により、10分間隔で自動的にCSVが取り込まれることを確認

**前提条件**:
- CSVインポートスケジュールが10分間隔で設定されている

**検証手順**:

1. **スケジュール設定の確認**
   - 管理コンソール `/admin/imports/schedule` で `MeasuringInstrumentLoans` のスケジュールを確認
   - 実行間隔が10分に設定されていることを確認

2. **Gmailに新しい未読メールを送信**
   - PowerAutomate経由で「計測機器持出状況」件名のCSV添付メールを送信

3. **10分後の自動実行確認**
   ```bash
   # APIログでスケジュール実行を確認
   ssh denkon5sd02@100.106.158.2 "docker logs docker-api-1 --tail 200 | grep -i 'csv.*import\|scheduler\|measuring'"
   ```
   - 期待されるログ:
     - `[CsvImportScheduler] Executing schedule`
     - `[CsvDashboardImportService] Processing X messages`

4. **イベントテーブルの更新確認**
   ```bash
   # 最新のイベントが追加されていることを確認
   ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml exec db psql -U postgres -d raspberry_pi_system -c \"SELECT MAX(\"createdAt\") as latest_event FROM \"MeasuringInstrumentLoanEvent\";\""
   ```

**期待される結果**:
- ✅ 10分間隔で自動的にCSVが取り込まれる
- ✅ 新しいイベントがイベントテーブルに追加される
- ✅ サイネージ表示が更新される（最大10分遅延）

---

### 5. 年次削除ジョブの確認（1月中のみ動作）

**目的**: 前々年のイベントが年1回（1月中）で削除されることを確認

**前提条件**:
- 現在が1月であること（またはテスト用にスケジュールを一時的に変更）

**検証手順**:

1. **テスト用データの準備**
   ```bash
   # 前々年のイベントを手動で作成（テスト用）
   ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml exec db psql -U postgres -d raspberry_pi_system -c \"INSERT INTO \"MeasuringInstrumentLoanEvent\" (id, \"managementNumber\", \"eventAt\", action, raw, \"createdAt\") VALUES (gen_random_uuid(), 'TEST-001', '2024-01-15T00:00:00Z', '持ち出し', '{}', NOW());\""
   ```

2. **スケジュール設定の確認**
   ```bash
   # スケジューラーのログで年次削除ジョブの登録を確認
   ssh denkon5sd02@100.106.158.2 "docker logs docker-api-1 --tail 100 | grep -i 'measuring.*retention\|loan.*retention'"
   ```
   - 期待されるログ:
     - `[CsvImportScheduler] Measuring instrument loan retention job registered`
     - `schedule: '0 30 2 1 *'` （1月の2:30に実行）

3. **手動実行（テスト用）**
   ```bash
   # 年次削除ジョブを手動実行（テスト用）
   # 注意: 本番環境では1月中のみ自動実行される
   ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml exec api node -e \"const { MeasuringInstrumentLoanRetentionService } = require('./dist/services/measuring-instruments/measuring-instrument-loan-retention.service.js'); const service = new MeasuringInstrumentLoanRetentionService(); service.cleanupTwoYearsAgo().then(r => console.log(JSON.stringify(r))).catch(e => console.error(e));\""
   ```

4. **削除結果の確認**
   ```bash
   # 前々年のイベントが削除されていることを確認
   ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml exec db psql -U postgres -d raspberry_pi_system -c \"SELECT COUNT(*) FROM \"MeasuringInstrumentLoanEvent\" WHERE \"eventAt\" >= '2024-01-01' AND \"eventAt\" < '2025-01-01';\""
   ```

**期待される結果**:
- ✅ 年次削除ジョブが1月中のみ実行される（スケジュール: `0 30 2 1 *`）
- ✅ 前々年のイベントが削除される
- ✅ 前年と当年のイベントは保持される

---

### 6. エラーハンドリングの確認

**目的**: Gmail取得失敗時やCSV解析エラー時の動作を確認

**検証手順**:

1. **Gmailに該当メールがない場合**
   - Gmailに「計測機器持出状況」件名の未読メールがない状態で実行
   - エラーにならず、正常に完了することを確認
   - ログに `No matching Gmail message, skipping` が記録されることを確認

2. **CSV列不一致の場合**
   - CSVの列名が管理コンソールの列定義と一致しないCSVを送信
   - 400 Bad Requestエラーが返されることを確認
   - エラーメッセージに「列構成が一致しません」が含まれることを確認

3. **部分的な処理失敗**
   - 複数メールのうち1件が失敗した場合、他のメールは正常に処理されることを確認
   - 失敗したメールは未読のまま保持されることを確認

**期待される結果**:
- ✅ エラーが適切にハンドリングされる
- ✅ 部分的な失敗でも他の処理は継続される
- ✅ エラーメッセージが分かりやすい

---

## 検証完了チェックリスト

- [ ] Gmail未読全件処理が正常に動作する
- [ ] 処理成功後にメールが既読化・ゴミ箱移動される
- [ ] イベントテーブルにデータが正しく保存される
- [ ] サイネージでJST「今日」の持ち出しのみが表示される
- [ ] 返却済みアイテムが非表示になる
- [ ] 10分間隔で自動的にCSVが取り込まれる
- [ ] 年次削除ジョブが1月中のみ実行される（スケジュール確認）
- [ ] エラーハンドリングが適切に動作する

## トラブルシューティング

### Gmail取得が失敗する場合

- Gmail APIの認証トークンが有効か確認
- Gmail件名パターンが正しく設定されているか確認
- 未読メールが存在するか確認

### イベントテーブルにデータが保存されない場合

- CSVの列名が管理コンソールの列定義と一致しているか確認
- `managementNumber`, `day`, `shiyou_henkyaku` 列が存在するか確認
- APIログでエラーが発生していないか確認

### サイネージに表示されない場合

- イベントテーブルにデータが存在するか確認
- `eventAt` がJST「今日」の範囲内か確認
- 返却済みアイテムでないか確認（返却イベントが存在する場合は非表示）

## 関連ドキュメント

- [CSVインポート・エクスポート仕様](../guides/csv-import-export.md)
- [計測機器持出返却: イベント履歴＋Gmail全件取り込み ExecPlan](../../.cursor/plans/measuring-instrument-events-retention_02349d3d.plan.md)
- [生産スケジュールキオスクページ実装 ExecPlan](../plans/production-schedule-kiosk-execplan.md)
