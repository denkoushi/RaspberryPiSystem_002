---
title: KB-370 生産スケジュール「実効完了」の外部要因3系統OR統合（手動・工順ST・生産日程CSV）
tags: [生産スケジュール, CSV, FKOJUNST, 外部完了, 順位ボード]
audience: [開発者, 運用者]
last-verified: 2026-05-10
category: knowledge-base
---

# KB-370: 生産スケジュール「実効完了」の外部要因3系統OR統合

## Context

順位ボード等で参照する **実効完了** を、CSV 由来の複数ソースで一貫させる必要があった。

## ガード: 生産日程CSVで winner 論理キーが 0 件

**DEDUP** 取込の本体処理の直前時点で **現 winner の論理キー集合が空** の場合、**CSV 由来の「消滅」差分**と **`ProductionScheduleExternalCompletion` の当該列同期**は **行わない**（戻り値 `skipped: true`, `reason: 'empty_schedule_csv'`）。歴史的経路で **`ProductionScheduleCsvIngestLogicalKeySnapshot` を更新していた**場合も **同 skip で抑止**（**2026-05-09** 以降の主経路校区では当該スナップショットは未使用）。空CSVや事故入力で **DB 上の全 winner を一括「消滅完了」扱いにしない**ため。

取込パイプライン側は [`csv-dashboard-ingestor.ts`](../../apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts) で当該 skip を **warn**（`dashboardId` / `reason`）し、観測可能にする。

## Decision（仕様の要約）

実効完了は次の **論理 OR**（いずれかが真なら完了扱い）:

1. **手動**: 既存 `ProductionScheduleProgress.isCompleted`
2. **工順ST（FKOJUNST_Status メール同期 → `ProductionScheduleFkojunstMailStatus`）**
   - **`statusCode` が `C` または `X`** のとき外部完了（**2026-05-08 改訂**: 旧 **dedupe キー消失**・**`O`/`P` による完了**は廃止。`externallyCompletedFromFkojunstDisappeared` は再計算で **常に false**）
   - **`O` / `P`**: 一覧非表示だが **未完了**（製番進捗 total に残る）
3. **生産日程CSV取込（消滅完了）**
   - **2026-05-09 改訂**: **「`FKOJUNST` メール同期済み winner のうち `fkmail.statusCode <> 'C'`」かつ「`occurredAt` が基準日時の UTC **±3 カ月**」**に入る論理キー**を母集団とし、**母集団 − 今回取込で確定した現 winner 論理キー** を **消滅**とみなして `externallyCompletedFromScheduleCsvDisappeared` を更新する（**`C` は母集団から除外**・[KB-373](./KB-373-fkojunst-status-c-key-domain-mismatch.md) の **キー空間不一致**対策）。**旧仕様（〜2026-05-08 以前）**: 取込直前スナップショットと取込後キーの差分・**`S`/`R` winner に限定**する記述は **本項で置換**（正本は [deployment.md §2026-05-09 消滅窓](../guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09)）。
   - **空 winner ガード**（`empty_schedule_csv`）は変更なし。

論理キーは運用どおり **`FKOJUN` + TAB + 正規化資源CD + TAB + 製造order（ProductNo）**（`FSIGENCD` は trim・大文字化して共通関数で生成）。

## Data model

- `ProductionScheduleExternalCompletion` に由来別フラグを保持し、同期時に **`isExternallyCompleted` を3列の OR** で更新する:
  - `externallyCompletedFromFkojunstDisappeared`（**2026-05-08**: メール再計算で **常に false**。列は後方互換のため保持）
  - `externallyCompletedFromFkojunstMailStatus`（**`fkmail` の `C`/`X`**）
  - `externallyCompletedFromScheduleCsvDisappeared`
- 生産日程CSV用スナップショット: `ProductionScheduleCsvIngestLogicalKeySnapshot`（**2026-05-09**: 消滅差分の主計算からは外し、**DB／repository は互換で存続**）

## Migration

- `apps/api/prisma/migrations/20260506150000_triple_source_external_completion/migration.sql`
- 既存 `isExternallyCompleted = true` は **消滅由来列**へバックフィル（移行方針はマイグレーションコメント参照）

## 主な実装参照

- `apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.repository.ts`
- `apps/api/src/services/production-schedule/external-completion/production-schedule-csv-ingest-external-completion-sync.service.ts`
- `apps/api/src/services/production-schedule/external-completion/schedule-csv-logical-key-snapshot.repository.ts`（**2026-05-09**: 消滅主経路では非参照・互換保持）
- `apps/api/src/services/production-schedule/external-completion/production-schedule-nonc-window-winner-key.query.ts`（**非C×`occurredAt` 窓**の母集団キー）
- `apps/api/src/services/production-schedule/policies/schedule-csv-disappearance-occurred-at-window.policy.ts`（**UTC ±3 カ月**）
- `apps/api/src/services/production-schedule/policies/fkojunst-production-schedule-list-visibility.policy.ts`（`buildFkojunstScheduleCsvDisappearanceEligibleScalarSql`・**`statusCode <> 'C'`**）
- `apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts`（DEDUP + 生産日程時の post-ingest 外部完了同期）
- `apps/api/src/services/production-schedule/completion/fkojunst-mail-status-completion.policy.ts`
- `apps/api/src/services/production-schedule/production-schedule-effective-completion.sql.ts`

