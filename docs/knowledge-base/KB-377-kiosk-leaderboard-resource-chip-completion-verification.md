---
title: KB-377 キオスク順位ボード・資源CDフッタチップのグレーアウト検証
tags: [キオスク, 順位ボード, 資源CD, FSIGENCD, 完了, FKOJUNST, 生産日程CSV, ナレッジ]
audience: [開発者, 運用者]
last-verified: 2026-05-26
related:
  [
    KB-375-kiosk-leaderboard-completion-integrity.md,
    KB-376-leaderboard-footer-display-scope-winner-alignment.md,
    KB-370-production-schedule-external-completion-triple-source.md,
    KB-373-fkojunst-status-c-key-domain-mismatch.md,
  ]
category: knowledge-base
update-frequency: low
---

# KB-377: キオスク順位ボード・資源CDフッタチップのグレーアウト検証

## Context

キオスク **順位ボード**（`/kiosk/production-schedule/leader-order-board`）では、各行の **`row.isCompleted`** に応じて **行本体**および **資源CDフッタ工程チップ**（例: **`021`**）へ **`opacity-50 grayscale`** 系の視覚処理が適用される。現場では「工程は進んで完了しているはず」と感じられる一方で **特定資源コードのチップだけグレーアウトしない**という問いが繰り返し出た。**2026-05** の調査では、**実装バグ優先ではなくデータと厳密仕様との整合確認**が主題となった。また、過去スクショ（本番出力）について **画面上の複数製番を OCR で列挙し、当時に近い DB 状態と突合**する検証データも残している。

**2026-05-26 追補**: 生産日程CSV差分消失による完了は廃止した。現行のグレーアウト根拠は **手動完了** または **FKOJUNST_Status `C` / `X`** のみ（[ADR-20260526](../decisions/ADR-20260526-production-schedule-completion-status-only.md)）。

## Symptoms

- **資源 `021`**（および他資源コード）の **フッタチップがグレーアウトしない**。
- 認識としては「後続工程や現場運用上は済んでいる」ため **バグではないか**との疑い。
- **メイン行**と **チップ**で完了の見え方が異なるように感じられる（まれに **表示スコープと winner の取り違え**があり得る点は [KB-376](./KB-376-leaderboard-footer-display-scope-winner-alignment.md) を参照）。

## Investigation（確定結果の要約）

### H1: 行の winner とチップ算出の winner が食い違う

- **結果**: **当該ケースでは棄却**（同一 `csvDashboardRowId` がカード本体とチップ双方に載る確認で説明できる）。ただし **`rowIds` 境界・重複キー時の DISTINCT ON** では別途 [KB-376](./KB-376-leaderboard-footer-display-scope-winner-alignment.md) を正とする。

### H2: `021` の行単体がサーバ上で実効未完のまま

- **結果**: **CONFIRMED**。対象行について **`ProductionScheduleProgress.isCompleted` は false**、**`ProductionScheduleExternalCompletion.isExternallyCompleted` は false**、関連 **`ProductionScheduleFkojunstMailStatus.statusCode` は `S`（例）** が観測された。
- **意味**: メール由来の外部完了ポリシーは **`C` / `X` のみ**が完了とみなされる（**`S` / `R` は可視だが未完**）。よって **`S` のままではチップもグレーアウトしない**のが **現仕様どおり**。ポリシー実装は [`fkojunst-mail-status-completion.policy.ts`](../../apps/api/src/services/production-schedule/completion/fkojunst-mail-status-completion.policy.ts)。

### H3: 生産日程CSVの **論理キー差分消失**で完了になるはず（履歴）

- **結果（2026-05-25 以前）**: **当該 `021` の winner 論理キーは、当時の勝者集合にまだ残っており、「消滅」条件を満たさなかった**場合が **CONFIRMED**。**「CSV が2系統だから自動で済む」のではなく、メール完了以外×窓の母集合と現キーの集合演算結果**だった（詳細は [KB-370](./KB-370-production-schedule-external-completion-triple-source.md)）。
- **現行（2026-05-26 以降）**: 差分消失は完了判定に使わない。
- **補足（履歴データ）**: 製番 **`BA1S5301`** など一部では過去タイムスタンプで **`externallyCompletedFromScheduleCsvDisappeared = true`** が少数立っているログがあり得るが、**別バッチ／別時点の話であり、特定スクリーンショット直下の全会が「消滅完了」になるわけではない**。

