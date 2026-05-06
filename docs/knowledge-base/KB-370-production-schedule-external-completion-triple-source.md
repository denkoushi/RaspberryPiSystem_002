---
title: KB-370 生産スケジュール「実効完了」の外部要因3系統OR統合（手動・工順ST・生産日程CSV）
tags: [生産スケジュール, CSV, FKOJUNST, 外部完了, 順位ボード]
audience: [開発者, 運用者]
last-verified: 2026-05-06
category: knowledge-base
---

# KB-370: 生産スケジュール「実効完了」の外部要因3系統OR統合

## Context

順位ボード等で参照する **実効完了** を、CSV 由来の複数ソースで一貫させる必要があった。

## Decision（仕様の要約）

実効完了は次の **論理 OR**（いずれかが真なら完了扱い）:

1. **手動**: 既存 `ProductionScheduleProgress.isCompleted`
2. **工順ST（FKOJUNST_Status メール同期）**
   - メール dedupe キー集合の **前回あり→今回なし（消滅）**
   - かつ **ステータスが `C` / `P` / `X` / `O` のいずれか**（`S` / `R` は未完了のまま）
3. **生産日程CSV取込**
   - 取込 **直前** の winner **論理キー** スナップショットと、取込 **後** の winner 集合を比較し、**消えたキー**を完了扱い

論理キーは運用どおり **`FKOJUN` + TAB + 正規化資源CD + TAB + 製造order（ProductNo）**（`FSIGENCD` は trim・大文字化して共通関数で生成）。

## Data model

- `ProductionScheduleExternalCompletion` に由来別フラグを保持し、同期時に **`isExternallyCompleted` を3列の OR** で更新する:
  - `externallyCompletedFromFkojunstDisappeared`
  - `externallyCompletedFromFkojunstMailStatus`
  - `externallyCompletedFromScheduleCsvDisappeared`
- 生産日程CSV用スナップショット: `ProductionScheduleCsvIngestLogicalKeySnapshot`

## Migration

- `apps/api/prisma/migrations/20260506150000_triple_source_external_completion/migration.sql`
- 既存 `isExternallyCompleted = true` は **消滅由来列**へバックフィル（移行方針はマイグレーションコメント参照）

## 主な実装参照

- `apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.repository.ts`
- `apps/api/src/services/production-schedule/external-completion/production-schedule-csv-ingest-external-completion-sync.service.ts`
- `apps/api/src/services/production-schedule/external-completion/schedule-csv-logical-key-snapshot.repository.ts`
- `apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts`（DEDUP + 生産日程時のスナップショット→post-ingest）
- `apps/api/src/services/production-schedule/completion/fkojunst-mail-status-completion.policy.ts`
- `apps/api/src/services/production-schedule/production-schedule-effective-completion.sql.ts`

## Verification（ローカル）

- Vitest: `src/services/production-schedule/external-completion/__tests__/`、`src/services/csv-dashboard/__tests__/`

## References

- ブランチ例: `feat/completion-triple-source-unification`（作業用・未コミット想定の場合あり）
