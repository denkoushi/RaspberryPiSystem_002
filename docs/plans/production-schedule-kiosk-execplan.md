# 生産スケジュールキオスクページ実装 ExecPlan

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

PowerAppsの生産スケジュールUIを参考に、Gmail経由で取得したCSVファイル（件名: `生産日程_三島_研削工程`）をキオスク画面で表示し、完了ボタン（赤いボタン）で`progress`フィールドを更新する機能を実装します。

実装完了後、ユーザーはキオスク画面（`/kiosk/production-schedule`）で生産スケジュールを確認し、完了した部品にチェックを入れることができます。完了済みアイテムはグレーアウト表示され、誤操作時はトグルで未完了に戻せます。

## Context

### 関連ドキュメント

- `docs/knowledge-base/frontend.md#kb-184`: 生産スケジュールキオスクページ実装のトラブルシューティング
- `docs/knowledge-base/api.md#kb-185`: CSVダッシュボードのgmailSubjectPattern設定UI改善
- `docs/knowledge-base/api.md#kb-186`: CsvImportSubjectPatternモデル追加による設計統一
- `docs/guides/csv-import-export.md`: CSVインポート・エクスポート仕様
- `docs/guides/csv-dashboard-verification.md`: CSVダッシュボード可視化機能の実機検証手順

### 既存実装

- `apps/api/src/services/csv-dashboard/`: CSVダッシュボードの取り込み・管理機能
- `apps/api/src/services/imports/csv-import-scheduler.ts`: CSVインポートスケジューラー
- `apps/api/src/routes/kiosk.ts`: キオスク用APIエンドポイント
- `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`: キオスク生産スケジュールページ

### 用語定義

