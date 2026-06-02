---
title: KB-383 キオスク順位ボード・資源035など過去納期行の滞留調査（2026-06-01）
tags: [キオスク, 順位ボード, 生産スケジュール, FSIGENCD, FKOJUNST, 調査, ナレッジ]
audience: [開発者, 運用者]
last-verified: 2026-06-02
related:
  [
    KB-375-kiosk-leaderboard-completion-integrity.md,
    KB-377-kiosk-leaderboard-resource-chip-completion-verification.md,
    KB-370-production-schedule-external-completion-triple-source.md,
    KB-373-fkojunst-status-c-key-domain-mismatch.md,
    KB-297-kiosk-due-management-workflow.md,
  ]
category: knowledge-base
update-frequency: low
status: investigation-paused
---

# KB-383: キオスク順位ボード・過去納期行の滞留調査（資源 `035` ほか）

## 調査の位置づけ（2026-06-02 時点）

| 項目 | 内容 |
|------|------|
| **状態** | **調査中断**（アプリ側原因調査は打ち切り可） |
| **コード変更** | **なし**（調査中に挿入したデバッグ計測は **revert 済み**・本番未反映） |
| **実装** | **着手しない**（次フェーズは上流確認・必要なら UI の「長期滞留・要確認」分離のみ） |
| **調査前提日** | **2026-06-01 JST**（本番 Pi5 `denkon5sd02@100.106.158.2`・Docker `db` **読取のみ**） |
| **起点症状** | キオスク順位ボードで資源 CD **`035`** などに **数か月前の納期**が残り、未完として目立つ |

**外部調査指示書**（ローカル・リポ外）: `~/Documents/Codex/2026-05-31/.../cursor_investigation_kiosk_leaderboard_stale_due_items.md`（会話・エージェント transcript と併用）。

---

## Context

現場では「工程は進んでいるのに、順位ボードに古い納期の未完行が残る」と感じられる。過去 KB（[KB-377](./KB-377-kiosk-leaderboard-resource-chip-completion-verification.md)・[KB-370](./KB-370-production-schedule-external-completion-triple-source.md)）では **完了意味**と **CSV 差分消失**が主題だったが、**2026-05-26 以降**は差分消失完了は廃止され、実効完了は **手動 + `FKOJUNST_Status` の `C`/`X`** のみ（[ADR-20260526](../decisions/ADR-20260526-production-schedule-completion-status-only.md)）。

本調査は **「アプリが古い行を誤って残しているのか」** と **「上流ステータスが `S/R` のままなのか」** を切り分けることを目的とした。

---

## Symptoms

- 順位ボード（`/kiosk/production-schedule/leader-order-board`）で **資源 `035`** の行に **2025-12 など過去の表示納期**が並ぶ。
- 代表例: 製番 **`AA1S2M02`** で **`2025-12-18`**, **`2025-12-23`** など（本番 DB 上も **`FKOJUNST` 最新が `R`**）。
- 完了フィルタを **「完了」** にすると見えなくなる行も多いが、**初期表示は「未完」** のため、オープン直後は古い未完行が目立つ。

---

## Investigation（仮説 → 検証 → 結果）

### H1: 表示納期ロジックが古い日付を誤って拾っている

