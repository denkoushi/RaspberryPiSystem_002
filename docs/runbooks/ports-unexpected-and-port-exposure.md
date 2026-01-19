---
title: Runbook: ports-unexpected / ポート露出（LISTEN/UNCONN）点検と切り分け
tags: [運用, セキュリティ, 監視, ports-unexpected, ポート]
audience: [運用者, 開発者]
last-verified: 2026-01-18
related:
  - ../knowledge-base/infrastructure/security.md#kb-177-ports-unexpected-が15分おきに発生し続けるpi5の不要ポート露出監視ノイズ
  - ../knowledge-base/infrastructure/ports-baseline-20260118.md
  - ../security/port-security-audit.md
category: runbooks
---

# Runbook: ports-unexpected / ポート露出（LISTEN/UNCONN）点検と切り分け

## 目的

- Pi5上の **不要なLISTEN/UNCONNを減らし** 攻撃面を縮小する
- `ports-unexpected` を **本当に危険な露出だけ** に絞り、運用ノイズを減らす

## 定期点検（推奨: 月1 / 構成変更後）

### 1) LISTEN/UNCONNの実態（プロセス込み）

```bash
sudo ss -H -tulpen
```

### 2) UFW許可状況

```bash
sudo ufw status verbose
```

### 3) Dockerの公開（publish）状況

```bash
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml ps
```

期待:
- `db` / `api` にホスト側publishが無い（`db`は`5432/tcp`のみ、`api`のPORTSが空）
- `web` は `80/443` のみ公開

### 4) security-monitorの稼働状況

```bash
systemctl is-enabled security-monitor.timer && systemctl is-active security-monitor.timer
systemctl list-timers --no-pager | grep security-monitor || true
```

## `ports-unexpected` が出たときの切り分け

### 0) まず「何が出ているか」を確認

- 管理コンソールの `ports-unexpected` details は `addr:port(process,proto)` 形式（想定）。
- まず `sudo ss -H -tulpen` の該当行と突合する。

### 1) 判断フロー（最小変更）

1. **不要サービス由来**（例: rpcbind/avahi/exim4/cups など）
   - 方針: **stop + disable + mask**（LISTEN自体を消す）
2. **必要だが露出経路を限定すべき**（例: VNCなど）
   - 方針: bind先の制限 + UFW制限（LAN限定等）
3. **必要で、運用上の“想定内”露出**（例: 22/80/443/5900など）
   - 方針: `ALLOWED_LISTEN_PORTS` へ追加（systemd Environment / Ansible変数で管理）
4. **Tailscale/loopback/link-local等のノイズ**
   - 方針: `SECURITY_MONITOR_IGNORE_*` の設定で除外（Ansible変数で管理）

## ベースライン（証跡）の採取

### 目的

- 変更前/変更後を比較できるようにする（「いつ何が開いていたか」を残す）

### 推奨ファイル名

- `docs/knowledge-base/infrastructure/ports-baseline-YYYYMMDD.md`

### 採取コマンド（例）

```bash
date -Is
sudo ss -H -tulpen
sudo ufw status verbose
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml ps
```

## 参照

- KB（原因/対策/ハマりどころ）: [KB-177](../knowledge-base/infrastructure/security.md#kb-177-ports-unexpected-が15分おきに発生し続けるpi5の不要ポート露出監視ノイズ)
- ベースライン例: [ports-baseline-20260118](../knowledge-base/infrastructure/ports-baseline-20260118.md)
- セキュリティ監査: [port-security-audit](../security/port-security-audit.md)

