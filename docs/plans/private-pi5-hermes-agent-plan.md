---
title: 私用 Pi5 Hermes Agent 計画（セキュリティ先行・Discord 雑談）
tags: [Hermes Agent, private Pi5, DGX Spark, Discord, Docker, UFW, Tailscale]
audience: [開発者, 運用者]
last-verified: 2026-05-24
related:
  - ../runbooks/private-pi5-hermes-deploy.md
  - ../knowledge-base/KB-private-pi5-hermes-install-noninteractive.md
  - ../decisions/ADR-20260524-private-pi5-hermes-security-profile.md
  - stackchan-private-pi5-tailnet-workflow-plan.md
  - ../../scripts/private-pi5-hermes/README.md
  - ../../infrastructure/ansible/playbooks/private-pi5-hermes.yml
category: plans
update-frequency: medium
---

# 私用 Pi5 Hermes Agent 計画

## 目的

自宅 **私用 Pi5** 上で [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) を運用し、将来 **Discord（自分のみ）** から **雑談** できるようにする。StackChan 音声経路（`stackchan-bridge`）とは **別系統** とし、セキュリティを最優先する。

## スコープ

| 含む | 含まない |
|------|----------|
| 専用ユーザー `hermes` + Ansible デプロイ | 職場 Pi5 API / `update-all-clients.sh` への混載 |
| DGX `system-prod-primary`（OpenAI 互換 `/v1`） | StackChan ファーム変更 |
| Docker 隔離・手動承認・UFW | Hermes ブラウザ自動化（`--skip-browser`） |
| Discord gateway（**設定後に有効化**） | ファイル操作ツールの明示無効化（未実装・Docker 隔離に依存） |

## 2系統との関係（私用 Pi5 上の併用）

| 経路 | 入口 | 用途 | 正本 |
|------|------|------|------|
| **StackChan** | `stackchan-bridge` :18080（LAN） | 音声・ESP32 | [private-pi5-stackchan-bridge-deploy.md](../runbooks/private-pi5-stackchan-bridge-deploy.md) |
| **Hermes** | `hermes-gateway`（Discord・**未設定時は停止**） | 雑談 DM | 本計画・[private-pi5-hermes-deploy.md](../runbooks/private-pi5-hermes-deploy.md) |

両方とも **DGX Spark**（例: Tailscale `100.118.82.72:38081`）を上流 LLM に使うが、**認可・プロセス・設定ファイルは分離**する。

## 確定仕様（セキュリティプロファイル）

実装: [`private-pi5-hermes.config.yaml.j2`](../../infrastructure/ansible/templates/private-pi5-hermes.config.yaml.j2) / [`private-pi5-hermes.env.j2`](../../infrastructure/ansible/templates/private-pi5-hermes.env.j2)

| 項目 | 値 | 意図 |
|------|-----|------|
| 実行ユーザー | `hermes` | `raspi5-private` / bridge と分離 |
| `terminal.backend` | `docker` | ツール実行をコンテナ内に閉じる |
| `container_persistent` | `false` | 永続コンテナを作らない |
| `approvals.mode` | `manual` | 危険操作は手動承認 |
| `allow_lazy_installs` | `false` | 実行時の勝手なパッケージ導入を禁止 |
| `allow_private_urls` | `true` | DGX Tailscale（100.x）到達に必要 |
| `tirith_enabled` | `true` / `fail_open: false` | プロンプトインジェクション対策 |
| Discord | `require_mention: true`・`unauthorized_dm_behavior: ignore` | 許可外 DM を無視 |
| 秘密 | `~/.hermes/.env` **0600** のみ | config にトークンを書かない |
| UFW | 既定 deny・SSH + LAN `192.168.128.0/24` → **18080** のみ | bridge 維持・外向き最小化 |
| Gateway | `private_pi5_hermes_gateway_enabled: false` 既定 | Discord 未設定時は **起動しない** |

**既知の残リスク**（「万全」ではない点）: `hermes` の **docker グループ**（コンテナ経由で特権に近い）、DGX トークンの **StackChan との共有**、SSH の **Anywhere 許可**、Hermes 側の **ファイルツール明示オフ未設定**。詳細は [ADR-20260524](../decisions/ADR-20260524-private-pi5-hermes-security-profile.md)。

## インフラ前提（2026-05-24 時点）

