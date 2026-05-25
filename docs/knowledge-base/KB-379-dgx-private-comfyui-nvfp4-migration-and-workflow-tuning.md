---
title: KB-379 DGX Spark private ComfyUI（FLUX.2 Klein 9B 移行・workflow・NVFP4）
tags: [DGX Spark, ComfyUI, NVFP4, FLUX.2 Klein, Flux2KleinEnhancer, safetensors, workflow, 最適化]
audience: [運用者, 開発者]
last-verified: 2026-05-25
category: knowledge-base
related:
  - ../runbooks/dgx-private-comfyui.md
  - ./KB-378-dgx-private-comfyui-mac-ssh-access.md
  - ./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md
  - ../plans/dgx-spark-local-llm-migration-execplan.md
---

# KB-379: DGX Spark private ComfyUI（FLUX.2 Klein 9B 移行・workflow・NVFP4）

## Context

Ubuntu PC（RTX 4060 8GB）で運用していた ComfyUI ワークフローを、DGX Spark 上の **私用コンテナ `dgx-private-comfyui`** へ移行し、FLUX.2 Klein 9B 系として **実用化完了**（2026-05-25）。

| 項目 | 元環境 | 移行先 |
|------|--------|--------|
| ホスト | Ubuntu PC | DGX Spark（GB10・128GB UMA） |
| GPU | RTX 4060 8GB | 統合メモリ |
| 元 workflow | `flux2_klein_9b_bloodforce88_snofs (1) (2) (2).json` | 下記 **推奨 workflow** へ置換 |
| モデル既定 | FP8 系 | **NVFP4 UNET + fp8mixed CLIP**（実測で標準候補） |
| UI アクセス | ローカル | Mac → **SSH `-L 8188`**（[KB-378](./KB-378-dgx-private-comfyui-mac-ssh-access.md)） |

**インフラ正本**: コンテナ配置・境界・トンネルは [Runbook: dgx-private-comfyui.md](../runbooks/dgx-private-comfyui.md)。本 KB は **workflow 移行・品質/速度切り分け・推奨構成** に限定する。

### DGX 上のパス（実測）

```text
compose:  /srv/dgx/private-personal/compose/dgx-private-comfyui
models:   /srv/dgx/private-personal/comfyui/data/models   → /opt/ComfyUI/models
input:    /srv/dgx/private-personal/comfyui/data/input    → /opt/ComfyUI/input
output:   /srv/dgx/private-personal/comfyui/data/output   → /opt/ComfyUI/output
user:     /srv/dgx/private-personal/comfyui/data/user     → /opt/ComfyUI/user
```

### 元 workflow の主な依存（抽出）

| 種別 | ファイル名 |
|------|------------|
| UNET | `flux-2-klein-base-9b-fp8.safetensors` |
| CLIP | `qwen_3_8b_fp8mixed.safetensors` |
| VAE | `flux2-vae.safetensors` |
| LoRA | `klein_9B_Turbo_r64.safetensors`, `klein_9B_Turbo_r128.safetensors`, `klein_snofs_v1_1.safetensors` |
| 参照画像 | `DSC07559.JPG`（例） |
| Custom Node | **ComfyUI-Flux2Klein-Enhancer**（`Flux2KleinEnhancer`） |

DGX 上で利用可能だった UNET 実体（`models/diffusion_models`）:

- `flux-2-klein-base-9b-bf16.safetensors`
- `flux-2-klein-base-9b-fp8.safetensors`
- `flux-2-klein-base-9b-nvfp4.safetensors`

CLIP 実体（`models/text_encoders`）:

- `qwen_3_8b_bf16.safetensors`
- `qwen_3_8b_fp8mixed.safetensors`

## Symptoms（移行直後・元 JSON をそのまま実行）

- **生成時間**: 約 **10分43秒**
- **出力**: **破綻画像**（細かい模様・ノイズ・参照画像の質感が異常増幅）
- 当初は ComfyUI 起動設定・メモリ設定が疑われた（後述の切り分けで **Enhancer が主因**と確定）

**過去記録（2026-05-17 以前）**との関係:

- **モザイク/NaN**（fp8 経路）→ 起動フラグ・dtype 調整で緩和した事例あり（本移行では **破綻の主因は Enhancer**）
- **17分超**（safetensors 二重ロード）→ `--disable-mmap` + `copy=False` で緩和（下記 Compose 参照）
- **高解像度の遅さ** → 1248×1824 ではサンプリング自体が支配（約 2.27MP）

## Investigation（段階的切り分け・2026-05-25）

