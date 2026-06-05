# KB-private-pi5-hermes-daily-pilot: Discord `/daily` 普段遣いパイロット（D6-pre）

- **Status**: reference（2026-06-05 · repo 実装完了 · **Pi5 デプロイ未**）
- **Related**: [ExecPlan D6-pre](../plans/private-pi5-hermes-daily-pilot-execplan.md) · [Runbook §/daily](../runbooks/private-pi5-hermes-deploy.md#phase-d6-pre--discord-daily-普段遣いパイロット2026-06-05) · [`daily-pilot.policy.yaml`](../../scripts/private-pi5-hermes/config/daily-pilot.policy.yaml) · [KB `/task` 安全枠](./KB-private-pi5-hermes-phase-d5-production.md#task-安全枠の明文化2026-06-05--repo) · [butler vision](../plans/private-pi5-hermes-butler-vision-and-roadmap.md)

## Context

**目的（Handoff 2026-06-05）**: hermesAgent をいきなり本番開発システムへ接続せず、まず Discord 上の **「普段遣いの進行係」** として試す。

**到達点（D6-pre）**: Hermes は **`/daily`** で Cursor に渡す作業指示、Codex に渡すレビュー依頼、CI/Deploy 前チェックリストを **Markdown で作るだけ**。Cursor/Codex CLI、terminal、git、deploy、秘密情報読み取りは **まだ実行しない**。

**対象**: 私用 Pi5（`private-pi5-stackchan-bridge`）· **repo 正本のみ**（実機反映は次回デプロイ）

## 確定仕様（repo）

| 領域 | 仕様 |
|------|------|
| **入口** | Discord slash **`/daily <メモ>`**（chat profile · plugin 経由） |
| **登録条件** | plugin 配置先に **`daily-pilot.policy.yaml` が存在**（Ansible: `private_pi5_hermes_daily_pilot_enabled: true`） |
| **出力** | **deterministic Markdown**（`# Daily Pilot Draft` テンプレ）· **LLM/worker 未呼び出し** |
| **chat system_prompt** | daily 有効時のみ `/daily` 案内を追記（`/task` `/novel` と独立フラグ） |
| **plugin 共存** | 同一 plugin `private-pi5-discord-task-bridge` · `/task` `/novel` は従来フラグで登録 |
| **Ansible** | `deploy-discord-task-bridge.yml` が policy + Python モジュール配備 · `verify-discord-daily-pilot.yml` |

### policy 契約（`daily-pilot.policy.yaml`）

| フィールド | 意味 |
|-----------|------|
| `phase` | `daily_pilot_v0` |
| `output_mode` | `markdown_only` |
| `cursor_codex_auto_run` 等 | **すべて `false`**（hard gate） |
| `allowed_task_classes` | 許可ラベル（検証・Handoff 用） |
| `deferred_task_classes` | D6+ まで保留ラベル |
| `deny_prompt_substrings` / `deny_prompt_patterns` | `/task` と同型の regex deny |

**`allowed_task_classes`**: `summarize_user_notes` · `draft_cursor_instruction` · `draft_codex_review_prompt` · `draft_ci_checklist` · `draft_deploy_checklist` · `draft_daily_log`

**`deferred_task_classes`**: `run_cursor_or_codex_cli` · `edit_production_repo` · `git_commit_push_merge` · `deploy_or_restart_services` · `secret_or_token_access` · `terminal_shell_execution` · `tailnet_or_lan_scan`

### 主要モジュール

| パス | 責務 |
|------|------|
| [`daily_pilot_policy.py`](../../scripts/private-pi5-hermes/lib/daily_pilot_policy.py) | policy 読込・prompt 検証 |
| [`discord_daily_pilot_bridge.py`](../../scripts/private-pi5-hermes/lib/discord_daily_pilot_bridge.py) | Markdown 生成 · `run_daily_pilot_bridge_async` |
| [`discord_task_bridge_plugin.py`](../../scripts/private-pi5-hermes/lib/discord_task_bridge_plugin.py) | `_daily_pilot_enabled()` · `/daily` 登録 |

**登録判定**: `_plugin_dir() / "daily-pilot.policy.yaml".is_file()` — marker ファイル方式（novel の `novel-bridge.enabled` と同型）

## 許可 / 禁止（運用メモ）

### 今すぐ許可（`/daily`）

- workspace 外の **repo 編集なし** · メモ整理
- **Cursor 指示書** Markdown
- **Codex レビュー依頼** Prompt 草案
- **CI / Deploy 前チェックリスト** 草案
- **日次ログ** 整理

### 明示的に禁止（policy + regex）

- Cursor/Codex **CLI 自動実行**
- **git** commit/push/merge/reset/checkout/rebase
- **deploy** / systemctl / docker / sudo / ssh
- **terminal** / shell / bash / zsh
- **`.env` / token / secret** 読取・Discord 貼付
- **tailnet / LAN scan**

**拒否例**: `/daily git pushしてdeployして` → `daily rejected: prompt matches deferred task pattern: …`

## Investigation（設計判断）

| 判断 | 理由 |
|------|------|
| **deterministic Markdown**（LLM なし） | 初回パイロットは **実行経路ゼロ** を優先。Spark LocalAI 整形は次段階 |
| **`/task` と別コマンド** | tools 実行（file/web/browser）と **文案作成** を分離 |
| **policy ファイル存在 = 有効** | Ansible が fragment OFF 時に policy を **削除**し、plugin 登録を止める |
| **chat prompt をフラグ合成** | `/task` only / `/novel` only / daily only の組合せを Jinja で個別案内 |

## 検証結果（2026-06-05 · ローカル）

| コマンド | 結果 |
|----------|------|
| targeted unittest（daily + plugin register + policy） | **16 OK** |
| `python3 -m unittest discover -s scripts/private-pi5-hermes/tests -v` | **142 OK** |
| `validate_boundary_policy.py … --validate-daily-pilot` | **OK** |
| `verify-discord-task-bridge-smoke.sh` | **OK** |
| `ansible-playbook … private-pi5-hermes.yml --syntax-check` | **OK** |

**Ansible verify（デプロイ時）**: `verify-discord-daily-pilot.yml` — policy 存在 · `/daily` 登録 · 許可プロンプトに `# Daily Pilot Draft` · 危険プロンプト拒否

## 実機デプロイ手順（未実施）

1. fragment（非コミット）に `private_pi5_hermes_daily_pilot_enabled: true` を追加（要 `private_pi5_hermes_gateway_enabled: true`）
2. `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh`
3. Discord: `/daily 今日の作業メモをCursor指示書にして` → Markdown 応答
4. `/daily git pushしてdeployして` → **拒否**を確認
5. 問題なければ次段階: Spark LocalAI による要約・整形ルートを検討

## Prevention

- **Codex/Cursor 使役**は `/daily` でも regex deny — 解放は **D6+ worker profile**（1 worktree = 1 branch）後
- fragment OFF 時は stale `daily-pilot.policy.yaml` を Ansible が **削除**（誤登録防止）
- 秘密情報を Discord に貼らない（policy に `.env` / `token` / `secret` deny）
- `/task` `/novel` 回帰: plugin register smoke · `verify-discord-task-bridge-smoke.sh`

## まだやらないこと（Handoff）

- Hermes から Mac GUI の Cursor/Codex を操作
- Hermes から Cursor/Codex CLI を自動起動
- 本番 repo への書き込み権限を Hermes に付与
- git push / deploy の Hermes 実行

## 次の段階（D6+）

- `/task-code` 等の **専用入口**
- **1 task = 1 worktree = 1 branch**
- Cursor/Codex CLI は **read-only review** から
- write / commit / push / deploy は **個別承認**
- Cursor は **handoff markdown 受け取り + repo 管理** を継続

## References

- [ExecPlan D6-pre](../plans/private-pi5-hermes-daily-pilot-execplan.md)
- [agent-plan Decision Log](../plans/private-pi5-hermes-agent-plan.md)
- [`validate_boundary_policy.py`](../../scripts/private-pi5-hermes/validate_boundary_policy.py)