- ホスト: inventory 名 `private-pi5-stackchan-bridge`（私用 Pi5・Tailscale 例 `100.89.190.21`）
- **Docker**: `docker.io` 導入済み・`raspi5-private` / `hermes` が `docker` グループ
- ディスク: SD 空き十分（SSD は当面不要）
- Inventory: `inventory-private-pi5-stackchan-bridge-fragment.yml`（**gitignore・秘密はコミットしない**）

## 実装物（repo）

| 種別 | パス |
|------|------|
| Playbook | [`infrastructure/ansible/playbooks/private-pi5-hermes.yml`](../../infrastructure/ansible/playbooks/private-pi5-hermes.yml) |
| Templates | [`private-pi5-hermes.config.yaml.j2`](../../infrastructure/ansible/templates/private-pi5-hermes.config.yaml.j2) 他 |
| デプロイ | [`scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh`](../../scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh) |
| 手順 | [`scripts/private-pi5-hermes/README.md`](../../scripts/private-pi5-hermes/README.md) |

## 進捗（2026-05-24）

| フェーズ | 状態 | 備考 |
|----------|------|------|
| Docker 導入（Pi5） | 完了 | `docker.io` + compose |
| セキュリティ準備（UFW・`hermes` ユーザー） | 完了 | Playbook |
| Hermes 公式 install（非対話） | 完了 | **v0.14.0**（2026.5.16） |
| config / `.env` 配備 | 完了 | 0600 / 0700 |
| `hermes doctor` | 完了 | 未使用機能の警告のみ |
| DGX `/healthz` | 完了 | `ok` |
| Docker hello-world（hermes） | 完了 | |
| `stackchan-bridge` | 完了 | UFW 後も **active** |
| `hermes-gateway` | 停止 | Discord 未設定 |
| Discord Bot・許可 User ID | 未着手 | ユーザーがアカウント作成予定 |
| 雑談 E2E（Discord） | 未着手 | |

**Playbook 最終実行**: `PLAY RECAP ok=29 changed=6 failed=0`（2026-05-24）。

## フェーズ別チェックリスト

### Phase A — 基盤（完了）

- [x] 専用 `hermes` ユーザー・グループ
- [x] UFW（SSH + LAN 18080）
- [x] 非対話 `install.sh`（`--skip-setup` `--skip-browser`）
- [x] セキュリティ config テンプレート
- [x] systemd `hermes-gateway`（installed・**stopped**）
- [x] `hermes doctor` / DGX health / Docker 検証

### Phase B — Discord（未着手）

- [ ] Discord アカウント・Bot 作成
- [ ] fragment に `private_pi5_hermes_discord_bot_token` / `private_pi5_hermes_discord_allowed_users`
- [ ] `private_pi5_hermes_gateway_enabled: true` で Playbook 再実行
- [ ] `systemctl is-active hermes-gateway` → `active`
- [ ] 自分の DM のみで雑談 E2E

### Phase C — 硬化（推奨・未着手）

- [ ] DGX トークンを Hermes 専用に分離（StackChan と別 vault 値）
- [ ] Tailscale ACL で Hermes から DGX 以外への egress 制限（運用ポリシー次第）
- [ ] `hermes doctor` の Skills Hub 初期化（任意）

## Decision Log

- **2026-05-24**: Hermes は **StackChan bridge と inventory / ホストを共有**するが、**プロセス・ユーザー・gateway は分離**。
- **2026-05-24**: 公式 `install.sh` は **`curl | bash` 禁止**（TTY 対話でハング）。**apt 先行** + **`command` + `stdin: /dev/null`** + スクリプトファイル実行。
- **2026-05-24**: Discord 未設定時は **`gateway_enabled: false`** でサービスを止める（攻撃面を増やさない）。
- **2026-05-24**: LLM は **DGX custom endpoint**（`OPENAI_API_KEY` + `base_url`）。Nous Portal / 各種 OAuth は使わない。

## トラブルシュート索引

| 症状 | 正本 |
|------|------|
| Ansible が install で長時間停止 | [KB-private-pi5-hermes-install-noninteractive.md](../knowledge-base/KB-private-pi5-hermes-install-noninteractive.md) |
| `Group hermes does not exist` | Playbook に `group` タスク追加済み（再実行） |
| `curl: (23) Failure writing output` | `curl \| bash` + `pipefail` — ファイル経由 install へ |
| gateway が勝手に起動 | fragment の `gateway_enabled` と token の有無を確認 |

## 更新ルール

- 実機検証結果（バージョン・UFW ルール・doctor 出力）は **Runbook** に追記する。
- インストール障害は **KB** に昇格する。
- 方針変更は **ADR** → 本計画の Decision Log の順で更新する。