| 段階 | 構成 | 結果 | 結論 |
|------|------|------|------|
| 最小 | fp8 UNET + fp8mixed CLIP + VAE、LoRA/Ref/Enhancer なし、512×768・8 steps | 正常 | モデル・CLIP・VAE・GPU は正常 |
| 2段サンプラー | `SamplerCustomAdvanced` + `SplitSigmas` + `DisableNoise` | 正常 | 2段構成は正常 |
| LoRA 3本 | Turbo r64/r128 + SNOFS | 正常（作風強め） | LoRA チェーンは破綻原因ではない |
| ReferenceLatent | LoadImage → Scale → VAEEncode → ReferenceLatent | 正常 | ReferenceLatent 単体は破綻原因ではない |
| **Flux2KleinEnhancer** | 上記に Enhancer 追加 | **破綻** | **現 DGX/ComfyUI 環境では Enhancer が破綻原因（CONFIRMED）** |

**併発要因（CONFIRMED）**:

1. **`system-prod-trtllm`（VLLM::EngineCore）が約 57GB 占有** → Comfy 利用中は `docker stop system-prod-trtllm` で一時停止し実測（[KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md) と整合）
2. 元 workflow の **Flux2KleinEnhancer**
3. LoRA 強度が写真用途に強すぎた
4. FP8 より **NVFP4** の方が DGX Spark では速度・実用性に有利

## Fix（実施済み）

### 1. 修正版 workflow（運用者ワークステーションまたは DGX `user/` 配下）

| ファイル | 目的 |
|----------|------|
| `0525_flux2_klein_9b_DGXSpark_fixed_no_enhancer.json`（`.zip` 同梱可） | **Enhancer 除去**。Positive → ReferenceLatent 直結。`UNETLoader` dtype **`fp8_e4m3fn` 明示**。保存 prefix: `Flux2-Klein-9b-DGXSpark-fixed` |
| `0525_flux2_klein_9b_DGXSpark_photoreal_tuned.json` | 写真寄せ LoRA 強度・CFG・prompt 調整 |
| **`0525_flux2_klein_9b_DGXSpark_photoreal_nvfp4.json`** | **現行推奨**。UNET を **nvfp4** に差し替え。他は photoreal tuned と同様 |

**photoreal_tuned / photoreal_nvfp4 の主な tuning**:

| 項目 | 変更 |
|------|------|
| Turbo r64 | 0.15 → **0.08** |
| Turbo r128 | 1.0 → **0.45** |
| SNOFS | 0.8 → **0.35** |
| CFG（1段目） | 3.5 → **3.0** |
| Positive | `photorealistic raw photo`, `natural skin texture`, … 等を追加 |
| Negative | `illustration`, `anime`, `plastic skin`, … 等を追加 |

**photoreal_nvfp4 の UNET 差し替え**:

```text
flux-2-klein-base-9b-fp8.safetensors
  → flux-2-klein-base-9b-nvfp4.safetensors
```

### 2. 現行推奨 workflow 構成（標準）

**ファイル**: `0525_flux2_klein_9b_DGXSpark_photoreal_nvfp4.json`

| コンポーネント | 値 |
|----------------|-----|
| UNET | `flux-2-klein-base-9b-nvfp4.safetensors` |
| CLIP | `qwen_3_8b_fp8mixed.safetensors` |
| VAE | `flux2-vae.safetensors` |
| LoRA | `klein_9B_Turbo_r64` **0.08**, `klein_9B_Turbo_r128` **0.45**, `klein_snofs_v1_1` **0.35** |
| **使わない** | **`Flux2KleinEnhancer`**（当面禁止） |
| 解像度（実測） | **1248×1824**（約 2.27MP。512×768 の約 5.8 倍画素） |

### 3. ComfyUI コンテナ起動（実用寄り・DGX 実機）

`compose.yaml` の `command` 例（フラグ変更後は **`docker compose up -d --force-recreate`**）:

```yaml
environment:
  PYTORCH_NO_CUDA_MEMORY_CACHING: "1"

command:
  - python
  - main.py
  - --listen
  - 0.0.0.0
  - --port
  - "8188"
  - --disable-dynamic-vram
  - --reserve-vram
  - "8"
  - --disable-pinned-memory
  - --disable-mmap
```

**ログで確認した挙動**（`--disable-dynamic-vram` 有効時）:

```text
Dynamic vram disabled with argument
Enabled pinned memory …
loaded partially / lowvram patches
```

**リポジトリ雛形**: [`scripts/dgx-private-comfyui/compose.yaml.example`](../../scripts/dgx-private-comfyui/compose.yaml.example) を上記に整合（2026-05-25）。**`--bf16-unet` 系は NVFP4 標準 workflow では必須ではない**（過去の NaN 対策用。workflow 側 dtype と併用判断）。

**build 時パッチ（継続）**: `Dockerfile` の `copy=True` → `copy=False`（safetensors 不要コピー抑制）。

### 4. 業務 vLLM とのメモリ競合（運用メモ）

Comfy 重作業時は **`system-prod-trtllm` が約 57GB 使用**しうる。

