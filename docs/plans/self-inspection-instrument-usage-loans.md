# 自主検査の計測機器使用前点検・持出統合

Status: completed / deployed / user-verified
Last updated: 2026-06-30

作業ブランチ: `feat/self-inspection-instrument-usage-loans`

## 目的

自主検査の入力件ごとに、複数の計測機器を「使用前点検済」として記録する。計測機器を点検して持ち出す行為は、持出画面からでも自主検査画面からでも同じ業務イベントなので、元データは既存の `Loan` / `InspectionRecord` / `MeasuringInstrumentLoanEvent` に統合する。

## 現仕様

- `SelfInspectionLotEntry.measuringInstrumentId` は互換用に残し、最初に使用前点検済になった1台を入れる。
- 複数機器の正本は `SelfInspectionLotEntryInstrumentUsage`。
- 過去データは migration で usage テーブルへ backfill する。過去行の `loanId` は捏造せず `NULL`。
- 自主検査からの使用前点検成功時は、既存の計測機器持出と同じ `Loan` を正本にする。
- 未貸出なら `Loan` を作成し、計測機器を `IN_USE` にし、貸出 transaction と NFC 貸出イベントを作る。
- 同じ社員が貸出中なら既存 `Loan` を再利用し、今回の `InspectionRecord` と usage だけを作る。
- 別社員が貸出中なら 409 で拒否する。
- 同じ入力件で同じ計測機器を再スキャンした場合は usage / `Loan` / `InspectionRecord` を二重作成せず、既存 usage を返す。
- 返却は自主検査画面では扱わず、既存の計測機器持出一覧/返却フローで行う。

## API

`POST /api/part-measurement/self-inspection/sessions/:id/entries/:entryIndex/instrument-usages/pre-use-inspection`

body:

```json
{
  "instrumentTagUid": "計測機器タグUID",
  "employeeTagUid": "社員タグUID"
}
```

成功時:

- entry が無ければ値なしの `SelfInspectionLotEntry` を作る。
- entry の測定者が未設定なら社員タグの従業員を測定者として補完する。
- entry に別の測定者が設定済みなら拒否する。
- `Loan` 作成または再利用、`InspectionRecord` 作成、usage 作成を同一 transaction で行う。

## UI

- 自主検査右ペインは `使用前点検（この入力件）`。
- 計測機器タグをスキャンすると、計測機器持出画面と同じ点検項目確認画面へ遷移する。
- 点検確認後に氏名タグをスキャンすると新 API を呼び、元の自主検査 session + entryIndex に戻る。
- 右ペインと検査記録確認画面は複数の使用機器を一覧表示する。
- 文言は `使用前点検済` / `未点検` / `点検不足` に統一する。
- 設定名は `計測機器の使用前点検必須`。

## 完了・承認判定

- 必須 ON: required entry ごとに、測定者と最低1台の使用前点検済み計測機器が必要。
- 必須 OFF: 測定者だけで保存・承認可能。点検した計測機器はすべて記録する。

## DB

- 新テーブル: `SelfInspectionLotEntryInstrumentUsage`
- 主要列: `entryId`, `measuringInstrumentId`, `loanId`, 計測機器 snapshot, `preUseInspectedAt`
- 主要 index: `entryId`, `measuringInstrumentId`, `loanId`
- migration: `20260630160000_self_inspection_instrument_usage_loans`

## 検証

- `pnpm --filter @raspi-system/api prisma:generate`
- `pnpm --filter @raspi-system/api build`
- `pnpm --filter @raspi-system/web build`
- 一時 `pgvector/pgvector:pg16` Postgres で `prisma migrate deploy`
- backfill SQL で legacy single-instrument entry が usage に移ることを確認
- `EXPLAIN` で `entryId`, `measuringInstrumentId`, `loanId` 検索が index scan になることを確認
- 一時 DB 上で新 API integration 2件を実行
- `pnpm --filter @raspi-system/web test`
- `pnpm --filter @raspi-system/api test -- src/services/part-measurement/__tests__/self-inspection-registration-tag-validation.test.ts`

## 完了記録（2026-06-30）

- 実装 commit: `006f8ea0 feat: integrate self-inspection instrument usage loans`
- CI: GitHub Actions run `28427006703` success
- 本番デプロイ: `update-all-clients.sh` run `20260630-162728-8098` success、対象 host はすべて `failed=0`
- 実機自動検証: Phase12 `PASS 45 / WARN 0 / FAIL 0`
- ユーザー実機検証: OK

## 次回AI向けの最小引き継ぎ

- 自主検査の計測機器使用前点検は、入力件単位で複数台を `SelfInspectionLotEntryInstrumentUsage` に保持する。
- 業務イベントの正本は既存の `Loan` / `InspectionRecord` / 計測機器貸出イベント。自主検査専用の別集計元は作らない。
- 既存互換のため `SelfInspectionLotEntry.measuringInstrumentId` は残し、最初の1台だけを入れる。
- 同じ社員の既存貸出は再利用し、別社員が貸出中の機器は拒否する。
- 同じ入力件で同じ機器を再スキャンしても二重作成しない。
- 返却は自主検査画面では扱わず、既存の計測機器持出一覧/返却フローで行う。
- 本件スコープの未完了事項はなし。紙/OCR取込からのリアルタイム `Loan` 作成、点検NG時の詳細UI、返却導線の自主検査画面内追加は今回の対象外。
