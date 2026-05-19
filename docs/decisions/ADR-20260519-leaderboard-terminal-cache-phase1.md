# ADR-20260519: 順位ボード Phase 1 端末キャッシュ（IndexedDB + 裏同期）

- **Status**: accepted
- **日付**: 2026-05-19

## Context

キオスク順位ボードは `GET/POST leaderboard-board` + continue 完走まで待つ構造のため、Pi4 再起動・リロード時に「読み込み中…」が長い。API 側最適化（pageSize 80、装飾後取り、COUNT 再利用等）後も **端末側の cold start** が残る。

**制約**: 表示の id 列・total・並び・装飾の意味論は従来と同値。API 契約は Phase 1 では変更しない。

## Decision

- **Web のみ**: IndexedDB に **continue 完走済み**の board + 装飾累積を `siteKey + paramsKey` 単位で保存する。
- **起動時**: キャッシュがあれば即表示し、裏で既存 React Query + continue + decorations を実行する。
- **照合**: ネットワーク完走版と id 列・total が一致 → 保存更新。**不一致 → サーバ正・キャッシュ削除**。
- **通信失敗**: キャッシュ継続 + 警告バナー。
- **ロールバック**: `VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED=false` で無効化（省略時 true）。

### 確定要件（2026-05-19 合意）

| # | 内容 |
| --- | --- |
| 1 | 鮮度許容 **120秒**（`LEADER_BOARD_SCHEDULE_REFETCH_MS` と整合） |
| 2 | 不一致時 **常にサーバ正** |
| 3 | キャッシュキー = **`siteKey` + `paramsKey`**（全検索条件） |
| 4 | 通信失敗時 **キャッシュ継続** + 警告 |
| 5 | 保存 = **continue 完走後** + **120s ポーリング成功時**（`hasMore=false` のみ） |

### Invalidation

| イベント | 動作 |
| --- | --- |
| `paramsKey` / `siteKey` 変更 | 別キー読込（旧キーは残置） |
| reconcile 不一致 | `delete(key)` |
| `snapshotExpired` | `delete(key)` |
| 完走 + 同期成功 | `put` |
| schemaVersion 不一致 | 読込スキップ |

## Alternatives

| 案 | 却下理由 |
| --- | --- |
| React Query persist のみ | continue 完走・cold start の改善が限定的 |
| サーバ差分 sync API | Phase 1 スコープ外（契約変更大） |
| localStorage | 数百行×装飾で容量不足 |

## Consequences

- **良**: リロード・再起動後の即表示。既存 API・append ポリシーは維持。
- **注意**: 他端末更新は最大 120s 遅れうる（現ポーリングと同型）。IDB 障害時は従来どおりネットワークのみ。

## 実装モジュール（後続スレッド用）

| 層 | 役割 | パス |
| --- | --- | --- |
| 定数・Feature flag | `MAX_AGE_MS`・`VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED` | [`leaderboardBoardCacheConstants.ts`](../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheConstants.ts) |
| キャッシュキー | `siteKey` + `paramsKey`（`\u0001` 結合） | [`leaderboardBoardCacheKey.ts`](../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheKey.ts) |
| レコード | 完走 snapshot の serialize/parse・指紋 | [`leaderboardBoardCacheRecord.ts`](../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheRecord.ts) |
| 表示ポリシー | いつ IDB を画面に出すか | [`leaderboardBoardCacheDisplayPolicy.ts`](../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheDisplayPolicy.ts) |
| 照合 | 不一致 → サーバ正・`delete` | [`leaderboardBoardCacheReconcilePolicy.ts`](../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheReconcilePolicy.ts) |
| 永続化 port / IDB | `idb` ^8.0.3 | [`leaderboardBoardCacheStore.port.ts`](../apps/web/src/features/kiosk/leaderOrderBoard/cache/leaderboardBoardCacheStore.port.ts)·[`indexedDbLeaderboardBoardCacheStore.ts`](../apps/web/src/features/kiosk/leaderOrderBoard/cache/indexedDbLeaderboardBoardCacheStore.ts) |
| Hook | load/save/purge・`networkSyncToken` で reconcile 直後 put 抑止 | [`useLeaderboardBoardTerminalCache.ts`](../apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardBoardTerminalCache.ts) |
| 統合 | composite hook から `displayBoard` / `cacheSyncWarning` | [`useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx`](../apps/web/src/features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend.tsx) |
| UI 警告 | 通信失敗時バナー | [`ProductionScheduleLeaderOrderBoardPage.tsx`](../apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx) |

