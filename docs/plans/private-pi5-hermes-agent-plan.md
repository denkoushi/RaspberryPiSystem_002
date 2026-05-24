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
  - ../knowledge-base/KB-private-pi5-hermes-skills-community-architecture.md
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
| keep-warm・gateway thinking 注入 | |

## 2系統との関係（私用 Pi5 上の併用）

| 経路 | 入口 | 用途 | 認証（DGX） | 体感速度（目安） |
|------|------|------|-------------|------------------|
| **StackChan** | `stackchan-bridge` :18080（LAN） | 音声・ESP32 | `X-LLM-Token` | `max_tokens` 160 級・thinking off 明示 |
| **Hermes** | `hermes-gateway`（Discord DM） | 雑談 | `Authorization: Bearer` | **数秒〜十数秒/通**（2026-05-24 改善後） |

両方 **DGX Spark**（Tailscale `100.118.82.72:38081`）を上流にするが、**プロセス・ユーザー・設定・gateway ライフサイクルは分離**。

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

### 雑談・Discord・レイテンシ（2026-05-24 実機確定）

| 項目 | 値 | 備考 |
|------|-----|------|
| LLM provider | `custom:dgx-system-prod` + `key_env: OPENAI_API_KEY` | [KB 403](./../knowledge-base/KB-private-pi5-hermes-dgx-403-bearer-token.md) |
| `context_length` | `65536`（config） | Hermes 起動用。**DGX 実効 ~8192** |
| `max_tokens` | **128** | 長い生成抑制（50〜200 字は可） |
| `agent.system_prompt` | 簡潔雑談（既定） | 2〜4 文目安。「詳しく」時のみ長め |
| `agent.reasoning_effort` | **none** | Hermes が読む正本 |
| `compression.enabled` | `false` | 8K モデルと不整合回避 |
| ツール | `disabled_toolsets` + `platform_toolsets.discord: []` | 8K 超過防止。**`skills` / `memory` 無効**（自己改善・永続記憶なし） |
| Discord | `require_mention: false` | 許可リストで保護 |
| DGX thinking | **gateway `inject_blue_chat_completions_defaults`** | `reasoning_effort` だけでは ~100s/通 |
| keep-warm | `hermes-dgx-keep-warm.timer` | 要 `private_pi5_dgx_runtime_control_token` |
| 体感レイテンシ | **~1 min/通** → **数秒〜十数秒/通**（inject + max_tokens 128） | 実測 **8.7〜10.7 s**（out=41〜52） |

**既知の残リスク**: `hermes` の docker グループ、DGX トークン共有、SSH Anywhere、8K 会話上限。詳細 [ADR-20260524](../decisions/ADR-20260524-private-pi5-hermes-security-profile.md)。

## 実装物（repo）

| 種別 | パス |
|------|------|
| Playbook | [`private-pi5-hermes.yml`](../../infrastructure/ansible/playbooks/private-pi5-hermes.yml) |
| Templates | `private-pi5-hermes.*.j2` |
| Deploy | [`deploy-private-pi5-hermes.sh`](../../scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh) |
| keep-warm | [`dgx_keep_warm.py`](../../scripts/private-pi5-hermes/dgx_keep_warm.py) · [`dgx_runtime_client.py`](../../scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py) |
| DGX gateway | [`gateway-server.py`](../../scripts/dgx-local-llm-system/gateway-server.py)（Bearer + **thinking 注入**） |

## 進捗（2026-05-24）

| フェーズ | 状態 | 備考 |
|----------|------|------|
| Phase A 基盤 | **完了** | UFW・hermes・install・doctor |
| Phase B Discord | **完了** | DM E2E・403/8K/メンション解消 |
| Phase C 体験 | **完了（実用レベル）** | keep-warm・thinking 注入・max_tokens 128。**体感 OK**（8.7〜10.7 s/通） |
| DGX gateway | **完了** | Bearer + inject・DGX 再起動済 |

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
- [x] 雑談 E2E

### Phase C — 硬化・体験改善

