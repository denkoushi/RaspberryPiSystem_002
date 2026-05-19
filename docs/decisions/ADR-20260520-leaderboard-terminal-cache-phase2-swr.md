# ADR-20260520: 順位ボード端末キャッシュ Phase 2（SWR 表示 + 書き込み同期）

- **Status**: accepted
- **日付**: 2026-05-20
- **関連**: [ADR-20260519](./ADR-20260519-leaderboard-terminal-cache-phase1.md)（Phase 1 を拡張・置換しない）

## Context

Phase 1 は cold start の bootstrap のみが主効果で、製番 OR 切替やポーリング中はネットワーク待ちが残った。加えて IDB 更新が行 ID 指紋のみのため、順位・備考等のユーザー入力がリロード後に失われうる。

**制約**: API 契約・一覧の id 列・total・並び・装飾の意味論は不変（サーバ正本）。

## Decision

### 表示（RFC 5861 型 SWR）

- 鮮度 **120 秒**内の **continue 完走済み** IDB スナップショットを、`paramsKey` 一致時に **即表示**。
- 裏で既存 `leaderboard-board` + continue + `leaderboard-decorations` を実行。
- **再検証中**（`isLoading` / `isFetching` / continue 未完 / `paramsKey` 変更直後で network 未就绪）はキャッシュを維持。
- Origin 完走 + reconcile **aligned** → ネットワーク表示 + IDB `put`（**内容指紋**で更新判定）。
- reconcile **serverWins** → 即 `delete` + ネットワーク表示（Phase 1 維持）。

### 書き込み同期

- 順位・備考・納期・完了の API 成功後、`ProductionScheduleWriteSuccessListeners` 経由で **同一 `paramsKey` の IDB を patch**。
- React Query 更新（既存）と併用。`leaderBoardFastPath` の invalidate 省略は維持。

### UX

- 完了フィルタ既定: **`incomplete`**（クライアントのみ・API 不変）。

### ロールバック

| フラグ | 効果 |
| --- | --- |
| `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED=false` | Phase 1/2 とも無効 |
| `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_PHASE2_SWR=false` | Phase 1 表示ポリシーのみ（省略時 true） |

## 実装モジュール

| 層 | パス |
| --- | --- |
| SWR 表示 | [`leaderboardBoardSwrDisplayPolicy.ts`](../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardSwrDisplayPolicy.ts) |
| 内容指紋 | [`leaderboardBoardCachePersistPolicy.ts`](../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCachePersistPolicy.ts) |
| mutation patch | [`leaderboardBoardCachePatchPolicy.ts`](../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCachePatchPolicy.ts) |
| hook | [`useLeaderboardBoardTerminalCache.ts`](../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardBoardTerminalCache.ts) |
| 書き込み橋 | [`productionScheduleWriteSuccessListeners.ts`](../apps/web/src/features/kiosk/productionSchedule/productionScheduleWriteSuccessListeners.ts) · [`buildLeaderboardBoardCacheWriteSuccessListeners`](../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardBoardCacheMutationBridge.ts) |

## デプロイ（未実施・計画）

Pi5 検証 → Pi4 キオスク 4 台順次（Phase 1 と同型）。本 ADR 時点では **ローカル Vitest のみ**。

## Consequences

- **良**: 製番 OR 切替・再検証中の体感短縮。自端末入力の IDB 反映。他端末は 120s SLA で収束。
- **注意**: SWR 中は最大 120s 古い他端末状態を表示しうる（Phase 1 と同型 SLA）。

## References

- [KB-374 §端末キャッシュ Phase 2](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#端末キャッシュ-phase-2-swr--書き込み同期2026-05-20)
- [RFC 5861 stale-while-revalidate](https://httpwg.org/specs/rfc5861.html)
