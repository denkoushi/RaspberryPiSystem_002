---
title: KB-374 leaderboard-board/continue の cursor 契約と HTTP 400（Zod）
tags: [kiosk, production-schedule, leader-order-board, leaderboard-board, api, web]
audience: [開発者, 運用者]
last-verified: 2026-05-09
category: knowledge-base
---

# KB-374: `leaderboard-board/continue` の `cursor` 契約と HTTP 400（Zod）

## Context

複合順位ボード（[`useCompositeLeaderboardPhasedScheduleWithAutoAppend`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx)）が **`POST /api/kiosk/production-schedule/leaderboard-board/continue`** を呼ぶ経路で、**`hasMore: true` かつ `snapshotId` があるのに `cursor` が欠ける**と **HTTP 400** になる事象があった。board 集約の背景は [ADR-20260508](../decisions/ADR-20260508-leaderboard-board-aggregate-api.md)・収束 KB は [KB-369](./KB-369-leader-order-board-api-internal-latency.md)。

## Symptoms

- ブラウザ Network で **`leaderboard-board/continue`** が **400**。
- API ログまたは応答が **Zod バリデーション失敗**（ボディに **`cursor` が必須**な条件で欠落）。

## Investigation

- **仮説**: 応答の **`nextCursor`** が **`undefined`** のとき、クライアントが **`cursor` プロパティを JSON に載せない**（`undefined` を omit）ため、**`snapshotId` + `hasMore` がある続きリクエスト**でも **`cursor` 欠落**になりうる。
- **検証**: `leaderboard-composite-board.service` の shell／continue 応答と Web のペイロード組み立てを追跡。**結果**: **CONFIRMED**。

## Root cause

1. **サーバ**: 資源スロットごとの **`nextCursor`** が、計算上 **`undefined`** になり得た（クライアントはそれを **`cursor` として返す想定**）。
2. **クライアント**: JSON シリアライズで **`cursor: undefined` がキーごと落ちる**ため、スキーマ上 **`snapshotId` がある続き**では **`cursor` が無い不正ボディ**になる。

## Fix（最小変更）

1. **API**: [`leaderboard-board-resource-cursor.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-board-resource-cursor.ts) の **`resolveFiniteLeaderboardBoardNextCursor`** で、`shell`／`continue` が返す各 **`resources[].nextCursor`** を **有限のカーソル値へ正規化**（既存の `cursor`・行 ID・別経路のフォールバック連鎖）。[`leaderboard-composite-board.service.ts`](../../apps/api/src/services/production-schedule/leaderboard/leaderboard-composite-board.service.ts) から利用。
2. **Web**: [`buildLeaderboardBoardContinuePayload.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/buildLeaderboardBoardContinuePayload.ts) で、`hasMore && snapshotId` のとき **`cursor` を必ず載せる**（必要なら **`0` フォールバック**）。[`useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`](../../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) がこれを呼ぶ。
3. **テスト**: `leaderboard-board-resource-cursor.test.ts`・`buildLeaderboardBoardContinuePayload.test.ts`・複合 hook の **`cursor: 0`** ケース。

## Prevention

- **continue 系の契約変更**は **`shared.ts` の Zod** と **Web ペイロードビルダー**を **対で**見る（片側だけ直すと再発）。
- **`undefined` omit** に依存しない。**「続き」を意味するフラグがあるなら必須フィールドを明示的に送る**。

## Dual payload: deltaRows (2026-05-18)

- **`POST …/leaderboard-board/continue` のみ**、`rows`（累積・従来互換）に加え **`deltaRows` を省略可能で追加**。**旧クライアント**は未定義フィールドを無視し、これまでどおり **`rows`** のみで表示する。
- **付与条件（サーバ）**: 集約続き読みにおいて **全資源スロットとも**、`leaderboard-composite-board-continue-assembly` の **軽量チャンク合成**により「このラウンドで追加された continuation チャンク」が明示できる場合のみ **`deltaRows`** を載せる。いずれかのスロットで **チャンク空・ID ずれ・安全 hydrate フォールバック**等により差分意味を持てないときは **`deltaRows` キーごと省略**する（旧挙動＝ **`rows` 正本**）。
- **並び**: `deltaRows` は **`boardResourceCds` のスロット順**で、スロット内のcontinuationで増えた行を **順に連結**した配列（スロットに追加チャンクが無いときは **`[]`** のスライス）。
- **Web**: [`mergeLeaderboardBoardContinueResponse.ts`](../../apps/web/src/features/kiosk/leaderOrderBoard/mergeLeaderboardBoardContinueResponse.ts) が **`FSIGENCD`（大文字小文字無視）**で `rows` / `deltaRows` をスロット分割し、`prevRows`＋`deltaRows` の合成が **応答の累積 `rows` と同じ ID 列**になることを検証。失敗時は **サーバの `rows` オブジェクト**をそのまま採る（出力不変・安全側）。
- **段階導入**: 本番では **Pi5 API のみ先行**し、順位ボード続き読み確認後に Pi4 を台ごと展開する運用とする（手順・リスク整理: [deployment.md §continue deltaRows](../guides/deployment.md#kiosk-leaderboard-continue-deltarows-dual-payload-2026-05-18)）。

## References

- 代表コミット（機能）: **`6bfd2c2b`**（ブランチ **`fix/kiosk-leaderboard-board-continue-cursor`**）。
- 運用・Detach 実績（ローカル採取）: [deployment.md §2026-05-09 cursor 契約](../guides/deployment.md#leaderboard-board-continue-cursor-contract-2026-05-09)。
- 関連: [KB-369](./KB-369-leader-order-board-api-internal-latency.md)·[EXEC_PLAN.md](../../EXEC_PLAN.md)。
