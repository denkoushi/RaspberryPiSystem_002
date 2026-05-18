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

## Production Rollout（2026-05-18）

- **対象ホスト（ユーザー指定の5台のみ・1台ずつ）**:
  - `raspberrypi5`
  - `raspberrypi4`
  - `raspi4-robodrill01`
  - `raspi4-fjv60-80`
  - `raspi4-kensaku-stonebase01`
- **Pi3 について**: 本リリースでは対象外。Ansible の Pi3 play は全 run で `no hosts matched`（Pi3 専用手順を誤って適用していない）。
- **デプロイ手順**: [deployment.md](../guides/deployment.md) の標準手順に従い、各ホストへ `./scripts/update-all-clients.sh fix/kiosk-leaderboard-networkerror-resilience infrastructure/ansible/inventory.yml --limit <host> --detach --follow` を順次実行。
- **Detach Run ID（接頭辞 `ansible-update-`）**:
  - `20260518-193612-24083`（`raspberrypi5`）
  - `20260518-194538-23622`（`raspberrypi4`）
  - `20260518-195212-20827`（`raspi4-robodrill01`）
  - `20260518-195749-32736`（`raspi4-fjv60-80`）
  - `20260518-200323-26959`（`raspi4-kensaku-stonebase01`）
- **結果**: 全 run とも `PLAY RECAP failed=0 / unreachable=0`、リモート `exit 0`、summary `success: true`。
- **実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Tailscale、Pi5 API `100.106.158.2`、`deploy-status` 4台 PASS）。

## Troubleshooting（運用）

- **`Network Error` が再発する**:
  - まず Caddy で `502` と `connect: connection refused` の有無を確認し、契約エラー（400系）と分離して判断する。
  - `leaderboard-board/continue` の 4xx は `terminal` として `appendError` 表示、応答なし/5xx/408/429 は `transient` 扱いで復帰余地を残す設計。
- **デプロイ後に UI が旧挙動**:
  - 各 Pi4 の `web` が対象 ref を取得できているか、detach サマリの `Git: changed` と `kiosk-browser` 再起動ログを確認する。
  - 必要に応じてキオスクを強制リロードする（[verification-checklist.md](../guides/verification-checklist.md)）。
- **`verify-phase12-real.sh` で `deploy-status` のみ落ちる**:
  - 連続デプロイ直後は `isMaintenance` 残留の既知ケースがあるため、全台完了後に再実行する。

## References

- [KB-369](./KB-369-leader-order-board-api-internal-latency.md)（board 集約・内部レイテンシ）
- [KB-374](./KB-374-leaderboard-board-continue-cursor-contract.md)（`cursor` と 400）
- [deployment.md](../guides/deployment.md)（本番反映ログ）
