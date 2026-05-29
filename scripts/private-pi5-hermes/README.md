# Private Pi5 — Hermes Agent（セキュリティ先行）

自宅 **私用 Pi5** 上で [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) を **専用ユーザー + Docker 隔離 + UFW** で運用し、**Discord DM（本人のみ）** から DGX で雑談する。

## ドキュメント正本

| 種別 | パス |
|------|------|
| 計画・進捗 | [private-pi5-hermes-agent-plan.md](../../docs/plans/private-pi5-hermes-agent-plan.md) |
| AI執事ビジョン（北極星・D4以降） | [private-pi5-hermes-butler-vision-and-roadmap.md](../../docs/plans/private-pi5-hermes-butler-vision-and-roadmap.md) |
| Runbook | [private-pi5-hermes-deploy.md](../../docs/runbooks/private-pi5-hermes-deploy.md) |
| KB（install 障害） | [KB-private-pi5-hermes-install-noninteractive.md](../../docs/knowledge-base/KB-private-pi5-hermes-install-noninteractive.md) |
| KB（403 / Bearer） | [KB-private-pi5-hermes-dgx-403-bearer-token.md](../../docs/knowledge-base/KB-private-pi5-hermes-dgx-403-bearer-token.md) |
| KB（Discord E2E・遅延） | [KB-private-pi5-hermes-discord-e2e-and-latency.md](../../docs/knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md) |
| KB（スキル・フォーラム・設計） | [KB-private-pi5-hermes-skills-community-architecture.md](../../docs/knowledge-base/KB-private-pi5-hermes-skills-community-architecture.md) |
| ADR（セキュリティ） | [ADR-20260524](../../docs/decisions/ADR-20260524-private-pi5-hermes-security-profile.md) |
| Phase D0（ツール安全） | [ExecPlan](../../docs/plans/private-pi5-hermes-tools-security-phase-d0-execplan.md) · [ADR-20260525](../../docs/decisions/ADR-20260525-private-pi5-hermes-tools-security-phase-d0.md) |
| Phase D1（tools 骨格） | [ExecPlan D1](../../docs/plans/private-pi5-hermes-tools-security-phase-d1-execplan.md) · `verify-tools-profile-deploy.sh` |
| Phase D2（file のみ） | [ExecPlan D2](../../docs/plans/private-pi5-hermes-tools-security-phase-d2-execplan.md) · `HERMES_TOOLS_PHASE=d2` · `verify-tools-file-smoke.sh` |
| Phase D3（file+web） | [ExecPlan D3](../../docs/plans/private-pi5-hermes-tools-security-phase-d3-execplan.md) · `HERMES_TOOLS_PHASE=d3` · `verify-tools-web-smoke.sh` |
| Phase D4（file+web+browser） | [ExecPlan D4](../../docs/plans/private-pi5-hermes-tools-security-phase-d4-execplan.md) · `HERMES_TOOLS_PHASE=d4` · `verify-tools-browser-smoke.sh` |
| Phase D5（Discord `/task` 橋） | [ExecPlan D5](../../docs/plans/private-pi5-hermes-tools-security-phase-d5-execplan.md) · `verify-discord-task-bridge-smoke.sh` · `plugin.yaml` · `hermes-discord-task-bridge` |
| Novel profile（`/novel` 創作） | [ExecPlan](../../docs/plans/private-pi5-hermes-novel-profile-execplan.md) · [KB 本番](../../docs/knowledge-base/KB-private-pi5-hermes-novel-profile-production.md) · `lib/novel_profile_runner.py` · DGX `qwen36_35b_uncensored` on-demand |
| 境界ポリシー | [`lib/boundary_policy.py`](lib/boundary_policy.py) · [`config_contract.py`](lib/config_contract.py) · [`hermes_security_adapter.py`](lib/hermes_security_adapter.py) · [`config/boundary-policy.tools.yaml`](config/boundary-policy.tools.yaml) |

## 前提

- **Docker 導入済み**（`hermes` が `docker` グループ）
- ローカル inventory: `infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml`（**非追跡**）
- DGX token: `private_pi5_dgx_llm_shared_token`（StackChan）。chat は `private_pi5_hermes_chat_dgx_llm_token`。tools（D1+）は `private_pi5_hermes_tools_dgx_llm_token`（**chat と別必須**・DGX `LLM_SHARED_ADDITIONAL_TOKENS`）
- Discord（任意）: `private_pi5_hermes_discord_bot_token` / `private_pi5_hermes_discord_allowed_users` / `private_pi5_hermes_gateway_enabled: true`
- Novel（任意）: `private_pi5_hermes_novel_profile_enabled: true` · `private_pi5_hermes_discord_novel_bridge_enabled: true`（要 `private_pi5_dgx_runtime_control_token`）

## セキュリティ + 雑談プロファイル（2026-05-24）

| 項目 | 設定 |
|------|------|
| 実行ユーザー | `hermes` |
| ツール実行 | Docker（**雑談時はツール無効** — config テンプレ） |
| 承認 | `manual` |
| LLM | `custom:dgx-system-prod` → DGX Bearer |
| Discord | 許可 User のみ・テンプレ **`require_mention: false`** |
| 体感レイテンシ | **8.7〜10.7 s/通**（max_tokens 128 + inject + keep-warm） |
| 主因 | **DGX 推論**（out 比例）。経路 ~2〜3 s |
| スキル・記憶 | **`skills` / `memory` 無効** — 会話から自動では賢くならない（[KB](../../docs/knowledge-base/KB-private-pi5-hermes-skills-community-architecture.md)） |

## デプロイ

```bash
./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh
```

初回 install は **10〜30 分**（async 3600s）。非対話の要点は [KB install](../../docs/knowledge-base/KB-private-pi5-hermes-install-noninteractive.md)。

Discord 有効化後は fragment を更新して再実行。初回のみ Pi5 venv へ `discord-py` が必要な場合あり（[Runbook](../../docs/runbooks/private-pi5-hermes-deploy.md)）。

## DGX keep-warm

fragment に `private_pi5_dgx_runtime_control_token` を設定してデプロイすると、`hermes-dgx-keep-warm.timer` が **10 分毎**（起動 **3 分**後も）DGX を warm します。既定では **`DGX_MODEL_PROFILE_ID=business_qwen36_27b_nvfp4`** を維持（`/novel` 後のドリフト矯正）。`/task` も実行前に同 profile へ復帰します。詳細は [Runbook §keep-warm](../../docs/runbooks/private-pi5-hermes-deploy.md#dgx-keep-warm体感速度)。

## 手動確認

```bash
ssh raspi5-private@<tailscale-ip>
systemctl is-active hermes-dgx-keep-warm.timer
systemctl is-active hermes-gateway
sudo -u hermes /home/hermes/.local/bin/hermes doctor
sudo -u hermes bash -lc 'set -a; source ~/.hermes/.env; set +a; \
  curl -sf -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  http://100.118.82.72:38081/v1/models'
```

Novel profile 有効時（fragment フラグ ON 後）:

```bash
sudo -u hermes test -f ~/.hermes-novel/.env
sudo -u hermes grep DGX_MODEL_PROFILE_ID ~/.hermes-novel/.env
sudo -u hermes grep max_tokens ~/.hermes/.hermes/config.yaml ~/.hermes-novel/home/.hermes/config.yaml
# Discord: /novel <creative prompt>（初回 35B cold start は数分）
```

## 関連

- [private-pi5-stackchan-bridge](../private-pi5-stackchan-bridge/README.md)（別系統・併用可）
- [dgx-system-prod-local-llm.md](../../docs/runbooks/dgx-system-prod-local-llm.md)