- **CSVダッシュボード**: Gmail経由で取得したCSVファイルをデータベースに保存し、キオスクやサイネージで表示する機能
- **ProductionSchedule_Mishima_Grinding**: 生産日程（研削工程）用のCSVダッシュボード（ID: `3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01`）
- **MeasuringInstrumentLoans**: 計測機器の持出状況用のCSVダッシュボード（ID: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`）
- **gmailSubjectPattern**: CSVダッシュボードごとに設定するGmail件名パターン（例: `生産日程_三島_研削工程`）
- **CsvImportSubjectPattern**: マスターデータインポート用のGmail件名パターンをDBで管理するモデル

## Scope

### 実装順序（本スレッドで合意）

1. **生産スケジュールの実機検証**: CSVファイルをDBに入れて検証
2. **UI改善**: `gmailSubjectPattern`設定フィールドを管理コンソールのCSVダッシュボードページに追加
3. **サイネージ用データ取得の構築**: 計測機器の持出状況をGmail経由で取得し、サイネージで表示
4. **設計統一**: `csvImportSubjectPatterns`を`backup.json`からDBテーブル（`CsvImportSubjectPattern`）へ移行

### 詳細ToDo（内部実装タスク）

- [x] 作業ブランチ作成（`feat/production-schedule-kiosk`）
- [x] DBスキーマ: `CsvDashboard`に`gmailSubjectPattern`追加＋マイグレーション
- [x] CSV取り込み: `CsvImportScheduler`のcsvDashboards件名解決を`dashboard.gmailSubjectPattern`参照に修正
- [x] 差分検出: `CsvDashboardIngestor`のDEDUPをIN検索＋差分update＋progress完了維持に改善
- [x] Seed: 生産日程用`CsvDashboard`をupsert作成（列定義/キー/件名/日付列）
- [x] API: キオスク用生産日程API（list + complete）を追加
- [x] Web: `KioskLayout`へナビ追加＋`ProductionSchedulePage`実装（カード/完了ボタン/検索履歴）
- [x] テスト: API統合テスト追加（kiosk production schedule）
- [x] ローカルテスト実行手順とCI確認（push/PRでActions起動）
- [x] UI改善: `CsvDashboardsPage`に`gmailSubjectPattern`設定フィールド追加
- [x] 設計統一（モデル追加のみ）: `CsvImportSubjectPattern`モデル追加＋seedデータ投入
- [x] 設計統一（スケジューラー統合）: `CsvImportScheduler`でマスターデータインポート時にDBから件名パターンを取得するように修正（`CsvImportSubjectPattern` → Gmail候補件名パターンとして利用、`target.source`はフォールバック）

### アーキテクチャ改善ToDo（CSV取得の疎結合・モジュール化・スケーラビリティ）

**目的**: CSV取得（Gmail/Dropbox/Localなど）をスケジューラーから分離し、依存方向を「安定→不安定」に揃える。新しい取得元（例: S3）追加やエラーハンドリング改善を“局所変更”に閉じ込める。

- [x] **境界（インターフェース）の導入**: `CsvImportScheduler` が直接 `StorageProvider` / Gmail例外 / Prisma に依存しないよう、`CsvImportExecutionService` と `CsvImportSourceService` を導入
- [x] **Gmail件名パターン解決の分離**: DBの `CsvImportSubjectPattern`（優先度付き） + `target.source`（後方互換フォールバック）を候補生成として `CsvImportSourceService` に分離（`CsvImportSubjectPatternProvider` を導入）
- [x] **取得元アダプタ化**: Gmail専用の `NoMatchingMessageError` は `CsvImportSourceService` / `CsvDashboardSourceService` 内で吸収し、schedulerは取得元非依存に
- [x] **スケーラビリティ**: 1回のスケジュール実行で同一 `importType` の候補パターンをキャッシュし、DB往復・ログ量を抑制（挙動は不変）
- [x] **テスト**: 取得元と候補解決はユニットで検証し、schedulerのテストはDI前提で薄く保つ

## Progress

- [x] (2026-01-XX) **実装順序1: 生産スケジュールの実機検証完了**: CSVファイル（`標準工数_機械工数 (4).csv`）をDBに取り込み、キオスク画面（`/kiosk/production-schedule`）で表示確認。完了ボタンの動作、グレーアウト表示、トグル機能が正常に動作することを確認。実機検証で発見された問題（seed.tsの`enabled: true`不足、prisma db seed失敗、CIテスト失敗）をすべて解決。詳細は [KB-184](../knowledge-base/frontend.md#kb-184-生産スケジュールキオスクページ実装と完了ボタンのグレーアウトトグル機能) を参照。

- [x] (2026-01-XX) **実装順序2: UI改善完了**: CSVダッシュボードの`gmailSubjectPattern`設定UIを管理コンソール（`/admin/csv-dashboards`）に追加。`CsvDashboardsPage.tsx`に「Gmail件名パターン」入力フィールドを追加し、APIスキーマと型定義を更新。実機検証で設定が正しく保存・使用されることを確認。詳細は [KB-185](../knowledge-base/api.md#kb-185-csvダッシュボードのgmailsubjectpattern設定ui改善) を参照。

- [x] (2026-01-22) **実装順序3: サイネージ用データ取得の構築（実機検証完了）**: `MeasuringInstrumentLoans`（件名: `計測機器持出状況`）をGmail経由で取得し、CSVインポート→サイネージ表示までのE2Eを実機確認。初期はCSV列名と管理コンソールの列定義が不一致で失敗したが、列定義をCSVに合わせて修正後、エラーなく取り込み・サイネージ表示が成功。
- [x] (2026-01-20) **CSVインポートスケジュールUI改善**: ID自動生成機能とNoMatchingMessageErrorハンドリング改善を実装。CSVダッシュボード選択時にスケジュールIDと名前を自動生成し、Gmailに該当メールがない場合でもエラーにならず正常に完了するように改善。詳細は [KB-187](../knowledge-base/api.md#kb-187-csvインポートスケジュール作成時のid自動生成とnomatchingmessageerrorハンドリング改善) を参照。
- [x] (2026-01-21) **CSVインポート実行エンドポイントのエラーハンドリング改善**: ApiErrorのstatusCodeを尊重するように修正。列不一致エラーが500ではなく400 Bad Requestとして返されるようになり、ブラウザコンソールでも適切なステータスコードが記録される。詳細は [KB-188](../knowledge-base/api.md#kb-188-csvインポート実行エンドポイントでのapierror-statuscode尊重) を参照。

- [x] (2026-01-XX) **実装順序4: 設計統一（完了・互換性維持中）**: マスターデータインポートのGmail件名パターンを`backup.json`からDBテーブル（`CsvImportSubjectPattern`）へ移行する設計変更。
  - ✅ **完了済み**: Prismaスキーマに`CsvImportSubjectPattern`モデル追加（`schema.prisma:578-591`）、`seed.ts`にデフォルトデータ投入
  - ✅ **完了済み**: `CsvImportScheduler`がDB（`CsvImportSubjectPattern`）から件名パターンを取得し、候補を順に試行する（`target.source`はフォールバックとして候補に追加）
  - ⏳ **互換性維持中**: `backup-config.ts`の`csvImportSubjectPatterns`（旧設定）は後方互換のため残置（deprecate→移行→削除の段階的移行で安全に進める）
  - 詳細は [KB-186](../knowledge-base/api.md#kb-186-csvimportsubjectpatternモデル追加による設計統一マスターデータインポートの件名パターンdb化) を参照

- [x] (2026-01-26) **生産スケジュール機能改良完了**: 列名変更（ProductNo→製造order番号、FSEIBAN→製番）、FSEIBAN全文表示、管理コンソールの列並び順・表示非表示機能、差分ロジック改善（updatedAt優先・完了でも更新）、CSVインポートスケジュールUI改善（409エラー時のrefetch）、バリデーション追加（ProductNo: 10桁数字、FSEIBAN: 8文字英数字）、TABLEテンプレート化を実装。実機検証でCSVダッシュボード画面とキオスク画面の動作を確認。詳細は [KB-201](../knowledge-base/api.md#kb-201-生産スケジュールcsvダッシュボードの差分ロジック改善とバリデーション追加)、[KB-202](../knowledge-base/frontend.md#kb-202-生産スケジュールキオスクページの列名変更とfseiban全文表示)、[KB-203](../knowledge-base/infrastructure/ansible-deployment.md#kb-203-本番環境でのprisma-db-seed失敗と直接sql更新) を参照。

## Surprises & Discoveries

### CSVインポートスケジュール作成時のID自動生成機能

**発見**: CSVダッシュボードを選択してもスケジュールIDが自動入力されず、手動入力が必要だった。

**対策**: CSVダッシュボード選択時に、ダッシュボード名から自動的にIDと名前を生成する機能を追加。編集時は既存IDを変更しない。

**関連ファイル**: `apps/web/src/pages/admin/CsvImportSchedulePage.tsx`

### NoMatchingMessageErrorの500エラー問題

**発見**: Gmailに該当する未読メールがない場合、`NoMatchingMessageError`が発生し、500エラーになっていた。これは正常な状態（メールがない）をエラーとして扱っていた。

**対策**: `CsvDashboardImportService.ingestTargets`で`NoMatchingMessageError`を捕捉し、該当ダッシュボードをスキップして処理を継続するように変更。メールがない場合は正常に完了し、エラーにならない。

**関連ファイル**: `apps/api/src/services/csv-dashboard/csv-dashboard-import.service.ts`

### アラート生成スクリプトのシェル実行エラー

**発見**: `ImportAlertService`が`exec(string)`でシェル実行しており、括弧や改行を含むメッセージでシェルエスケープが破綻していた。

**対策**: `execFile`に変更し、引数配列として渡すことでシェルエスケープ問題を回避。

**関連ファイル**: `apps/api/src/services/imports/import-alert.service.ts`

### CSVインポート実行エンドポイントでのApiError statusCode無視問題

**発見**: CSVインポート実行時に列不一致エラーが発生すると、ブラウザコンソールに500 Internal Server Errorが記録されていた。UIには適切なエラーメッセージが表示されるが、HTTPステータスコードが500（サーバー側の問題）になっていた。列不一致はクライアント側の問題なので、400 Bad Requestが適切。

**対策**: `apps/api/src/routes/imports.ts`の`POST /imports/schedule/:id/run`エンドポイントで、`ApiError`の場合は`statusCode`を尊重して再スローするように修正。`error instanceof ApiError`のチェックを最初に行い、`ApiError`の場合はその`statusCode`を尊重して再スロー。それ以外の`Error`の場合のみ、500に変換。

**関連ファイル**: `apps/api/src/routes/imports.ts`

### CSV列定義（columnDefinitions）と取り込みCSVヘッダー不一致による取り込み失敗

**発見**: `MeasuringInstrumentLoans`の取り込みで「列構成が一致しない」エラーが発生。原因は、取り込み対象CSVのヘッダー行と管理コンソールの列定義（CSVヘッダー候補）が不一致だった。

**対策**: 管理コンソール（`/admin/csv-dashboards`）で対象CSVダッシュボードの列定義をCSVの実ヘッダーに合わせて修正。必要に応じて「CSVプレビュー（ヘッダー照合）」で事前確認してから実行する。

**結果**: スケジュール手動実行で正常に取り込まれ、サイネージ表示も正常に更新されることを実機で確認。

**関連ファイル**: `apps/web/src/pages/admin/CsvDashboardsPage.tsx`, `apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts`

### 本番環境での`prisma db seed`失敗

**発見**: Raspberry Piの本番環境で`prisma db seed`が失敗。`tsx`がdev依存のため、`NODE_ENV=production`ではインストールされていない。

**対策**: 直接SQLで`INSERT ... ON CONFLICT DO UPDATE`を実行してシードデータを投入。将来的には、本番環境でも`tsx`を使用可能にするか、シードスクリプトをJavaScriptに変換する必要がある。

**関連ファイル**: `apps/api/prisma/seed.ts`

### 完了ボタンの仕様変更

**発見**: 当初は完了済みアイテムを一覧から除外する仕様だったが、グレーアウト表示により一覧に残す仕様に変更。

**理由**: 完了済みアイテムも確認できるようにし、誤操作時の復元（トグル）を可能にするため。

**実装**: `GET /api/kiosk/production-schedule`はすべての行を返すように変更し、フロントエンドで`progress='完了'`のアイテムを`opacity-50 grayscale`でグレーアウト表示。

**関連ファイル**: `apps/api/src/routes/kiosk.ts`, `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`

### 管理UI導線の誤解

**発見**: 「サイネージの中にCSVダッシュボードはない」という指摘を受け、管理コンソールのナビゲーション構造を確認。

**原因**: CSVダッシュボードは「サイネージ」タブではなく、独立した「CSVダッシュボード」タブからアクセスする必要がある。

**対策**: 実機検証手順を明確化し、管理コンソールのナビゲーション構造をドキュメント化。

**関連ファイル**: `apps/web/src/layouts/AdminLayout.tsx`

### `seed.ts`の`enabled: true`不足

**発見**: `ProductionSchedule_Mishima_Grinding`の`upsert`で`update`ブロックに`enabled: true`がなく、既存レコードが無効化される可能性があった。

**対策**: `update`ブロックに`enabled: true`を追加して修正。

**関連ファイル**: `apps/api/prisma/seed.ts`

### 本番環境での`prisma db seed`失敗と直接SQL更新

**発見**: Raspberry Piの本番環境で`prisma db seed`が失敗。`tsx`がdev依存のため、`NODE_ENV=production`ではインストールされていない。`templateType`と`templateConfig`の更新が必要だった。

**対策**: 直接SQLで`UPDATE`を実行して`templateType`と`templateConfig`を更新。将来的には、本番環境でも`tsx`を使用可能にするか、シードスクリプトをJavaScriptに変換する必要がある。

**関連ファイル**: `apps/api/prisma/seed.ts`

**詳細**: [KB-203](../knowledge-base/infrastructure/ansible-deployment.md#kb-203-本番環境でのprisma-db-seed失敗と直接sql更新)

### CSVインポートスケジュール作成時の409エラーとrefetch

**発見**: CSVインポートスケジュール作成時に「already exists」（HTTP 409）エラーが発生するが、スケジュール一覧に表示されない。既存スケジュールが存在するが、UIが更新されていない。

**対策**: `CsvImportSchedulePage.tsx`で409エラー発生時に`refetch()`を呼び出し、スケジュール一覧を更新。`validationError`メッセージを表示してユーザーに既存スケジュールの存在を通知。

**関連ファイル**: `apps/web/src/pages/admin/CsvImportSchedulePage.tsx`

**詳細**: [KB-201](../knowledge-base/api.md#kb-201-生産スケジュールcsvダッシュボードの差分ロジック改善とバリデーション追加)（CSVインポートスケジュールUI改善）

## Decision Log

### progressの優先順位（DB操作を優先して完了維持）

**決定**: キオスクで完了にしたら**DB側を優先して完了維持**（次回CSVが空欄でも戻さない）。PowerApps側反映は**将来対応**。

**理由**: キオスクでの操作を優先し、誤操作時の復元を可能にするため。PowerApps側への反映は将来的に実装する。

**実装**: `CsvDashboardIngestor`のDEDUPモードで、既存行の`rowData.progress`が`完了`の場合は維持するロジックを追加。

**関連ファイル**: `apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts`

### 完了の表現（一覧除外ではなくグレーアウト）

**決定**: 完了済みアイテムを一覧から除外せず、グレーアウト表示で視覚的に識別可能にする。

**理由**: 完了済みアイテムも確認できるようにし、誤操作時の復元（トグル）を可能にするため。

**実装**: `GET /api/kiosk/production-schedule`はすべての行を返すように変更し、フロントエンドで`progress='完了'`のアイテムを`opacity-50 grayscale`でグレーアウト表示。

**関連ファイル**: `apps/api/src/routes/kiosk.ts`, `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`

### CSVダッシュボードのgmailSubjectPattern設定方式

**決定**: CSVダッシュボードごとに`gmailSubjectPattern`を設定できるようにし、`CsvDashboard`モデルに`gmailSubjectPattern`フィールドを追加。

**理由**: CSVダッシュボードごとに異なる件名パターンが必要なため。管理コンソールから設定可能にすることで、運用時の柔軟性を確保。

**実装**: `apps/api/prisma/schema.prisma`に`gmailSubjectPattern String?`を追加し、`CsvDashboardsPage.tsx`に設定UIを追加。

**関連ファイル**: `apps/api/prisma/schema.prisma`, `apps/web/src/pages/admin/CsvDashboardsPage.tsx`

### マスターデータインポートの件名パターン管理方式

**決定**: マスターデータインポートのGmail件名パターンを`backup.json`からDBテーブル（`CsvImportSubjectPattern`）へ移行。

**理由**: CSVダッシュボードの`gmailSubjectPattern`はDBに保存されているため、設計を統一するため。DB化により、管理コンソールからの編集が容易になる。

**実装状況**:
- ✅ `apps/api/prisma/schema.prisma`に`CsvImportSubjectPattern`モデルを追加済み
- ✅ `apps/api/prisma/seed.ts`にデフォルトデータを投入済み
- ✅ `CsvImportScheduler`はDBから件名パターンを取得し、候補を順に試行（`target.source`はフォールバック）
- ✅ `CsvImportSourceService` + `CsvImportSubjectPatternProvider` で候補生成と取得を分離（schedulerから詳細を排除）

**関連ファイル**: `apps/api/prisma/schema.prisma`, `apps/api/prisma/seed.ts`, `apps/api/src/services/imports/csv-import-scheduler.ts`

### 生産スケジュールCSVダッシュボードの差分ロジック改善

**決定**: CSVダッシュボードの差分ロジック（DEDUPモード）で、`updatedAt`タイムスタンプを優先的に使用し、完了状態でも最新の`updatedAt`を持つレコードを採用する。

**理由**: PowerAppsと管理コンソールの両方で完了/未完了の切り替えが可能なため、タイミングによっては完了済みレコードが未完了に戻される可能性がある。`updatedAt`が新しい方を優先することで、最新の状態を保持できる。

**実装状況**:
- ✅ `computeCsvDashboardDedupDiff`関数で`updatedAt`を優先的に使用（`occurredAt`はフォールバック）
- ✅ 完了状態のスキップロジックを削除し、`updatedAt`の新旧のみで判定
- ✅ `parseJstDate`関数を追加し、JST形式（`YYYY/MM/DD HH:mm`）の日付文字列をUTC `Date`オブジェクトに変換

**関連ファイル**: `apps/api/src/services/csv-dashboard/diff/csv-dashboard-diff.ts`

**詳細**: [KB-201](../knowledge-base/api.md#kb-201-生産スケジュールcsvダッシュボードの差分ロジック改善とバリデーション追加)

### 生産スケジュールCSVダッシュボードのバリデーション追加

**決定**: CSV取り込み時に`ProductNo`（10桁数字）と`FSEIBAN`（8文字英数字）のバリデーションを追加。

**理由**: データ品質を保証し、不正なデータの取り込みを防止するため。

**実装状況**:
- ✅ `CsvDashboardIngestor`に`validateProductionScheduleRow`メソッドを追加
- ✅ `ProductNo`: 10桁の数字のみ（正規表現: `^[0-9]{10}$`）
- ✅ `FSEIBAN`: 8文字の英数字（正規表現: `^[A-Za-z0-9]{8}$`）
- ✅ バリデーション失敗時は`ApiError`（400 Bad Request）をスロー

**関連ファイル**: `apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts`

**詳細**: [KB-201](../knowledge-base/api.md#kb-201-生産スケジュールcsvダッシュボードの差分ロジック改善とバリデーション追加)

### 生産スケジュールCSVダッシュボードのテンプレート形式変更

**決定**: `ProductionSchedule_Mishima_Grinding`の`templateType`を`CARD_GRID`から`TABLE`に変更し、管理コンソールで列の並び順変更・表示非表示機能を有効化。

**理由**: 計測機器持出返却ダッシュボードと同様のUI機能を提供し、運用性を向上させるため。

**実装状況**:
- ✅ `seed.ts`で`templateType`を`TABLE`に変更
- ✅ `templateConfig`に`displayColumns`を追加（列の並び順・表示非表示を管理）
- ✅ 本番環境では直接SQLで`UPDATE`を実行（`prisma db seed`が失敗するため）

**関連ファイル**: `apps/api/prisma/seed.ts`

**詳細**: [KB-203](../knowledge-base/infrastructure/ansible-deployment.md#kb-203-本番環境でのprisma-db-seed失敗と直接sql更新)

## Next Steps

### 実装順序3: サイネージ用データ取得の構築（実機検証完了）

**目的**: 計測機器の持出状況をGmail経由で取得し、サイネージで表示する機能を構築する。

**現状**: `MeasuringInstrumentLoans`（ID: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`、件名パターン: `計測機器持出状況`）について、Gmail経由のCSV取得→取り込み→サイネージ表示までのE2Eを実機検証し、正常動作を確認済み（2026-01-22）。

