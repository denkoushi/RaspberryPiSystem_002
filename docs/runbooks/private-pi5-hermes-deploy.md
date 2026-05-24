# 私用 Pi5 Hermes Agent 標準デプロイ

最終更新: 2026-05-24（max_tokens 128・簡潔プロンプト・レイテンシ実測追補）

## 目的

自宅 **私用 Pi5** に [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) を **セキュリティ先行 + 雑談プロファイル**で再現可能に配置する。StackChan `stackchan-bridge` と **同じホスト**で併用するが、**業務 Pi5 の `update-all-clients.sh` には載せない**。

## 標準ファイル

| 種別 | パス |
|------|------|
| Playbook | `infrastructure/ansible/playbooks/private-pi5-hermes.yml` |
| Config / env / systemd | `infrastructure/ansible/templates/private-pi5-hermes.*.j2` · 分割: `templates/private-pi5-hermes/` |
| Phase D0 ExecPlan | [private-pi5-hermes-tools-security-phase-d0-execplan.md](../plans/private-pi5-hermes-tools-security-phase-d0-execplan.md) |
| ADR Phase D0 | [ADR-20260525](../decisions/ADR-20260525-private-pi5-hermes-tools-security-phase-d0.md) |
| Deploy wrapper | `scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` |
| Inventory（ローカル） | `infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml`（**非追跡**） |
| 計画 | [private-pi5-hermes-agent-plan.md](../plans/private-pi5-hermes-agent-plan.md) |
| KB（install） | [KB-private-pi5-hermes-install-noninteractive.md](../knowledge-base/KB-private-pi5-hermes-install-noninteractive.md) |
| KB（403 / Bearer） | [KB-private-pi5-hermes-dgx-403-bearer-token.md](../knowledge-base/KB-private-pi5-hermes-dgx-403-bearer-token.md) |
| KB（Discord E2E・遅延） | [KB-private-pi5-hermes-discord-e2e-and-latency.md](../knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md) |
| KB（スキル・フォーラム・設計） | [KB-private-pi5-hermes-skills-community-architecture.md](../knowledge-base/KB-private-pi5-hermes-skills-community-architecture.md) |

## 前提

- 私用 Pi5 が **Tailscale** 参加済みで、Mac から Ansible SSH 可能。
- **Docker 導入済み**（`hermes` が `docker` グループ）。
- fragment に **DGX トークン**・（Discord 時）**Bot token / 許可 User ID**。
- **秘密は fragment のみ**。Git / チャットに載せない。

## 雑談プロファイル（config テンプレ要約）

[`private-pi5-hermes.config.yaml.j2`](../../infrastructure/ansible/templates/private-pi5-hermes.config.yaml.j2) が配備する主な値:

| 設定 | 値 | 理由 |
|------|-----|------|
| `model.provider` | `custom:dgx-system-prod` | `OPENAI_API_KEY` を確実に送る |
| `model.context_length` | `65536` | Hermes 64K 起動要件（**DGX 実効は ~8K**） |
| `agent.reasoning_effort` | `none` | Hermes gateway が読む正本（`model.` 直下だけでは不十分） |
| `model.max_tokens` | `128` | 長い生成抑制（50〜200 字の返答は余裕。fragment で上書き可） |
| `agent.system_prompt` | 簡潔雑談用（既定） | 文体を短めに。詳しく求められたら長め可 |
| `custom_providers[].extra_body` | `enable_thinking: false` | Pi5 側（**毎ターン上書きされ得る**） |
| **DGX gateway** | `inject_blue_chat_completions_defaults` | **正**: blue で thinking off 注入（**~100s → ~数s**） |
| `compression.enabled` | `false` | 8K 上流と非両立 |
| `agent.disabled_toolsets` | 全主要 + kanban/discord 系 + **`skills`** | 8K 超過防止。**自己改善スキルはオフ** |
| `memory.memory_enabled` | `false` | 永続ユーザープロファイルなし |
| `platform_toolsets.discord` | `[]` | Discord でツールなし |
| `discord.require_mention` | `false` | DM 雑談（許可 User で保護） |
| `auxiliary.title_generation` | `main` / timeout 20 | OpenRouter 試行タイムアウト回避 |