## Verification（ローカル）

- Vitest: `src/services/production-schedule/external-completion/__tests__/`、`src/services/csv-dashboard/__tests__/`

## Production（2026-05-08 · **FKOJUNST_Status を一覧・メール由来外部完了の唯一正本に統一**） {#production-2026-05-08-fkojunst-sole-source}

- **対象ホスト**: **`raspberrypi5` のみ**（Pi4／Pi3 **no hosts matched**）。
- **ブランチ**: **`feat/fkojunst-status-cx-completion`**（代表 **`d12b40de`**）。
- **標準手順**: [deployment.md §FKOJUNST 唯一正本（2026-05-08）](../guides/deployment.md#fkojunst-status-sole-source-2026-05-08)。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260508-192843-15997`**
  - **`PLAY RECAP`**: `ok=134` `changed=4` `failed=0` `unreachable=0`・リモート **`exit 0`**
  - **新規マイグレーション**: **なし**（`prisma migrate deploy` / `status` は playbook 内 **成功**）
- **Phase12 実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 188s**）。
- **仕様差分（メール由来）**: **完了は `C`/`X` のみ**（`externallyCompletedFromFkojunstMailStatus`）。**`externallyCompletedFromFkojunstDisappeared`** は再計算で **常に false**（キー消失完了は廃止）。
- **歴史的メモ（本番当時の CSV 消滅）**: 当時は **生産日程CSV消滅**を **`fkmail` が `S`/`R` の winner** に限定する記述で運用。**2026-05-09** に **非C×±3ヶ月窓**へ改訂（下記 [#production-2026-05-09-schedule-csv-disappearance-nonc-window](#production-2026-05-09-schedule-csv-disappearance-nonc-window)）。
- **トラブルシュート（追補）**: 下記 **「実効完了が付かない／期待とずれる」** の **メール status** は **`C`/`X` のみ**と読み替える（歴史的に **`P`/`O` 完了**と書かれた箇所は **2026-05-08 以前の経緯**）。

## Production（2026-05-09 · **生産日程CSV消滅・非C × `occurredAt` ±3ヶ月母集団**） {#production-2026-05-09-schedule-csv-disappearance-nonc-window}

- **対象ホスト**: **`raspberrypi5` のみ**（Pi4 キオスク／Pi3 **no hosts matched**・**Pi3 専用手順不要**）。
- **ブランチ**: **`feature/external-completion-schedule-disappearance-non-c`**（代表 **`89086089`**。**`main` マージ後は先端を正**）。
- **標準手順**: [deployment.md §schedule-csv-disappearance-nonc-window-2026-05-09](../guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09)。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260509-170432-1808`**
  - **`PLAY RECAP`**: `ok=134` `changed=4` `failed=0` `unreachable=0`・リモート **`exit 0`**・ローカル **`--follow` 約 705s**・**`Git: changed`**・**Docker 再起動あり**
  - **新規マイグレーション**: **なし**（`prisma migrate deploy` / `status` は playbook 内 **成功**）
- **Phase12 実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 190s**・Tailscale）。
- **知見（運用）**: 生産日程 CSV は **日付窓で切られる**ため、**旧スナップショット差分**だけでは **窓外落下を「消滅」**と誤判定し得る。**`FKOJUNST_Status` はより広い窓**で届く。**`C` はキー不整合の調査結果**（KB-373）により **消滅母集団から明示除外**し、完了は **`C`/`X` メール由来**に寄せる。
- **ローカル検証（開発時）**: 一時 Postgres で **非C・窓内・winner が日程 CSV から消えたケース**で `externallyCompletedFromScheduleCsvDisappeared` が立ち、**`C` は対象外**・**行が再出現すると消滅由来が解除**されることを確認済み（Vitest＋Docker 一時DB・検証後コンテナ削除）。

## Production（2026-05-06）

- **対象ホスト**: **`raspberrypi5` のみ**（Pi4／Pi3 の個別デプロイは不要）。
- **ブランチ**: `feat/completion-triple-source-unification`（代表コミット **`2b8c8427`**）。
- **標準手順**: [deployment.md](../guides/deployment.md) の **2026-05-06 · 実効完了3系統OR** 項。
- **Detach Run ID**（接頭辞 `ansible-update-`）: **`20260506-152049-17895`**
  - **`PLAY RECAP`**: `ok=134` `changed=4` `failed=0` `unreachable=0`・リモート **`exit 0`**
  - **`Run prisma migrate deploy`**: **成功**（**`20260506150000_triple_source_external_completion`** 適用）
- **Phase12 実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 138s**・Tailscale）。

### 追補（2026-05-06 · **空 winner ガード本番反映**·**axios**）

- **ブランチ**: **`fix/schedule-csv-empty-guard`**（API [`0fd0f248`](https://github.com/denkoushi/RaspberryPiSystem_002/commit/0fd0f248)·Web lock [`a372ecce`](https://github.com/denkoushi/RaspberryPiSystem_002/commit/a372ecce)）。
- **対象**: **`raspberrypi5` のみ**。[deployment.md](../guides/deployment.md) の **空 winner ガード** 項を正とする。
- **Detach Run ID**: **`20260506-171017-29269`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート **`exit 0`**）。
- **Phase12**: **PASS 43 / WARN 0 / FAIL 0**（**約 146s**）。

## Troubleshooting

- **本番 Postgres で「JST の当日」の CSV 点数・完了件数が 0 に見える／前日まで混じる**
  - **暦日ウィンドウの SQL** が **`TimeZone` セッション依存の誤パターン**（例: `(date)::timestamp AT TIME ZONE 'Asia/Tokyo'` だけに頼る）になっていないか確認する。**正しい midnight 拘束 + `AT TIME ZONE 'Asia/Tokyo'` の例**: [KB-377 Appendix `#kb-377-appendix-counting`](./KB-377-kiosk-leaderboard-resource-chip-completion-verification.md#kb-377-appendix-counting)。あわせて **`FKOJUNST_Status` メール用 `csvDashboardId` と本体 `PRODUCTION_SCHEDULE_DASHBOARD_ID` を取り違えていないか** を確認する（同 Appendix）。
- **順位ボードで資源コード（例: `021`）のチップだけグレーアウトしない**
  - まず **`row.isCompleted`（実効完了）が false の理由**へ分解する（メール **`C`/`X`**・手動 **`/completion`**・**CSV消失**）。**`S`/`R` は可視未完**。**winner が現集合に残っていれば差分消失は立たない**典型がある。**詳細ナレッジ**: [KB-377](./KB-377-kiosk-leaderboard-resource-chip-completion-verification.md)。
- **`[CsvDashboardIngestor]` warn と `empty_schedule_csv`**
  - **0 件 winner** 時の **想定どおりのスキップ**。上流の生産日程CSV・取込ダッシュボード・DEDUP 設定を確認（本当に行が 0 であるべきか）。
- **実効完了が付かない／期待とずれる**
  - **工順ST**: **2026-05-08 以降**は **メール status（`C`/`X`）**と **生産日程CSV消滅**が主因。**2026-05-09 以降**の消滅は **`fkmail.statusCode <> 'C'` かつ `occurredAt` が ±3ヶ月窓内**の母集団と現 winner の差分（[deployment.md 消滅窓項](../guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09)）。旧 **dedupe キー消失**完了は **廃止**（[KB-297 §外部完了](./KB-297-kiosk-due-management-workflow.md#fkojunst-status-external-completion-b-2026-05-02)）。
  - **メール status**: **`C`/`X` のみ**メール由来完了（`?` / 空 / **`O`/`P`** は **未完了**。**`O`/`P`** は一覧にも出ない）。
  - **生産日程CSV（消滅）**: **DEDUP** 取込後に **非C×±3ヶ月母集団** と **現 winner キー**を突合。**`C`** は **消滅母集団に入らない**（完了状態は **`C`/`X` メール由来**で見る）。**窓外**に落ちた行だけが CSV から消えても **消滅完了にならない**のが期待どおり。取込が **`empty_schedule_csv`** で skip されていないか ingestor **warn** を確認。歴史的に **`ProductionScheduleCsvIngestLogicalKeySnapshot`** を参照していた場合は **2026-05-09 以降は主経路未使用**（テーブルは残存し得る）。
- **マイグレ未適用**
  - Pi5 で **`prisma migrate status`** が **`20260506150000`** を **Applied** と報告するか（デプロイ playbook の migrate ログが正本）。

## References

- ブランチ: `feat/completion-triple-source-unification`（**`main`**: [PR #263](https://github.com/denkoushi/RaspberryPiSystem_002/pull/263) **squash**・先端 **`4af94e05`** を正とする）
- **空 winner ガード + axios**: **`fix/schedule-csv-empty-guard`**（**`main`**: [PR #264](https://github.com/denkoushi/RaspberryPiSystem_002/pull/264) **squash**・**`f9b1683e`** を正とする）·デプロイ記録は [deployment.md](../guides/deployment.md)（2026-05-06 · 空 winner ガード 項）
- デプロイ記録: [deployment.md](../guides/deployment.md)（2026-05-06 · 実効完了3系統OR・**2026-05-09 · 消滅窓** [#schedule-csv-disappearance-nonc-window-2026-05-09](../guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09)）