**実施手順（再実行・運用時のチェックポイント）**:

1. **CSVインポートスケジュールの有効化**
   - 管理コンソール（`/admin/imports/schedules`）でCSVインポートスケジュールを作成または編集
   - **ターゲット**: 「CSVダッシュボード」を選択
   - **CSVダッシュボード**: `MeasuringInstrumentLoans`を選択
   - **Gmail件名パターン**: ダッシュボード設定（`gmailSubjectPattern`）を使用するため、スケジュール側の追加設定は不要
   - **スケジュール**: 適切なcron形式を設定（例: 毎時0分に実行）

2. **サイネージスケジュールの設定**
   - 管理コンソール（`/admin/signage/schedules`）でサイネージスケジュールを作成または編集
   - **レイアウト**: 「全体表示（FULL）」または「左右分割表示（SPLIT）」を選択
   - **コンテンツ種別**: 「CSVダッシュボード」を選択
   - **CSVダッシュボード**: `MeasuringInstrumentLoans`を選択
   - **表示期間**: 適切な日数を設定（デフォルト: 7日）

3. **Gmail経由のCSV取得テスト**
   - PowerAutomateからGmailに計測機器の持出状況CSVを送信（件名: `計測機器持出状況`）
   - CSVインポートスケジュールを手動実行（またはスケジュール実行を待つ）
   - データが`CsvDashboardRow`テーブルに取り込まれることを確認

