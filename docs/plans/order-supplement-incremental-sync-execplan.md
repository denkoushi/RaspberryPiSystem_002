# 着手日同期の差分反映化と手動補正保護 ExecPlan

このExecPlanは `.agent/PLANS.md` に従う生きたドキュメントとして運用する。作業中に進捗・判断・発見を更新し、途中再開時でもこの文書だけで意図を再現できる状態を維持する。

## Purpose / Big Picture

`ProductionScheduleOrderSupplement` の同期を「全削除→再作成」から「差分反映」に変更し、CSV取得頻度増加時に着手日が `-` へ急減する現象を抑える。あわせて、手動補正済みの着手日を自動取り込みで上書きしない保護と、1年以上前の古い自動着手日の削除を導入する。利用者は購買照会・順位ボードで着手日表示の安定化を確認できる。

## Progress

- [x] (2026-05-01T01:49Z) 専用ブランチ `feat/order-supplement-incremental-sync` を作成。
- [x] (2026-05-01T01:59Z) 現行同期実装（全削除→createMany）と要件差分を特定。
- [x] (2026-05-01T02:08Z) 差分同期ロジック（create/update）と手動着手日保護ロジックを実装。
- [x] (2026-05-01T02:11Z) `ProductionScheduleOrderSupplement` に `plannedStartDateManuallySet` / `lastSeenAt` を追加する Prisma schema と migration を追加。
- [x] (2026-05-01T02:15Z) 既存ユニットテストを差分同期仕様へ更新。
- [x] (2026-05-01T02:22Z) `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/order-supplement-sync.service.test.ts` を実行し 3 tests passed を確認。
- [x] (2026-05-01T02:23Z) `pnpm --filter @raspi-system/api lint` を実行し成功を確認。
- [x] (2026-05-01T02:24Z) 実装結果の最終点検とユーザー報告準備。
- [x] (2026-05-01 JST) 本番 **`raspberrypi5` のみ**デプロイ（[deployment.md](../guides/deployment.md) 標準・Detach **`20260501-111010-10961`**・**`PLAY RECAP` `failed=0` / `unreachable=0`**）。
- [x] (2026-05-01 JST) `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **26s**・Tailscale）。
- [x] (2026-05-01 JST) デプロイ実績・仕様・TS を [deployment.md](../guides/deployment.md)·[KB-297](../knowledge-base/KB-297-kiosk-due-management-workflow.md)·[KB-328](../knowledge-base/KB-328-production-schedule-supplement-key-mismatch-investigation.md)·[INDEX](../INDEX.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md) に反映。

## Surprises & Discoveries

- 観測: 現行同期は source単位で `deleteMany` してから再投入しており、入力ゆらぎがそのまま表示欠損に伝播する。
  Evidence: `apps/api/src/services/production-schedule/order-supplement-sync.pipeline.ts` の既存実装。

## Decision Log

- Decision: 差分同期の更新キーは既存ユニーク制約 `(csvDashboardId, sourceCsvDashboardId, productNo, resourceCd, processOrder)` を踏襲する。
  Rationale: 既存DB契約を壊さず最小変更で導入できるため。
  Date/Author: 2026-05-01 / Codex

- Decision: 手動保護は `plannedStartDateManuallySet=true` で判定し、着手日のみ上書き禁止にする。
  Rationale: 既存要件「手動変更は守る」を満たしつつ、数量・終了日は最新CSV追従を維持できるため。
  Date/Author: 2026-05-01 / Codex

- Decision: 古い削除は `plannedStartDate < now - 1 year` かつ `plannedStartDateManuallySet=false` に限定する。
  Rationale: 手動補正の誤削除を避ける安全側動作を優先するため。
  Date/Author: 2026-05-01 / Codex

## Outcomes & Retrospective

- 着手日同期を差分反映へ変更し、全削除置換を廃止した。
- 手動補正保護フラグと lastSeenAt を追加し、同期時に手動着手日を維持できる形へ移行した。
- 1年超過の自動着手日削除を追加し、履歴蓄積時の肥大化に対する保守導線を入れた。

## Context and Orientation

- 同期本体は `apps/api/src/services/production-schedule/order-supplement-sync.pipeline.ts`。
- サービスエントリは `apps/api/src/services/production-schedule/order-supplement-sync.service.ts`。
- 取り込み後フックは `apps/api/src/services/csv-dashboard/csv-dashboard-post-ingest.service.ts` からこの同期サービスを呼ぶ。
- DB契約は `apps/api/prisma/schema.prisma` の `ProductionScheduleOrderSupplement` モデル。

## Plan of Work

1. パイプラインを差分同期へ変更する。既存補助行をキーで読み込み、新規CSVの正規化結果を winner 行へ解決して create/update を分岐する。
2. 手動補正保護を導入する。既存行が `plannedStartDateManuallySet=true` の場合、着手日値を保持する。
3. 1年超過の自動着手日を prune する。同期トランザクション内で削除する。
4. スキーマ拡張と migration を追加する。
5. ユニットテストを新仕様に合わせる。

## Concrete Steps

1. `order-supplement-sync.pipeline.ts` を更新し、`loadExistingSupplementsByKey` / `updateInputs` / retention prune を追加。
2. `order-supplement-sync.service.ts` を更新し、clear分岐を削除して差分同期を常時適用。
3. `schema.prisma` と `prisma/migrations/.../migration.sql` を更新。
4. `order-supplement-sync.service.test.ts` を新仕様（create/update/manual保護）へ更新。
5. `pnpm --filter @raspi-system/api test -- order-supplement-sync.service.test.ts` を実行して確認。

## Validation and Acceptance

- ユニットテストが通ること。
- テスト内で次を観測できること。
  - 新規行は create される
  - 照合不能行で既存を消さない
  - `plannedStartDateManuallySet=true` では着手日を保持する

## Idempotence and Recovery

- この変更は再実行可能。差分同期のため重複投入でデータ増殖しない。
- migration は additive。失敗時は migration ロールバック手順に従う。

## Artifacts and Notes

- 実装差分: APIサービス・Prisma schema・migration・ユニットテスト。

## Interfaces and Dependencies

- 既存依存: Prisma Client, `buildMaxProductNoWinnerCondition`, `normalizeProductionScheduleResourceCd`。
- 追加DB列:
  - `plannedStartDateManuallySet: boolean`
  - `lastSeenAt: timestamp`

---

### 更新履歴

- 2026-05-01: 初版作成。理由: 着手日 `-` 増加の主要因である全削除置換を差分同期へ変更する実装を、再開可能な形で記録するため。
- 2026-05-01: 進捗・検証結果・成果を反映。理由: 実装とテストが完了したため、計画を現況へ同期するため。