**`paramsKey` の正本**: `boardQueryParams != null ? JSON.stringify(boardQueryParams) : ''`（`scheduleEnabled=false` 時は **空文字** — 下記 Post-deploy fix 参照）。

## 本番反映（2026-05-19 · Pi5 のみ · 現場 OK）

- **ブランチ**: **`feat/kiosk-leaderboard-terminal-cache-phase1`**
- **代表コミット**: **`072054f9`**（機能）· **`3ae93221`**（真っ白画面 fix）
- **CI（機能）**: run **`26093399804`** **success**（`072054f9`）
- **対象**: **`raspberrypi5` のみ**（**Web のみ**·API 変更なし·**Pi4×4 は未反映** — 端末キャッシュ効果を Pi4 実機で得るには **Pi4 順次デプロイ + キオスク再読込**が必要）
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/kiosk-leaderboard-terminal-cache-phase1 infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）
- **Detach Run ID**:
  - 初回 **`20260519-203723-29020`**（`072054f9`·**`PLAY RECAP` `ok=134` `changed=4` `failed=0`**）
  - fix 再デプロイ **`20260519-205437-31528`**（`3ae93221`·同上 **`failed=0`**）
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**
- **実機（Mac→Pi5 ブラウザ）**: 初回デプロイ後 **真っ白画面** → fix 後 **表示 OK**（ユーザー確認）

### Post-deploy fix（真っ白画面 · `3ae93221`）

- **症状**: `/kiosk/production-schedule/leader-order-board` が **真っ白**（`#root` 空）。DevTools: **`Cannot read properties of undefined (reading 'trim')`** at `buildLeaderboardBoardCacheKey`.
- **根因（CONFIRMED）**: `scheduleEnabled=false`（端末・スロット未選択）の初期描画で `paramsKey = JSON.stringify(undefined)` が **`undefined`**（文字列ではない）のまま hook 内で **`buildLeaderboardBoardCacheKey(siteKey, paramsKey)`** が毎 render 実行され **`paramsKey.trim()`** で React 全体がクラッシュ。
- **Fix**: composite hook で **`paramsKey` を常に文字列化**·cache key builder で **`?? ''` ガード**·Vitest 追加。
- **Prevention**: **`JSON.stringify(x)` をキーに使う境界**では **`x == null` を空文字に正規化**する。hook トップレベルで **未就绪 params に対する pure 関数を無条件実行しない**。

## 残タスク（Phase 1 運用）

- **Pi4 キオスク 4 台**への順次デプロイ（装飾後取りと同じ 5 台パターン。Pi5 単独では **Mac/ Pi5 ブラウザからの Web 検証**のみ完了）
- 本番 **cold start 体感**の記録（IDB 初回 hydrate 前後）

## References

- 実装: `apps/web/src/features/kiosk/leaderOrderBoard/cache/`
- 運用・TS: [KB-374 §端末キャッシュ Phase 1](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md#端末キャッシュ-phase-1-indexeddb--裏同期2026-05-19--featkiosk-leaderboard-terminal-cache-phase1)
- デプロイ: [deployment.md §端末キャッシュ](../guides/deployment.md#kiosk-leaderboard-terminal-cache-phase1-2026-05-19)
- 背景: [KB-374](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md)