### 仕様として採らないもの（ユーザー合意）

- **後続工程が完了していれば前工程資源も自動完了**といった **曖昧な伝播判定**は **採用しない**（現行は **各行・各論理キーごとの厳密OR**）。

## Root cause（本件で言える範囲）

1. UI は **`row.isCompleted`（実効完了）**を忠実に表示しており、**データ上未完ならチップも未完表示**となる。
2. **メール status `S`** は完了ではないため、それだけではグレーアウトにならない。
3. **差分消失完了**は **「母集団内の論理キーが現 winner から消えた」とき**に限定され、**キーが残存している限り**消失完了にならない（2026-05-09 改訂の **メール完了（`C`/`X`）以外×`occurredAt` ±3ヶ月窓**は [KB-370](./KB-370-production-schedule-external-completion-triple-source.md)·[deployment.md §消滅窓](../guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09)）。

## Fix

- **本スレッド時点のアプリコード修正は無し**（挙動は仕様とデータに整合）。
- 運用上 **グレーアウトさせたい**場合の正規ルートは、**`/completion` + `intent: 'complete'`**（手動完了）または **上流の `FKOJUNST_Status` が `C`/`X`** へ至ること（上流キー不一致は [KB-373](./KB-373-fkojunst-status-c-key-domain-mismatch.md)）。

## Verification（開発端末でのスクリーンショット検証の例）

複数製番・品番コードを画面上から読み取り DB と突き合わせる用途。

1. **OCR**: Homebrew **`tesseract`** に加え **`tesseract-lang`（`jpn.traineddata`）** が無いと **`-l jpn+eng` が効かず英語のみ**になり、製番（`BA1…`/`AA1…`）の誤認が増える。前処理として **トリミング／二値化／拡大**すると表形式の読み取り精度が安定しやすい。
2. **`csvDashboardId`**: 定数ソース [`apps/api/src/services/production-schedule/constants.ts`](../../apps/api/src/services/production-schedule/constants.ts) の **`PRODUCTION_SCHEDULE_DASHBOARD_ID`**（生産日程本体 CSV）。
3. **PostgreSQL**: Prisma テーブル名は CamelCase のため、`psql` では **`"CsvDashboardRow"`** のように **二重引用符**が必要になり得る（未引用だと **`relation csvdashboardrow does not exist`** 級）。
4. **突合クエリの観点**（概念的）:
   - `rowData` JSON から `FSEIBAN`/`ProductNo`/`FHINCD`/`FSIGENCD`/`FKOJUN` を取得
   - `ProductionScheduleFkojunstMailStatus`（別名 **`fkmail`**）・`ProductionScheduleExternalCompletion`・`ProductionScheduleProgress` を **`csvDashboardRowId`** で結合
   - **`externallyCompletedFromScheduleCsvDisappeared`**・**`isExternallyCompleted`**・手動 **`isCompleted`** を確認
5. **解釈**: 画像に写った製番集合について **`occurredAt` が同日バッチに近い行**だけを切り出して **`by_disappeared` 件数**を数えると、「消滅ロジックが一斉に誤暴走していないか」のスモークに使える。

## Prevention

- **仕様質問ファースト**: 「チップ未完成」→ **実効未完のどちら由来か（手動／メールC・X／CSV消滅）** に分解してからコード疑いへ進む。
- **winner・境界**: 大量 **`rowIds`** やチャンク境界では [KB-376](./KB-376-leaderboard-footer-display-scope-winner-alignment.md) を先に疑う。
- **消滅ロジック検証**: まず **`empty_schedule_csv` ガード**と **メール完了以外×窓母集団**を [KB-370](./KB-370-production-schedule-external-completion-triple-source.md) で確認し、単に「CSVに残っていない気がする」だけで期待を立てない（**winner 論理キーがまだ勝者側に残っている**典型がある）。
- **本番で「その日」の件数だけを見るとき**: 「当日取込 0 件」と誤解しやすい **JST 暦日境界の SQL 間違い** と、**Fk Status メール CSV と生産日程本体 CSV のダッシュボード混同**に注意。**詳細**: 下記 Appendix。

