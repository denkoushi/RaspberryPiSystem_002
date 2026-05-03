---
title: KB-364 DGX blue vLLM と私用 ComfyUI の GPU 競合（502・inference-backend WARN）
tags: [DGX, LocalLLM, vLLM, ComfyUI, GPU, 運用, Pi5]
audience: [開発者, 運用者]
last-verified: 2026-05-03
category: knowledge-base
---

# KB-364: DGX blue vLLM と私用 ComfyUI の GPU 競合（502・inference-backend WARN）

## Context

同一 DGX 上では **GPU / 統一メモリ** を複数コンテナで共有する。`dgx-private-comfyui`（私用 ComfyUI）が GPU メモリを大きく占有している状態で、業務側 blue（`system-prod-trtllm` 等の vLLM）が **要求する VRAM 割当**を確保できないと、**プロセスは起動直後に終了**しうる。

## Symptoms

- 管理コンソール `/admin/tools/dgx-resource` の **`inference-backend`**（`GET /v1/models` ベース）が **WARN** のまま、しばらく **自動更新（約 5s）しても改善しない**
- Pi5 経由 gateway で **認証付き `GET /v1/models`** が **502**。本文に **`bad gateway`** かつ **`[Errno 111] Connection refused`** 等（**upstream が listen していない**）
- DGX 上で `system-prod-trtllm` のログに **`ValueError: Free memory on device cuda:0 … is less than desired GPU memory utilization`**（**空き VRAM が blue の既定利用率に足りない**）

**注意**: blue の **cold start**（重み読込・`torch.compile`・autotune）中も **502 / connection reset** は起こり得る。**ログに上記 `ValueError` が出ている**なら、まず **GPU 占有**を疑う。

## Investigation（CONFIRMED / 2026-05-03）

- DGX ホストで **`nvidia-smi`** の **Processes** に **ComfyUI**（例: `python main.py --listen … --port 8188`）が載り、**VRAM 使用量が大きい**
- `docker logs system-prod-trtllm`（または当該 blue コンテナ名）で **`ValueError: Free memory on device`** を確認
- Pi5 **API コンテナ内**に `curl` / `python` が無い場合があるため、**Pi5 ホストの `python3`** で `infrastructure/docker/.env` の **`LOCAL_LLM_SHARED_TOKEN`** を読み、gateway に **`X-LLM-Token`** 付きで叩く、または **DGX に SSH** して `127.0.0.1:38083` 直叩きで切り分ける（実装参照: [`dgx-resource.probes.ts`](../../apps/api/src/services/system/dgx-resource/dgx-resource.probes.ts) の `probeV1Models`）

## Fix（運用）

1. **業務優先（`business_first` 等）で blue を復旧したい**: 私用 ComfyUI を止めるか、VRAM を空ける（例: **`docker stop dgx-private-comfyui`** — コンテナ名は環境により異なる。**復旧後に私用で再度起動する場合は、再び blue と衝突しうる**）
2. **`POST /start`（runtime 制御）** を再実行し、ログで **listen 復帰**と **`GET /v1/models` → 200**（`system-prod-primary` 等）を確認
3. **cold start のみ**の場合は、**`torch.compile` / autotune 完了**まで待つ（Runbook の既知節）

## Prevention

- 運用プロファイル **`private_ok`** は **ComfyUI 等との競合を許容**する一方、**`business_first`** では **業務 blue との同時フル稼働は期待しない**（UI・Runbook の説明と整合）
- 管理 UI の WARN は **裏側が変わらない限り「待つ」だけでは直らない**（ポーリング間隔は UI 側の更新周期に依存）

## References

- [Runbook: dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)（トラブルシューティング補足・コンテナ混在）
- [KB-363](./KB-363-dgx-resource-spark-status-fallback.md)（別事象: `sparkHost` フォールバック）
- [ADR-20260502-dgx-resource-control-targets.md](../decisions/ADR-20260502-dgx-resource-control-targets.md)
