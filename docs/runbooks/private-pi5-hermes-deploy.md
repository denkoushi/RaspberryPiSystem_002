# 私用 Pi5 Hermes Agent 標準デプロイ

最終更新: 2026-05-24（Phase D0 実機完了・トークン分離・Tailscale grants 適用済）

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
```

**デプロイ**: 標準 `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh`（`deploy-discord-task-bridge.yml` が **`~/.hermes/plugins/private-pi5-discord-task-bridge/`** に plugin + policy を配置 · chat テンプレに `plugins.enabled`）。

**検証（repo / Pi5）**:

```bash
./scripts/private-pi5-hermes/verify-discord-task-bridge-smoke.sh
# Pi5（lib + config を REPO_ROOT 下に配置してから）
REPO_ROOT=/tmp/smoke-repo /tmp/verify-discord-task-bridge-smoke.sh
```

**Discord 利用**: `/task List files in workspace`（read-only 推奨）。**`/task` は gateway plugin コマンド**（`hermes task` トップレベル CLI ではない）。承認待ちは [ExecPlan D5](../plans/private-pi5-hermes-tools-security-phase-d5-execplan.md) 参照。

**記録**: [KB Phase D5 本番](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md)。

正本: [Phase D5 ExecPlan](../plans/private-pi5-hermes-tools-security-phase-d5-execplan.md) · [ADR D5](../decisions/ADR-20260525-private-pi5-hermes-discord-tools-bridge-d5.md)。

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
| ansible `script` に env を渡せない | ad-hoc `-a` はパスのみ | `copy` + `shell -a 'HERMES_TOOLS_PHASE=d3 /tmp/...'`（[KB D2](./knowledge-base/KB-private-pi5-hermes-phase-d2-production.md)） |
| file が workspace 外を触る | `docker_volumes` 未設定 | 再デプロイ · [`config_contract.py`](../../scripts/private-pi5-hermes/lib/config_contract.py) |
| web が LAN に到達 | blocklist 未反映 | 再デプロイ · `validate_boundary_policy.py --emit-hermes-security` |
| D3 playbook verify 失敗（config は正しい） | Ansible assert の `\n` / blocklist 一括 match | [KB D3](./knowledge-base/KB-private-pi5-hermes-phase-d3-production.md) Investigation · `verify-tools-profile.yml` 更新後に再デプロイ |
| D4 verify: browser が disabled のまま | fragment に **`tools_browser_enabled` 未設定** | `private_pi5_hermes_tools_browser_enabled: true` → 再デプロイ |
| `install-browser-tooling` rc=1（agent-browser 不在） | 非対話 `hermes setup` は **agent-browser を入れない** | playbook が **node_modules → `~/.local/bin` symlink** · [KB D4](./knowledge-base/KB-private-pi5-hermes-phase-d4-production.md) |
| Ansible で symlink 後も `command -v` 失敗 | **`bash -lc`** が PATH を上書き | install タスクは **`bash -c` + 明示 export PATH** |
| `/task` が動かない | D5 フラグ off · plugin 未配置 · **flat deploy で相対 import 失敗** | fragment 有効 → 再デプロイ · gateway restart · [KB D5](./knowledge-base/KB-private-pi5-hermes-phase-d5-production.md) Investigation |
| D5 verify: file disabled 不一致 | Ansible **`'    - file\n'`** 厳密 match | [`verify-discord-task-bridge.yml`](../../infrastructure/ansible/tasks/private-pi5-hermes/verify-discord-task-bridge.yml) 更新後に再デプロイ · [KB D5](./knowledge-base/KB-private-pi5-hermes-phase-d5-production.md) |
| `/task` がタイムアウト | tools **manual 承認** 待ち | read-only タスクで再試行 · D5.1 承認中継は未実装 |

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
