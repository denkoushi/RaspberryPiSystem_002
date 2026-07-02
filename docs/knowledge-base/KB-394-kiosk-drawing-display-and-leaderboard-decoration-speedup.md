---
title: KB-394 Kiosk drawing display and leaderboard decoration speedup
tags: [kiosk, part-measurement, leaderboard, performance, cache]
audience: [開発者]
last-verified: 2026-07-03
category: knowledge-base
---

# KB-394: Kiosk drawing display and leaderboard decoration speedup

## Metadata

| Field | Value |
|-------|-------|
| id | KB-394 |
| status | active |
| scope | キオスク「順位ボード」「検査図面」「自主検査」の図面表示速度、`POST …/leaderboard-decorations` の装飾 API 内部レイテンシ |
| date | 2026-07-02 |
| source_of_truth | this file |
| related_code | `apps/api/src/routes/storage/part-measurement-drawings.ts`, `apps/api/src/lib/part-measurement-drawing-storage.ts`, `apps/web/src/features/part-measurement/usePartMeasurementDrawingBlobUrl.ts`, `apps/api/src/services/production-schedule/leaderboard/leaderboard-materialized-winner-cache.ts`, `apps/api/src/services/production-schedule/production-schedule-query.service.ts` |

## Context

ユーザー要望（2026-07-02）: キオスクの「順位ボード」「検査図面」「自主検査」で表示する図面の表示速度向上、および順位ボードのアイテム表示速度向上。

2026-07-03 handoff update: 実装 commit `2ceb79c1` は `origin/main` へ反映済み。GitHub Actions、標準デプロイ、Pi 実機検証、対象 API の本番確認まで完了している。

## Symptoms Or Trigger

- キオスク画面遷移・コンポーネント再マウントのたびに、図面（最大 12MiB）がフル再ダウンロードされる。
- 順位ボードの装飾（機種名・顧客名・フッターチップ）が、shell 行表示後も後追いで遅く見える。`POST …/leaderboard-decorations` のバッチ POST ごとに固定コストが繰り返される。

## Investigation

- **図面配信** `GET /api/storage/part-measurement-drawings/*`（[`part-measurement-drawings.ts`](../../apps/api/src/routes/storage/part-measurement-drawings.ts)）は `fs.readFile` 全バッファ送信のみで、`Cache-Control` / `ETag` / `304` が無く、キオスクの画面遷移・再マウントごとに最大 12MiB のフル再ダウンロードが発生していた。
- **フロント hook** [`usePartMeasurementDrawingBlobUrl`](../../apps/web/src/features/part-measurement/usePartMeasurementDrawingBlobUrl.ts) は毎マウントで axios blob 取得しており、コンポーネント間・画面遷移間の共有キャッシュが無かった。利用画面: 検査図面の作成/編集/印刷ページ、自主検査セッションページ、`KioskPartMeasurementEditPage`、`PartMeasurementTemplateCandidateDrawing`。
- **順位ボード**自体は図面バイナリを扱わず（`hasSelfInspectionDrawing` フラグのみ）。アイテム装飾は `POST /api/kiosk/production-schedule/leaderboard-decorations` に **優先 8 行 / 資源 → 背景 80 行 × 80ms** のバッチ分割 POST。各 POST ごとに `resolveLeaderboardMaterializedBaseWhere` → `fetchMaxProductNoWinnerRowIdsForDashboard`（`CsvDashboardRow` 全体のウィンドウ集約、winner 約 5 万件）が固定コストとして毎回実行されていた（**board/continue 経路はリクエスト内共有済み** — [KB-369](./KB-369-leader-order-board-api-internal-latency.md) 参照）。
- **図面ファイル**は `{randomUUID}{ext}` 保存で同一パスの内容上書きコードパスは無い（`saveDrawing` は常に新 UUID、更新は delete + save）→ **immutable キャッシュが安全**。

## Root Cause

1. 図面 API に HTTP 条件付きキャッシュが未実装。
2. フロントに図面 Blob のプロセス内共有キャッシュが無い。
3. decorations 経路のみ、バッチ POST ごとに winner materialization（約 99ms、テスト DB 5 万行 seed 実測）を再実行していた。board/continue/labor-metadata 経路は既にリクエスト内で materialized base WHERE を共有していた。

## Fix

すべて **2026-07-02 実装**。**最小変更・レスポンス契約不変**。

### 1. 図面配信 API に HTTP キャッシュ

- [`part-measurement-drawings.ts`](../../apps/api/src/routes/storage/part-measurement-drawings.ts): `ETag`（既存 pdf-pages の `buildPdfPageEtag` = size-mtimeMs 方式を再利用）、`If-None-Match` 一致で **304**、`Cache-Control: private, max-age=86400, immutable`（認証付き配信のため `private`）。
- [`part-measurement-drawing-storage.ts`](../../apps/api/src/lib/part-measurement-drawing-storage.ts): `resolveDrawingFile` 共通化 + `statDrawing` 追加（`readDrawing` のシグネチャ不変）。

### 2. フロント図面 Blob のモジュールレベル LRU キャッシュ

- [`usePartMeasurementDrawingBlobUrl.ts`](../../apps/web/src/features/part-measurement/usePartMeasurementDrawingBlobUrl.ts): 上限 **10 エントリ**、参照カウント方式（参照 0 のエントリのみ evict + `revokeObjectURL`）、同一パス並行 fetch の Promise 共有。hook の公開シグネチャ不変。「**パス変更時は取得完了まで `blobUrl=null`（旧図面と新測定点の重なり防止）**」の既存仕様維持（キャッシュヒット時は `useLayoutEffect` で即時反映）。

### 3. 装飾 API の winner materialization 世代キャッシュ

