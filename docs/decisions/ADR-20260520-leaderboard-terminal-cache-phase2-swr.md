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

## デプロイ（本番反映済み・2026-05-19）

**ブランチ**: **`feat/kiosk-leaderboard-terminal-cache-phase2-swr`**（tip **`2300da83`**）·**PR [#302](https://github.com/denkoushi/RaspberryPiSystem_002/pull/302)**。**Web のみ**·**新規マイグレーションなし**。

**順序（1 台ずつ）**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`**（**Pi3** は **`no hosts matched`**）。

| ホスト | Detach Run ID | PLAY RECAP |
| --- | --- | --- |
| `raspberrypi5` | **`20260519-215631-11713`** | `ok=134` `changed=4` `failed=0`（**Docker compose 再起動 `changed`**） |
| `raspberrypi4` | **`20260519-220153-2826`** | `ok=122` `changed=10` `failed=0`（**`kiosk-browser` / `status-agent` 再起動**） |
| `raspi4-robodrill01` | **`20260519-220731-12252`** | `ok=122` `changed=9` `failed=0` |
| `raspi4-fjv60-80` | **`20260519-221143-3419`** | `ok=122` `changed=9` `failed=0` |
| `raspi4-kensaku-stonebase01` | **`20260519-221558-18199`** | `ok=129` `changed=10` `failed=0` |

**実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **70s**·Tailscale·Pi5 `100.106.158.2`）·**`deploy-status`（Pi4×4）** すべて **PASS**。

**知見**: Phase 1 は **Pi5 のみ**だったため、Pi4×4 は **Phase 1 + Phase 2 を同時に初反映**（IDB は端末ローカル）。**初回アクセスは IDB 空**のため体感改善は **continue 完走後の 2 回目以降**で評価する（Phase 1 と同型）。

**手順正本**: [deployment.md §端末キャッシュ Phase 2](../guides/deployment.md#kiosk-leaderboard-terminal-cache-phase2-swr-2026-05-19)·[KB-374 §Phase 2](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#端末キャッシュ-phase-2-swr--書き込み同期2026-05-20)。

## Consequences

- **良**: 製番 OR 切替・再検証中の体感短縮。自端末入力の IDB 反映。他端末は 120s SLA で収束。
- **注意**: SWR 中は最大 120s 古い他端末状態を表示しうる（Phase 1 と同型 SLA）。

## References

- [KB-374 §端末キャッシュ Phase 2](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#端末キャッシュ-phase-2-swr--書き込み同期2026-05-20)
- [RFC 5861 stale-while-revalidate](https://httpwg.org/specs/rfc5861.html)
