---
title: KB-380: キオスク順位ボード・追補 Network Error（到達性瞬断とクライアント/Compose 対策）
tags: [キオスク, 順位ボード, Network Error, Docker, Caddy]
audience: [開発者, 運用者]
last-verified: 2026-05-18
related: [KB-374-leaderboard-board-continue-cursor-contract.md, KB-369-leader-order-board-api-internal-latency.md]
category: knowledge-base
---

# KB-380: キオスク順位ボード・追補 Network Error（到達性瞬断とクライアント/Compose 対策）

## Context

順位ボードの **追補**（`POST /api/kiosk/production-schedule/leaderboard-board/continue`）表示で **「Network Error」** が記録される事象。**契約どおりペイロードが送られていても**、運用側では Web コンテナの Caddy ログに **`502 Bad Gateway`**（`connect: connection refused` 等）、API が一時停止しているタイミングがあり、フロントの Axios が **応答なしエラー**として扱う。

## Symptoms

- メッセージ例: 「順位一覧の追補取得に失敗しました（Network Error）。…」
- **`cursor` 欠落による 400（[KB-374](./KB-374-leaderboard-board-continue-cursor-contract.md)）とは別経路**。API が落ちている/再起動している瞬間でも再現し得る。

## Investigation

- **`cursor`/`snapshotId` 契約**: [KB-374](./KB-374-leaderboard-board-continue-cursor-contract.md)、既知問題は是正済み想定。
- **インフラ**: `web` が `api` へ到達できないとき Caddy が **502** を返す。Compose の **`depends_on` のみ**では **API がまだlisten前**でも `web` が起動し得た。

## Fix（実装）

1. **`infrastructure/docker/docker-compose.server.yml`**
   - **`db`** に `healthcheck`（`pg_isready`）。**`api`** は `depends_on.db.condition: service_healthy`。
   - **`api`** に `healthcheck`（コンテナ内 `node` で `GET http://127.0.0.1:8080/api/system/health`）。
   - **`web`** は `depends_on.api.condition: service_healthy`。
2. **Web**: `leaderboardContinueErrorPolicy` で **`continue` 失敗を transient / terminal に分類**し、**ネットワーク断・5xx は `appendError` を確定しない**（次の shell フェッチ後に追補再開）。

## References

- [KB-369](./KB-369-leader-order-board-api-internal-latency.md)（board 集約・内部レイテンシ）
- [KB-374](./KB-374-leaderboard-board-continue-cursor-contract.md)（`cursor` と 400）
