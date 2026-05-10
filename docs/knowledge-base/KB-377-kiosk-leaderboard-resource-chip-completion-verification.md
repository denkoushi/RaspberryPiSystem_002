---
title: KB-377 キオスク順位ボード・資源CDフッタチップのグレーアウト検証と差分消失ロジックとの整合確認
tags: [キオスク, 順位ボード, 資源CD, FSIGENCD, 完了, FKOJUNST, 生産日程CSV, ナレッジ]
audience: [開発者, 運用者]
last-verified: 2026-05-10
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

# KB-377: キオスク順位ボード・資源CDフッタチップのグレーアウト検証と差分消失との整合

## Context

キオスク **順位ボード**（`/kiosk/production-schedule/leader-order-board`）では、各行の **`row.isCompleted`** に応じて **行本体**および **資源CDフッタ工程チップ**（例: **`021`**）へ **`opacity-50 grayscale`** 系の視覚処理が適用される。現場では「工程は進んで完了しているはず」と感じられる一方で **特定資源コードのチップだけグレーアウトしない**という問いが繰り返し出た。**2026-05** の調査では、**実装バグ優先ではなくデータと厳密仕様との整合確認**が主題となった。また、過去スクショ（本番出力）について **画面上の複数製番を OCR で列挙し、当時に近い DB 状態と突合**する検証データも残している。

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

### H3: 生産日程CSVの **論理キー差分消失**で完了になるはず

- **結果**: **当該 `021` の winner 論理キーは、現行の勝者集合にまだ残っており、「消滅」条件を満たさなかった**場合が **CONFIRMED**。**「CSV が2系統だから自動で済む」のではなく、非C×窓の母集合と現キーの集合演算結果**である（詳細は [KB-370](./KB-370-production-schedule-external-completion-triple-source.md)）。
- **補足（履歴データ）**: 製番 **`BA1S5301`** など一部では過去タイムスタンプで **`externallyCompletedFromScheduleCsvDisappeared = true`** が少数立っているログがあり得るが、**別バッチ／別時点の話であり、特定スクリーンショット直下の全会が「消滅完了」になるわけではない**。

### 仕様として採らないもの（ユーザー合意）

- **後続工程が完了していれば前工程資源も自動完了**といった **曖昧な伝播判定**は **採用しない**（現行は **各行・各論理キーごとの厳密OR**）。

## Root cause（本件で言える範囲）

1. UI は **`row.isCompleted`（実効完了）**を忠実に表示しており、**データ上未完ならチップも未完表示**となる。
2. **メール status `S`** は完了ではないため、それだけではグレーアウトにならない。
3. **差分消失完了**は **「母集団内の論理キーが現 winner から消えた」とき**に限定され、**キーが残存している限り**消失完了にならない（2026-05-09 改訂の **非C×`occurredAt` ±3ヶ月窓**は [KB-370](./KB-370-production-schedule-external-completion-triple-source.md)·[deployment.md §消滅窓](../guides/deployment.md#schedule-csv-disappearance-nonc-window-2026-05-09)）。

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
- **消滅ロジック検証**: まず **`empty_schedule_csv` ガード**と **非C×窓母集団**を [KB-370](./KB-370-production-schedule-external-completion-triple-source.md) で確認し、単に「CSVに残っていない気がする」だけで期待を立てない（**winner 論理キーがまだ勝者側に残っている**典型がある）。

## References

- [`production-schedule-effective-completion.sql.ts`](../../apps/api/src/services/production-schedule/production-schedule-effective-completion.sql.ts)（実効完了の SQL OR）
- [`leaderboard-part-footer-processes.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-part-footer-processes.service.ts)（フッタチップ・winner 選好）
- Web: [`LeaderOrderResourceRow.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceRow.tsx)·[`KioskResourceProcessChips.tsx`](../../apps/web/src/components/kiosk/resourceProgress/KioskResourceProcessChips.tsx)
- [KB-375](./KB-375-kiosk-leaderboard-completion-integrity.md)（`/completion`・CSV と手動の整合）
- [KB-376](./KB-376-leaderboard-footer-display-scope-winner-alignment.md)（`**preferredDisplayRowIds`**）
- [KB-370](./KB-370-production-schedule-external-completion-triple-source.md)（3系統OR・消滅窓）
- [docs INDEX](../INDEX.md)
