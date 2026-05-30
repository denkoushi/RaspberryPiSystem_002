---
title: KB-private-pi5-hermes-task-dgx-profile-restore
tags: [Hermes Agent, private Pi5, DGX, /task, /novel, model profile]
audience: [開発者, 運用者]
last-verified: 2026-05-30
category: knowledge-base
---

# KB: 私用 Pi5 Hermes `/task` — DGX 通常 profile 復帰

## Context

`/novel` 実行後に `/task`（tools + 承認リレー）が **LLM 400**（`n_ctx: 2048`、prompt ~2089 tokens）で失敗し、`request.json` が生成されない事象。

## Symptoms

- Hermes tools config は `context_length: 65536` だが DGX エラーは **`n_ctx: 2048`**
- `pre_tool_call` hook は登録済み（fail-closed は維持）
- 手動 runner: `request_json:missing` · `target:not_created_without_approval`

## Root cause（CONFIRMED）

- DGX **単一 active ランタイム** + 共有 alias **`system-prod-primary`**
- `/novel` が **`qwen36_35b_uncensored`（green / llama-server `--ctx-size 2048`）** を `POST /start` で起動
- `/task` は **DGX profile を切り替えず** Hermes tools のみ実行していた
- keep-warm は **ready なら `/start` スキップ**のため novel 残留を矯正しない

## Fix（repo）

| 経路 | 動作 |
|------|------|
| **`/task`** | `tools_profile_runner.ensure_tools_dgx_runtime_ready()` → `POST /start` with **`business_qwen36_27b_nvfp4`** |
| **keep-warm** | `DGX_MODEL_PROFILE_ID` 設定時は `DgxUpstreamClient.warm_runtime()` → 常に profile 付き ensure |
| **設定** | `~/.hermes-tools/.env` · `~/.hermes/dgx-keep-warm.env` · playbook 変数 `private_pi5_hermes_dgx_default_model_profile_id` |

## Prevention

- `/novel` 後に `/task` する運用では、**デプロイに本 Fix を含める**こと
- **D5 `/task` 有効時は `private_pi5_dgx_runtime_control_token` 必須**（playbook assert）。未設定だと `/task` は常に runtime prepare 失敗
- plugin 配備に **`dgx_runtime_prepare.py` と `tools_profile_constants.py`** を含める（`deploy-discord-task-bridge.yml`）
- DGX 確認: `cat /srv/dgx/system-prod/state/active-model-profile.json` · `ss -ltn | grep 3808`
- **playbook verify の 502**: デプロイ直後に DGX が cold / llama 再起動中だと **`Verify DGX accepts tools profile Bearer token` が 502** になり得る。配置自体は完了しているため **keep-warm 手動起動または 10 分待ち後に再検証**（下記本番記録）

## 本番反映（2026-05-30）

| 項目 | 内容 |
|------|------|
| **Git** | branch `fix/private-pi5-hermes-task-runtime-profile-restore` · commit **`63aab15b`**（`fix: restore Hermes task DGX business profile`） |
| **対象ホスト** | 私用 Pi5 **`raspi5-private`**（inventory: `private-pi5-stackchan-bridge`）のみ。**DGX Spark は Ansible 対象外**（Pi5 から `POST /start` で profile 切替） |
| **手順** | 標準 `./scripts/private-pi5-hermes/deploy-private-pi5-hermes.sh` |
| **PLAY RECAP** | **`ok=106` `changed=6` `failed=1`**（約 **179s**）— 失敗は verify 段階の **tools Bearer → `/v1/models` = 502**（DGX cold / backend 未 ready） |
| **配置差分（主要）** | plugin: `dgx_runtime_prepare.py` · `tools_profile_constants.py` · `tools_profile_runner.py` · `novel_profile_runner.py` · `__init__.py`；`~/.hermes-tools/.env` / `dgx-keep-warm.env` に **`DGX_MODEL_PROFILE_ID=business_qwen36_27b_nvfp4`** |

### Investigation（デプロイ直後の 502）

| 仮説 | 検証 | 結果 |
|------|------|------|
| 配置未反映 | `grep DGX_MODEL_PROFILE_ID` on Pi5 | **CONFIRMED** 両 env が `business_qwen36_27b_nvfp4` |
| DGX gateway 停止 | `curl …/healthz` from Pi5 chat env | **REJECTED** — **200** |
| llama-server 未 ready（profile start 直後） | `journalctl -u hermes-dgx-keep-warm` | **CONFIRMED** — 1 回目は `ready: 502` · `Connection refused`、続く手動 start で **`activeProfileId: business_qwen36_27b_nvfp4`** + `/v1/models` **200** |

keep-warm 成功ログ（抜粋）:

```json
{"ok": true, "start": {"status": 200, "body": "... \"activeProfileId\": \"business_qwen36_27b_nvfp4\" ..."}, "ready": {"status": 200}, "phase": "profile_ensure"}
```

### 実機検証（デプロイ後）

| 検証 | 結果 |
|------|------|
| `hermes-gateway` / `hermes-dgx-keep-warm.timer` / `stackchan-bridge` | **active** |
| `HERMES_TOOLS_PHASE=d4` · `/tmp/verify-tools-profile-deploy.sh` | **OK**（tools/chat Bearer **200**） |
| `ensure_tools_dgx_runtime_ready(ToolsProfilePaths.default_pi5())` on Pi5 | **`ensure_ok=True`** |
| repo `verify-discord-task-bridge-smoke.sh`（ローカル） | **OK** |
| `verify-tool-write-approval-gate-pi5.sh`（**approval_relay/runner.py 直呼び**） | **FAIL** — `request.json` 未作成（ファイルは作成）。**本 Fix の経路（Discord `/task` → `run_tools_profile_prompt`）とは別**。既知: [KB D5 §write ゲート](../knowledge-base/KB-private-pi5-hermes-phase-d5-production.md) |

**Discord `/task` E2E（承認リレー完結）**: **2026-05-30 11:15 JST** デプロイ（`fix/private-pi5-hermes-task-approval-finish` · **`a6b0a940`**）済み · **手動 E2E 未実施**。profile 復帰後に `/novel` → `/task` で `request.json` 出現を確認するのが最終受け入れ。承認 UX とデプロイ記録: [KB D5 §承認 relay 完結](./KB-private-pi5-hermes-phase-d5-production.md#本番デプロイ承認-relay-完結--2026-05-30-jst) · [KB D5 §承認 UX（repo）](./KB-private-pi5-hermes-phase-d5-production.md#discord-承認-ux-修正2026-05-30--repo)。

### Investigation（2026-05-30 · `Unknown command /task`）

| 仮説 | 検証 | 結果 |
|------|------|------|
| plugin 未登録（`discover_plugins` no-op） | Pi5 `gateway/run.py` に `discover_plugins(force=True)` · 別プロセス smoke | **REJECTED** — handler 取得可 |
| 孤児 `hermes-tools-gateway` が Discord を奪う | `ss -tpn` · `HOME` on PIDs | **REJECTED** — Discord TCP は **chat** `hermes-gateway`（`HOME=/home/hermes`）のみ。`hermes-tools-gateway` は **意図した第 2 gateway**（`HOME=~/.hermes-tools/home`） |
| handler 内例外 → gateway が DEBUG で握りつぶし Unknown 表示 | `sudo -u hermes` で handler 直呼び | **CONFIRMED** — `PermissionError` on `task-bridge/approvals/manual-write-gate-*/request.json`（**root:root** サブディレクトリ。過去 verify を **root** で実行した痕跡） |
| 同上の修復 | `chown -R hermes:hermes ~/.hermes/task-bridge` 後に `/task` 直呼び | **CONFIRMED** — `List files in workspace` **~39s OK**（2026-05-30 09:3x JST） |
| chat gateway 再起動 | `systemctl restart hermes-gateway` · MAINPID **212165** | **実施** — 09:11 以前の `Unrecognized slash command /task` は旧 PID **209020** のみ（再起動後 journal **新規なし**） |

**再発防止**: Pi5 実機 smoke / verify は **`sudo -u hermes`**（Runbook 記載どおり）。root で `approvals/` 配下を作らない。Unknown が続く場合は `find ~/.hermes/task-bridge -user root` → `chown -R hermes:hermes`。

### 仕様要約（後続読者向け）

1. **単一 DGX ランタイム**が chat / tools / novel で **`system-prod-primary` を共有**する。
2. `/novel` は **green 35B（ctx 2048）** を起動し得る。`/task` は tool schema 込みで **2048 を超えやすい**。
3. **Fix**: `run_tools_profile_prompt` の先頭で `ensure_tools_dgx_runtime_ready` → **`business_qwen36_27b_nvfp4`** へ `POST /start`（既に active なら `/system/model-profile` で **skip**）。
4. **keep-warm**: 同 profile を `DGX_MODEL_PROFILE_ID` 付きで定期 ensure（novel 残留の矯正）。

## References

- [private-pi5-hermes-deploy.md §DGX 通常 profile 復帰](../runbooks/private-pi5-hermes-deploy.md)
- [`lib/dgx_runtime_prepare.py`](../../scripts/private-pi5-hermes/lib/dgx_runtime_prepare.py)
- [`lib/tools_profile_runner.py`](../../scripts/private-pi5-hermes/lib/tools_profile_runner.py)