<span id="kb-377-appendix-counting"></span>

## Appendix: 本番 PostgreSQL／二系統 CSV／JST の暦日窓／件数の読み替え

本節は **2026-05-10 前後の Pi5 本番 Postgres での運用質問・切り分け**を、(1) どのデータがどの経路由来か、(2) `createdAt` / `updatedAt` が何を保証しないか、(3) JST 暦日の切り方、(4) 代表観測値、に整理したもの。**環境により件数は変動**するため、数値そのものより **解釈の枠組み**を正とする。

### 二系統の CSV と `csvDashboardId`（混同しない）

実装が参照する **`csvDashboardId` の定数は [`constants.ts`](../../apps/api/src/services/production-schedule/constants.ts) が正本**であり、代表的には次のように分離される。

| 系統（概念） | 定数名 | UUID（正本はコード参照） |
| --- | --- | --- |
| **生産日程本体**（論理キー・差分消失の主経路側） | `PRODUCTION_SCHEDULE_DASHBOARD_ID` | `3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01` |
| **`FKOJUNST_Status` メールCSV**（`fkmail`・メール経路同期の正） | `PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID` | `b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e` |

- **CSV は 2 系統**: **Gmail 取込ログで「`FKOJUNST_Status` が成功」「ゴミ箱＋`rps_processed`」**は、主に **`PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID` 側の ingest 完了**を示す。**それだけから、同日の本体 CSV ingest 点数や「消失完了が何件」を直接読み替えない**（ダッシュボードが別）。
- **差分消失由来のフラグ `externallyCompletedFromScheduleCsvDisappeared`** は **`ProductionScheduleExternalCompletion`** と紐づき、論理構造としては **本体スケジュール側の ingest／外部完了同期**（[KB-370](./KB-370-production-schedule-external-completion-triple-source.md)·[deployment 消滅窓項](../guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09)）が主。**Fk Status メール側の点数が多い／少ないことと、同日の disappear カウントは独立**になり得る。

### JST で「その日」を切る SQL（ハマり）

**PostgreSQL で JST の暦日 `[d, d+1)` を切りたい**とき、`(ある date 列)::timestamp AT TIME ZONE 'Asia/Tokyo'` のような形は、**セッションの `TimeZone` 設定に依存して意図とずれた窓**になり得る（「当日なのに 0 件」「前日まで混ざる」等）。

**暦日 `yyyy-mm-dd`（JST）をアプリ入力として持っている**前提の **安全側のパターン**（開始・終了）:

```sql
-- 例: パラメータ jst_date = '2026-05-10'（text / date で渡す）
-- [start_jst_inclusive_utc, end_jst_exclusive_utc)
SELECT
  (jst_date::text || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Tokyo' AS start_utc,
  ((jst_date + interval '1 day')::text || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Tokyo' AS end_exclusive_utc;
```

**チェックリスト**: 「当日ウィンドウ」で件数が妙に **0／極端**なら、(1) 上記の開始・終了が **`Asia/Tokyo` の明示 midnight**になっているか、(2) **`occurredAt` 等が UTC で格納**されているかに合わせて比較演算子（`>=` / `<`）を揃えているか、を最初に疑う。

### `ProductionScheduleExternalCompletion`: `createdAt` と `updatedAt` が意味しないもの

モデル **`ProductionScheduleExternalCompletion`** は **`csvDashboardRowId`** を PK に持ち、`externallyCompletedFromScheduleCsvDisappeared` に **「スケジュール CSV 側の論理による消失フラグ」**が載り得る（実効完了の OR の一要素。**厳密は effective SQL** を見る）。