- 新規 [`leaderboard-materialized-winner-cache.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-materialized-winner-cache.ts): `resolveLeaderboardMaterializedBaseWhereWithGenerationCache` — `readLeaderboardShellSnapshotGenerationToken()`（約 13ms）で世代を読み、一致時は winner materialization（約 99ms）を再利用。進行中 Promise 共有あり。**プロセスローカル 1 エントリ**。
- [`production-schedule-query.service.ts`](../../apps/api/src/services/production-schedule/production-schedule-query.service.ts) の `decorateLeaderboardShellRowsForKiosk` **のみ**差し替え。board/continue/labor-metadata 経路は変更なし。
- **正しさの境界**: 世代トークンは `rowsCount` / `MAX(createdAt)` 等で構成。`rowData` の in-place UPDATE で ProductNo / 論理キーが変わる場合はトークン不変のまま winner が変わり得るが、これは shell/continue の snapshot 世代機構が既に共有している前提であり、decorations は同一 shell 世代内で実行されるため **整合境界は既存と同じ**。

## Prevention

- 図面配信: [`part-measurement-drawings.integration.test.ts`](../../apps/api/src/routes/__tests__/part-measurement-drawings.integration.test.ts)（200 に ETag/Cache-Control、`If-None-Match` で 304）。
- フロント LRU: [`usePartMeasurementDrawingBlobUrl.test.ts`](../../apps/web/src/features/part-measurement/usePartMeasurementDrawingBlobUrl.test.ts)（同一パス再マウントで fetch 1 回、パス変更時 null 維持、エラー非キャッシュ）。
- decorations 世代キャッシュ: [`leaderboard-materialized-winner-cache.test.ts`](../../apps/api/src/services/production-schedule/leaderboard/__tests__/leaderboard-materialized-winner-cache.test.ts)（同一トークン 1 回 / トークン変化で再実行 / 並行共有）。
- 回帰: [`kiosk-production-schedule.integration.test.ts`](../../apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts)（decorations match monolithic 含む）、`src/services/production-schedule` 全体。

## Validation

2026-07-02、Mac 上の一時 Docker Postgres `postgres-test-local`（`pgvector/pgvector:pg15`、`localhost:5432`、migrate 適用済み）で実施。**検証後にコンテナ・匿名 volume は削除済み**。

| Check | Result |
|-------|--------|
| `apps/api`: `tsc -p tsconfig.build.json --noEmit` | PASS |
| `apps/api`: eslint（変更 6 ファイル） | PASS |
| `part-measurement-drawings.integration.test.ts` | 2 passed（200 に ETag/Cache-Control、`If-None-Match` で 304 実測） |
| `leaderboard-materialized-winner-cache.test.ts` | 3 passed（同一トークン 1 回 / トークン変化で再実行 / 並行共有） |
| `kiosk-production-schedule.integration.test.ts` | 98 passed（decorations match monolithic 含む） |
| `src/services/production-schedule` 全体 | 106 files / 422 tests passed |
| `apps/web`: `usePartMeasurementDrawingBlobUrl.test.ts` | 5 passed |
| `apps/web`: `tsc -b` | PASS |

### Post-Merge / Production Validation

2026-07-02 から 2026-07-03 にかけて、commit `2ceb79c1`（`fix(kiosk): cache drawing assets and leaderboard decorations`）を `origin/main` に push し、CI と実機反映を確認した。

| Check | Result |
|-------|--------|
| GitHub Actions CI run `28592650438` | success（`lint-build-unit`, `api-db-and-infra`, `e2e-smoke`, `security-docker`, `e2e-tests`） |
| Secret scan `28592650510` | success |
| CodeQL `28592650528` | success |
| Pages build/deploy `28592648491` | success |
| Standard deploy | success。Run ID `20260702-222623-917`、remote log `/opt/RaspberryPiSystem_002/logs/deploy/ansible-update-20260702-222623-917.log` |
| Deploy recap | all hosts `failed=0` / `unreachable=0`（Pi5、全 Pi4、Pi3） |
| `verify-phase12-real.sh` | `PASS: 45`, `WARN: 0`, `FAIL: 0` |
| Pi5 health | `/api/system/health` returned `status: ok`; `docker-api-1` and `docker-db-1` healthy, `docker-web-1` running |
| Production drawing API | existing drawing returned first `200`, `Cache-Control: private, max-age=86400, immutable`, stable `ETag`, then `If-None-Match` returned `304` |
| Production leaderboard decorations API | 80 requested rows returned `rowDecorations=80`; consecutive POSTs succeeded; sample row resolved machine name and `hasSelfInspectionDrawing=false` |

Observed production drawing path used for cache verification: `/api/storage/part-measurement-drawings/403c2bf4-ba0c-488c-aeb0-3b579981d687.jpg`.

## Open Items

- **図面サムネイル/リサイズ配信**（原寸最大 12MiB のまま）は未着手の追加改善候補。
- **装飾 per-batch の client-perf 計測**（[KB-369](./KB-369-leader-order-board-api-internal-latency.md) / [KB-374](./KB-374-leaderboard-board-continue-cursor-contract.md) の推奨）は未実装。
- **キオスク 3 画面の人手体感確認**（現場の実操作で図面再表示と順位ボード装飾追従を確認）は、API/サービス実機検証後の任意フォローアップ。

## References

- [KB-369 · 順位ボード API 内部レイテンシ](./KB-369-leader-order-board-api-internal-latency.md)
- [KB-374 · board/continue 契約](./KB-374-leaderboard-board-continue-cursor-contract.md)
- [KB-392 · 順位ボード現行契約の正本](./KB-392-kiosk-leaderboard-spec-source-of-truth.md)
- Implementation commit: `2ceb79c1`
