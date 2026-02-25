# KB-273: CSVダッシュボードの重複削除共通化とエラーメール廃棄ポリシー統一

## Context

- Production Schedule のみ、重複 loser 行の即時削除（DB削除）が実装されていた。
- 他の CSV ダッシュボードは DEDUP でも loser が残り得る仕様差があった。
- Gmail 取得時、フォーマット不正などの非再試行系エラーでもメールが受信箱に残り、再試行対象と混在していた。

## Symptoms

- ダッシュボード種別によって重複データの残存挙動が異なる。
- 同一の不正 CSV メールが繰り返し処理対象になる。

## Investigation

- CONFIRMED: `CsvDashboardIngestor` では Production Schedule 専用 cleanup のみが即時削除を担っていた。
- CONFIRMED: `CsvDashboardImportService` は失敗時にメール廃棄を行わず、成功時後処理（既読/ゴミ箱）中心だった。
- CONFIRMED: 非再試行か否かの判定ロジックが明示的なポリシークラスとして分離されていなかった。

## Root Cause

- 重複 loser 削除ロジックがダッシュボード共通サービス化されておらず、Production Schedule に局所実装されていた。
- 失敗時メール処理に「再試行可否」ポリシー境界がなく、運用仕様を一貫して適用できていなかった。

## Fix

- `CsvDashboardDedupCleanupService` を追加し、DEDUP ダッシュボード共通で loser 即時削除を実施。
  - 観測キー範囲のみを対象（過剰削除防止）
  - winner 順序は注入可能（Production Schedule は既存互換）
- `CsvErrorDispositionPolicy` を追加し、`RETRIABLE` / `NON_RETRIABLE` 判定を分離。
- `CsvDashboardImportService` で `NON_RETRIABLE` のみ `trashMessage` を実行。
  - 既存の Gmail 側ラベル付与経路（`rps_processed`）と整合
- 監査性を強化:
  - debug に `postProcessStateByMessageIdSuffix` / `disposeReasonByMessageIdSuffix` を追加
  - `CsvDashboardIngestRun.errorMessage` へ `[ingest-audit] postProcessState=...` を追記

## Prevention

- 重複削除と winner 決定は「サービス + 注入パラメータ」に統一し、ダッシュボード別要件は設定で吸収する。
- Gmail失敗時の後処理は `CsvErrorDispositionPolicy` を唯一の判定境界にし、個別分岐を増やさない。
- 監査情報（状態・理由）を構造化ログと IngestRun に残し、運用時の判定を再現可能にする。

## References

- `apps/api/src/services/csv-dashboard/csv-dashboard-dedup-cleanup.service.ts`
- `apps/api/src/services/csv-dashboard/csv-error-disposition-policy.ts`
- `apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts`
- `apps/api/src/services/csv-dashboard/csv-dashboard-import.service.ts`
- `apps/api/src/services/csv-dashboard/__tests__/csv-error-disposition-policy.test.ts`
- `apps/api/src/services/csv-dashboard/__tests__/csv-dashboard-ingestor-dedup-keys.test.ts`
- `apps/api/src/services/csv-dashboard/__tests__/csv-dashboard-import.service.audit.test.ts`

