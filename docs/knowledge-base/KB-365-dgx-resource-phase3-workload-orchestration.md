---
title: KB-365 DGXリソース Phase3・補助ランタイム起停・ワークロード自動調停
tags: [DGX, DGX_RESOURCE, Pi5, ComfyUI, experiment-lab, 運用]
audience: [開発者, 運用者]
last-verified: 2026-05-03
category: knowledge-base
---

# KB-365: DGXリソース Phase3・補助ランタイム起停・ワークロード自動調停

## Context

`/admin/tools/dgx-resource` の **Control Target を拡張**し、`system-prod-gateway` 以外にも **Pi5 から POST できる補助起停**（私用 ComfyUI・論理ターゲット `experiment-lab`）を追加した。あわせて **`SET_POLICY` に `applyWorkloadChanges`** を用意し、GUI のチェック有効時に **業務優先 / 実験優先へ切り替える前に**自動で停止試行する（GPU 競合緩和。KB-364 系）。

## Preconditions

- Pi5 **`apps/api`** が Tailscale（または許可経路）で **DGX 側の軽い HTTP hook（POST）**に到達できること（URL は運用が DGX で用意）。
- Hook は gateway と同様、トークン使用時 **`X-Runtime-Control-Token`** を検証することを推奨。
- `applyWorkloadChanges` は **順次 POST**であり、途中失敗時は **モード変更前にエラー**。一部 POST 済みの可能性は運用側で許容または hook をべき等に。

## ENV（Pi5）

- `DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL` / `_STOP_URL`（/ 任意 `_CONTROL_TOKEN`）
- `DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_START_URL` / `_STOP_URL`（/ 任意 `_CONTROL_TOKEN`）
- （任意）`DGX_RESOURCE_EXPERIMENT_LAB_HEALTH_URL` — GET で状態表示用
- `DGX_RESOURCE_AUX_RUNTIME_REQUEST_TIMEOUT_MS` — 補助 POST タイムアウト（既定 90000）

Ansible は `templates/api.env.j2` / `templates/docker.env.j2` で上記変数を空既定で出力（inventory で上書き）。

## API/UI

- **`EXECUTE_TARGET_ACTION`**: `overview.targets[].capabilities` に `start`/`stop` があるもののみ許可。
- **`SET_POLICY`**: `applyWorkloadChanges: true` のときのみ `dgx-resource.policy-arbitrator` の計画に従って停止試行。**直前モードへ戻す** は `applyWorkloadChanges: false` で呼ぶ（ワークロードは触らない）。

## References

- [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)（管理コンソール節・Phase3 説明）
- [KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)
- [ADR-20260502-dgx-resource-control-targets.md](../decisions/ADR-20260502-dgx-resource-control-targets.md)
