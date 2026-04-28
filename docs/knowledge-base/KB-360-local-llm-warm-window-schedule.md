---
title: KB-360 LocalLLM on_demand の昼間 warm ウィンドウ（release 後も upstream を止めない）
tags: [LocalLLM, Pi5, API, on_demand, 運用]
audience: [開発者, 運用者]
last-verified: 2026-04-28
related:
  - ./KB-319-photo-loan-vlm-tool-label.md
  - ../runbooks/local-llm-tailscale-sidecar.md
  - ../decisions/ADR-20260403-on-demand-local-llm-runtime-control.md
  - ./infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env
category: knowledge-base
update-frequency: medium
---

# KB-360: LocalLLM on_demand の昼間 warm ウィンドウ

## Context

- `LOCAL_LLM_RUNTIME_MODE=on_demand` のとき、参照カウントが 0 になると API が upstream の **`POST …/stop`** を送り、llama-server / vLLM 側のプロセスを止められうる。
- 管理チャットや連続ジョブで **2 回目が cold start** になりタイムアウトしやすい、GPU 共有との trade-off のため、**業務時間帯だけ warm 維持**したい。

## 仕様（本リポジトリの実装）

- **前提**: `LOCAL_LLM_RUNTIME_MODE=on_demand` かつ warm ウィンドウが **有効**。
- **時間帯**: IANA タイムゾーン（既定 `Asia/Tokyo`）で、**`START_HOUR`（含む）〜`END_HOUR`（含まない）** の間は「warm」。
  - 既定 **`7`〜`23`** → **07:00〜22:59** が warm、**23:00〜06:59** は従来どおり release で `/stop` 試行。
- **適用範囲**: `admin_console_chat` / `photo_label` / `document_summary` はいずれも **同じ `HttpOnDemandLocalLlmRuntimeController` 経路**に **`shouldSuppressStop` が渡る**ため、同一ポリシーが効く。
- **無効時**: `LOCAL_LLM_RUNTIME_WARM_WINDOW_ENABLED=false`（既定）なら **従来通り** refCount=0 で停止試行。

## 環境変数（API）

| 変数 | 意味 |
|------|------|
| `LOCAL_LLM_RUNTIME_WARM_WINDOW_ENABLED` | `true` で有効 |
| `LOCAL_LLM_RUNTIME_WARM_WINDOW_TIMEZONE` | 既定 `Asia/Tokyo` |
| `LOCAL_LLM_RUNTIME_WARM_WINDOW_START_HOUR` | 0–23、窓開始（含む） |
| `LOCAL_LLM_RUNTIME_WARM_WINDOW_END_HOUR` | 0–23、窓終了（**含まない**）。有効時は **START &lt; END** が必須 |

## Ansible / `docker.env`

- `infrastructure/ansible/templates/docker.env.j2` に上記を出力済み。
- 本番 Pi5 例は `infrastructure/ansible/inventory.yml` の `api_local_llm_runtime_warm_window_*`。

## 観測

- warm 内で release した場合、API ログに  
  **`action: runtime_stop_suppressed`**（`[LocalLlmRuntimeControl] stop suppressed (schedule policy)`）が出る。

## References

- 実装: `apps/api/src/services/inference/runtime/local-llm-runtime-schedule.policy.ts`、`get-local-llm-runtime-controller.ts`
- on_demand 全体: [ADR-20260403](../decisions/ADR-20260403-on-demand-local-llm-runtime-control.md)