```bash
# 一時停止（Comfy 優先時）
docker stop system-prod-trtllm

# 業務復帰時
docker start system-prod-trtllm
```

**同時稼働**は UMA を大きく消費し Comfy が遅くなる可能性あり（[KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)）。

## 速度（実測・2026-05-25）

| 構成 | 所要時間の目安 |
|------|----------------|
| FP8（photoreal tuned 相当） | 約 **5分台** |
| **NVFP4（推奨）** 1回目 | 約 **5分台** |
| **NVFP4** 2回目（同一セッション・再起動なし） | 約 **3分台** |
| 512×768 軽量テスト | サンプリング **数十秒** |

**解釈**: FP8 でも連続実行で劇的短縮しなかった → ボトルネックはモデルロードより **1248×1824 のサンプリング**。NVFP4 の 3分台は妥当。

## 解決済み状態（2026-05-25）

```text
ComfyUI は DGX 上で正常動作
Klein 9B / LoRA / ReferenceLatent は正常
破綻原因は Flux2KleinEnhancer と判明 → 除去 workflow で解消
NVFP4 + photoreal tuning で 3分台まで改善
写真寄せ版 workflow 作成済み
```

## 今後の改善候補（未実施）

| 候補 | 内容 |
|------|------|
| 解像度別 workflow | 品質 **1248×1824** / 速度 **1024×1536** / さらに **896×1344** |
| 低解像度 + アップスケール | 896×1344 または 1024×1536 生成 → 後段 upscale |
| LoRA 再調整 | 写真弱い → SNOFS 0.2〜0、Turbo r128 0.3 等 / 作風弱い → SNOFS 0.45、r128 0.55 等 |
| Flux2KleinEnhancer | **当面使わない**。再検証するなら custom node 更新・ComfyUI バージョン整合・Enhancer 単独・`active_scale` 等を弱めて試す |

## NVFP4 モデル取得（初回のみ・参考）

モデルが未配置の環境向け（実測済み環境では配置済み）。

```bash
sudo docker exec "dgx-private-comfyui" sh -lc 'cat /root/.cache/huggingface/token 2>/dev/null || echo "UNSET"'
```

```bash
sudo docker exec -it "dgx-private-comfyui" bash
huggingface-cli download \
  black-forest-labs/FLUX.2-klein-base-9b-nvfp4 \
  --local-dir /opt/ComfyUI/models/diffusion_models/ \
  --include "*.safetensors"
```

workflow では `UNETLoader.unet_name` を **`flux-2-klein-base-9b-nvfp4.safetensors`** に合わせる。

## Verification Checklist（workflow 変更時）

1. DGX: `curl -I http://127.0.0.1:8188` → **200**
2. Mac: SSH トンネル後 `curl -I http://127.0.0.1:8188` → **200**（[KB-378](./KB-378-dgx-private-comfyui-mac-ssh-access.md)）
3. ComfyUI ログに **model not found / dtype mismatch** が無い
4. **Enhancer ノードが無い**こと（または使用しないこと）
5. 同一 prompt/seed で **破綻なし**・生成時間を記録
6. 業務 vLLM 再開時は **メモリ占有**を `nvidia-smi` で確認

## Prevention

- **破綻時はまず `Flux2KleinEnhancer` の有無を確認**（`mid_layer_scale` 互換パッチは旧暫定。正攻法は **Enhancer 除去 workflow**）。
- `docker compose restart` ではなく **`up -d --force-recreate`**（起動フラグ反映）。
- workflow のモデル名は **実ファイル名**に一致（`fp8`/`bf16`/`nvfp4` 混在参照を残さない）。
- 速度改善は SSH 経路より **解像度・量子化（NVFP4）・vLLM 停止**を優先して切り分ける。

## 別 AI / オペレータへの依頼テンプレ

```text
DGX Spark 上の ComfyUI で FLUX.2 Klein 9B NVFP4 を使用。
標準 workflow: 0525_flux2_klein_9b_DGXSpark_photoreal_nvfp4.json
Flux2KleinEnhancer は使わない（破綻原因）。
LoRA: Turbo r64=0.08, r128=0.45, SNOFS=0.35
課題: 写真らしさを維持しつつ生成時間短縮。
候補: 1024x1536 版、低解像度+アップスケール、LoRA 強度再調整。
```

## References

- [Runbook: dgx-private-comfyui.md](../runbooks/dgx-private-comfyui.md)
- [KB-378](./KB-378-dgx-private-comfyui-mac-ssh-access.md)
- [KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)
- [`scripts/dgx-private-comfyui/README.md`](../../scripts/dgx-private-comfyui/README.md)
- NVIDIA: [Comfy UI Instructions](https://build.nvidia.com/spark/comfy-ui/instructions)
- 移行作業の元メモ（外部）: `DGX_Spark_ComfyUI_FLUX2_Klein9B_migration_notes.md`（2026-05-24/25 作業ログ）