- [x] DGX **keep-warm**（timer + `dgx_keep_warm.py`）
- [x] **enable_thinking 注入**（DGX gateway + Hermes config）
- [x] **`max_tokens: 128` + 簡潔 `agent.system_prompt`**（Pi5 デプロイ・実測 **&lt;15s** 安定）
- [ ] Hermes **既定プロンプト本体**の短縮（`in` ~661 削減・任意）
- [ ] Hermes 専用 DGX トークン
- [ ] Discord Bot token ローテーション（漏洩疑い時）
- [ ] PR マージ（ユーザー明示時）

## Decision Log

- **2026-05-24**: StackChan と inventory 共有・プロセス分離。
- **2026-05-24**: install は apt 先行 + ファイル実行（[KB install](./../knowledge-base/KB-private-pi5-hermes-install-noninteractive.md)）。
- **2026-05-24**: DGX gateway は **Bearer + X-LLM-Token** 両対応。
- **2026-05-24**: Hermes は **`custom:dgx-system-prod` + `key_env`**。
- **2026-05-24**: 雑談は **ツール無効** + **compression off**。
- **2026-05-24**: Discord DM は **`require_mention: false`**。
- **2026-05-24**: keep-warm は **`hermes-dgx-keep-warm.timer`**。要 **`private_pi5_dgx_runtime_control_token`**。
- **2026-05-24**: vLLM 遅延の主因は **思考トークン**。Fix は **`chat_template_kwargs.enable_thinking: false`**。Hermes は毎ターン `request_overrides` を空にするため **DGX gateway で注入**（`inject_blue_chat_completions_defaults`）。
- **2026-05-24**: **`agent.reasoning_effort`**（`model.` 直下のみでは CustomProfile に届かない）。
- **2026-05-24**: **主因は DGX 推論**（思考トークン・out 比例）。経路は通常 **~2〜3 s** 級。
- **2026-05-24**: **`max_tokens: 128`** + **`agent.system_prompt`（簡潔雑談）**。50〜200 字は可。Pi5 デプロイ後 **8.7〜10.7 s/通**（out=41〜52）。
- **2026-05-24**: **`skills` / `memory` 無効** — 雑談プロファイルでは **自己改善スキル・永続記憶は使わない**（会話から自然には賢くならない）。
- **2026-05-24**: **Phase C 完了（実用レベル）** — 遅延主因は DGX 推論。gateway 境界で thinking 注入・共有 runtime client。

## 実装構成（repo・境界）

| モジュール | 責務 | 再利用 |
|------------|------|--------|
| `dgx_runtime_client.py` | DGX ready / start / warm | StackChan bridge + Hermes keep-warm |
| `dgx_keep_warm.py` | systemd oneshot CLI | Pi5 timer のみ |
| `gateway-server.py` → `inject_blue_*` | blue thinking off 注入 | 全 OpenAI 互換クライアント |
| Ansible テンプレ | config / env / systemd | 再現可能デプロイ |

設計評価（SOLID・スケールの限界）: [KB スキル・コミュニティ・アーキテクチャ](./../knowledge-base/KB-private-pi5-hermes-skills-community-architecture.md)。

DGX Spark フォーラム知見（モデル・セキュリティ・活用）: 同上 KB §フォーラム。

## トラブルシュート索引

| 症状 | 正本 |
|------|------|
| install ハング | [KB install](./../knowledge-base/KB-private-pi5-hermes-install-noninteractive.md) |
| HTTP 403 / Bearer | [KB 403](./../knowledge-base/KB-private-pi5-hermes-dgx-403-bearer-token.md) |
| 遅い・8K・圧縮・無応答 | [KB Discord E2E・遅延](./../knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md) |
| スキル・賢くならない・フォーラム | [KB スキル・コミュニティ](./../knowledge-base/KB-private-pi5-hermes-skills-community-architecture.md) |
| デプロイ手順 | [Runbook](./../runbooks/private-pi5-hermes-deploy.md) |

## 更新ルール

- 実機検証・レイテンシ数字 → **KB Discord E2E** と Runbook。
- 方針変更 → **ADR** → 本計画 Decision Log。
