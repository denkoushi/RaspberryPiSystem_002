---
title: 私用 Pi5 Hermes Agent 計画（セキュリティ先行・Discord 雑談）
tags: [Hermes Agent, private Pi5, DGX Spark, Discord, Docker, UFW, Tailscale]
audience: [開発者, 運用者]
last-verified: 2026-05-24
related:
  - ../runbooks/private-pi5-hermes-deploy.md
  - ../knowledge-base/KB-private-pi5-hermes-install-noninteractive.md
  - ../knowledge-base/KB-private-pi5-hermes-dgx-403-bearer-token.md
  - ../knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md
  - ../decisions/ADR-20260524-private-pi5-hermes-security-profile.md
  - stackchan-private-pi5-tailnet-workflow-plan.md
  - ../../scripts/private-pi5-hermes/README.md
  - ../../infrastructure/ansible/playbooks/private-pi5-hermes.yml
category: plans
update-frequency: medium
---

# 私用 Pi5 Hermes Agent 計画

## 目的

自宅 **私用 Pi5** 上で [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) を運用し、**Discord（自分のみ）** から **雑談** できるようにする。StackChan 音声経路（`stackchan-bridge`）とは **別系統** とし、セキュリティを最優先する。

## スコープ

| 含む | 含まない |
|------|----------|
| 専用ユーザー `hermes` + Ansible デプロイ | 職場 Pi5 API / `update-all-clients.sh` への混載 |
| DGX `system-prod-primary`（OpenAI 互換 `/v1`） | StackChan ファーム変更 |
| Docker 隔離・手動承認・UFW | Hermes ブラウザ自動化（`--skip-browser`） |
| Discord gateway（fragment 設定後に有効化） | 業務向けツール有効化（雑談は **ツール無効**） |

## 2系統との関係（私用 Pi5 上の併用）

| 経路 | 入口 | 用途 | 認証（DGX） |
|------|------|------|-------------|
| **StackChan** | `stackchan-bridge` :18080（LAN） | 音声・ESP32 | `X-LLM-Token` |
| **Hermes** | `hermes-gateway`（Discord DM） | 雑談 | `Authorization: Bearer` |

両方 **DGX Spark**（Tailscale `100.118.82.72:38081`）を上流にするが、**プロセス・ユーザー・設定・gateway ライフサイクルは分離**。DGX gateway は **両認証方式を受理**（repo `gateway-server.py` 修正済み・DGX 実機反映済み 2026-05-24）。

## 確定仕様（セキュリティ + 雑談プロファイル）

実装: [`private-pi5-hermes.config.yaml.j2`](../../infrastructure/ansible/templates/private-pi5-hermes.config.yaml.j2) / [`private-pi5-hermes.env.j2`](../../infrastructure/ansible/templates/private-pi5-hermes.env.j2)

### セキュリティ（変更頻度低）

| 項目 | 値 | 意図 |
|------|-----|------|
| 実行ユーザー | `hermes` | `raspi5-private` / bridge と分離 |
| `terminal.backend` | `docker` | ツール実行はコンテナ内（雑談時はツール無効） |
| `approvals.mode` | `manual` | 危険操作は手動承認 |
| `allow_private_urls` | `true` | DGX Tailscale 到達 |
| `tirith_enabled` | `true` | プロンプトインジェクション対策 |
| 秘密 | `~/.hermes/.env` **0600** | config にトークンを書かない |
| UFW | deny 既定・SSH・LAN **18080** | bridge 維持 |
| Gateway | `gateway_enabled: false` 既定 | Discord 未設定時は起動しない |

### 雑談・Discord（2026-05-24 実機で確定）

| 項目 | 値 | 備考 |
|------|-----|------|
| LLM provider | `custom:dgx-system-prod` + `key_env: OPENAI_API_KEY` | [KB-403](./../knowledge-base/KB-private-pi5-hermes-dgx-403-bearer-token.md) |
| `context_length` | `65536`（config） | Hermes 起動用。**DGX 実効 ~8192** |
| `reasoning_effort` | `none` | レイテンシ短縮 |
| `compression.enabled` | `false` | 8K モデルと Hermes 64K 圧縮要件の不整合回避 |
| ツール | `disabled_toolsets` + `platform_toolsets.discord: []` | 8K 超過防止 |
| Discord | `require_mention: false`（テンプレ） | `DISCORD_ALLOWED_USERS` で保護 |
| 体感レイテンシ | **~30s〜1min/通**（初回・コールド時はより長い） | keep-warm で改善候補 |