- **検証**: Web [`plannedDueDisplay.ts`](../../apps/web/src/features/kiosk/productionSchedule/plannedDueDisplay.ts)、API [`leaderboard-shell-row-projection.sql.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-row-projection.sql.ts)（`COALESCE(dueDate, plannedEndDate)`）。
- **結果**: **CONFIRMED（仕様どおり）** — **過去日付の除外はない**。表示は DB にある納期をそのまま使う。

### H2: 並び順・`processingOrder` 残骸で古い行が上に来る

- **検証**: [`sortLeaderBoardRowsForDisplay.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/sortLeaderBoardRowsForDisplay.ts)、[`leaderboard-row-selection.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-row-selection.service.ts)。
- **結果**: **部分 CONFIRMED** — 未割当は **表示納期昇順（古いほど上）**。ただし資源 `035` の期限切れ **55 件はすべて `processingOrder = null`** のため、**順位固定の残骸は主因ではない**。

### H3: 完了フィルタ・可視性で「見える件数」が増幅している

- **検証**: [`ProductionScheduleLeaderOrderBoardPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) 初期 `completionFilter='incomplete'`、[`filterLeaderBoardRowsByCompletion.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/filterLeaderBoardRowsByCompletion.ts)。
- **可視性**: [`fkojunst-production-schedule-list-visibility.policy.ts`](../../apps/api/src/services/production-schedule/completion/fkojunst-production-schedule-list-visibility.policy.ts) — **`S`/`R`/`C`/`X` のみ** 一覧母集団。
- **結果**: **CONFIRMED** — API 母集団上は期限切れ **55 件**（`fkmail` 可視）だが、**通常の初期 UI では `S/R` + 実効未完の 11 件が中心**（`C/X` + 完了 **44 件**は未完フィルタで除外）。

### H4: 生産日程 CSV の「期間外落ち」「差分消失完了」が未完 `S/R` を説明する

- **検証**: [`production-schedule-csv-ingest-external-completion-sync.service.ts`](../../apps/api/src/services/production-schedule/external-completion/production-schedule-csv-ingest-external-completion-sync.service.ts)（**2026-05-26 以降 no-op**）、[`production-schedule-effective-completion.sql.ts`](../../apps/api/src/services/production-schedule/production-schedule-effective-completion.sql.ts)。
- **結果**: **REJECTED（現行主因ではない）** — 期間外で CSV から消えても **自動完了にはならない**。cleanup は **1 年超** 基準で、数か月前は残る。

### H5: `FKOJUNST_Status` 同期遅延・取込停止で古い `S/R` が残る

- **検証**: 本番 `CsvDashboardIngestRun`（dashboard `b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e`）、raw 最大 `FUPDTEDT`。
- **結果**: **REJECTED（弱い）** — 最新成功 run **2026-05-31 19:44:37 JST 前後**、直近も日次 success。raw 最大 `FUPDTEDT` 約 **2026-05-30 23:50:42+00**。

### H6: ボードの `S/R` は同期残骸で、原本には `C/X` がある

- **検証**: 厳密 **3 キー**（`FKOJUN` + `FKOTEICD`/`FSIGENCD` + `FSEZONO`/`ProductNo`）で raw winner と `ProductionScheduleFkojunstMailStatus` を突合（[`fkojunst-mail-winner-by-triple.reader.ts`](../../apps/api/src/services/production-schedule/fkojunst-mail-winner-by-triple.reader.ts)）。
- **結果**: **REJECTED** — 問題 **11 件すべて**で **current `S/R` = raw latest `S/R`**。履歴遷移あり（例: `R→S`, `P→R→S`, `O→R`）。

### H7: 同一 `ProductNo` の別工程 `C/X` を 035 に転写すべき

- **検証**: 同一 `ProductNo` で他 `FKOJUN`×`FKOTEICD` に `C/X` があるが 035 だけ `S/R` の例を複数確認。
- **結果**: **意図的に採用しない**（[KB-373](./KB-373-fkojunst-status-c-key-domain-mismatch.md)・[ADR-20260509](../decisions/ADR-20260509-fkojunst-status-completion-matching-policy.md) と整合）。**厳密 3 キーを緩めると別工程完了の誤転写リスク**。

### H8: 端末キャッシュが数か月分の stale を保持している

- **検証**: [KB-374](./KB-374-leaderboard-board-continue-cursor-contract.md) の IndexedDB / 120s 同期 SLA。
- **結果**: **REJECTED（主因ではない）** — 鮮度は最大約 **2 分**程度。数か月の表示差は説明できない。

---

## 本番 DB 集計（資源 `035`・表示納期が過去・`fkmail` 可視）

**参照日**: 2026-06-01 JST。表示納期 = `COALESCE(ProductionScheduleNote.dueDate, ProductionScheduleOrderSupplement.plannedEndDate)`。

| 区分 | 件数 | 通常順位ボード（未完フィルタ）での意味 |
|------|------|----------------------------------------|
| 期限切れかつ `fkmail` 可視（`S/R/C/X`） | **55** | API 母集団 |
| うち `R` + 実効未完 | 9 | **初期表示で問題になりやすい** |
| うち `S` + 実効未完 | 2 | **同上** |
| うち `C` + 実効完了 | 31 | 未完フィルタで **非表示** |
| うち `X` + 実効完了 | 8 | **非表示** |
| 上記 11 件の `processingOrder` | **全件 null** | 納期昇順で上に来るだけ |

**実効完了**（調査時点の現行）: `ProductionScheduleProgress.isCompleted` OR `ProductionScheduleExternalCompletion.isExternallyCompleted`（実質 **`FKOJUNST` `C`/`X`**）。

**ダッシュボード ID**（再現用）:

- 生産日程: `3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01`（[`constants.ts`](../../apps/api/src/services/production-schedule/constants.ts)）
- `FKOJUNST_Status` メール: `b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e`

**調査時の SQL 落とし穴（再発防止）**:

- `CsvDashboardIngestRun.status` は enum — **`status::text = 'completed'`** を使う（`ImportStatus=completed` 等の誤記で 0 件になり得る）。
- `csvDashboardId` は **UUID 文字列**（整数 `2` 等と混同しない）。

**ローカル Mac DB**: 空に近く **症状再現不可**。本番は **SSH + `docker compose exec db psql`** のみで検証した。

---

## Root cause（技術・業務の切り分け）

| レイヤ | 判定 |
|--------|------|
| **アプリ表示** | **仕様どおり** — 古い納期を除外せず、`FKOJUNST` が `S/R` なら **未完として表示** |
| **DB 同期・CSV 期間外** | **現行では主因になりにくい**（差分消失完了 no-op・取込は新しい） |
| **11 件の直接技術原因** | **上流 `FKOJUNST_Status` の当該 3 キーで最新が `S/R`**（同期残骸ではない） |
| **未確定（業務）** | その `S/R` が **本当の未完/保留/戻り** か、**完了済みなのに `C/X` 未更新** か — **上流・現場確認** |

---

## 上流確認リスト（11 件・2026-06-01 時点）

現場・上流への問い合わせ用。**列**: ProductNo / FSEIBAN / 資源(035) / FKOJUN / 最新 S/R / 履歴・他工程 C/X / 確認観点。

| ProductNo | FSEIBAN | FKOJUN | 最新 | 履歴・同一 ProductNo の他工程 | 確認観点 |
|-----------|---------|--------|------|-------------------------------|----------|
| 0003602728 | AA1S2M02 | 210 | R | 他工程も R/O 系のみ | **製番全体が未完系列**の可能性 |
| 0003623621 | AA1S2M02 | 210 | R | 同上 | 同上 |
| 0003774808 | BA1S5334 | 210 | R | 他工程は多数 **C** | **035 だけ未完/保留 or 035 の status 更新漏れ** |
| 0003800853 | BA1S6362 | 210 | R | 他工程は多数 **C** | 同上 |
| 0003800854 | BA1S6362 | 210 | R | 他工程は多数 **C** | 同上 |
| 0003817578 | BA1S6328 | 190 | S | 履歴 **R→S**；同一 ProductNo で `589/210=C` | 工程分岐中の未完/保留 or 035 だけ更新漏れ |
| 0003823447 | BA1S6330 | 210 | S | 履歴 **P→R→S**；`033/200=C` | **035 だけ状態継続** |
| 0003817736 | BA1S6370 | 210 | R | 他工程も R | 全体未完系列の可能性 |
| 0003817737 | BA1S6370 | 210 | R | 他工程も R | 同上 |
| 0003801363 | BA1S5337 | 215 | R | 履歴 **R→S→R…**；別工程 `033` は **X** | 工程混在・035 だけ未完了の可能性 |
| 0003838889 | BA1S6332 | 210 | R | 履歴 **O→R**；他工程 R/S | 全体未完系列寄り |

**分類サマリ**

- **上流でも未完系列が自然（5 件）**: `0003602728`, `0003623621`, `0003817736`, `0003817737`, `0003838889`
- **他工程は C/X だが 035 だけ S/R（6 件）**: `0003774808`, `0003800853`, `0003800854`, `0003817578`, `0003823447`, `0003801363` — **「製造 order は進んでいるが 035 工程だけ未完/保留/戻り」か「035 の status 更新漏れ」** を重点確認

**統一確認質問（現場・上流）**

1. この **資源 `035`・当該 `FKOJUN`** は **本当に未完** か。
2. 完了済みなら、なぜ **`FKOJUNST_Status` が `C`/`X` に遷移していない** か。
3. **保留・戻り・再作業** など、**`S/R` 維持が正しい運用** か。

---

## Fix（実施した対策）

- **コード**: **なし**（調査のみ）。
- **ドキュメント**: 本 KB および索引更新（2026-06-02）。

---

## Prevention / 次にやってよいこと・やらないこと

### 推奨（安全）

- **11 件を上流確認リストとして運用**し、業務原因を確定してからアプリ判断。
- アプリ対応するなら **完了化ではなく**「**長期滞留・要確認**」の **分離表示**（工程キー・最新 `S/R`・更新時刻・同一 ProductNo の他工程 `C/X` 注意）。

### 禁止（ユーザー合意・技術リスク）

| 対策 | 理由 |
|------|------|
| 数か月過去だから **強制完了** | 本当の未完を隠す |
| 同一 ProductNo の別工程 **C/X で 035 も完了** | 厳密 3 キー破壊・誤転写（[KB-373](./KB-373-fkojunst-status-c-key-domain-mismatch.md)） |
| **厳密 3 キー照合の緩和** | 別工程完了の誤適用 |
| **いきなり非表示** | 現場バックログの隠蔽 |

---

## 現仕様クイックリファレンス（再調査用）

|  topic | 正本 |
|--------|------|
| 表示納期 | `dueDate` → `plannedEndDate`、過去除外なし |
| 並び | `processingOrder` あり先頭 → なければ表示納期昇順 |
| 完了 | 手動 OR `FKOJUNST` **`C`/`X`**（[KB-370](./KB-370-production-schedule-external-completion-triple-source.md)） |
| 可視 | `S/R/C/X`（`C/X` は完了扱いだが **一覧には載る**） |
| 順位ボード UI 初期 | `completionFilter = incomplete`（[KB-297 §未完既定](./KB-297-kiosk-due-management-workflow.md#leader-order-board-default-completion-filter-incomplete-2026-04-30)） |
| Status 同期キー | `FKOJUN` + `FKOTEICD` + `FSEZONO`（trim+upper・`FUPDTEDT` 最新 winner） |

---

## References

- [KB-375 完了整合](./KB-375-kiosk-leaderboard-completion-integrity.md)
- [KB-377 チップ・グレーアウト検証](./KB-377-kiosk-leaderboard-resource-chip-completion-verification.md)
- [KB-370 実効完了](./KB-370-production-schedule-external-completion-triple-source.md)
- [KB-373 キー空間不一致](./KB-373-fkojunst-status-c-key-domain-mismatch.md)
- [KB-297 順位ボード運用](./KB-297-kiosk-due-management-workflow.md#リーダー順位ボード納期ベース整列手動順-api-反映2026-04-01)
- [docs/INDEX.md §KB-383](../INDEX.md)