詳細・症状別: [KB Discord E2E](../knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md)。

## 手順

### 1. ローカル inventory fragment

StackChan bridge と **同一 fragment**（`private-pi5-stackchan-bridge`）。

```bash
cp infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.sample.yml \
  infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml
```

### 2. デプロイ

```bash
./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh
```

初回 install は **10〜30 分**（Playbook `async: 3600`）。

### 3. Playbook が行うこと

1. Tailscale preflight
2. `hermes` ユーザー + docker グループ
3. UFW（SSH + LAN **18080**）
4. apt 先行 → 非対話 `install.sh`（`--skip-setup` `--skip-browser`）
5. `config.yaml` / `.env` 配備
6. `hermes-gateway.service`（fragment の `gateway_enabled` に従う）
7. **`hermes-dgx-keep-warm.timer`**（`private_pi5_dgx_runtime_control_token` 設定時）— 10 分毎 + 起動 3 分後に DGX `/start` または ready 確認
8. `hermes doctor`・DGX `/healthz`・Docker hello-world

## Discord 有効化

### fragment（コミット禁止）

```yaml
private_pi5_hermes_discord_bot_token: "<bot-token>"
private_pi5_hermes_discord_allowed_users: "<your-discord-user-id>"
private_pi5_hermes_gateway_enabled: true
# keep-warm（体感速度）: StackChan と同じ DGX 制御トークン
private_pi5_dgx_runtime_control_token: "<runtime-control-token>"
# 任意: メンション必須に戻す場合
# private_pi5_hermes_discord_require_mention: true
# 任意: keep-warm 間隔（分）
# private_pi5_hermes_dgx_keep_warm_interval_min: 10
```

### Developer Portal

- Bot: **MESSAGE CONTENT INTENT** 等 Privileged Intents 有効化
- OAuth2: Bot を **自分のサーバーまたは DM** に招待

### 初回のみ: discord-py

Playbook 未包含の場合（2026-05-24 実績）:

```bash
sudo -u hermes bash -lc 'source ~/.hermes/hermes-agent/venv/bin/activate && uv pip install discord-py'
```

### DGX gateway（Bearer + thinking 注入）

Hermes は **Bearer** で認証。repo の `gateway-server.py` には **Bearer 受理**と **blue `chat/completions` への `enable_thinking: false` 注入**が含まれる（Hermes 雑談の体感速度に必須）。

```bash
scp scripts/dgx-local-llm-system/gateway-server.py \
  ubudgxkoushi@100.118.82.72:/srv/dgx/system-prod/bin/gateway-server.py
PID=$(cat /srv/dgx/system-prod/logs/gateway-server.pid 2>/dev/null || true)
[ -n "$PID" ] && kill "$PID" 2>/dev/null; rm -f /srv/dgx/system-prod/logs/gateway-server.pid
bash /srv/dgx/system-prod/bin/start-gateway-server.sh
curl -sf http://127.0.0.1:38081/healthz
```

詳細: [dgx-system-prod-local-llm.md](./dgx-system-prod-local-llm.md) · [KB Discord E2E](../knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md)。

### デプロイ後

```bash
sudo systemctl restart hermes-gateway
```

Discord: **`/reset`** → 短いメッセージで試す。

## DGX keep-warm（体感速度）

| 項目 | 内容 |
|------|------|
| 目的 | DGX コールドスタート（数十秒〜数分）を Discord 応答前に回避 |
| 実装 | `hermes-dgx-keep-warm.timer` → `GET /v1/models`、未 ready なら `POST /start` |
| 前提 | fragment に **`private_pi5_dgx_runtime_control_token`**（StackChan bridge と同値可） |
| 無効化 | `private_pi5_hermes_dgx_keep_warm_enabled: false` または制御トークン未設定 |

**トークンの入手**（DGX ホストで、値は fragment にのみ保存）:

