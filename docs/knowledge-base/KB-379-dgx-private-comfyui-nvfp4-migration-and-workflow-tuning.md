---
title: KB-379 DGX Spark private ComfyUI（NVFP4 移行・遅延要因・workflow 調整）
tags: [DGX Spark, ComfyUI, NVFP4, FLUX.2 Klein, safetensors, bf16, 最適化]
audience: [運用者, 開発者]
last-verified: 2026-05-17
category: knowledge-base
related:
  - ../runbooks/dgx-private-comfyui.md
  - ./KB-378-dgx-private-comfyui-mac-ssh-access.md
  - ./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md
  - ../plans/dgx-spark-local-llm-migration-execplan.md
---

# KB-379: DGX Spark private ComfyUI（NVFP4 移行・遅延要因・workflow 調整）

## Context

DGX Spark（GB10 / Blackwell, sm_121）の private ComfyUI 運用で、接続手順（SSH トンネル）に続いて「生成品質（モザイク）」「生成時間（17分超）」「高解像度運用時の遅さ」を切り分けた記録。  
アクセス経路は [KB-378](./KB-378-dgx-private-comfyui-mac-ssh-access.md) で確立済み。本KBは **ComfyUI 実行条件と workflow 側の技術負債**に限定する。

## Symptoms

- Flux2 Klein 9B workflow で **モザイク/ゴミ出力**が出る。
- 一部条件で **1枚17分以上**（体感異常）になる。
- 上記を緩和しても、高解像度（6MP級）では **なお遅い**。

## Investigation

### 1) モザイク/ゴミ出力（fp8 NaN 伝播）

- **原因（CONFIRMED）**: GB10/Blackwell で fp8 経路の NaN 伝播が出る構成がある。
- **対策（適用済み）**:
  - `compose.yaml` 起動フラグで `--bf16-unet` を有効化（既定）。
  - `--bf16-vae` / `--bf16-text-enc` も併用。
- **補足**: `UNETLoader.weight_dtype` は workflow 上 `default` のままでも、起動フラグ側の bf16 指定と整合する。

### 2) 17分超の遅延（safetensors 二重ロード）

- **原因（CONFIRMED）**: DGX Spark の UMA（統合メモリ）条件で safetensors 周りの二重ロード/コピーが起き、オフロード再ロードが反復する。
- **対策（適用済み）**:
  - ComfyUI 起動フラグへ `--disable-mmap` を追加。
  - `docker compose up -d --force-recreate` で再作成適用。
  - `comfy/utils.py` の `copy=True -> copy=False` パッチ（build 時適用）を維持。

### 3) 依然遅い（計算量が支配）

- **原因（CONFIRMED）**:
  - 2048x3008（約 6.16MP）
  - 2pass（split）
  - LoRA 3本
  - bf16 での計算
- **示唆（要実測）**: モデルを NVFP4 版へ置換すると、Blackwell での速度/メモリ効率改善余地がある。

## 現在の運用状態（2026-05-17）

- コンテナ: `dgx-private-comfyui`
- ComfyUI ポート公開: `127.0.0.1:8188`（アクセスは SSH `-L` 必須）
- 主要フラグ:
  - `--bf16-unet`
  - `--bf16-vae`
  - `--bf16-text-enc`
  - `--disable-dynamic-vram`
  - `--disable-mmap`
- 運用 workflow 例（DGX 向け最適化版）:
  - `flux2_klein_9b_dgxspark_v3_final.json`
  - `EmptyFlux2LatentImage`: 2048x3008
  - `BasicScheduler`: 20 steps
  - `SplitSigmas`: 12/8

## NVFP4 移行の実施手順（次タスク）

### 1. Hugging Face token を確認

```bash
sudo docker exec "dgx-private-comfyui" sh -lc 'cat /root/.cache/huggingface/token 2>/dev/null || echo "UNSET"'
```

未設定なら `huggingface-cli login` をコンテナ内で実施し、必要なモデル利用規約に同意する。

### 2. NVFP4 モデルを取得

```bash
sudo docker exec -it "dgx-private-comfyui" bash
huggingface-cli download \
  black-forest-labs/FLUX.2-klein-base-9b-nvfp4 \
  --local-dir /opt/ComfyUI/models/diffusion_models/ \
  --include "*.safetensors"
```

### 3. workflow の UNET を差し替え

- `UNETLoader.unet_name` を実ファイル名へ変更（例: `flux-2-klein-base-9b-nvfp4.safetensors`）。
- `weight_dtype` はまず `default` で開始し、必要時のみ候補（例: `fp8_e4m3fn`）を検証する。
- 変更は **1項目ずつ**適用し、生成結果/時間を比較する。

## Verification Checklist（NVFP4 移行時）

1. DGX 内 `curl -I http://127.0.0.1:8188` が `200`
2. Mac 側 SSH トンネル経由で UI 到達（[KB-378](./KB-378-dgx-private-comfyui-mac-ssh-access.md)）
3. ComfyUI ログに model not found / dtype mismatch が無い
4. 同一 prompt / seed で bf16版と NVFP4版の
   - 生成時間
   - 出力破綻有無
   - VRAM/UMA 圧迫傾向
   を比較記録

## Prevention

- `docker compose restart` ではなく **`up -d --force-recreate`** を使う（起動フラグ変更の反映漏れ防止）。
- workflow のモデル名は **実ファイル名**に合わせる（`fp8/bf16/nvfp4` 混在名を残さない）。
- 速度問題はまず「経路」ではなく「計算量・モデル・mmap/コピー」を疑う。

## References

- [Runbook: dgx-private-comfyui.md](../runbooks/dgx-private-comfyui.md)
- [KB-378](./KB-378-dgx-private-comfyui-mac-ssh-access.md)
- [KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)
- NVIDIA: [Comfy UI Instructions](https://build.nvidia.com/spark/comfy-ui/instructions)