4. **サイネージ表示の確認**
   - サイネージ画面（Pi3）でCSVダッシュボードが表示されることを確認
   - または、`/api/signage/content`でレスポンスを確認（`csvDashboardsById`にデータが含まれることを確認）

**関連ファイル**:
- `apps/api/prisma/seed.ts`（`MeasuringInstrumentLoans` CSVダッシュボード設定）
- `apps/api/src/services/imports/csv-import-scheduler.ts`（CSVインポートスケジューラー）
- `apps/api/src/services/signage/signage.service.ts`（サイネージサービス）

**参考ドキュメント**:
- [CSVダッシュボード可視化機能の実機検証手順](../guides/csv-dashboard-verification.md)
- [KB-155: CSVダッシュボード可視化機能実装完了](../knowledge-base/infrastructure/signage.md#kb-155-csvダッシュボード可視化機能実装完了)

### 次のタスク候補（運用・スケール）

1. **高頻度更新の取り込み要件整理**（「最新スナップショットが見えればよい」 vs 「借用/返却イベントを全て追跡したい」）
2. **Gmail取り込みの安定化**（未読メールが溜まっても誤選択しない/再処理しない）
   - 現行は `is:unread` の検索結果先頭1通の先頭添付のみ取得し、処理後は `INBOX` ラベルを外すだけ（未読フラグは残る）ため、運用によっては再処理や“どのメールを取るか”の揺れが起き得る

### 実装順序4: 設計統一（互換性維持のみ）

**目的**: マスターデータインポート（employees, items, measuringInstruments, riggingGears）の件名パターン取得を`backup.json`からDBテーブル（`CsvImportSubjectPattern`）へ移行する。

**現状**:
- ✅ `CsvImportSubjectPattern`モデルは`schema.prisma:578-591`に追加済み
- ✅ `seed.ts`にデフォルトデータ投入済み
- ✅ `CsvImportScheduler`はマスターデータインポート時にDBから件名パターンを取得し、候補を順に試行（`target.source`はフォールバック）

**実施手順**:

1. **互換性維持**
   - `csvImportSubjectPatterns`（旧設定）はdeprecate状態で残置
   - 既存運用の影響を避けるため、削除時期は段階的に判断

**関連ファイル**:
- `apps/api/src/services/imports/csv-import-scheduler.ts`（修正対象）
- `apps/api/src/services/backup/backup-config.ts`（整理対象）
- `apps/api/prisma/schema.prisma`（モデル定義）

## Outcomes & Retrospective

### 完了したタスクの成果

- ✅ **生産スケジュールキオスクページ**: PowerAppsのUIを参考に実装し、完了ボタンによる進捗管理が可能になった
- ✅ **gmailSubjectPattern設定UI**: 管理コンソールからCSVダッシュボードごとに件名パターンを設定できるようになった
- ✅ **設計統一（DB化＋スケジューラー統合）**: `CsvImportSubjectPattern`のDB化とスケジューラー統合を完了し、後方互換は維持
- ✅ **ID自動生成機能**: CSVダッシュボード選択時にスケジュールIDと名前を自動生成し、ユーザー入力の手間を削減
- ✅ **NoMatchingMessageErrorハンドリング**: メールがない場合でもエラーにならず、正常に完了するように改善
- ✅ **ApiError statusCode尊重**: CSVインポート実行エンドポイントでApiErrorのstatusCodeを尊重し、適切なHTTPステータスコード（400/500）を返すように改善

### 学んだこと

1. **完了状態の視覚的表現**: グレーアウト（`opacity-50 grayscale`）により、完了済みアイテムを一目で識別可能
2. **トグル機能の実装**: 完了→未完了のトグルにより、誤操作時の復元が可能
3. **本番環境でのseed実行**: `tsx`がdev依存のため、本番環境では直接SQLで実行する必要がある場合がある
4. **モデル追加と実装統合の分離**: DBモデル追加だけでは不十分で、実装統合まで確認が必要。統合後に進捗記載を更新する運用が有効
5. **UIの自動化**: ユーザー入力の手間を減らすため、選択に基づく自動生成は有効（ID自動生成機能）
6. **エラーハンドリングの粒度**: メールがないことは「エラー」ではなく「スキップ可能な状態」として扱うことで、UXが向上
7. **シェル実行の安全性**: `exec(string)`はシェルエスケープが複雑になるため、`execFile`で引数配列を渡す方が安全
8. **エラーハンドリングの階層**: `ApiError`の`statusCode`を尊重することで、適切なHTTPステータスコードを返せる。クライアント側の問題（400）とサーバー側の問題（500）を適切に区別することで、デバッグが容易になる

### 今後の改善点

- 実装順序3（サイネージ用データ取得）の実機検証を完了する
- `csvImportSubjectPatterns`の削除判断（互換性を見ながら段階的に移行）
- PowerApps側へのprogress反映機能を将来的に実装する
- 本番環境での`prisma db seed`実行方法を改善する（`tsx`の代替手段を検討）
