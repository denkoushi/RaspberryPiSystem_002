# CSVインポート・エクスポート仕様

## 概要

本システムでは、以下の方法でマスターデータ（従業員・工具・計測機器・吊具・加工機）を一括インポートできます：

1. **USBメモリ経由**: 管理画面からCSVファイルをアップロード（従業員・工具・計測機器・吊具・加工機の5種類に対応）✅ **実機検証完了**
2. **Dropbox経由**: DropboxからCSVファイルをダウンロードしてインポート（手動実行）✅ **実装・検証完了**
3. **Dropbox経由（スケジュール実行）**: 設定したスケジュールに従って自動的にDropboxからCSVを取得してインポート ✅ **実装・検証完了**
4. **Gmail経由（スケジュール実行）**: 設定したスケジュールに従って自動的にGmailからCSVを取得してインポート ✅ **実装完了（2025-12-29）** ⚠️ **スケジュール実行のE2E検証は未完了（手動実行は検証済み）**

**検証状況**:
- ✅ USBメモリ経由: 実機検証完了（従業員・計測機器・吊具のCSVインポートを確認済み）
- ✅ Dropbox経由（手動実行・スケジュール実行）: 実装・検証完了
- ✅ Gmail経由（手動実行）: 実装・検証完了（2026-01-03）
- ⚠️ Gmail経由（スケジュール実行）: 実装完了済みだが、PowerAutomate→Gmail→Pi5→CSVインポートのE2Eフロー全体の実機検証は未完了
  - 実装詳細: [docs/plans/gmail-data-acquisition-execplan.md](../plans/gmail-data-acquisition-execplan.md)
  - 検証手順: [docs/guides/verification-checklist.md#682-gmail経由csv取り込みスケジュール実行の実機検証](./verification-checklist.md#682-gmail経由csv取り込みスケジュール実行の実機検証)

**実装アーキテクチャ**:
- ✅ **CSV Import Scalingプラン完了（2025-12-29）**: CSVインポート機能をレジストリ・ファクトリパターンでモジュール化し、計測機器・吊具のCSVインポートに対応。新しいデータタイプの追加が容易になり、コードの重複を削減。スケジュール設定を`targets`配列形式に拡張し、複数のデータタイプを1つのスケジュールで処理可能に。後方互換性を確保（旧`employeesPath`/`itemsPath`形式もサポート）。Gmail件名パターンを管理コンソールから編集できる機能を実装し、設定ファイル（`backup.json`）に保存されるように変更。
  - プランファイル: `.cursor/plans/csv_import_scaling_ccfbf0e7.plan.md`（全To-do完了済み）
  - 詳細: [docs/knowledge-base/frontend.md#kb-112](./knowledge-base/frontend.md#kb-112-csvインポート構造改善と計測機器吊具対応) / [docs/knowledge-base/frontend.md#kb-113](./knowledge-base/frontend.md#kb-113-gmail件名パターンの管理コンソール編集機能) / [docs/knowledge-base/api.md#kb-114](./knowledge-base/api.md#kb-114-csvインポート構造改善レジストリファクトリパターン) / [docs/knowledge-base/api.md#kb-115](./knowledge-base/api.md#kb-115-gmail件名パターンの設定ファイル管理)

また、トランザクション履歴をCSV形式でエクスポートできます。

## CSVダッシュボード機能（生産スケジュール表示）

CSVダッシュボード機能により、Gmail経由で取得したCSVファイルをキオスク画面で表示できます。生産スケジュールなどの進捗管理に利用できます。

### 機能概要

- **CSVダッシュボード**: Gmail経由で取得したCSVファイルをデータベースに保存し、キオスク画面で表示
- **完了ボタン**: キオスク画面で完了ボタン（白背景・黒✓、枠色で状態表示）を押すと、`progress`フィールドに「完了」が入り、完了した部品を視覚的に識別可能に
- **グレーアウト表示**: 完了済みアイテム（`progress='完了'`）を`opacity-50 grayscale`で視覚的にグレーアウト
- **トグル機能**: 完了ボタンを押すと`progress`が「完了」→空文字（未完了）にトグル
- **備考欄**: 各行に備考列を表示。鉛筆アイコンを押すと編集モード（インライン入力、物理キーボード想定）。100文字以内・改行不可。拠点ごとに保存。誰でも編集可。「備考あり」ボタンで備考が入っている行のみ表示
- **資源CDフィルタ**: 各資源CDに2つのボタン（全件検索 / 割当済みのみ検索）を提供し、検索登録製番とAND条件で検索可能
- **加工順序割当**: 各アイテムに資源CDごとに独立して加工順序番号（1-10）を割当可能。完了時に自動で詰め替え（例: 1,2,3,4 → 3完了で 4→3）
- **検索状態同期**: 同一location（`ClientDevice.location`）の複数端末間で検索条件を同期（poll + debounce）
- **製造order番号の繰り上がりルール**: 同一キー（`FSEIBAN + FHINCD + FSIGENCD + FKOJUN`）で`ProductNo`が複数ある場合、**数字が大きい方のみ有効**として扱う（インポート時・表示時の両方で適用）✅ **実機検証完了（2026-02-10）**
- **削除ルール（生産スケジュールのみ）**:
  - **重複loserの削除**: 同一キー（`FSEIBAN + FHINCD + FSIGENCD + FKOJUN`）の複数行がDBに残っている場合、`ProductNo`が最大の行をwinnerとして残し、それ以外（loser）を削除
  - **1年超過は保存しない**: `max(rowData.updatedAt, occurredAt)` を基準日として、1年を超えた行は取り込み時点で保存しない（UIにも出ない）
  - **日次クリーンアップ**: 取り込み漏れや過去データの残存を収束させるため、日次で「1年超過削除」と「重複loser削除」を実行
  - **影響**: 行削除はカスケード前提のため、当該行に紐づく備考/納期/割当/完了状態も削除される（復旧・履歴保持はしない方針）

### 設定手順

1. **CSVダッシュボードの作成**: 管理コンソール（`/admin/csv-dashboards`）でCSVダッシュボードを作成
   - **名前**: ダッシュボード名（例: `ProductionSchedule_Mishima_Grinding`）
   - **Gmail件名パターン**: Gmailの件名パターン（例: `生産日程_三島_研削工程`）
   - **日付列**: CSVの日付列名（例: `date`）
   - **取り込みモード**: 「機械的追加（重複無視）」または「重複除去」
   - **表示期間**: 表示する期間（日数）
   - **テンプレート**: 「テーブル形式」または「カードグリッド形式」

2. **CSVファイルのアップロード**: 管理コンソールからCSVファイルをアップロード、またはGmail経由で自動取得

3. **キオスク画面での表示**: キオスク画面（`/kiosk/production-schedule`）でデータを確認

### 列定義（columnDefinitions）の確認・編集

CSVダッシュボードの列定義は、管理コンソール（`/admin/csv-dashboards`）で確認・編集できます。

未点検加工機（当日点検の有無）で使用する場合は、**点検結果CSVダッシュボード**の列定義に最低限以下を揃えてください。

- `equipmentManagementNumber`（候補: `設備管理番号`）
- `inspectionAt`（候補: `点検日時`, `点検日`, `inspectionAt` など）
- `inspectionResult`（候補: `点検結果`）
  - **運用上ほぼ必須**: `点検結果`が空欄（空文字）だと「正常/異常」にカウントされず、サイネージ上は灰色（点検済みに見えない）になり得ます

推奨（サイネージ/管理画面での確認が楽）:

- `machineName`（候補: `加工機名` など）
- `inspector`
- `inspectionItem`
- `inspectionResult`
- `registeredAt`

あわせて `dateColumnName` を `inspectionAt` に設定し、`displayPeriodDays: 1`（当日）で運用します。

**重要**: 内部名（`internalName`）は固定で、CSVヘッダー（日本語など）とは `csvHeaderCandidates` で紐付けます。

**編集可能**:
- 表示名（`displayName`）
- CSVヘッダー候補（`csvHeaderCandidates`、カンマ区切りで入力）
- 必須フラグ（`required`）
- 表示順（↑↓ボタンで並べ替え）

**編集不可（表示のみ）**:
- 内部名（`internalName`）
- データ型（`dataType`）

**安全策**:
- CSVプレビュー解析（ヘッダー照合）で、必須列不足や未知ヘッダーを事前確認できます。

### Gmailスケジュール取り込み（csvDashboards）

CSVダッシュボードのGmail取り込みは、CSVインポートスケジュールの`targets`に`csvDashboards`を追加して実行します。

**ポイント**:
- `target.source`は**CSVダッシュボードID**を指定する（件名パターンはダッシュボード設定を使用）
- Gmail件名は`CsvDashboard.gmailSubjectPattern`から取得するため、スケジュール側で件名を設定する必要はない
- デフォルト設定には`MeasuringInstrumentLoans`向けの無効スケジュールが含まれている（有効化は運用で実施）
- **落とし穴**: `CsvDashboard.gmailSubjectPattern` が `NULL` / 空文字だと、スケジュールが有効でも対象メールを検索できず取り込みできません（まずダッシュボード側の件名パターンを設定）。

**設定例**（管理コンソール / CSVインポート）:
1. **プロバイダー**: `gmail`
2. **ターゲット**: `CSVダッシュボード`
3. **CSVダッシュボード**: `MeasuringInstrumentLoans`を選択（選択時にスケジュールIDと名前が自動生成される）
4. **スケジュール**: 例）`0 * * * *`（毎時）

**注意事項**:
- CSVダッシュボードを選択すると、スケジュールIDと名前が自動生成されます（形式: `csv-import-${dashboardName.toLowerCase().replace(/\s+/g, '-')}`）
- Gmailに該当する未読メールがない場合でも、エラーにならず正常に完了します（該当ダッシュボードはスキップされる）
- 管理コンソールのスケジュール設定は **「時刻指定」または「間隔（N分ごと）」** を選択できます（**最小5分**）。間隔指定の場合は `*/N * * * *` のcronに変換されます。

#### レシピ: Gmail自動取得 → CSVダッシュボード → 可視化ダッシュボード → サイネージ

今後、別データでも同様に「GmailのCSV自動取得」から「サイネージの新コンテンツ」まで作る場合は、以下の順序が安全です（最小の動作確認ポイント込み）。

1. **CSVダッシュボードを作る**（`/admin/csv-dashboards`）
   - **最低限**: `gmailSubjectPattern`（件名）、`dateColumnName`（当日/期間フィルタに使う日付列）、列定義（`columnDefinitions`）
   - **未点検加工機（点検結果）**の場合は、`dateColumnName=inspectionAt` を推奨（上記「列定義」参照）
2. **CSVインポートスケジュールを作る**（`/admin/csv-imports`）
   - **プロバイダー**: `gmail`
   - **ターゲット**: `CSVダッシュボード`
   - **source**: CSVダッシュボードID（件名ではない）
3. **手動実行で疎通確認**（`/admin/csv-imports` の「実行」）
   - 失敗時は、まず「Gmail設定（OAuth）」と「CSVダッシュボードの `gmailSubjectPattern`」を疑う
4. **可視化ダッシュボードを作る/更新する**（`/admin/visualization-dashboards`）
   - `uninspected_machines` は `dataSourceConfig.csvDashboardId` が必須（点検結果CSVダッシュボードID）
   - 管理画面上でCSVダッシュボードIDを **ドロップダウン選択**して設定する（手入力しない）
   - 表示仕様（サイネージ向け）:
     - JST当日のみ対象
     - 1設備管理番号あたり1行
     - `点検結果` は `正常X/異常Y` 形式
     - 稼働中マスターに存在し当日記録なしの設備は `未使用`
5. **サイネージスケジュールに組み込む**（`/admin/signage/schedules`）
   - `layout=FULL` か `layout=SPLIT` を選び、`slot.kind=visualization` に可視化ダッシュボードIDを設定する

#### 取得ロジック（現行仕様）

`csvDashboards`（CSVダッシュボード）ターゲットのGmail取得は、現状つぎの仕様です（実装: `apps/api/src/services/backup/storage/gmail-storage.provider.ts` / `apps/api/src/services/backup/gmail-api-client.ts`）。

- **検索条件**:
  - `subject:"<gmailSubjectPattern>"`（`CsvDashboard.gmailSubjectPattern`）
  - `is:unread`（未読のみ）
  - ※送信元制限（`from:`）はGmailプロバイダー設定がある場合のみ
- **取得件数**: 最大10件のメッセージIDを取得（Gmail API `users.messages.list` の `maxResults: 10`）
- **どのメールを取るか**: 検索結果の **先頭1通（`messageIds[0]`）のみ**
- **どの添付を取るか**: そのメールの **「最初に見つかった添付」**（multipartを再帰探索して最初の `attachmentId` を採用）
- **処理後の扱い**:
  - 「アーカイブ」= `INBOX` ラベルを外す（未読フラグはそのまま）

#### 高頻度更新（1時間に10回など）の注意

PowerAutomateが「追加/変更のたびにメール送信」だと、Gmail側に同件名メールが短時間に多数たまり得ます。現行仕様では **1回の実行で1通（=1添付）しか処理しない**ため、以下が起き得ます。

- **取りこぼし**: 1時間に10通届いても、スケジュールが1時間に1回だと1通しか処理されない（残りは未処理のまま）
- **“最新状態”が目的ならOKだが、全イベント追跡は不可**: 本システムは「メールごとのCSVスナップショット取り込み」であり、借用/返却イベントをすべて取り込む設計ではない

**運用上の推奨**（現行仕様のまま精度を上げる）:
- PowerAutomate側で **一定間隔で最新スナップショットを送る**（例: 5分ごと/15分ごと）に変更する
- 本システム側のスケジュールを **送信頻度に合わせて短く**する
- 「同件名の未読が溜まる」状況を避ける（取り込ませたいCSVを未読1通に揃える運用）

### APIエンドポイント

**キオスク用エンドポイント**:
- `GET /api/kiosk/production-schedule`: 生産スケジュールデータを取得（各行に`note`（備考）を含む）
  - **クエリパラメータ**:
    - `q`（推奨）: 検索文字列（`ProductNo`または`FSEIBAN`で検索、カンマ区切りでOR検索）
    - `hasNoteOnly`: `true` で備考が入っている行のみ返す
      - 数値のみの場合: `ProductNo`の部分一致検索（`ILIKE`）
      - 8文字の英数字（`*`含む）の場合: `FSEIBAN`の完全一致検索
      - その他: `ProductNo`または`FSEIBAN`の`ILIKE` OR検索
      - カンマ区切りで複数指定可能（例: `q=A,B`でAまたはBにヒットする行を返す）
    - `resourceCds`: 資源CDでフィルタ（カンマ区切り、例: `resourceCds=1,2`）
    - `resourceAssignedOnlyCds`: 割当済みのみフィルタ（カンマ区切り、例: `resourceAssignedOnlyCds=1`）
    - `productNo`（後方互換）: `ProductNo`での検索（`q`パラメータを推奨）
    - `page`: ページ番号（デフォルト: 1）
    - `pageSize`: 1ページあたりの件数（デフォルト: 400、最大: 2000）
  - **検索条件の結合**: `q`（テキスト検索）と`resourceCds`/`resourceAssignedOnlyCds`（資源CDフィルタ）は**AND条件**で結合
  - **動作**: 検索条件がない場合は空の結果を返す（初期表示の負荷軽減）
  - **完了済みも含む**: すべての行を返す（完了済みも含む、グレーアウト表示のため）
  - **加工順序**: 各行に`processingOrder`（割当済み順番番号）を含む
- `PUT /api/kiosk/production-schedule/:rowId/complete`: 完了状態をトグル（完了→未完了、未完了→完了）。完了時は加工順序割当を削除し、同一資源CD内の後続番号を自動で詰める
- `PUT /api/kiosk/production-schedule/:rowId/order`: 加工順序番号を割当/解除（`resourceCd`と`orderNumber`（1-10またはnull）を指定）
- `PUT /api/kiosk/production-schedule/:rowId/note`: 行ごとの備考を保存（`note` 100文字以内・改行不可、拠点ごと）。空文字で削除
- `GET /api/kiosk/production-schedule` のクエリ: `hasNoteOnly=true` で備考が入っている行のみ取得
- `GET /api/kiosk/production-schedule/resources`: 有効行（同一キーで最大`ProductNo`）から取得した資源CD一覧を返す
- `GET /api/kiosk/production-schedule/order-usage`: 指定された資源CDの使用中順番番号を返す（`resourceCds`クエリパラメータでフィルタ可能）
- `GET /api/kiosk/production-schedule/search-state`: 検索状態を取得（location単位）
- `PUT /api/kiosk/production-schedule/search-state`: 検索状態を保存（location単位、`inputQuery`、`activeQueries`、`activeResourceCds`、`activeResourceAssignedOnlyCds`を含む）

**認証**: `x-client-key`ヘッダーが必要（キオスク用認証キー）

**パフォーマンス最適化**:
- DB側でフィルタリング・ソート・ページングを実行（`$queryRaw`を使用）
- `rowData`から必要なフィールドのみを選択（レスポンスサイズの削減）
- 既存の`pg_trgm`インデックスとJSONBインデックスを活用

### CSVフォーマット例

```csv
FHINCD,FSEIBAN,ProductNo,FSIGENCD,FHINMEI,FSIGENSHOYORYO,FKOJUN
製品コード1,製番1,0001,資源コード1,品名1,所要時間1,工順1
製品コード2,製番2,0002,資源コード2,品名2,所要時間2,工順2
```

**バリデーションルール**:
- **ProductNo**: 10桁の数字のみ（例: `1234567890`）
- **FSEIBAN**: 8文字の英数字（例: `ABC12345`）。割当がない場合は`********`（8個のアスタリスク）も許可されます
- バリデーション失敗時は、CSV取り込みがエラーとなり、該当行が取り込まれません

**注意事項**:
- FSEIBANが`********`（8個のアスタリスク）の場合も正常に取り込まれます（割当がない場合の運用に対応）
- バリデーションエラーの詳細は、エラーメッセージに`value`と`length`が含まれます（デバッグ用）
- 同一キーで`ProductNo`が繰り上がるケースでは、小さい`ProductNo`は表示対象から除外されます（最大`ProductNo`のみ返却）

### 実機検証

実機検証手順は、[CSVダッシュボード可視化機能の実機検証手順](./csv-dashboard-verification.md)を参照してください。

### 関連ドキュメント

- [CSVダッシュボード可視化機能の実機検証手順](./csv-dashboard-verification.md)
- [KB-184: 生産スケジュールキオスクページ実装と完了ボタンのグレーアウト・トグル機能](../knowledge-base/frontend.md#kb-184-生産スケジュールキオスクページ実装と完了ボタンのグレーアウトトグル機能)
- [KB-185: CSVダッシュボードのgmailSubjectPattern設定UI改善](../knowledge-base/api.md#kb-185-csvダッシュボードのgmailsubjectpattern設定ui改善)
- [KB-201: 生産スケジュールCSVダッシュボードの差分ロジック改善とバリデーション追加](../knowledge-base/api.md#kb-201-生産スケジュールcsvダッシュボードの差分ロジック改善とバリデーション追加)（FSEIBANバリデーション修正: `********`を許可）
- [KB-204: CSVインポートスケジュール実行ボタンの競合防止と409エラーハンドリング](../knowledge-base/frontend.md#kb-204-csvインポートスケジュール実行ボタンの競合防止と409エラーハンドリング)
- [KB-205: 生産スケジュール画面のパフォーマンス最適化と検索機能改善（API側）](../knowledge-base/api.md#kb-205-生産スケジュール画面のパフォーマンス最適化と検索機能改善api側)
- [KB-206: 生産スケジュール画面のパフォーマンス最適化と検索機能改善（フロントエンド側）](../knowledge-base/frontend.md#kb-206-生産スケジュール画面のパフォーマンス最適化と検索機能改善フロントエンド側)

## USBメモリ経由のCSVインポート

管理画面からCSVファイルをアップロードしてインポートできます。従業員・工具・計測機器・吊具・加工機の5種類に対応しています。

### インポート手順

1. **管理画面にアクセス**: `https://<Pi5のIP>/admin`
2. **「一括登録」タブにアクセス**: `https://<Pi5のIP>/admin/import`
3. **CSVファイルを選択**: 各データタイプのフォームからCSVファイルを選択
   - 従業員CSV (`employees.csv`)
   - 工具CSV (`items.csv`)
   - 計測機器CSV (`measuring-instruments.csv`)
   - 吊具CSV (`rigging-gears.csv`)
   - 加工機CSV (`machines.csv`)
4. **オプション設定**: 「既存データをクリアしてから取り込み」にチェックを入れるか選択
5. **取り込み開始**: 「取り込み開始」ボタンをクリック

### 各フォームの特徴

- **個別アップロード**: 各データタイプを個別にアップロード可能
- **独立した設定**: 各フォームで`replaceExisting`を個別に設定可能
- **ファイル名表示**: 選択したファイル名が表示され、確認可能

### APIエンドポイント

**エンドポイント**: `POST /api/imports/master/:type`

**パラメータ**:
- `:type`: データタイプ（`employees`, `items`, `measuring-instruments`, `rigging-gears`, `machines`）

**リクエスト形式**: multipart form data
- `file`: CSVファイル（必須）
- `replaceExisting`: 既存データをクリアするか（`true` / `false`、デフォルト: `false`）

**認証**: 管理者権限（`ADMIN`）が必要

## CSVインポート仕様

### 基本要件

- **文字コード**: UTF-8
- **形式**: CSV（カンマ区切り）
- **ヘッダー行**: 必須（1行目）
- **データ行**: 1行1レコード

### 従業員CSV（employees.csv）

#### 必須項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `employeeCode` | 数字4桁 | 社員コード（一意、写真番号に対応） | `0001`, `0123` |
| `lastName` | 文字列 | 苗字 | `山田` |
| `firstName` | 文字列 | 名前 | `太郎` |

#### 任意項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `department` | 文字列 | 所属部署 | `製造部` |
| `nfcTagUid` | 文字列 | NFCタグUID（14文字の16進数） | `04C362E1330289` |
| `status` | 文字列 | ステータス（`ACTIVE` / `INACTIVE` / `SUSPENDED`、未指定時は`ACTIVE`） | `ACTIVE` |

**注意**: `displayName`（氏名）は`lastName + firstName`で自動生成されます。CSVには含めません。

#### CSV例

```csv
employeeCode,lastName,firstName,department,nfcTagUid,status
0001,山田,太郎,製造部,04C362E1330289,ACTIVE
0002,佐藤,花子,品質管理部,,ACTIVE
0003,鈴木,一郎,製造部,04DE8366BC2A81,INACTIVE
```

#### バリデーションルール

- `employeeCode`: 数字4桁のみ（`/^\d{4}$/`）
- `lastName`: 1文字以上（必須）
- `firstName`: 1文字以上（必須）
- `nfcTagUid`: 既存の従業員・工具・計測機器・吊具で使用されていないこと
- CSV内で`nfcTagUid`が重複していないこと
- 他のマスターデータCSV間で`nfcTagUid`が重複していないこと

### 工具CSV（items.csv）

#### 必須項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `itemCode` | TO + 数字4桁 | 管理番号（一意） | `TO0001`, `TO0123` |
| `name` | 文字列 | 工具名 | `ドライバー No.1` |

#### 任意項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `nfcTagUid` | 文字列 | NFCタグUID（14文字の16進数） | `04DE8366BC2A81` |
| `category` | 文字列 | カテゴリ | `工具` |
| `storageLocation` | 文字列 | 保管場所 | `工具庫A` |
| `status` | 文字列 | ステータス（`AVAILABLE` / `IN_USE` / `MAINTENANCE` / `RETIRED`） | `AVAILABLE` |
| `notes` | 文字列 | 備考 | `定期点検必要` |

#### CSV例

```csv
itemCode,name,nfcTagUid,category,storageLocation,status,notes
TO0001,ドライバー No.1,04DE8366BC2A81,工具,工具庫A,AVAILABLE,
TO0002,レンチセット,,工具,工具庫B,AVAILABLE,定期点検必要
TO0003,ハンマー,04C362E1330289,工具,工具庫A,IN_USE,
```

#### バリデーションルール

- `itemCode`: TO + 数字4桁のみ（`/^TO\d{4}$/`）
- `name`: 1文字以上
- `nfcTagUid`: 既存の従業員・工具で使用されていないこと
- CSV内で`nfcTagUid`が重複していないこと
- 従業員CSVと工具CSV間で`nfcTagUid`が重複していないこと

### 計測機器CSV（measuring-instruments.csv）

#### 必須項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `managementNumber` | 文字列 | 管理番号（一意） | `MI-001`, `MI-123` |
| `name` | 文字列 | 名称 | `てこ式ダイヤルゲージ` |

#### 任意項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `storageLocation` | 文字列 | 保管場所 | `工具庫A` |
| `department` | 文字列 | 管理部署 | `品質管理部` |
| `measurementRange` | 文字列 | 測定範囲 | `0-100mm` |
| `calibrationExpiryDate` | 日付（YYYY-MM-DD） | 校正期限 | `2025-12-31` |
| `status` | 文字列 | ステータス（`AVAILABLE` / `IN_USE` / `MAINTENANCE` / `RETIRED`、未指定時は`AVAILABLE`） | `AVAILABLE` |
| `rfidTagUid` | 文字列 | NFCタグUID（14文字の16進数） | `04C362E1330289` |

#### CSV例

```csv
managementNumber,name,storageLocation,department,measurementRange,calibrationExpiryDate,status,rfidTagUid
MI-001,てこ式ダイヤルゲージ,工具庫A,品質管理部,0-100mm,2025-12-31,AVAILABLE,04C362E1330289
MI-002,ノギス,工具庫B,品質管理部,0-150mm,2025-06-30,AVAILABLE,
MI-003,マイクロメータ,工具庫A,品質管理部,0-25mm,2025-09-30,IN_USE,04DE8366BC2A81
```

#### バリデーションルール

- `managementNumber`: 1文字以上（一意）
- `name`: 1文字以上
- `rfidTagUid`: 既存の従業員・工具・計測機器・吊具で使用されていないこと
- CSV内で`rfidTagUid`が重複していないこと
- 他のマスターデータCSV間で`rfidTagUid`が重複していないこと

### 吊具CSV（rigging-gears.csv）

#### 必須項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `managementNumber` | 文字列 | 管理番号（一意） | `RG-001`, `RG-123` |
| `name` | 文字列 | 名称 | `ワイヤーロープ 10t` |

#### 任意項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `storageLocation` | 文字列 | 保管場所 | `工具庫A` |
| `department` | 文字列 | 管理部署 | `製造部` |
| `startedAt` | 日付（YYYY-MM-DD） | 使用開始日 | `2020-01-01` |
| `usableYears` | 数値 | 使用可能年数 | `10` |
| `maxLoadTon` | 数値 | 定格荷重（t） | `10` |
| `lengthMm` | 数値 | 長さ（mm） | `5000` |
| `widthMm` | 数値 | 幅（mm） | `100` |
| `thicknessMm` | 数値 | 厚さ（mm） | `20` |
| `status` | 文字列 | ステータス（`AVAILABLE` / `IN_USE` / `MAINTENANCE` / `RETIRED`、未指定時は`AVAILABLE`） | `AVAILABLE` |
| `notes` | 文字列 | 備考 | `定期点検必要` |
| `rfidTagUid` | 文字列 | NFCタグUID（14文字の16進数） | `04C362E1330289` |

#### CSV例

```csv
managementNumber,name,storageLocation,department,startedAt,usableYears,maxLoadTon,lengthMm,widthMm,thicknessMm,status,notes,rfidTagUid
RG-001,ワイヤーロープ 10t,工具庫A,製造部,2020-01-01,10,10,5000,100,20,AVAILABLE,,04C362E1330289
RG-002,チェーンブロック 5t,工具庫B,製造部,2019-06-01,15,5,3000,80,15,AVAILABLE,定期点検必要,
RG-003,スリングベルト 3t,工具庫A,製造部,2021-03-15,8,3,2000,50,10,IN_USE,,04DE8366BC2A81
```

#### バリデーションルール

- `managementNumber`: 1文字以上（一意）
- `name`: 1文字以上
- `rfidTagUid`: 既存の従業員・工具・計測機器・吊具で使用されていないこと
- CSV内で`rfidTagUid`が重複していないこと
- 他のマスターデータCSV間で`rfidTagUid`が重複していないこと

### 加工機CSV（machines.csv）

#### 必須項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `equipmentManagementNumber` | 文字列 | 設備管理番号（一意） | `30024`, `AQK002` |
| `name` | 文字列 | 加工機名称 | `HS3A_10P` |

#### 任意項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `shortName` | 文字列 | 加工機略称 | `HS3A` |
| `classification` | 文字列 | 加工機分類 | `マシニングセンター` |
| `operatingStatus` | 文字列 | 稼働状態 | `稼働中` |
| `ncManual` | 文字列 | NC/汎用区分 | `NC` |
| `maker` | 文字列 | メーカー | `日立` |
| `processClassification` | 文字列 | 工程分類 | `切削` |
| `coolant` | 文字列 | クーラント | `THK_I_ジュラロン` |

#### CSV例

```csv
equipmentManagementNumber,name,shortName,classification,operatingStatus,ncManual,maker,processClassification,coolant
30024,HS3A_10P,HS3A,マシニングセンター,稼働中,横型,日立,切削,
30026,HS3A_6P,HS3A,マシニングセンター,稼働中,横型,日立,切削,
```

#### バリデーションルール

- `equipmentManagementNumber`: 1文字以上（一意）
- `name`: 1文字以上

#### 日本語ヘッダー対応

加工機CSVは日本語ヘッダー（`加工機_名称`, `設備管理番号`など）でも取り込み可能です。

**デフォルト列定義**:
- DBに列定義が登録されていない場合、デフォルトの列定義が自動的に使用されます
- デフォルト列定義では、以下の日本語ヘッダーがサポートされています:
  - `加工機_名称` → `name`
  - `設備管理番号` → `equipmentManagementNumber`
  - `加工機_略称` → `shortName`
  - `加工機分類` → `classification`
  - `稼働状態` → `operatingStatus`
  - `NC_Manual` → `ncManual`
  - `maker` → `maker`
  - `工程分類` → `processClassification`
  - `クーラント` → `coolant`

**列定義の設定**:
- 管理コンソールの「CSV取り込み」→「取り込み設定（列定義・許可・戦略）」で列定義を設定できます
- 列定義を設定する際は、`internalName`が正しい英語キーであることを確認してください（例: `equipmentManagementNumber`, `name`）
- `csvHeaderCandidates`に日本語ヘッダーを追加することで、複数のヘッダー形式に対応できます

## インポート処理の動作

### 通常インポート（`replaceExisting: false`）

- 既存データは削除されません
- `employeeCode` / `itemCode` / `managementNumber`が一致する場合: 既存レコードを更新
- 一致しない場合: 新規レコードを作成

### 全削除してからインポート（`replaceExisting: true`）

- 選択したCSVの種類（従業員・工具・計測機器・吊具・加工機）の既存データを削除してからインポート
- **安全性**: 参照がある個体（貸出記録、点検記録など）は削除されません
  - 従業員: 貸出記録（Loan）が存在する場合は削除されない
  - 工具: 貸出記録（Loan）が存在する場合は削除されない
  - 計測機器: 貸出記録（Loan）または点検記録（InspectionRecord）が存在する場合は削除されない
  - 吊具: 貸出記録（Loan）が存在する場合は削除されない

## エラーメッセージ

### バリデーションエラー

- `社員コードは数字4桁である必要があります（例: 0001）`: `employeeCode`の形式が不正
- `苗字は必須です`: `lastName`が空
- `名前は必須です`: `firstName`が空
- `管理番号はTO + 数字4桁である必要があります（例: TO0001）`: `itemCode`の形式が不正
- `名称は必須です`: `name`が空（計測機器・吊具）
- `管理番号は必須です`: `managementNumber`が空（計測機器・吊具）

### 重複エラー

- `nfcTagUid="..."は既にemployeeCode="..."で使用されています。employeeCode="..."では使用できません。`: 既存の従業員が同じ`nfcTagUid`を使用している
- `nfcTagUid="..."は既にitemCode="..."で使用されています。itemCode="..."では使用できません。`: 既存の工具が同じ`nfcTagUid`を使用している
- `CSV内でnfcTagUidが重複しています: ...`: CSV内で同じ`nfcTagUid`が複数回使用されている
- `従業員とアイテムで同じnfcTagUidが使用されています: ...`: 従業員CSVと工具CSV間で`nfcTagUid`が重複している

### 列定義エラー

- `CSVファイルの列構成が設定と一致しません。見つからなかった列: ...`: CSVヘッダーと列定義の候補が一致しない
  - **対処法**: エラーメッセージに表示されている「実際のCSVヘッダー」を確認し、管理コンソールで列定義の候補を追加する
  - **例**: `加工機_名称`が候補に含まれていない場合、列定義の`csvHeaderCandidates`に`加工機_名称`を追加する

### 加工機CSVインポートのトラブルシューティング

**エラー**: `equipmentManagementNumber と name が undefined`

**原因**: DB側の列定義（`master-config-machines`）で`internalName`が壊れている可能性があります。

**確認方法**:
```sql
SELECT id, "columnDefinitions"->0->>'internalName' AS c0, "columnDefinitions"->1->>'internalName' AS c1
FROM "CsvDashboard" WHERE id='master-config-machines';
```

**期待される値**:
- `c0`: `equipmentManagementNumber`
- `c1`: `name`

**壊れている場合の値**:
- `c0`: `設備管理番号`（日本語ヘッダーがそのまま`internalName`になっている）
- `c1`: `加工機_名称`（日本語ヘッダーがそのまま`internalName`になっている）

**修正方法**:
1. 管理コンソールの「CSV取り込み」→「取り込み設定（列定義・許可・戦略）」で列定義を確認・修正
2. または、DB側で直接修正（[KB-253](../knowledge-base/api.md#kb-253-加工機csvインポートのデフォルト列定義とdb設定不整合問題)参照）

**関連KB**: [KB-253: 加工機CSVインポートのデフォルト列定義とDB設定不整合問題](../knowledge-base/api.md#kb-253-加工機csvインポートのデフォルト列定義とdb設定不整合問題)

## CSVエクスポート仕様

### トランザクション履歴エクスポート

履歴画面からCSV形式でトランザクション履歴をエクスポートできます。

#### エクスポート項目

| 列名 | 説明 |
|------|------|
| `日時` | トランザクションの日時 |
| `アクション` | アクション種別（`BORROW` / `RETURN`） |
| `アイテム` | アイテム名（スナップショット優先） |
| `従業員` | 従業員名（スナップショット優先） |
| `端末` | クライアント端末名 |

#### エクスポート方法

1. 管理画面の「履歴」タブにアクセス
2. 必要に応じて日時フィルタを設定
3. 「CSVエクスポート」ボタンをクリック
4. `transactions.csv`がダウンロードされます

## DropboxからのCSVインポート

### 手動実行

管理画面からDropbox経由でCSVをインポートできます。

**APIエンドポイント**: `POST /api/imports/master/from-dropbox`

**リクエスト例**:
```json
{
  "employeesPath": "/backups/csv/employees-20251216.csv",
  "itemsPath": "/backups/csv/items-20251216.csv",
  "replaceExisting": false
}
```

**認証**: 管理者権限（`ADMIN`）が必要

### スケジュール実行

設定ファイル（`backup.json`）でスケジュールを設定すると、自動的にDropboxまたはGmailからCSVを取得してインポートします。

#### 新しいCSV取得スケジュールを作成する際のガイドライン

⚠️ **重要**: 既存のスケジュールと分単位でバッティングしないようにする必要があります。複数のスケジュールが同時刻に発火すると、Gmail APIへのバーストアクセスが発生し、429エラー（レート制限）が連鎖的に発生する可能性があります。

**現在のスケジュール分**（2026-02-16時点）:
- `csv-import-加工機_日常点検結果`: `15,25,35,45,55`分（10分間隔、5分オフセット）
- `csv-import-measuringinstrumentloans`: `18,28,38,48,58`分（10分間隔、8分オフセット）
- `csv-import-productionschedule_mishima_grinding`: `21,31,41,51`分（10分間隔、1分オフセット）

**推奨パターン**:
- **10分間隔の場合**: 既存の分（`15,18,21,25,28,31,35,38,41,45,48,51,55,58`）を避け、空いている分を選択
  - ✅ 例: `0,10,20,30,40,50`（毎時の0分、10分、20分、30分、40分、50分）
  - ✅ 例: `2,12,22,32,42,52`（毎時の2分、12分、22分、32分、42分、52分）
  - ❌ 例: `5,15,25,35,45,55`（既存の`15,25,35,45,55`とバッティングするため不可）
- **5分間隔の場合**: 既存の分を避け、空いている分を選択
  - ❌ 例: `0,5,10,15,20,25,30,35,40,45,50,55`（既存の`15,25,35,45,55`とバッティングするため不可）
  - ❌ 例: `1,6,11,16,21,26,31,36,41,46,51,56`（既存の`21,31,41,51`とバッティングするため不可）
  - ✅ 例: `2,7,12,17,22,27,32,37,42,47,52,57`（既存とバッティングしない）

**確認方法**:
1. 管理コンソールの「CSV取り込み」→「CSVインポートスケジュール」で既存スケジュールの分を確認
2. 新しいスケジュールの分が既存と重複していないことを確認
3. 可能であれば、既存スケジュールの分から最低3分以上離す（例: 既存が`15,25,35,45,55`なら、新規は`18,28,38,48,58`や`0,10,20,30,40,50`）

**設定場所**:
- **管理コンソール**: 「CSV取り込み」→「CSVインポートスケジュール」→「新規作成」または「編集」
- **設定ファイル**: `/opt/RaspberryPiSystem_002/config/backup.json`の`csvImports`配列に追加

**推奨設定**:
- `retryConfig.maxRetries=0`: スケジューラーレベルでのリトライを無効化（GmailStorageProviderの内部リトライは1回のみ）
- `enabled: true`: スケジュールを有効化
- `schedule`: cron形式（例: `"2,12,22,32,42,52 * * * *"`）

**関連KB**: [KB-216: Gmail APIレート制限エラー（429）の対処方法](../knowledge-base/api.md#kb-216-gmail-apiレート制限エラー429の対処方法)

#### Dropbox経由のスケジュール実行

**設定例（新形式）**:
```json
{
  "csvImports": [
    {
      "id": "daily-import",
      "name": "毎日のCSVインポート",
      "provider": "dropbox",
      "schedule": "0 2 * * *",
      "timezone": "Asia/Tokyo",
      "targets": [
        { "type": "employees", "source": "/backups/csv/employees-YYYYMMDD.csv" },
        { "type": "items", "source": "/backups/csv/items-YYYYMMDD.csv" },
        { "type": "measuringInstruments", "source": "/backups/csv/measuring-instruments-YYYYMMDD.csv" },
        { "type": "riggingGears", "source": "/backups/csv/rigging-gears-YYYYMMDD.csv" },
        { "type": "machines", "source": "/backups/csv/machines-YYYYMMDD.csv" }
      ],
      "replaceExisting": false,
      "enabled": true
    }
  ]
}
```

**設定例（旧形式・後方互換）**:
```json
{
  "csvImports": [
    {
      "id": "daily-employees-import",
      "name": "毎日の従業員CSVインポート",
      "schedule": "0 2 * * *",
      "timezone": "Asia/Tokyo",
      "employeesPath": "/backups/csv/employees-YYYYMMDD.csv",
      "itemsPath": "/backups/csv/items-YYYYMMDD.csv",
      "replaceExisting": false,
      "enabled": true
    }
  ]
}
```

**注意**: 旧形式（`employeesPath`/`itemsPath`）もサポートされていますが、新形式（`targets`）の使用を推奨します。

#### Gmail経由のスケジュール実行

GmailからCSVファイルを自動取得してインポートできます。PowerAutomateなどからGmailにCSVファイルを送信し、設定した件名パターンに一致するメールの添付ファイルを自動的にインポートします。

**設定例**:
```json
{
  "csvImports": [
    {
      "id": "gmail-daily-import",
      "name": "Gmail経由の毎日CSVインポート",
      "provider": "gmail",
      "schedule": "0 4 * * 1,2,3",
      "timezone": "Asia/Tokyo",
      "targets": [
        { "type": "employees", "source": "[Pi5 CSV Import] employees" },
        { "type": "items", "source": "[Pi5 CSV Import] items" },
        { "type": "measuringInstruments", "source": "[Pi5 CSV Import] measuring-instruments" },
        { "type": "riggingGears", "source": "[Pi5 CSV Import] rigging-gears" },
        { "type": "machines", "source": "[Pi5 CSV Import] machines" }
      ],
      "replaceExisting": false,
      "enabled": true
    }
  ],
  "csvImportSubjectPatterns": {
    "employees": [
      "[Pi5 CSV Import] employees",
      "[CSV Import] employees",
      "CSV Import - employees",
      "従業員CSVインポート"
    ],
    "items": [
      "[Pi5 CSV Import] items",
      "[CSV Import] items",
      "CSV Import - items",
      "アイテムCSVインポート"
    ],
    "measuringInstruments": [
      "[Pi5 CSV Import] measuring-instruments",
      "[CSV Import] measuring-instruments",
      "CSV Import - measuring-instruments",
      "計測機器CSVインポート"
    ],
    "riggingGears": [
      "[Pi5 CSV Import] rigging-gears",
      "[CSV Import] rigging-gears",
      "CSV Import - rigging-gears",
      "吊具CSVインポート"
    ],
    "machines": [
      "[Pi5 CSV Import] machines",
      "[CSV Import] machines",
      "CSV Import - machines",
      "加工機CSVインポート"
    ]
  }
}
```

**Gmail件名パターンの管理**:
- 管理コンソールの「CSVインポートスケジュール」ページから、Gmail件名パターンを編集できます
- 件名パターンは`backup.json`の`csvImportSubjectPatterns`に保存されます
- Gmailプロバイダーを使用する場合、`targets`の`source`フィールドは件名パターンから選択します

**詳細**: 
- [PowerAutomate → Dropbox → Pi5 CSV統合ガイド](./powerautomate-dropbox-integration.md)
- [Gmail設定ガイド](./gmail-setup-guide.md)

#### スケジュールの手動実行

スケジュールに設定されたインポートを手動で実行できます。管理コンソールの「CSVインポートスケジュール」ページから、各スケジュールの「実行」ボタンをクリックして実行できます。

**APIエンドポイント**: `POST /api/imports/schedule/:id/run`

**動作**:
- 手動実行時は**リトライをスキップ**し、即座に結果を返します
- Gmailプロバイダーの場合、該当メールがない場合は即座にエラーを返します（リトライなし）
- 自動実行（スケジュール実行）の場合は、リトライ機能が有効です（最大3回、指数バックオフ）
- Gmailの認証が失効（`invalid_grant`）している場合は **401で「再認可が必要」** を返します

**注意**: 
- 手動実行は即座に結果を確認したい用途のため、リトライは実行されません
- 自動実行はメールがまだ届いていない可能性があるため、リトライ機能が有効です
- 再認可が必要な場合は、管理コンソールの「Gmail設定」からOAuth認証を実行してください

### インポート履歴

スケジュール実行や手動実行の履歴を確認できます。

**APIエンドポイント**:
- `GET /api/imports/history`: 全履歴取得（フィルタ・ページング対応）
- `GET /api/imports/schedule/:id/history`: 特定スケジュールの履歴取得
- `GET /api/imports/history/failed`: 失敗した履歴のみ取得
- `GET /api/imports/history/:historyId`: 詳細履歴取得

**詳細**: [CSVインポート履歴機能の有効化手順](./csv-import-history-migration.md)

### CSVインポート後の自動バックアップ（Phase 3）

CSVインポート成功時に自動的にバックアップを実行できます。

**設定例**:
```json
{
  "csvImports": [
    {
      "id": "daily-import",
      "name": "毎日のCSVインポート",
      "provider": "dropbox",
      "schedule": "0 2 * * *",
      "targets": [
        { "type": "employees", "source": "/backups/csv/employees-YYYYMMDD.csv" },
        { "type": "items", "source": "/backups/csv/items-YYYYMMDD.csv" }
      ],
      "enabled": true,
      "autoBackupAfterImport": {
        "enabled": true,
        "targets": ["csv"]
      }
    }
  ]
}
```

**バックアップ対象**:
- `csv`: CSVデータのみ（employees, items, measuringInstruments, riggingGears）
- `database`: データベース全体
- `all`: CSV + データベース

**動作**:
- CSVインポート成功時に自動的にバックアップを実行
- バックアップ失敗時もインポート成功は維持（エラーログのみ記録）
- バックアップ履歴が自動的に記録される

### Dropboxからのバックアップリストア（Phase 3）

Dropboxからバックアップをダウンロードしてリストアできます。

**APIエンドポイント**: `POST /api/backup/restore/from-dropbox`

**リクエスト例**:
```json
{
  "backupPath": "/backups/database/2025-12-16T04-00-00-000Z/database",
  "targetKind": "database",
  "verifyIntegrity": true,
  "expectedSize": 1024000,
  "expectedHash": "sha256-hash-value"
}
```

**パラメータ**:
- `backupPath`: Dropbox上のバックアップファイルパス（必須）
- `targetKind`: リストア対象の種類（`database`, `csv`、オプション）
- `verifyIntegrity`: 整合性検証を実行するか（デフォルト: `true`）
- `expectedSize`: 期待されるファイルサイズ（バイト、オプション）
- `expectedHash`: 期待されるハッシュ値（SHA256、オプション）

**認証**: 管理者権限（`ADMIN`）が必要

**動作**:
- Dropboxからバックアップファイルをダウンロード
- 整合性検証（ファイルサイズ、ハッシュ値、形式）
- データベースまたはCSVのリストアを実行
- リストア履歴が自動的に記録される

### バックアップ・リストア履歴（Phase 3）

バックアップ・リストア実行履歴を確認できます。

**APIエンドポイント**:
- `GET /api/backup/history`: バックアップ履歴一覧取得（フィルタ・ページング対応）
- `GET /api/backup/history/:id`: バックアップ履歴詳細取得

**クエリパラメータ**（`GET /api/backup/history`）:
- `operationType`: `BACKUP` または `RESTORE`
- `targetKind`: バックアップ対象の種類（`database`, `csv`, `file`, `directory`, `image`）
- `status`: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`
- `startDate`: 開始日時（ISO 8601形式）
- `endDate`: 終了日時（ISO 8601形式）
- `offset`: オフセット（ページング）
- `limit`: 取得件数（デフォルト: 100）

**レスポンス例**:
```json
{
  "history": [
    {
      "id": "uuid",
      "operationType": "BACKUP",
      "targetKind": "csv",
      "targetSource": "employees",
      "backupPath": "/backups/csv/2025-12-16T04-00-00-000Z/employees.csv",
      "storageProvider": "dropbox",
      "status": "COMPLETED",
      "sizeBytes": 1024,
      "hash": "sha256-hash-value",
      "startedAt": "2025-12-16T04:00:00.000Z",
      "completedAt": "2025-12-16T04:00:05.000Z"
    }
  ],
  "total": 1,
  "offset": 0,
  "limit": 100
}
```

## CSVインポート構造の改善

### レジストリ・ファクトリパターンの導入

CSVインポート機能は、拡張性と保守性を向上させるため、レジストリ・ファクトリパターンを採用しています。

**アーキテクチャ**:
- `CsvImporter`インターフェース: 各データタイプ（従業員・工具・計測機器・吊具）のインポータが実装する共通インターフェース
- `CsvImporterRegistry`: すべてのインポータを管理するレジストリ
- `CsvImporterFactory`: データタイプに応じて適切なインポータを取得するファクトリ

**メリット**:
- 新しいデータタイプの追加が容易（新しいインポータを実装してレジストリに登録するだけ）
- コードの重複を削減（共通ロジックをインターフェースに集約）
- テストが容易（各インポータを独立してテスト可能）

**実装ファイル**:
- `apps/api/src/services/imports/csv-importer.types.ts`: 型定義
- `apps/api/src/services/imports/csv-importer-registry.ts`: レジストリ実装
- `apps/api/src/services/imports/csv-importer-factory.ts`: ファクトリ実装
- `apps/api/src/services/imports/importers/`: 各データタイプのインポータ実装

### 後方互換性

旧形式（`employeesPath`/`itemsPath`）のスケジュール設定も引き続きサポートされています。設定ファイルを読み込む際に、自動的に新形式（`targets`）に変換されます。

## 将来の拡張予定

### マスターデータエクスポート

- 従業員マスタのCSVエクスポート機能
- 工具マスタのCSVエクスポート機能
- 計測機器マスタのCSVエクスポート機能
- 吊具マスタのCSVエクスポート機能

### その他のマスターデータインポート

- 将来のモジュール（ドキュメント管理、物流管理など）用のマスターデータインポート機能
- 新しいデータタイプの追加は、`CsvImporter`インターフェースを実装してレジストリに登録するだけで対応可能

## 実機検証

CSVフォーマット仕様実装の実機検証手順は、[検証チェックリスト](./verification-checklist.md#6-csvフォーマット仕様実装の検証2025-12-31)を参照してください。

## 関連ドキュメント

- [デプロイメントガイド](./deployment.md)
- [PowerAutomate → Dropbox → Pi5 CSV統合ガイド](./powerautomate-dropbox-integration.md)
- [CSVインポート履歴機能の有効化手順](./csv-import-history-migration.md)
- [Dropbox CSV統合機能の現状分析](../analysis/dropbox-csv-integration-status.md)
- [トラブルシューティングナレッジベース](../knowledge-base/troubleshooting-knowledge.md#kb-003-p2002エラーnfctaguidの重複が発生する)
- [KB-253: 加工機CSVインポートのデフォルト列定義とDB設定不整合問題](../knowledge-base/api.md#kb-253-加工機csvインポートのデフォルト列定義とdb設定不整合問題)
- [KB-254: 加工機マスタのメンテナンスページ追加（CRUD機能）](../knowledge-base/frontend.md#kb-254-加工機マスタのメンテナンスページ追加crud機能)
- [検証チェックリスト](./verification-checklist.md#6-csvフォーマット仕様実装の検証2025-12-31)

