---
title: KB-private-pi5-hermes-task-dgx-profile-restore
tags: [Hermes Agent, private Pi5, DGX, /task, /novel, model profile]
audience: [開発者, 運用者]
last-verified: 2026-05-29
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

## References

- [private-pi5-hermes-deploy.md §DGX 通常 profile 復帰](../runbooks/private-pi5-hermes-deploy.md)
- [`lib/dgx_runtime_prepare.py`](../../scripts/private-pi5-hermes/lib/dgx_runtime_prepare.py)
- [`lib/tools_profile_runner.py`](../../scripts/private-pi5-hermes/lib/tools_profile_runner.py)