- **`updatedAt` が「ある JST 暦日内」であること**は、**その日に再計算・再同期があり行が触られた**ことを示すが、**「その朝はじめて `externallyCompletedFromScheduleCsvDisappeared` が true になった」ことの証明にはならない**（過去から true で、その日別要因で `updatedAt` だけ動いた場合もあり得る）。
- 同様に **`createdAt` がその暦日内でない**ときは、**その日に新規 insert されたレコードではない**。逆に **`createdAt` が暦日内でも「今日が初めて消滅に至った」の証明には十分でない**（行のライフサイクルとビジネス意味は別）。
- **観測例（Pi5・2026-05-10 JST ウィンドウ、当時の手元集計・参考値）**: `csvDashboardId = PRODUCTION_SCHEDULE_DASHBOARD_ID` かつ `externallyCompletedFromScheduleCsvDisappeared = true` かつ **`updatedAt` がその JST 暦日内**→ **約 71 件**。同条件に **`createdAt` も同暦日内**を足すと **0 件**。解釈: **「消滅フラグレコードが今日初めて生まれた本数」を `updatedAt` だけで読んではならない**。

### 「当日 ingest された `CsvDashboardRow`」「消失と JOIN が 0」

- **`CsvDashboardRow` の `createdAt` がその JST 暦日内**のアイテム数は、**「論理的に今日新しく現場に現れた製番・工程アイテム数」≠ 一意に定まらない**。ingest が **UPDATE ではなく別スナップショットとして行を増やす**／**same logical key が別 dataHash で再度現れる**等、運用・DEDUP 実装の意味論に強く依存する。**観測例（参考・2026-05-10 JST ウィンドウ）**: 同一窓で **`CsvDashboardRow.createdAt`** が **`PRODUCTION_SCHEDULE_DASHBOARD_ID` に紐づく行は約 481**、**`PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID` 側は約 4,287**、といった並びになり得る。別の切り口では **メール側 `occurredAt` が当該ウィンドウ内の行総数〜79,659 行／約 63 バッチ・本体側〜13,613 行／約 35 バッチ**、**`MAX(occurredAt)` が JST で早朝〜4:43 付近**（メール処理時刻とも整合しうる）、といったログ突合にも使える（比較は **同じウィンドウ定義・同じ `csvDashboardId` フィルタ** が前提）。
- **「本体で当日 `createdAt` の行」の集合だけに対して、`externallyCompletedFromScheduleCsvDisappeared=true` で JOIN すると 0」** は、**(A) 消失完了がそのサブセットにはまだ波及していない**、(B) **完了は別 winner 行側に載っている**、(C) **`empty_schedule_csv` や窓ポリシーで同期が挟まっている**、(D) **そもそもサブセット定義が窓／ID 混入でズレている**、等のときに **素直に起こり得る**。**JOIN 結果 0 が「本体 ingest が無かった」証拠ではない**。

### 運用上の実務近似（ユーザー合意）

**差分消失の再評価が「朝夕など少なくとも 1 日 1 回」**であり、運用で **「今朝の結果として今日完了した件数を粗く見たい」**場合:

- **`externallyCompletedFromScheduleCsvDisappeared = true` かつ `updatedAt` が「今日の暦日内」** といった集合を **「実質、その営業日の CSV 消失に基づく完了結果のスナップショット近似」として扱ってよい**、という **現場運用近似**がある（監査ログや「その瞬間から初めて true だった」証明が欲しいときは **`updatedAt` 単独では不十分**）。
- メール側の **`FKOJUNST_Status` の取込件数／バッチ件数は、消失近似の直接的なカウントと混ぜない**（系統が別）。

## References

- [`production-schedule-effective-completion.sql.ts`](../../apps/api/src/services/production-schedule/production-schedule-effective-completion.sql.ts)（実効完了の SQL OR）
- [`leaderboard-part-footer-processes.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-part-footer-processes.service.ts)（フッタチップ・winner 選好）
- Web: [`LeaderOrderResourceRow.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceRow.tsx)·[`KioskResourceProcessChips.tsx`](../../apps/web/src/components/kiosk/resourceProgress/KioskResourceProcessChips.tsx)
- [KB-375](./KB-375-kiosk-leaderboard-completion-integrity.md)（`/completion`・CSV と手動の整合）
- [KB-376](./KB-376-leaderboard-footer-display-scope-winner-alignment.md)（`**preferredDisplayRowIds`**）
- [KB-370](./KB-370-production-schedule-external-completion-triple-source.md)（3系統OR・消滅窓）
- [docs INDEX](../INDEX.md)