```bash
# DGX（例: Tailscale SSH）
grep '^LLM_RUNTIME_CONTROL_TOKEN=' /srv/dgx/system-prod/secrets/control-server.env
# → fragment の private_pi5_dgx_runtime_control_token に貼り付け → 再デプロイ
```

```bash
systemctl is-active hermes-dgx-keep-warm.timer   # active（トークン設定時）
systemctl start hermes-dgx-keep-warm.service     # 手動で即時 warm
journalctl -u hermes-dgx-keep-warm.service -n 20 --no-pager
```

## 検証（2026-05-24 実機）

```bash
systemctl is-active hermes-gateway   # active
systemctl is-active stackchan-bridge # active（併用）

sudo -u hermes bash -lc 'set -a; source ~/.hermes/.env; set +a; \
  curl -sf -o /dev/null -w "bearer=%{http_code}\n" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  http://100.118.82.72:38081/v1/models'
# bearer=200

journalctl -u hermes-gateway -n 30 --no-pager
```

**E2E**: Discord DM で応答あり。**~1 min/通**（思考 ON）→ inject 後 **数秒** → **max_tokens 128 + 簡潔プロンプト** 後 **8.7〜10.7 s/通**（out=41〜52）。正本: [KB Discord E2E](../knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md)。

## Phase D0 — トークン分離・tools プロファイル（2026-05-24）

**既定**: 雑談のみ（`private_pi5_hermes_tools_profile_enabled` 未設定 = tools 骨格はデプロイしない）。

### fragment（コミット禁止）

```yaml
# chat 専用（省略時は private_pi5_dgx_llm_shared_token）
private_pi5_hermes_chat_dgx_llm_token: "<hermes-chat-token>"
# tools 専用（D1 以降・DGX LLM_SHARED_ADDITIONAL_TOKENS に登録）
# private_pi5_hermes_tools_dgx_llm_token: "<hermes-tools-token>"
# private_pi5_hermes_tools_profile_enabled: true
# private_pi5_hermes_tools_gateway_enabled: false
```

### DGX gateway（手動）

1. `/srv/dgx/system-prod/secrets/gateway-server.env` に `LLM_SHARED_ADDITIONAL_TOKENS=token1,token2` を追加（既存 `LLM_SHARED_TOKEN` は StackChan 用のまま可）
2. [`gateway-server.py`](../../scripts/dgx-local-llm-system/gateway-server.py) を scp 反映後、gateway 再起動（[dgx-system-prod-local-llm.md](./dgx-system-prod-local-llm.md)）
3. Pi5 再デプロイ

### 境界ポリシー smoke（repo）

```bash
python3 scripts/private-pi5-hermes/validate_boundary_policy.py
```

## トラブルシュート（クイック）

| 症状 | 参照 |
|------|------|
| 403 forbidden | [KB 403](../knowledge-base/KB-private-pi5-hermes-dgx-403-bearer-token.md) |
| 無応答（ホーム案内のみ） | `require_mention` → テンプレは false。`/reset` |
| 圧縮ループ / auto-reset | ツール無効テンプレ未反映 → 再デプロイ |
| 遅い | keep-warm timer・`private_pi5_dgx_runtime_control_token` → 本 Runbook §DGX keep-warm・[KB E2E](../knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md) |
| `/sethome` 案内 | 雑談のみなら無視可 |

## ロールバック

| 対象 | 手順 |
|------|------|
| Gateway 停止 | `private_pi5_hermes_gateway_enabled: false` → 再デプロイ |
| Hermes 全体 | `systemctl stop hermes-gateway`・`~/.hermes` 退避（手動） |

## 関連

- [private-pi5-stackchan-bridge-deploy.md](./private-pi5-stackchan-bridge-deploy.md)
- [dgx-system-prod-local-llm.md](./dgx-system-prod-local-llm.md)
- [ADR-20260524-private-pi5-hermes-security-profile.md](../decisions/ADR-20260524-private-pi5-hermes-security-profile.md)
- [ADR-20260525-private-pi5-hermes-tools-security-phase-d0.md](../decisions/ADR-20260525-private-pi5-hermes-tools-security-phase-d0.md)
- [KB 脅威モデル](../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md)
