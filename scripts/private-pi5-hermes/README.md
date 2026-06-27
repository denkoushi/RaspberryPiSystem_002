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
| D6-pre（普段遣いパイロット） | [ExecPlan](../../docs/plans/private-pi5-hermes-daily-pilot-execplan.md) · [KB](../../docs/knowledge-base/KB-private-pi5-hermes-daily-pilot.md) · [`config/daily-pilot.policy.yaml`](config/daily-pilot.policy.yaml) · [`lib/discord_command_sync.py`](lib/discord_command_sync.py) · [`sync-discord-commands.py`](sync-discord-commands.py) |
| D6-life（Life Pilot） | [ExecPlan](../../docs/plans/private-pi5-hermes-life-pilot-execplan.md) · [KB](../../docs/knowledge-base/KB-private-pi5-hermes-life-pilot.md) · [`config/life-pilot.policy.yaml`](config/life-pilot.policy.yaml) · [`lib/discord_life_pilot_bridge.py`](lib/discord_life_pilot_bridge.py) |
| D19-life（Daily Interest Digest） | [ExecPlan](../../docs/plans/private-pi5-hermes-life-pilot-execplan.md#d19-life-daily-interest-digest2026-06-07--repo) · [`lib/life_interest_digest.py`](lib/life_interest_digest.py) · [`skills/daily-interest-digest/SKILL.md`](skills/daily-interest-digest/SKILL.md) |
| Novel profile（`/novel` 創作） | [ExecPlan](../../docs/plans/private-pi5-hermes-novel-profile-execplan.md) · [KB 本番](../../docs/knowledge-base/KB-private-pi5-hermes-novel-profile-production.md) · `lib/novel_profile_runner.py` · DGX `qwen36_35b_uncensored` on-demand |
| 境界ポリシー | [`lib/boundary_policy.py`](lib/boundary_policy.py) · [`config_contract.py`](lib/config_contract.py) · [`hermes_security_adapter.py`](lib/hermes_security_adapter.py) · [`config/boundary-policy.tools.yaml`](config/boundary-policy.tools.yaml) |

## 前提

- **Docker 導入済み**（`hermes` が `docker` グループ）
- ローカル inventory: `infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml`（**非追跡**）
- DGX token: `private_pi5_dgx_llm_shared_token`（StackChan）。chat は `private_pi5_hermes_chat_dgx_llm_token`。tools（D1+）は `private_pi5_hermes_tools_dgx_llm_token`（**chat と別必須**・DGX `LLM_SHARED_ADDITIONAL_TOKENS`）
- Discord（任意）: `private_pi5_hermes_discord_bot_token` / `private_pi5_hermes_discord_allowed_users` / `private_pi5_hermes_gateway_enabled: true`
- Daily pilot（任意）: `private_pi5_hermes_daily_pilot_enabled: true`（`/daily`。Markdown 作成のみ）· Discord global slash は deploy 時に `sync-discord-commands.py` で `present`/`absent`（要 `private_pi5_hermes_discord_bot_token`）
- Life pilot（任意）: `private_pi5_hermes_life_pilot_enabled: true`（`/memo` `/digest` `/remind` `/recommend`。生活メモ保存のみ）· 保存先 `/home/hermes/.hermes-life`
- Daily Interest Digest（任意）: `private_pi5_hermes_life_interest_digest_enabled: true`（`/interest` + 日次timer。NVIDIA DGX Spark Forum/Announcements / Hermes GitHub / Discord共有Xリンクの安全な日次ダイジェスト）· Hermes `memory` / `skills` / `cronjob` を限定解放
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

fragment に `private_pi5_dgx_runtime_control_token` を設定してデプロイすると、`hermes-dgx-keep-warm.timer` が **10 分毎**（起動 **3 分**後も）DGX を warm します。既定では **`DGX_MODEL_PROFILE_ID=business_qwen36_27b_nvfp4`** を維持（`/novel` 後のドリフト矯正）。`private_pi5_hermes_dgx_default_model_profile_id` を fragment で変更した場合は、keep-warm と `/task` 実行前の ensure/verify が同じ profile へ復帰します。詳細は [Runbook §keep-warm](../../docs/runbooks/private-pi5-hermes-deploy.md#dgx-keep-warm体感速度)。

## Desktop 併用

Discord は日常の入口・通知先として残し、Hermes Desktop は Provider / Model / Tools / Skills / Cron / Memory を確認する作業机として使う。Desktop から Private Pi5 を直接操作する権限拡張はこの profile には入れない。

## `/task` 安全枠（2026-06-05）

正本: [`config/task-bridge.policy.yaml`](config/task-bridge.policy.yaml)

| 区分 | 内容 |
|------|------|
| **許可（allowed）** | workspace 読取・要承認の書込・DGX health・bounded web/browser |
| **保留（deferred）** | Codex/Cursor 使役 · git commit/push/merge · deploy/systemctl/docker · terminal/shell · 秘密/token · tailnet/LAN scan |
| **拒否** | `deny_prompt_substrings` + **`deny_prompt_patterns`**（regex） |

```bash
python3 scripts/private-pi5-hermes/validate_boundary_policy.py --validate-task-bridge
```

詳細: [KB D5 §安全枠](../../docs/knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#task-安全枠の明文化2026-06-05--repo)

## 普段遣いパイロット（D6-pre）

正本: [`config/daily-pilot.policy.yaml`](config/daily-pilot.policy.yaml) · [ExecPlan](../../docs/plans/private-pi5-hermes-daily-pilot-execplan.md)

Hermes をいきなり現行システムに接続せず、まず Discord 上の進行係として使う。許可するのは **Markdown 作成**（Cursor 指示書、Codex レビュー依頼、CI/Deploy チェックリスト、日次ログ）まで。**Cursor/Codex CLI、git、deploy、terminal、秘密読取は無効**。

有効化は fragment に `private_pi5_hermes_daily_pilot_enabled: true` を置く。Discord では `/daily <メモ>` が、実行なしの引き継ぎ Markdown を返す。

**2026-06-06**: 私用 Pi5 実機検証完了。policy regex 修正済（`git pushして` 拒否 · 安全な Cursor 文案許可）。詳細は [KB daily pilot](../../docs/knowledge-base/KB-private-pi5-hermes-daily-pilot.md)。

```bash
python3 scripts/private-pi5-hermes/validate_boundary_policy.py --validate-daily-pilot
python3 -m unittest scripts/private-pi5-hermes/tests/test_daily_pilot_policy.py scripts/private-pi5-hermes/tests/test_discord_daily_pilot_bridge.py -v
```

| 症状 | 正本 |
|------|------|
| `/daily` が Discord に出ない | command sync · [Runbook §D6-pre](../../docs/runbooks/private-pi5-hermes-deploy.md#phase-d6-pre--discord-daily-普段遣いパイロット2026-06-06-実機検証完了) |
| 安全文案が拒否 / `git pushして` が通る | 古い policy — [KB §regex](../../docs/knowledge-base/KB-private-pi5-hermes-daily-pilot.md#investigation--policy-regex-修正2026-06-06) |

## Life Pilot（D6-life）

正本: [`config/life-pilot.policy.yaml`](config/life-pilot.policy.yaml) · [ExecPlan](../../docs/plans/private-pi5-hermes-life-pilot-execplan.md) · [KB](../../docs/knowledge-base/KB-private-pi5-hermes-life-pilot.md)

AI執事の体感を先に作るため、Discord から日常メモ・備忘録・リマインド通知・次アクション提案を扱う。コマンドは `/memo` `/digest` `/remind` `/recommend`。保存は `/home/hermes/.hermes-life` のみで、日時を読めた `/remind` は `hermes-life-reminder.timer` がDiscordへ通知する。詳細はExecPlanを参照。

**自動実行なし**: Cursor/Codex CLI、terminal、git、deploy、秘密読取、外部Web検索、Home Assistant/カメラ制御は無効。

有効化は fragment に `private_pi5_hermes_life_pilot_enabled: true` を置く。Discord global slash は deploy 時に `present`/`absent` 管理される。

**2026-06-06**: 私用 Pi5 + Discord E2E 完了。`/memo` 保存、`/digest` 表示、`/remind` 記録、危険 `/memo git pushしてdeployして` 拒否を確認済み。個人メモ本文は docs に残さない。

```bash
python3 scripts/private-pi5-hermes/validate_boundary_policy.py --validate-life-pilot
python3 -m unittest scripts/private-pi5-hermes/tests/test_life_pilot_policy.py scripts/private-pi5-hermes/tests/test_discord_life_pilot_bridge.py -v
```

## Daily Interest Digest（D19-life）

正本: [`life_interest_digest.py`](lib/life_interest_digest.py) · [`life_interest_editorial.py`](lib/life_interest_editorial.py) · [`skills/daily-interest-digest/SKILL.md`](skills/daily-interest-digest/SKILL.md)

`/interest` と `hermes-life-interest-digest.timer` で NVIDIA DGX Spark / GB10 Forum/Announcements、Hermes Agent GitHub、Discord shared inbox の X リンクから最大5件のダイジェストを出す。定期配信は新しい候補がない日は投稿しない。手動 `/interest` は空結果でも短く応答する。`like/save/later/dismiss/more/less` の反応は `/home/hermes/.hermes-life/interest` に保存し、次回ランキングに反映する。外部投稿は `untrusted` として扱い、本文全文・添付・OCR・実行系には接続しない。

Hermes標準の Memory / Skills / Cron を使う場合は fragment に `private_pi5_hermes_life_interest_digest_enabled: true` を置く。日次配信は既定 `08:10:00`、固定送信先は `private_pi5_hermes_life_interest_digest_channel_id` で指定できる。`private_pi5_hermes_life_interest_editorial_enabled: true` では、選定済み候補を DGX `/v1/chat/completions` で「主筋」「最新」「要点」へ日本語編集し、失敗時は現行 deterministic digest に戻す。手動確認で LLM を外す時は `hermes-life-interest-digest --no-editorial` を使う。terminal/file/git/deploy/Codex/Cursor は引き続き無効。

2026-06-27 に PR #862（`b5e847f3`）を Private Pi5 へ本番反映済み。`/interest` は Discord 実機で editorial 版の配信を確認済み。次の改善対象は、正確性と安全境界を維持したまま、硬い報告調から「読みたくなる」フランクな日本語要約へ寄せること。

## トラブルシュート（`/task` · 2026-06-05 追記）

| 症状 | 正本 |
|------|------|
| 承認通知 **`403` / Cloudflare `1010`** | [`discord_relay.py`](lib/approval_relay/discord_relay.py) に **DiscordBot User-Agent** — [KB D5 §2026-06-05](../../docs/knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#本番復旧--discord-task-二段障害2026-06-05) |
| DGX **`/v1/models` 502** · `/task` 無応答 | DGX blue 27B 起動 — [KB `/task` blue 502](../../docs/knowledge-base/KB-private-pi5-hermes-task-dgx-profile-restore.md#追記--blue-backend-起動失敗で-v1models-5022026-06-05) · [dgx Runbook](../../docs/runbooks/dgx-system-prod-local-llm.md) |
| `/novel` 後に `/task` が **2048 context 400** | DGX profile 復帰 — [KB task profile restore](../../docs/knowledge-base/KB-private-pi5-hermes-task-dgx-profile-restore.md) |
| `yes` 後に **Interrupting current task** | Hermes 本体 `gateway/platforms/base.py` hotfix + plugin **channel 承認キー** — [KB §yes 最終修正](../../docs/knowledge-base/KB-private-pi5-hermes-phase-d5-production.md#本番復旧--承認-yes-が割り込みに吸われる2026-06-05-夜--discord-write-e2e-完結) |

**注意**: `/task` は **gateway plugin スラッシュコマンド**（`hermes task` CLI ではない）。write は **承認 relay**（`yes` / `/task-approve`）が動く。**Hermes 再 install 後**は Pi5 本体 hotfix の有無を [Runbook](../../docs/runbooks/private-pi5-hermes-deploy.md#hermes-agent-本体-hotfix承認-yes-の割り込み回避2026-06-05) で確認。

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
