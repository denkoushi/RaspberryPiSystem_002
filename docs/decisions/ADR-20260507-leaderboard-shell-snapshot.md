# ADR-20260507: 順位ボード phased read のサーバ内 snapshot（TTL インメモリ）

## Status

accepted（**本番先行反映 2026-05-07**: `fix/leaderboard-shell-snapshot`・Pi5→Pi4×4 順次。**マージ後は `main` 先端**を正とする）

## Context

キオスク順位ボードは `GET …/leaderboard-shell` と `POST …/leaderboard-shell/continue`（従来 `excludeRowIds`）で段階取得していた。continue ごとに選定コンテキストの再構築・重い全件選定に近い処理が走り得る。

## Decision

- **HTTP 外部契約は維持**する。
- shell 応答で **`snapshotId`**（任意）を返し、continue の body に **`snapshotId`**（任意）を付けられるようにする。
- **snapshot 未送信・不明・失効**のクライアントは従来どおり **`excludeRowIds` ベースのフォールバック経路**を使える。
- API 内部に **`LeaderboardShellSnapshotStore` 抽象**と、まずは **TTL 付きプロセス内メモリ実装**を置く。
- continue は同一 snapshot 上で **同時実行を直列化**（ロック）し、単一プロセス内の整合性を守る。
- **互換**: フィルタ条件・スコープの **フィンガープリント**と **location/site** が snapshot と一致しない場合は **`snapshotExpired: true`** と空行で応答し、クライアントは shell/total を再取得する。

## Alternatives

1. **Redis / DB 永続 snapshot** — 運用・デプロイ境界が広がるため今回は見送り。抽象で差し替え可能にする。
2. **契約破壊の cursor 専用 API** — 画面・既存クライアント変更が大きいため不採用。

## Consequences

- **良**: continue の主経路が軽量になり、同一順序のchunk取得が安定しやすい。
- **良**: 古いクライアントは `snapshotId` なしで従来動作を維持できる。
- **注意**: **API 複数プロセス間では snapshot は共有されない**（ロードバランサ振り分けで continue が別インスタンスに当たるとフォールバックまたは `snapshotExpired` になりうる）。本番は同一セッションでスティッキーになっている前提、またはフォールバックで全件性は維持される。
- **注意**: TTL（`LEADERBOARD_SHELL_SNAPSHOT_TTL_MS`、未設定時はサービス既定）は運用で調整する。

## References

- API ルート: `apps/api/src/routes/kiosk/production-schedule/leaderboard-phased-read.ts`
- ストア: `apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-snapshot.store.ts`
- Web フック: `apps/web/src/features/kiosk/leaderOrderBoard/useLeaderboardPhasedScheduleWithAutoAppend.ts`
- デプロイ実績: [deployment.md](../guides/deployment.md)（2026-05-07 · snapshot 項）
- ナレッジ: [KB-369](../knowledge-base/KB-369-leader-order-board-api-internal-latency.md)（Production deploy · 2026-05-07 · snapshot）
