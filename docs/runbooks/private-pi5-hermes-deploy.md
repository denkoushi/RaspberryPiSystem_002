# 私用 Pi5 Hermes Agent 標準デプロイ

最終更新: 2026-06-06（D7-life reminder scheduler Discord 通知E2E完了 · D6-life Life Pilot 私用 Pi5 + Discord E2E 完了 · D6-pre `/daily` 私用 Pi5 実機検証完了）

## 運用状態サマリ（2026-05-24 時点）

| 項目 | 状態 |
|------|------|
| **Git** | `main` @ `65d21c3f` 以降（`feat/private-pi5-hermes-docs` は **マージ済**） |
| **対象ホスト** | 私用 Pi5 `raspi5-private`（`100.89.190.21`）· DGX `dgx-local-llm-system`（`100.118.82.72`）のみ |
| **Hermes** | `hermes-gateway` **active** · Discord DM **応答あり**（トークン分離後も正常） |
| **StackChan** | `stackchan-bridge` **active**（同一ホスト・別プロセス） |
| **DGX 認証** | `LLM_SHARED_TOKEN`＝StackChan · `LLM_SHARED_ADDITIONAL_TOKENS`＝Hermes chat 専用 |
| **Tailscale** | `tag:private-server` · grants **admin 保存済**（[§Tailscale](#tailscale私用-pi5-分離)） |
| **tools プロファイル** | **骨格デプロイ済**（`tools_profile_enabled=True` · `hermes-tools-gateway` **停止**） |
| **境界ポリシー** | repo 正本のみ（Hermes ランタイム未接続） |

**正本リンク**: [ExecPlan D0](../plans/private-pi5-hermes-tools-security-phase-d0-execplan.md) · [KB 脅威モデル](../knowledge-base/KB-private-pi5-hermes-tools-security-threat-model.md) · [ADR-20260525](../decisions/ADR-20260525-private-pi5-hermes-tools-security-phase-d0.md) · [AI執事ビジョン（北極星）](../plans/private-pi5-hermes-butler-vision-and-roadmap.md)

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

標準 `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` は **verify 前に `hermes-gateway` を自動 restart** する（[`restart-chat-gateway.yml`](../../infrastructure/ansible/tasks/private-pi5-hermes/restart-chat-gateway.yml)）。手動 hotfix で plugin のみ copy した場合のみ:

```bash
sudo systemctl restart hermes-gateway
```

Discord: **`/reset`** → 短いメッセージで試す。

## DGX keep-warm（体感速度）

| 項目 | 内容 |
|------|------|
| 目的 | DGX コールドスタート（数十秒〜数分）を Discord 応答前に回避 |
| 実装 | `hermes-dgx-keep-warm.timer` → `DGX_MODEL_PROFILE_ID` 設定時は **`POST /start` で通常 profile を維持**（未設定時は従来どおり ready のみ見て cold 時 `{}` start） |
| 通常 profile | 既定 **`business_qwen36_27b_nvfp4`**（`private_pi5_hermes_dgx_default_model_profile_id`） |
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

## 本番反映（2026-05-24・Phase D0 骨格・私用 Pi5 → DGX 順次）

**対象**: 私用 Pi5（`private-pi5-stackchan-bridge` / `raspi5-private@100.89.190.21`）と DGX Spark（`ubudgxkoushi@100.118.82.72`）のみ。**業務 Pi5 / Pi4 / Pi3 / `update-all-clients.sh` は未使用**。

| 順 | ホスト | 手順 | 結果 |
|----|--------|------|------|
| 1 | DGX | `scp gateway-server.py` + **`gateway_llm_auth.py`** → PID 削除 → `start-gateway-server.sh` | `healthz` **200**・`gateway_llm_auth` import OK |
| 2 | 私用 Pi5 | `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` | `PLAY RECAP` **ok=40 changed=3 failed=0**（約 **109s**） |

**Ansible 要約**: `tools_profile_enabled=False`（tools 骨格・`hermes-tools-gateway` はスキップ）。`hermes-gateway` / `stackchan-bridge` / `hermes-dgx-keep-warm.timer` は **active**。`hermes doctor`・DGX health・Bearer **`/v1/models` → 200**（playbook verify + 実機 curl）。

**デプロイ中の repo 修正（再発防止）**:

1. **変数自己参照**: playbook `vars` で `private_pi5_hermes_chat_dgx_llm_token` を同名で解決すると **Recursive loop** → `pre_tasks` の `set_fact` + `hostvars[...].get(...)` に変更。
2. **Jinja include**: `config.chat.yaml.j2` の `{% include 'private-pi5-hermes/config.base.yaml.j2' %}` は tasks からの template 探索で **not found** → 同ディレクトリ名 `config.base.yaml.j2` に変更。`deploy-chat-profile.yml` の `src` は `../../templates/private-pi5-hermes/...`。
3. **SSH 直叩き**: `raspi5-private@100.89.190.21` はローカル鍵未登録で **Permission denied** のことがある → 検証は **inventory 経由の `ansible -m shell`** を正本とする。

**Phase D1 以降**: tools 骨格は **実施済**（[§Phase D1 本番反映](#phase-d1--tools-プロファイル骨格実機本番反映2026-05-24)）。

## トークン分離（2026-05-24 実施）

| 項目 | 内容 |
|------|------|
| DGX | `LLM_SHARED_TOKEN` は **StackChan 用のまま**。`LLM_SHARED_ADDITIONAL_TOKENS` に **Hermes chat 専用**（`openssl rand -hex 32` 等で生成）を 1 件追加 → gateway 再起動（PID 削除手順） |
| fragment | `private_pi5_hermes_chat_dgx_llm_token` を設定（**コミット禁止**）。`private_pi5_dgx_llm_shared_token` は StackChan bridge 用のまま |
| Pi5 | `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` で `~/.hermes/.env` と keep-warm env を再配布 |

**検証（DGX 上・127.0.0.1）**: primary `X-LLM-Token` → **200** · chat `Bearer` → **200** · 不正トークン → **403**。**Pi5**: `hermes` ユーザの Bearer → **200**（playbook verify + curl）。

**効果**: Hermes 漏洩時に StackChan 用 primary トークンは共用されない（逆も同様）。

**Discord E2E（分離後）**: ユーザー確認 **応答あり・正常**（2026-05-24）。

## Tailscale（私用 Pi5 分離・2026-05-24 適用済）

| 項目 | 内容 |
|------|------|
| 機械タグ | `tag:private-server`（`raspi5-private`・既存） |
| `tagOwners` | **既存維持** `"tag:private-server": ["denkoushi@github"]`（重複追加しない） |
| 追加 `grants` | ① `tag:private-server` → `tag:llm` **`tcp:38081`** ② `tag:admin` → `tag:private-server` **`tcp:22`** |
| 正本 JSON | [tailscale-policy-hermes-private-pi5-grants.json](../security/tailscale-policy-hermes-private-pi5-grants.json) |
| 適用後検証 | [verification.sh](../security/tailscale-policy-hermes-private-pi5-verification.sh) → **PASS**（DGX 200 · 業務 Pi5 未到達 · Hermes Bearer 200） |

**管理画面で duplicate `tag:private-server` エラー** → `tagOwners` は触らず **`grants` の2件だけ**追加（[草案 §適用](../security/tailscale-policy-hermes-private-pi5-draft.md)）。

## 検証（2026-05-24 実機）

```bash
systemctl is-active hermes-gateway   # active
systemctl is-active stackchan-bridge # active（併用）
systemctl is-active hermes-dgx-keep-warm.timer  # active（Phase D0 再デプロイ後）

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

## Phase D1 — tools プロファイル骨格（実機）

**目的**: `~/.hermes-tools` を配備し、境界ポリシー正本を実機に置く。**ツールはまだ無効** · **`hermes-tools-gateway` は停止**。

### fragment（必須）

```yaml
private_pi5_hermes_tools_profile_enabled: true
private_pi5_hermes_tools_dgx_llm_token: "<dedicated-tools-token>"  # chat と別
private_pi5_hermes_tools_gateway_enabled: false
```

Playbook は **tools トークン未設定**または **chat と同一**のとき **fail**。

### DGX（tools トークン）

`LLM_SHARED_ADDITIONAL_TOKENS` を **`<chat-token>,<tools-token>`**（カンマ区切り・chat は既存維持）→ gateway 再起動。

### デプロイ・検証

```bash
./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh
# Pi5 上（root または sudo）または:
ansible -i infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml \
  private-pi5-stackchan-bridge -m script -a scripts/private-pi5-hermes/verify-tools-profile-deploy.sh -b
```

**受け入れ**: `hermes-gateway` active · `hermes-tools-gateway` inactive · `boundary-policy.tools.yaml` 存在 · tools/chat Bearer とも DGX **200**。

正本: [Phase D1 ExecPlan](../plans/private-pi5-hermes-tools-security-phase-d1-execplan.md)。

## Phase D1 — tools プロファイル骨格（実機本番反映・2026-05-24）

| # | 対象 | 手順 | 結果 |
|---|------|------|------|
| — | DGX | additional 済のため **再起動スキップ** | localhost chat/tools Bearer **200** |
| 1 | 私用 Pi5 | `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` | `PLAY RECAP` **ok=57 failed=0**（約 **123s**） |

**fragment（非コミット）**: `private_pi5_hermes_tools_profile_enabled: true` · 専用 `private_pi5_hermes_tools_dgx_llm_token` · `private_pi5_hermes_tools_gateway_enabled: false`。

**追加検証**（`cd infrastructure/ansible` 後）:

```bash
ansible private-pi5-stackchan-bridge \
  -i inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m script -a ../../scripts/private-pi5-hermes/verify-tools-profile-deploy.sh -b
```

**CI / Git**: `feat/private-pi5-hermes-d1` · `15a95e13` · CI **`26361904957`** success → **`main` マージ**。

**記録**: [KB Phase D1 本番](../knowledge-base/KB-private-pi5-hermes-phase-d1-production.md)。

## Phase D2 — file ツールのみ（workspace 限定・repo 実装）

**目的**: tools プロファイルで **`file` のみ有効** · ホスト `~/.hermes-tools/workspace` を Docker **`/workspace`** にバインド · **`hermes-tools-gateway` 起動** · chat（Discord）は **無変更**。

### fragment（必須）

```yaml
private_pi5_hermes_tools_profile_enabled: true
private_pi5_hermes_tools_dgx_llm_token: "<dedicated-tools-token>"
private_pi5_hermes_tools_file_enabled: true
private_pi5_hermes_tools_gateway_enabled: true
```

D2 では playbook が **`tools_gateway_enabled: true` を assert**（file 有効時）。

### デプロイ・検証

```bash
./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh
# Pi5 上または ansible（fragment inventory）:
HERMES_TOOLS_PHASE=d2 ./scripts/private-pi5-hermes/verify-tools-profile-deploy.sh
./scripts/private-pi5-hermes/verify-tools-file-smoke.sh   # 任意
```

**受け入れ**: `hermes-gateway` active · `hermes-tools-gateway` **active** · config に `workspace:/workspace` マウント · `file` が disabled_toolsets に **無い** · tools/chat Bearer **200**。

**repo 契約チェック**:

```bash
python3 scripts/private-pi5-hermes/validate_boundary_policy.py --check-docker-volumes
```

正本: [Phase D2 ExecPlan](../plans/private-pi5-hermes-tools-security-phase-d2-execplan.md)。

## Phase D2 — file ツールのみ（実機本番反映・2026-05-24）

| # | 対象 | 手順 | 結果 |
|---|------|------|------|
| 1 | 私用 Pi5 | `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` | `PLAY RECAP` **ok=61 changed=4 failed=0**（約 **131s**） |

**fragment**: `private_pi5_hermes_tools_file_enabled: true` · `private_pi5_hermes_tools_gateway_enabled: true`（D1 から変更）。

**検証**: `HERMES_TOOLS_PHASE=d2` + `verify-tools-profile-deploy.sh` → **OK** · `verify-tools-file-smoke.sh` → **OK**。

**CI / Git**: `feat/private-pi5-hermes-d2` · `630cdbe1` · CI **`26362979630`** success。

**記録**: [KB Phase D2 本番](../knowledge-base/KB-private-pi5-hermes-phase-d2-production.md)。

## Phase D3 — file + web（URL 境界同期・repo 実装）

**目的**: D2 の **file** を維持し **`web` を有効化**。`boundary-policy.tools.yaml` の deny 規則を Hermes **`security.website_blocklist`** に同期（[`hermes_security_adapter.py`](../../scripts/private-pi5-hermes/lib/hermes_security_adapter.py)）。**chat は無変更**。

### fragment（必須）

```yaml
private_pi5_hermes_tools_profile_enabled: true
private_pi5_hermes_tools_dgx_llm_token: "<dedicated-tools-token>"
private_pi5_hermes_tools_file_enabled: true
private_pi5_hermes_tools_web_enabled: true
private_pi5_hermes_tools_gateway_enabled: true
```

D3 では playbook が **`tools_web_enabled` 時に file + gateway を assert** する。

### デプロイ・検証

```bash
./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh
HERMES_TOOLS_PHASE=d3 ./scripts/private-pi5-hermes/verify-tools-profile-deploy.sh
./scripts/private-pi5-hermes/verify-tools-web-smoke.sh      # 任意（DGX 到達時）
./scripts/private-pi5-hermes/verify-tools-file-smoke.sh     # D2 回帰・任意
```

**受け入れ**: D2 条件に加え **`web` が disabled_toolsets に無い** · **`website_blocklist.enabled: true`** · tools/chat Bearer **200**。

**repo 契約チェック**:

```bash
python3 scripts/private-pi5-hermes/validate_boundary_policy.py --emit-hermes-security
```

正本: [Phase D3 ExecPlan](../plans/private-pi5-hermes-tools-security-phase-d3-execplan.md)。

## Phase D3 — file + web（実機本番反映・2026-05-25）

| # | 対象 | 手順 | 結果 |
|---|------|------|------|
| 1 | 私用 Pi5 | `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` | `PLAY RECAP` **ok=67 changed=1 failed=0**（約 **123s**） |

**fragment**: `private_pi5_hermes_tools_web_enabled: true` を追加（D2 の file + gateway は維持）。

**検証**: ansible `copy` + `HERMES_TOOLS_PHASE=d3 /tmp/verify-tools-profile-deploy.sh` → **OK** · `verify-tools-file-smoke.sh` → **OK** · Pi5 上 web-smoke curl → **200**。

**CI / Git**: `feat/private-pi5-hermes-d3` · `cfdae77a` · CI **`26375912601`** success。

**記録**: [KB Phase D3 本番](../knowledge-base/KB-private-pi5-hermes-phase-d3-production.md)。

## Phase D4 — file + web + browser（実機本番反映・2026-05-25）

**目的**: D3 を維持し **`browser` toolset** を有効化。ローカル **agent-browser** のみ（クラウド browser API キー禁止）。**`AGENT_BROWSER_ARGS`** を tools `.env` に配置。**初回 install は `--skip-browser` 維持**；`private_pi5_hermes_tools_browser_enabled: true` 時のみ `install-browser-tooling.yml` が Chromium + **agent-browser symlink** を実行。

| # | 対象 | 手順 | 結果 |
|---|------|------|------|
| 1 | 私用 Pi5 | `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` | `PLAY RECAP` **ok=78 changed=2 failed=0**（約 **132s**） |

**fragment（D4）** — D3 に加え:

```yaml
private_pi5_hermes_tools_browser_enabled: true
# 任意:
# private_pi5_hermes_browser_agent_args: "--no-sandbox,--disable-dev-shm-usage"
```

**検証（実機）**:

```bash
# ansible copy 後（Pi5）
HERMES_TOOLS_PHASE=d4 /tmp/verify-tools-profile-deploy.sh
# browser smoke: REPO_ROOT 下に scripts/private-pi5-hermes/lib を配置してから実行
REPO_ROOT=/tmp/smoke-repo /tmp/verify-tools-browser-smoke.sh
```

**記録**: [KB Phase D4 本番](../knowledge-base/KB-private-pi5-hermes-phase-d4-production.md)。

正本: [Phase D4 ExecPlan](../plans/private-pi5-hermes-tools-security-phase-d4-execplan.md)。

## Phase D5 — Discord `/task` 橋（実機本番反映・2026-05-25）

**目的**: 雑談（chat）は維持し、**`/task <指示>`** のみ tools プロファイル（D4: file+web+browser）へ委譲。

**fragment（D5）** — D4 に加え:

```yaml
private_pi5_hermes_discord_tools_bridge_enabled: true
private_pi5_hermes_gateway_enabled: true
# 必須: /task 実行前の DGX profile 復帰（POST /start）
private_pi5_dgx_runtime_control_token: "<from vault>"
```

**デプロイ**: 標準 `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh`（`deploy-discord-task-bridge.yml` が **`~/.hermes/plugins/private-pi5-discord-task-bridge/`** に plugin + policy を配置 · chat テンプレに `plugins.enabled`）。

**検証（repo / Pi5）**:

```bash
./scripts/private-pi5-hermes/verify-discord-task-bridge-smoke.sh
# Pi5（lib + config を REPO_ROOT 下に配置してから）
REPO_ROOT=/tmp/smoke-repo /tmp/verify-discord-task-bridge-smoke.sh
```

**Discord 利用**: `/task List files in workspace`（read-only 推奨）。**`/task` は gateway plugin コマンド**（`hermes task` トップレベル CLI ではない）。承認待ちは [ExecPlan D5](../plans/private-pi5-hermes-tools-security-phase-d5-execplan.md) 参照。

### Phase D6-pre — Discord `/daily` 普段遣いパイロット（2026-06-06 実機検証完了）

**目的**: Hermes を **実行者ではなく進行係**として試す。`/daily <メモ>` は **Markdown handoff のみ**（Cursor 指示書 · Codex レビュー依頼 · CI/Deploy チェックリスト · 日次ログ）。

**有効化（fragment · 非コミット）**:

```yaml
private_pi5_hermes_daily_pilot_enabled: true
# 必須: private_pi5_hermes_gateway_enabled: true
```

**配備物**: `daily-pilot.policy.yaml` · `daily_pilot_policy.py` · `discord_daily_pilot_bridge.py` · `discord_command_sync.py` · plugin `register()` に `/daily` 追加 · chat `system_prompt` に `/daily` 案内

**検証（ローカル · 2026-06-06）**: unittest **149 OK**（daily/sync focused **23 OK**）· `--validate-daily-pilot` OK · smoke OK

**私用 Pi5 実機（2026-06-06 · 受け入れ完了）**:

| 項目 | 結果 |
|------|------|
| `hermes-gateway` | active |
| plugin コマンド | `daily` · `novel` · `task` · `task-approve` · `task-deny` |
| Discord slash | `/daily` global 登録（Ansible `present` 管理 · 既存 bridge コマンド維持） |
| 安全試験 | `/daily 今日の作業メモを作って` → **Daily Pilot Draft** |
| 危険試験 | `/daily git pushしてdeployして` → **daily rejected** |

**デプロイ経路（2026-06-06 確定）**:

| 段階 | 内容 |
|------|------|
| 初回 | Codex sandbox 制限 → **最小ファイル手動配置** + `hermes-gateway` restart（[KB §Surprises](../knowledge-base/KB-private-pi5-hermes-daily-pilot.md#デプロイ経路の注意surprises)） |
| **収束** | **Cursor から標準 Ansible deploy 完了** — `daily-pilot.policy.yaml` · plugin · Discord `/daily` present · 既存 slash 維持 |

以降の変更は **必ず** `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` 経由。

**Discord スラッシュ同期**: `private_pi5_hermes_discord_bot_token` が設定されている場合、Ansible が controller 側で Discord API を呼び、`private_pi5_hermes_daily_pilot_enabled: true` なら `/daily` を **present**、false なら **absent** にする。token は環境変数で渡し、task は `no_log: true`。

**標準デプロイ手順**:

1. fragment にフラグ追加 → `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh`
2. Pi5 で plugin コマンド一覧に `daily` があること
3. Discord 側で `/daily` が補完に出ること（Ansible command sync）
4. Discord 受け入れ試験（上表の安全/危険プロンプト）
5. `/task` `/novel` 回帰

**policy 修正（2026-06-06）**: 初版 regex は `git pushして` 未拒否・安全な Cursor 文案の誤拒否があり得た。repo 最新 `daily-pilot.policy.yaml` を配備すること。

**禁止（意図的）**: Cursor/Codex CLI · git · deploy · terminal · 秘密読取 — [KB daily pilot](../knowledge-base/KB-private-pi5-hermes-daily-pilot.md)

**記録**: [ExecPlan D6-pre](../plans/private-pi5-hermes-daily-pilot-execplan.md) · [`daily-pilot.policy.yaml`](../../scripts/private-pi5-hermes/config/daily-pilot.policy.yaml)

### Phase D6-life — Discord Life Pilot（2026-06-06 私用 Pi5 + Discord E2E 完了）

**目的**: Codex/Cursor 使役の前に、Hermes を **日常生活の執事**として体感する。`/memo` `/digest` `/remind` `/recommend` は private life log の記録・要約・軽い提案のみ。

**有効化（fragment · 非コミット）**:

```yaml
private_pi5_hermes_life_pilot_enabled: true
# 必須: private_pi5_hermes_gateway_enabled: true
```

**配備物**: `life-pilot.policy.yaml` · `life_pilot_policy.py` · `discord_life_pilot_bridge.py` · `life_reminder_scheduler.py` · plugin `register()` に `/memo` `/digest` `/remind` `/recommend` 追加 · `hermes-life-reminder.timer` · chat `system_prompt` に Life Pilot 案内

**Discord 応答UX**: 日常利用では本文を通常テキストで先頭表示し、保存先・件数・安全境界などの診断情報は `-# debug:` 1行に畳む。

**保存先**:

```text
/home/hermes/.hermes-life/
  notes/YYYY-MM-DD.md
  reminders/reminders.jsonl
```

**検証（ローカル · 2026-06-06）**: focused unittest **39 OK** · `--validate-life-pilot` OK · compileall OK · Ansible syntax check OK

**私用 Pi5 + Discord E2E（2026-06-06 · 受け入れ完了）**:

| 項目 | 結果 |
|------|------|
| `hermes-gateway` | active / running |
| plugin コマンド | `daily` · `memo` · `digest` · `remind` · `recommend` · `novel` · `task` · `task-approve` · `task-deny` |
| Discord slash | `/daily` `/memo` `/digest` `/remind` `/recommend` 定義一致 |
| 安全メモ | `/memo ...` → 本文が先頭、下部に `-# debug:` |
| digest | `/digest` → `Focus:` / `Recent notes:`、下部に `-# debug:` |
| reminder | `/remind ...` → 本文が先頭、下部に `status=pending` を含む `-# debug:` |
| 危険試験 | `/memo git pushしてdeployして` → **memo rejected** |

**実機目視（PR #403 反映後 · 2026-06-06）**: Discord で `/memo` `/digest` `/remind` の本文先頭表示、`#` 見出しなし、`>` 引用なし、下部 `-# debug:` のみをユーザー確認 OK。

**実機通知E2E（PR #405 反映後 · 2026-06-06）**:

| 項目 | 結果 |
|------|------|
| deploy | `main` @ `7a51cfb7` · `PLAY RECAP` `ok=167 changed=7 failed=0` |
| digest | `Scheduled reminders:` と `Pending without time:` が分離表示 |
| recommend | 次の scheduled reminder と日時未指定 reminder を優先して提案 |
| `/remind 2026-06-06 HH:MM ...` | `scheduled: 2026-06-06 HH:MM`、`status=pending`、`notification=scheduled` を表示 |
| due notification | 指定時刻に Discord 通知が届き、debug は `reminder=due` と `boundary=local-only/no-tools` |

補足: `notification=not-enabled` の既存/別経路 reminder は送信先 channel context がないため通知対象外。日時つき・送信先ありの reminder は `notification=scheduled` となり、timer により通知されることを確認済み。

個人メモ本文は Runbook に残さない。

**標準デプロイ手順**:

1. fragment に `private_pi5_hermes_life_pilot_enabled: true` を追加
2. `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh`
3. Pi5 で plugin コマンド一覧に `memo` `digest` `remind` `recommend` があること
4. Discord 側で4コマンドが補完に出ること（token 設定時の Ansible command sync）
5. Discord 受け入れ試験:
   - `/memo 今日は朝散歩した。体調は良い。` → 本文が先頭、`#` 見出しと `>` 引用なし
   - `/digest` → `Focus:` / `Recent notes:`、`#` 見出しなし
   - `/remind 明日の朝、燃えるごみを出す` → 本文が先頭、`scheduled:` と `status=pending` を含む `-# debug:`
   - `/recommend` → `Focus:` / `Suggested next steps:`、`#` 見出しなし
   - `/memo git pushしてdeployして` → **memo rejected**

**禁止（意図的）**: Cursor/Codex CLI · production repo 編集 · git · deploy · terminal · 秘密読取 · 外部Web検索 · Home Assistant/カメラ制御。

**注意**: `/remind` は日時を読めた request のみ `hermes-life-reminder.timer` が Discord 通知する。日時を読めない request は pending without time として残す。詳細正本: [ExecPlan D6-life](../plans/private-pi5-hermes-life-pilot-execplan.md)。

**記録**: [ExecPlan D6-life](../plans/private-pi5-hermes-life-pilot-execplan.md) · [KB Life Pilot](../knowledge-base/KB-private-pi5-hermes-life-pilot.md) · [`life-pilot.policy.yaml`](../../scripts/private-pi5-hermes/config/life-pilot.policy.yaml)

**現在の `/task` 安全枠（2026-06-05）**: `task-bridge.policy.yaml` は tools を **file/web/browser 固定**にし、タスク分類を検証出力へ載せる。許可は workspace 読取・要承認の workspace 書込・DGX health などの bounded check まで。**Codex/Cursor の直接実行、git commit/push/merge、deploy/systemctl/docker、terminal/shell、秘密・token 読取、tailnet/LAN scan は deferred**。これらは D6+ の専用 worker profile と追加承認設計後に扱う。

```bash
python3 scripts/private-pi5-hermes/validate_boundary_policy.py --validate-task-bridge
# task_bridge.allowed_task_classes / deferred_task_classes を確認
```

**DGX 通常 profile 復帰（`/novel` 後の `/task`）**:

- **問題**: `/novel` は `qwen36_35b_uncensored`（green・llama **ctx 2048**）を起動する。`/task` は同じ `system-prod-primary` alias を使うため、復帰しないと **prompt+tool schema が 2048 超過で LLM 400** → 承認リレーまで到達しない。
- **対策（repo）**: `/task` 実行前に tools runner が **`business_qwen36_27b_nvfp4` へ `POST /start`**（`~/.hermes-tools/.env` の `DGX_MODEL_PROFILE_ID`）。keep-warm も同 profile を定期維持。
- **検証**: デプロイ後 `grep DGX_MODEL_PROFILE_ID=~/.hermes-tools/.env` と `~/.hermes/dgx-keep-warm.env` が **`business_qwen36_27b_nvfp4`** であること。DGX で `active-model-profile.json` の `activeProfileId` が blue 27B 系に戻っていること。

### 本番反映 — `/task` DGX 通常 profile 復帰（2026-05-30）

| # | 対象 | 手順 | 結果 |
|---|------|------|------|
| 1 | 私用 Pi5 `raspi5-private` | `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` | **`PLAY RECAP` ok=106 changed=6 failed=1**（約 **179s**）— verify で tools Bearer **502**（DGX cold）。配置は完了 |
| 2 | 同上（keep-warm 手動） | `systemctl start hermes-dgx-keep-warm.service` | **profile_ensure OK** · `business_qwen36_27b_nvfp4` · `/v1/models` **200** |
| 3 | 同上（事後検証） | `HERMES_TOOLS_PHASE=d4 /tmp/verify-tools-profile-deploy.sh` · `ensure_tools_dgx_runtime_ready` | **OK** |

**トラブルシュート（今回）**: playbook が verify で落ちても **plugin / env は更新済み**のことがある。`healthz=200` かつ `/v1/models=502` → **keep-warm または profile `/start` 完了を待って再 curl**。詳細: [KB task DGX profile restore](../knowledge-base/KB-private-pi5-hermes-task-dgx-profile-restore.md)。

**Git**: `fix/private-pi5-hermes-task-runtime-profile-restore` · **`63aab15b`**。

**記録**: [KB Phase D5 本番](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md) · [KB `/task` profile 復帰](../knowledge-base/KB-private-pi5-hermes-task-dgx-profile-restore.md)。

### 本番反映 — Discord 承認 relay 完結（2026-05-30）

| # | 対象 | 手順 | 結果 |
|---|------|------|------|
| 1 | 私用 Pi5 `raspi5-private` | `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` | **`PLAY RECAP` ok=140 changed=6 failed=0**（約 **193s**）· DGX health **ok** |

**変更概要（repo `a6b0a940`）**: 承認プロンプト **即時 Discord 送信**（失敗時 `delivery_failed.json` + ERROR ログ）· timeout 後 **grace + `approval_timed_out`** · 承認文の **最終返信後載せ禁止** · `/task` 前 **DGX profile 検証強化**。

**事後検証（Pi5 · `cd infrastructure/ansible`）**:

```bash
# read-only 状態（必ず hermes ユーザー）
ansible private-pi5-stackchan-bridge -i inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m copy -a "src=../../scripts/private-pi5-hermes/verify-task-bridge-readonly-state-pi5.sh dest=/tmp/verify-task-bridge-readonly-state-pi5.sh mode=0755" -b
ansible private-pi5-stackchan-bridge -i inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m shell -a "sudo -u hermes bash /tmp/verify-task-bridge-readonly-state-pi5.sh" -b

# write ゲート（runner 直呼び · Discord E2E ではない）
ansible private-pi5-stackchan-bridge -i inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m copy -a "src=../../scripts/private-pi5-hermes/verify-tool-write-approval-gate-pi5.sh dest=/tmp/verify-tool-write-approval-gate-pi5.sh mode=0755" -b
ansible private-pi5-stackchan-bridge -i inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m shell -a "sudo -u hermes /tmp/verify-tool-write-approval-gate-pi5.sh" -b
# 2026-05-30: request.json 未作成で FAIL（Discord 手動 E2E が受け入れ正本）
```

**Discord 手動 E2E（受け入れ）**: `/task Create <unique>.txt in workspace with content ok` → **10s 以内**に承認依頼 → `yes` または `/task-approve` → workspace にファイル。**`sudo -u hermes` 以外で `approvals/` を触らない**。

**Git**: `fix/private-pi5-hermes-task-approval-finish` · **`a6b0a940`** · CI **`26671325365`** success。

**記録**: [KB Phase D5 §承認 relay 完結](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#本番デプロイ承認-relay-完結--2026-05-30-jst)。

### 本番復旧 — `/task` 二段障害（2026-06-05）

**症状**: Discord `/task` が実用応答しない（read-only 失敗または write で承認が来ない）。

**原因（独立した 2 段）**:

1. **承認通知**: `approval_relay/discord_relay.py` の Discord REST POST が **`403` / Cloudflare `1010`**（`urllib` 既定 User-Agent）。
2. **DGX LLM**: blue 27B backend 起動失敗 → Pi5 から **`/v1/models` 502**。

**repo Fix**:

| 対象 | 変更 |
|------|------|
| [`discord_relay.py`](../../scripts/private-pi5-hermes/lib/approval_relay/discord_relay.py) | `User-Agent: DiscordBot (…)` · `Accept: application/json` |
| [`test_approval_relay.py`](../../scripts/private-pi5-hermes/tests/test_approval_relay.py) | ヘッダ regress テスト |
| DGX example / Runbook / KB-366 | snapshot path · `gpu-memory-utilization 0.65` · `language_model_only` |

**Pi5 反映（実機済み）**: plugin 配置先へ `discord_relay.py` copy → **`systemctl restart hermes-gateway`**。標準 `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` でも配布可。

**DGX 反映（実機済み · secret のみ）**: `/srv/dgx/system-prod/secrets/control-server.env` の `BLUE_SERVER_COMMAND` hotfix → **control-server 再起動** → `POST /start`（`business_qwen36_27b_nvfp4`）。手順: [dgx-system-prod-local-llm.md §blue 502](./dgx-system-prod-local-llm.md#トラブルシュート--blue-backend-起動失敗--v1models-5022026-06-05)。

**検証**:

```bash
python3 -m unittest discover -s scripts/private-pi5-hermes/tests -v
./scripts/private-pi5-hermes/verify-discord-task-bridge-smoke.sh
# Pi5: read-only /task 相当（workspace 列挙）— 実機 2026-06-05 OK
# Discord UI: /task List files in workspace — 手動推奨
```

**記録**: [KB D5 §2026-06-05 復旧](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#本番復旧--discord-task-二段障害2026-06-05) · [KB `/task` blue 502](../knowledge-base/KB-private-pi5-hermes-task-dgx-profile-restore.md#追記--blue-backend-起動失敗で-v1models-5022026-06-05)。

### 本番復旧 — 承認 `yes` ルーティング（2026-06-05 夜 · Discord write E2E 完結）

**症状**: 承認プロンプト後に `yes` → **`⚡ Interrupting current task...`** · ファイル未作成。

**Fix（2 層）**:

| 層 | 内容 |
|----|------|
| **repo（plugin）** | `approval_actor_ids` — user キー + **`channel:<id>`** フォールバック · `discord_task_bridge` / plugin hook 更新 |
| **Pi5 hotfix（Hermes 本体）** | `~/.hermes/hermes-agent/gateway/platforms/base.py` — 承認短文本を interrupt より先に `pre_gateway_dispatch` へ |

**受け入れ（実機 E2E）**:

```text
/task Create test-20260605-2.txt in workspace with content ok -- write
yes
→ ファイルを作成しました：/workspace/test-20260605-2.txt、内容は ok
```

**検証**:

```bash
python3 -m unittest discover -s scripts/private-pi5-hermes/tests -v   # 129 OK
./scripts/private-pi5-hermes/verify-discord-task-bridge-smoke.sh
```

**記録**: [KB D5 §承認 yes 最終修正](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#本番復旧--承認-yes-が割り込みに吸われる2026-06-05-夜--discord-write-e2e-完結)

#### Hermes Agent 本体 hotfix（承認 `yes` の割り込み回避 · 2026-06-05）

**対象ファイル（Pi5 · `hermes` ユーザー）**:

```text
/home/hermes/.hermes/hermes-agent/gateway/platforms/base.py
```

**目的**: tools 実行中セッションで `yes` / `no` が **busy/interrupt** に吸われず、plugin `pre_gateway_dispatch` で `{"action": "skip"}` として承認解決できるようにする。

**承認として先送りする短文本（例）**: `yes` `no` `approve` `deny` `ok` `go` `once` `session` `always` `cancel` 等（実機 hotfix 参照）。

**反映後**: `systemctl restart hermes-gateway` · 古い `~/.hermes/task-bridge/approvals/*` を必要ならクリア。

**再発防止**:

- **Hermes 再 install / アップデート後**に hotfix が消えていないか確認（`grep -n pre_gateway_dispatch` 等）。
- repo デプロイだけでは **本体 hotfix は再適用されない** — 消えた場合は同 patch を再投入するか、Ansible で patch 管理を検討。

正本: [Phase D5 ExecPlan](../plans/private-pi5-hermes-tools-security-phase-d5-execplan.md) · [ADR D5](../decisions/ADR-20260525-private-pi5-hermes-discord-tools-bridge-d5.md)。

## Novel profile — Discord `/novel`（長文創作 · 2026-05-29）

**目的**: 雑談（chat）・作業（`/task`）と分離し、**`/novel <指示>`** で長文創作専用プロファイルへ委譲。DGX は on-demand で `modelProfileId=qwen36_35b_uncensored` を起動（keep-warm なし）。

**fragment 例**（inventory fragment に追記）:

```yaml
private_pi5_hermes_novel_profile_enabled: true
private_pi5_hermes_discord_novel_bridge_enabled: true
# 必須: DGX runtime control（/start 用）
private_pi5_dgx_runtime_control_token: "<from vault>"
```

**デプロイ**: 標準 `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh`（novel レーンはフラグ ON 時のみ active）。

**Discord 利用**:

- **スラッシュ**: `/novel` → **Arguments（プロンプト欄）** に創作指示を入力（空だと usage）。
- **1行テキスト（確実）**: `/novel 坂の上の雲の続きを書いて`
- 空入力は usage（日本語案内）を返す。**別 gateway は不要** — chat gateway の plugin から `~/.hermes-novel` isolated HOME で `hermes chat -q` を実行。

**初回ロード**: uncensored プロファイルの cold start は **数分**かかる場合あり（`DGX_RUNTIME_READY_TIMEOUT_SEC` 既定 900）。

正本: [Novel ExecPlan](../plans/private-pi5-hermes-novel-profile-execplan.md) · [dgx uncensored ボタン Plan](../plans/dgx-uncensored-profile-button.md) · [KB Novel 本番](../knowledge-base/KB-private-pi5-hermes-novel-profile-production.md)。

### Novel profile — 本番反映（2026-05-29）

| # | 対象 | 手順 | 結果 |
|---|------|------|------|
| 1 | 私用 Pi5 `raspi5-private` | `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` | **`PLAY RECAP` ok=138 changed=13 failed=0**（約 **371s**） |

**fragment（非コミット）**: D5 一式に加え `private_pi5_hermes_novel_profile_enabled: true` · `private_pi5_hermes_discord_novel_bridge_enabled: true` · `private_pi5_dgx_runtime_control_token`（既存）。

**追加検証**（`cd infrastructure/ansible` 後）:

```bash
# novel 配置 + plugin register
ansible private-pi5-stackchan-bridge -i inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m shell -a "sudo -u hermes test -f /home/hermes/.hermes-novel/.env && sudo -u hermes grep -q DGX_MODEL_PROFILE_ID=qwen36_35b_uncensored /home/hermes/.hermes-novel/.env && echo novel-env:ok" -b

# D4 非回帰
ansible private-pi5-stackchan-bridge -i inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m shell -a "HERMES_TOOLS_PHASE=d4 /tmp/verify-tools-profile-deploy.sh" -b
```

**CI / Git**: `feat/private-pi5-hermes-novel-profile` · **`8a8b43f6`** · CI **`26634375437`** success。

**記録**: [KB Novel 本番](../knowledge-base/KB-private-pi5-hermes-novel-profile-production.md)。

### Novel profile — `args_hint` 修正デプロイ（2026-05-29 21:56 JST）

| # | 対象 | 手順 | 結果 |
|---|------|------|------|
| 1 | 私用 Pi5 `raspi5-private` | `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` | **`PLAY RECAP` ok=138 changed=5 failed=0**（約 **191s**） |

**変更概要**: `/novel` · `/task` に **`args_hint`** · 日本語 usage · approval-relay verify の novel 条件分岐 · smoke の args_hint 退行検知。

**実機検証**: gateway **active** + **freshness_ok** · plugin `args_hint` **OK** · Discord **`Safely reconciled` updated=1** · D4 **`verify-tools-profile-deploy.sh` OK**。

**Discord E2E**: slash **Arguments 欄**または **1行テキスト**で手動確認（cold start 数分あり）。

**Git / CI**: branch **`feat/private-pi5-hermes-novel-slash-args-hint`** · **`66c1ff79`** · CI **`26637722184`** success。

**記録**: [KB §args_hint 追記](../knowledge-base/KB-private-pi5-hermes-novel-profile-production.md#追記--novel-slash-args_hint-修正2026-05-29-2156-jst)。

## Phase D5.1 — Discord 承認中継（2026-05-25 · 私用 Pi5 本番反映）

**目的**: `/task` 実行時の **manual 承認**を Discord 上で完結（file IPC · yes/no · `/task-approve`/`/task-deny`）。

**デプロイ**: 標準 `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh`（D5 と同一 · `approval_relay/` · store · CLI 追加）。

| # | 対象 | 手順 | 結果 |
|---|------|------|------|
| 1 | 私用 Pi5 `raspi5-private` | `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` | **`PLAY RECAP` ok=107 changed=9 failed=0**（約 **158s**） |
| 2 | 同上（session context API fix） | 同上 · branch `fix/private-pi5-hermes-task-session-context-api` | **`PLAY RECAP` ok=123 changed=6 failed=0**（約 **175s** · 2026-05-25 22:36 JST） |
| 3 | 同上（`write_file` / `patch` 承認ゲート） | 同上 · branch `feat/private-pi5-hermes-tool-write-approval-gate` · PR #342 | **`PLAY RECAP` ok=123 changed=8 failed=0**（約 **421s** · 2026-05-26 09:01 JST） |
| 4 | 同上（gateway actor context · `yes` ルーティング） | 同上 · branch `fix/private-pi5-hermes-discord-approval-actor-context` · PR #343 | **`PLAY RECAP` ok=123 changed=6 failed=0**（約 **405s** · 2026-05-26 11:00 JST） |
| 5 | 同上（poll スレッド · `yes` 後 write 再開） | 同上 · branch `fix/private-pi5-hermes-tool-write-poll-race` | **`PLAY RECAP` ok=123 changed=6 failed=0**（約 **413s** · 2026-05-26 14:01 JST · PID **169596**） |

**Pi5 追加検証**（Runbook 既存パターン）:

```bash
# tools D4 契約（HERMES_TOOLS_PHASE を明示）
ansible private-pi5-stackchan-bridge -i infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m copy -a "src=scripts/private-pi5-hermes/verify-tools-profile-deploy.sh dest=/tmp/verify-tools-profile-deploy.sh mode=0755" -b
ansible private-pi5-stackchan-bridge -i infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m shell -a "HERMES_TOOLS_PHASE=d4 /tmp/verify-tools-profile-deploy.sh" -b
```

**write ツール承認ゲート smoke**（`request.json` が作成されること）:

```bash
ansible private-pi5-stackchan-bridge -i infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m copy -a "src=scripts/private-pi5-hermes/verify-tool-write-approval-gate-pi5.sh dest=/tmp/verify-tool-write-approval-gate-pi5.sh mode=0755" -b
ansible private-pi5-stackchan-bridge -i infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m shell -a "sudo -u hermes /tmp/verify-tool-write-approval-gate-pi5.sh" -b
```

**gateway actor context smoke**（stash → `by-user` 索引）:

```bash
ansible private-pi5-stackchan-bridge -i infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m copy -a "src=scripts/private-pi5-hermes/verify-actor-context-bind-pi5.sh dest=/tmp/verify-actor-context-bind-pi5.sh mode=0755" -b
ansible private-pi5-stackchan-bridge -i inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m shell -a "sudo -u hermes /tmp/verify-actor-context-bind-pi5.sh" -b
```

**poll スレッド smoke**（`tool:*` 承認時 · `response.json` が poll で消えないこと）:

```bash
ansible private-pi5-stackchan-bridge -i infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m copy -a "src=scripts/private-pi5-hermes/verify-poll-thread-tool-write-pi5.sh dest=/tmp/verify-poll-thread-tool-write-pi5.sh mode=0755" -b
ansible private-pi5-stackchan-bridge -i infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml \
  -m shell -a "sudo -u hermes /tmp/verify-poll-thread-tool-write-pi5.sh" -b
```

**Discord 利用（write タスク · Discord UI E2E は手動）**:

1. `/task Create hello-d51.txt in workspace with content test`
2. 承認依頼が届いたら `yes` または `/task-approve`
3. 拒否は `no` または `/task-deny`

**記録**: [ExecPlan D5.1](../plans/private-pi5-hermes-tools-security-phase-d5-1-execplan.md) · [ADR D5.1](../decisions/ADR-20260525-private-pi5-hermes-discord-approval-relay-d5-1.md) · [KB D5 §D5.1](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#phase-d51-追記2026-05-25--repo-実装--私用-pi5-本番反映)


## トラブルシュート（クイック）

| 症状 | 参照 |
|------|------|
| 403 forbidden | [KB 403](../knowledge-base/KB-private-pi5-hermes-dgx-403-bearer-token.md) |
| 無応答（ホーム案内のみ） | `require_mention` → テンプレは false。`/reset` |
| 圧縮ループ / auto-reset | ツール無効テンプレ未反映 → 再デプロイ |
| 遅い | keep-warm timer・`private_pi5_dgx_runtime_control_token` → 本 Runbook §DGX keep-warm・[KB E2E](../knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md) |
| `/sethome` 案内 | 雑談のみなら無視可 |
| Ansible **Recursive loop**（chat token） | playbook `vars` で同名変数を参照している → [本番反映 2026-05-24](#本番反映2026-05-24phase-d0-骨格私用-pi5--dgx-順次) の `set_fact` パターン |
| **config.base.yaml.j2 not found** | include パスが `private-pi5-hermes/...` のまま → 同ディレクトリ `config.base.yaml.j2` |
| Tailscale **duplicate tag:private-server** | `tagOwners` に既存キーがあるのに追記した | `grants` のみ追加 · `tagOwners` は `denkoushi@github` のまま |
| Mac から Pi5 **SSH Permission denied** | ローカル鍵未登録 | `ansible -i inventory-private-pi5-stackchan-bridge-fragment.yml ...` |
| Mac から DGX **curl timeout** | tailnet 経路が Pi5 経由想定 | DGX 上で `127.0.0.1:38081` または Pi5 から curl |
| **verify-tools** path missing | `~/.hermes-tools` 0700 | `sudo -u hermes test -e` · ansible **`-b`** |
| ansible inventory **empty** | `-i inventory-private-pi5-stackchan-bridge.yml` は未使用 | **fragment** `-i inventory-private-pi5-stackchan-bridge-fragment.yml` |
| D2 verify **gateway inactive** | `HERMES_TOOLS_PHASE` 未設定（既定 d1） | **`HERMES_TOOLS_PHASE=d2`**（D3 は **`d3`**） |
| ansible `script` に env を渡せない | ad-hoc `-a` はパスのみ | `copy` + `shell -a 'HERMES_TOOLS_PHASE=d3 /tmp/...'`（[KB D2](../knowledge-base/KB-private-pi5-hermes-phase-d2-production.md)） |
| file が workspace 外を触る | `docker_volumes` 未設定 | 再デプロイ · [`config_contract.py`](../../scripts/private-pi5-hermes/lib/config_contract.py) |
| web が LAN に到達 | blocklist 未反映 | 再デプロイ · `validate_boundary_policy.py --emit-hermes-security` |
| D3 playbook verify 失敗（config は正しい） | Ansible assert の `\n` / blocklist 一括 match | [KB D3](../knowledge-base/KB-private-pi5-hermes-phase-d3-production.md) Investigation · `verify-tools-profile.yml` 更新後に再デプロイ |
| D4 verify: browser が disabled のまま | fragment に **`tools_browser_enabled` 未設定** | `private_pi5_hermes_tools_browser_enabled: true` → 再デプロイ |
| `install-browser-tooling` rc=1（agent-browser 不在） | 非対話 `hermes setup` は **agent-browser を入れない** | playbook が **node_modules → `~/.local/bin` symlink** · [KB D4](../knowledge-base/KB-private-pi5-hermes-phase-d4-production.md) |
| Ansible で symlink 後も `command -v` 失敗 | **`bash -lc`** が PATH を上書き | install タスクは **`bash -c` + 明示 export PATH** |
| `/task` が動かない | D5 フラグ off · plugin 未配置 · **flat deploy で相対 import 失敗** · **restart 後 plugin discover race** | fragment 有効 → 再デプロイ · gateway restart · discover **force** パッチ · [KB D5](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md) Investigation |
| D5 verify: file disabled 不一致 | Ansible **`'    - file\n'`** 厳密 match | [`verify-discord-task-bridge.yml`](../../infrastructure/ansible/tasks/private-pi5-hermes/verify-discord-task-bridge.yml) 更新後に再デプロイ · [KB D5](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md) |
| `/task` がタイムアウト | tools **manual 承認** 待ち · relay 無効 | read-only で再試行 · D5.1 デプロイ確認 · `/task-approve` / yes |
| 承認依頼が来ない | `approval_relay.enabled: false` · store 未配置 · **gateway 未再起動（旧 D5 plugin 常駐）** | policy + restart + [verify-discord-approval-relay.yml](../../infrastructure/ansible/tasks/private-pi5-hermes/verify-discord-approval-relay.yml) |
| `/task` relay が即失敗 | bash ラッパ hermes → 誤 venv python | [`tools_profile_runner.py`](../../scripts/private-pi5-hermes/lib/tools_profile_runner.py) の venv 解決 · [KB D5 §D5.1 Investigation](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#investigationd51-デプロイ実機検証) |
| yes/no が雑談になる | pending task なし | write タスク実行中のみ intercept · [ExecPlan D5.1](../plans/private-pi5-hermes-tools-security-phase-d5-1-execplan.md) |
| write `/task` が承認なしで完了 | D5.1 が **shell 承認のみ** · LLM は `write_file` 使用 | `tool_write_gate.py` デプロイ後再試行 · [KB D5 §write ゲート](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#本番デプロイwrite_file-承認ゲート--2026-05-26-jst) |
| `yes` が雑談になる（承認後） | slash 時 **`by-user/` 未作成**（session env 未設定） | `gateway_actor_context.py` デプロイ後再試行 · `verify-actor-context-bind-pi5.sh` · [KB §actor context](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#本番デプロイgateway-actor-context--yes-ルーティング--2026-05-26-jst) |
| Discord `/novel` が usage のみ | plugin に **`args_hint` 未指定** → Discord slash が引数なし登録 · または **Arguments 欄が空** | `args_hint` 追加後再デプロイ · **Arguments 欄にプロンプト** · 回避: **`/novel プロット…`** 1行テキスト |
| `/novel` 初回が長時間無応答 | **35B uncensored cold start**（数分） | `DGX_RUNTIME_READY_TIMEOUT_SEC` 900 · DGX 側 profile 登録確認 · [dgx uncensored Plan](../plans/dgx-uncensored-profile-button.md) |
| `/task` が **2048 context** で 400 · `request.json` なし | **`/novel` 後に green 35B が active のまま** | 上記 **DGX 通常 profile 復帰** · `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` 再デプロイ |
| smoke: `unexpected commands: set()` | repo `lib/` に plugin marker 無し | temp plugin_dir patch（[`verify-discord-task-bridge-smoke.sh`](../../scripts/private-pi5-hermes/verify-discord-task-bridge-smoke.sh) 2026-05-29 修正） |
| 承認通知 **`403` / `error code: 1010`** | `discord_relay.py` が **`urllib` 既定 UA** で Cloudflare 拒否 | repo の **`DiscordBot` User-Agent** をデプロイ · gateway restart · [KB D5 §2026-06-05](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#本番復旧--discord-task-二段障害2026-06-05) |
| `/task` 無応答 · DGX **`/v1/models` 502** | blue **27B vLLM 未起動**（HF metadata / GPU mem / vision ロード） | DGX `control-server.env` · snapshot path · **`0.65`** · **`language_model_only`** · [dgx Runbook §blue 502](./dgx-system-prod-local-llm.md#トラブルシュート--blue-backend-起動失敗--v1models-5022026-06-05) |
| `/v1/models` が起動中 **`Connection reset by peer`** | vLLM 初回 compile/autotune 中 | **container 生存なら数分待つ** — [KB D5 §2026-06-05](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#本番復旧--discord-task-二段障害2026-06-05) |
| `yes` 後に **`Interrupting current task`** | Hermes 本体が **busy/interrupt を plugin hook より先**に処理 | Pi5 **`gateway/platforms/base.py` hotfix** + plugin channel キー · [KB §yes 最終修正](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#本番復旧--承認-yes-が割り込みに吸われる2026-06-05-夜--discord-write-e2e-完結) |
| 承認プロンプトは来るが `yes` 無効（interrupt なし） | `user_id` bind 失敗 | repo **`channel:<channel_id>`** フォールバックをデプロイ · `approval_actor_ids` テスト |
| `/task` が **`task rejected: … deferred task pattern`** | Codex/Cursor/git/deploy/terminal 等のプロンプト | **意図的** — [KB §安全枠](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#task-安全枠の明文化2026-06-05--repo) · D6+ worker 設計後に段階解放 |
| `/daily` が登録されない | policy 未配備 · Discord command sync 未実行 · token 未設定 | fragment ON + `private_pi5_hermes_discord_bot_token` 設定 → deploy · `hermes-gateway` restart · Discord API で slash 確認 · [KB daily pilot](../knowledge-base/KB-private-pi5-hermes-daily-pilot.md) |
| `/daily git push…` が通る | 古い policy（regex 修正前） | 最新 `daily-pilot.policy.yaml` 再配備 · `test_repo_policy_allows_safe_cursor_draft…` |
| 安全な Cursor 文案が拒否 | 広い日本語 regex（修正前） | 同上 · [KB §policy regex](../knowledge-base/KB-private-pi5-hermes-daily-pilot.md#investigation--policy-regex-修正2026-06-06) |
| `/memo` 等が登録されない | `life-pilot.policy.yaml` 未配備 · Discord command sync 未実行 · token 未設定 | fragment ON + `private_pi5_hermes_discord_bot_token` 設定 → deploy · `hermes-gateway` restart · [KB Life Pilot](../knowledge-base/KB-private-pi5-hermes-life-pilot.md) |
| `/remind` で通知が来ない | 日時を読めない · `notifyChannelId` がない · `hermes-life-reminder.timer` inactive | 日時つき slash で登録し `notification=scheduled` を確認 · `systemctl is-active hermes-life-reminder.timer` · [ExecPlan D6-life](../plans/private-pi5-hermes-life-pilot-execplan.md) |

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
- [KB Phase D1 本番](../knowledge-base/KB-private-pi5-hermes-phase-d1-production.md)
- [Phase D2 ExecPlan](../plans/private-pi5-hermes-tools-security-phase-d2-execplan.md)
- [KB Phase D2 本番](../knowledge-base/KB-private-pi5-hermes-phase-d2-production.md)
- [Phase D3 ExecPlan](../plans/private-pi5-hermes-tools-security-phase-d3-execplan.md)
- [Phase D4 ExecPlan](../plans/private-pi5-hermes-tools-security-phase-d4-execplan.md)