**既知の残リスク**: `hermes` の docker グループ、DGX トークン共有、SSH Anywhere、8K 会話上限。詳細 [ADR-20260524](../decisions/ADR-20260524-private-pi5-hermes-security-profile.md)。

## インフラ前提（2026-05-24）

- ホスト: inventory `private-pi5-stackchan-bridge`（私用 Pi5・Tailscale）
- **Hermes v0.14.0**（2026.5.16）·`discord-py` は Pi5 venv へ手動追加済み（Playbook 外）
- Inventory fragment: **gitignore**（Bot token・DGX トークン・パスワード）

## 実装物（repo）

| 種別 | パス |
|------|------|
| Playbook | [`private-pi5-hermes.yml`](../../infrastructure/ansible/playbooks/private-pi5-hermes.yml) |
| Templates | `private-pi5-hermes.*.j2` |
| Deploy | [`deploy-private-pi5-hermes.sh`](../../scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh) |
| DGX gateway | [`gateway-server.py`](../../scripts/dgx-local-llm-system/gateway-server.py)（Bearer 受理） |

## 進捗（2026-05-24）

| フェーズ | 状態 | 備考 |
|----------|------|------|
| Phase A 基盤 | **完了** | UFW・hermes ユーザー・非対話 install・doctor・DGX health |
| Phase B Discord | **完了（雑談 E2E）** | gateway active・DM 応答確認。**~1min/通** |
| DGX gateway Bearer | **完了** | repo + DGX `scp` + 再起動 |
| 雑談 config プロファイル | **完了** | ツール無効・403/8K/メンション問題解消 |
| Phase C 硬化 | **未着手** | トークン分離・keep-warm・Bot token ローテ |

**Playbook 最終**: `PLAY RECAP ok=28`（2026-05-24 夕方）。

## フェーズ別チェックリスト

### Phase A — 基盤（完了）

- [x] 専用 `hermes` ユーザー・UFW
- [x] 非対話 `install.sh`
- [x] セキュリティ config テンプレート
- [x] `hermes doctor` / DGX health / Docker 検証

### Phase B — Discord（完了）

- [x] Discord Bot・許可 User ID（fragment）
- [x] `gateway_enabled: true`・Privileged Intents
- [x] `discord-py`（Pi5 venv）
- [x] DGX Bearer + Hermes `custom:dgx-system-prod`
- [x] 雑談 E2E（応答確認 18:33 JST）

### Phase C — 硬化・体験改善（次）

- [ ] DGX **keep-warm**（`/start` 常駐または cron）
- [ ] レイテンシ **10〜30s** 安定化の実測記録
- [ ] Hermes 専用 DGX トークン
- [ ] Discord Bot token ローテーション（漏洩疑い時）
- [ ] PR マージ（`feat/private-pi5-hermes-docs` + gateway 修正）

## Decision Log

- **2026-05-24**: StackChan と inventory 共有・プロセス分離。
- **2026-05-24**: install は apt 先行 + ファイル実行（[KB install](./../knowledge-base/KB-private-pi5-hermes-install-noninteractive.md)）。
- **2026-05-24**: DGX gateway は **Bearer + X-LLM-Token** 両対応。
- **2026-05-24**: Hermes は **`custom:dgx-system-prod` + `key_env`**（`no-key-required` 回避）。
- **2026-05-24**: 雑談は **ツール無効** + **compression off** + **reasoning_effort none**。
- **2026-05-24**: Discord DM は **`require_mention: false`**（許可リストで保護）。

## トラブルシュート索引

| 症状 | 正本 |
|------|------|
| install ハング | [KB install](./../knowledge-base/KB-private-pi5-hermes-install-noninteractive.md) |
| HTTP 403 / Bearer | [KB 403](./../knowledge-base/KB-private-pi5-hermes-dgx-403-bearer-token.md) |
| 遅い・8K・圧縮・無応答・/sethome | [KB Discord E2E](./../knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md) |
| デプロイ手順 | [Runbook](./../runbooks/private-pi5-hermes-deploy.md) |

## 更新ルール

- 実機検証・レイテンシ数字 → **KB Discord E2E** と Runbook。
- 方針変更 → **ADR** → 本計画 Decision Log。
