# 私用 Pi5 Hermes Agent 標準デプロイ

最終更新: 2026-05-24

## 目的

自宅 **私用 Pi5** に [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) を **セキュリティ先行 + 雑談プロファイル**で再現可能に配置する。StackChan `stackchan-bridge` と **同じホスト**で併用するが、**業務 Pi5 の `update-all-clients.sh` には載せない**。

## 標準ファイル

| 種別 | パス |
|------|------|
| Playbook | `infrastructure/ansible/playbooks/private-pi5-hermes.yml` |
| Config / env / systemd | `infrastructure/ansible/templates/private-pi5-hermes.*.j2` |
| Deploy wrapper | `scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` |
| Inventory（ローカル） | `infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml`（**非追跡**） |
| 計画 | [private-pi5-hermes-agent-plan.md](../plans/private-pi5-hermes-agent-plan.md) |
| KB（install） | [KB-private-pi5-hermes-install-noninteractive.md](../knowledge-base/KB-private-pi5-hermes-install-noninteractive.md) |
| KB（403 / Bearer） | [KB-private-pi5-hermes-dgx-403-bearer-token.md](../knowledge-base/KB-private-pi5-hermes-dgx-403-bearer-token.md) |
| KB（Discord E2E・遅延） | [KB-private-pi5-hermes-discord-e2e-and-latency.md](../knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md) |

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
| `model.reasoning_effort` | `none` | 応答待ち短縮 |
| `compression.enabled` | `false` | 8K 上流と非両立 |
| `agent.disabled_toolsets` | 全主要 + kanban/discord 系 | ツール JSON が 8K 超の原因 |
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
7. `hermes doctor`・DGX `/healthz`・Docker hello-world

## Discord 有効化

### fragment（コミット禁止）

```yaml
private_pi5_hermes_discord_bot_token: "<bot-token>"
private_pi5_hermes_discord_allowed_users: "<your-discord-user-id>"
private_pi5_hermes_gateway_enabled: true
# 任意: メンション必須に戻す場合
# private_pi5_hermes_discord_require_mention: true
```

### Developer Portal

- Bot: **MESSAGE CONTENT INTENT** 等 Privileged Intents 有効化
- OAuth2: Bot を **自分のサーバーまたは DM** に招待

### 初回のみ: discord-py

Playbook 未包含の場合（2026-05-24 実績）:

```bash
sudo -u hermes bash -lc 'source ~/.hermes/hermes-agent/venv/bin/activate && uv pip install discord-py'
```

### DGX gateway（Bearer）

Hermes は **Bearer** で認証。repo の `gateway-server.py` を DGX へ反映:

```bash
scp scripts/dgx-local-llm-system/gateway-server.py \
  ubudgxkoushi@100.118.82.72:/srv/dgx/system-prod/bin/gateway-server.py
# PID 終了 → start-gateway-server.sh（Runbook: dgx-system-prod-local-llm.md）
```

### デプロイ後

```bash
sudo systemctl restart hermes-gateway
```

Discord: **`/reset`** → 短いメッセージで試す。

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

**E2E**: Discord DM で応答あり（体感 **~1 分/通**、改善余地あり）。

## トラブルシュート（クイック）

| 症状 | 参照 |
|------|------|
| 403 forbidden | [KB 403](../knowledge-base/KB-private-pi5-hermes-dgx-403-bearer-token.md) |
| 無応答（ホーム案内のみ） | `require_mention` → テンプレは false。`/reset` |
| 圧縮ループ / auto-reset | ツール無効テンプレ未反映 → 再デプロイ |
| 遅い | reasoning off・DGX cold start → [KB E2E](../knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md) |
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
