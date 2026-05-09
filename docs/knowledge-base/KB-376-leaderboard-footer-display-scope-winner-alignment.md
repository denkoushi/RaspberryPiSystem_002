---
title: KB-376 順位ボード・装飾APIの表示スコープとフッタwinner選定の整合
tags: [キオスク, 生産スケジュール, 順位ボード, フッタチップ, hydrate, ナレッジ]
audience: [開発者]
last-verified: 2026-05-10
related: [KB-375-kiosk-leaderboard-completion-integrity.md, ADR-20260508-leaderboard-board-aggregate-api.md, KB-374-leaderboard-board-continue-cursor-contract.md]
category: knowledge-base
update-frequency: medium
---

# KB-376: 順位ボード・装飾APIの表示スコープとフッタ winner 選定の整合

## Context

`leaderboard-decorations`・集約 `leaderboard-board`・`responseProfile=leaderboard` の **資源CDフッタチップ**は、DB 上で **同一の dedupe 5キー**（`FSEIBAN` / `ProductNo` / `FHINCD` / `FSIGENCD` / `FKOJUN`）を持つ **複数 `CsvDashboardRow`** に対して **1行（winner）**を選ぶ。一覧側の **行完了**とチップの **`isCompleted`** がずれると現場判断を誤る。

## Symptoms

- 順位ボードで **行は完了**なのに **021 などのフッタチップが未完**（またはその逆）。
- **表示対象行が 900 件を超える**リクエストで、**shell 装飾経路**のみ不整合（一覧の monolithic 経路では問題なし、など経路差が出る）。

## Investigation

- **CONFIRMED**: **装飾用 hydrate** が **1回の SQL で扱う ID 上限**（実務上 **900** 前後）により **入力 `rowIds` の後半が hydrate 対象外**になり得た。
- **CONFIRMED**: フッタ winner の `DISTINCT ON` は **`preferred`（表示中 rowId）優先**だが、**`preferred` が hydrate 済み行の id のみ**に偏ると、**画面上の表示行 id が優先集合に含まれず**別 winner が選ばれ得た。

## Root cause

1. **表示対象 ID 集合**（リクエスト境界）と **hydrate 取得集合**が分断され、**フッタ SQL の prefer 入力**が **画面の正しい境界**を表していなかった。
2. **board continue** などは chunked hydrate を持つ一方、**装飾直結 hydrate** の欠損により **経路間で同一原則が共有されなかった**。

## Fix（実装の要約）

| 領域 | 変更 |
|------|------|
| 表示スコープ | `leaderboard-display-row-scope.ts` に **正規化**（trim・重複除去・順序保持・硬上限）と **hydrate 用チャンク分割**を集約。 |
| hydrate | `fetchLeaderboardScheduleHydratedRowsOrderedByIds` が **全チャンクを順に実行**し、**入力順でマージ**。 |
| フッタ | `preferredDisplayRowIds` を **明示**でき、`buildLeaderboardFooterChipsByPartKeyForScheduleRows` が **選定境界**と **部品キー収集**を分離（collector）。 |
| 配線 | `decorateLeaderboardShellRowsForKiosk*` / `enrichLeaderboardListRowsAndFooter` / `leaderboard-composite-board` continue が **同一スコープ**をフッタへ渡す。 |

主要コード:  
[`leaderboard-display-row-scope.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-display-row-scope.ts)·[`leaderboard-shell-hydrate.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-hydrate.service.ts)·[`leaderboard-part-footer-processes.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-part-footer-processes.service.ts)·[`leaderboard-footer-part-key-collector.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-footer-part-key-collector.ts)·[`production-schedule-query.service.ts`](../../apps/api/src/services/production-schedule/production-schedule-query.service.ts)·[`leaderboard-composite-board.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts)。

## Prevention

- **回帰テスト**: `kiosk-production-schedule.integration.test.ts`（**>900 `rowIds` + 重複 winner**）・`leaderboard-display-row-scope.test.ts`・`leaderboard-footer-part-key-collector.test.ts`。
- **新規経路**では **hydrate 上限**を単独で二次実装せず、`leaderboard-display-row-scope` / `fetchLeaderboardScheduleHydratedRowsOrderedByIds` に寄せる。

## References

- [KB-375](./KB-375-kiosk-leaderboard-completion-integrity.md)（完了意味の共有）
- [ADR-20260508](../decisions/ADR-20260508-leaderboard-board-aggregate-api.md)
- [KB-374](./KB-374-leaderboard-board-continue-cursor-contract.md)
- [docs INDEX](../INDEX.md)
