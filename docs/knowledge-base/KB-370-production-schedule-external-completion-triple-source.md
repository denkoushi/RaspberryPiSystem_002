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

## Production（2026-05-06）

- **対象ホスト**: **`raspberrypi5` のみ**（Pi4／Pi3 の個別デプロイは不要）。
- **ブランチ**: `feat/completion-triple-source-unification`（代表コミット **`2b8c8427`**）。
- **標準手順**: [deployment.md](../guides/deployment.md) の **2026-05-06 · 実効完了3系統OR** 項。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260506-152049-17895`**
  - **`PLAY RECAP`**: `ok=134` `changed=4` `failed=0` `unreachable=0`・リモート **`exit 0`**
  - **`Run prisma migrate deploy`**: **成功**（**`20260506150000_triple_source_external_completion`** 適用）
- **Phase12 実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 138s**・Tailscale）。

## Troubleshooting

- **実効完了が付かない／期待とずれる**
  - **工順ST**: メール同期が **dedupe 後キー0でスキップ**していないか・**初回**は消滅差分が無い（[KB-297 §外部完了](./KB-297-kiosk-due-management-workflow.md#fkojunst-status-external-completion-b-2026-05-02)）。
  - **メール status**: **`C`/`P`/`X`/`O` のみ**完了扱い（`?` や空は未完了のまま）。
  - **生産日程CSV**: **DEDUP** 取込でのみスナップショット＆差分。**取込後の「現在キー」は DB 再クエリではなく今回CSVの winner 集合**で比較（取りこぼし防止）。`ProductionScheduleCsvIngestLogicalKeySnapshot` の内容と取込ログを確認。
- **マイグレ未適用**
  - Pi5 で **`prisma migrate status`** が **`20260506150000`** を **Applied** と報告するか（デプロイ playbook の migrate ログが正本）。

## References

- ブランチ: `feat/completion-triple-source-unification`（**`main`**: [PR #263](https://github.com/denkoushi/RaspberryPiSystem_002/pull/263) **squash**・先端 **`4af94e05`** を正とする）
- デプロイ記録: [deployment.md](../guides/deployment.md)（2026-05-06 · 実効完了3系統OR）
