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

## References

- 実装: `apps/web/src/features/kiosk/leaderOrderBoard/cache/`
- 背景: [KB-374](../knowledge-base/KB-374-leaderboard-board-continue-cursor-contract.md)
