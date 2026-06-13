---
title: KB-379 DGX Spark private ComfyUI（FLUX.2 Klein 9B 移行・workflow・NVFP4）
tags: [DGX Spark, ComfyUI, NVFP4, FLUX.2 Klein, Qwen Image Edit 2511, Flux2KleinEnhancer, safetensors, workflow, 最適化]
audience: [運用者, 開発者]
last-verified: 2026-06-13
category: knowledge-base
related:
  - ../runbooks/dgx-private-comfyui.md
  - ./KB-378-dgx-private-comfyui-mac-ssh-access.md
  - ./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md
  - ../plans/dgx-spark-local-llm-migration-execplan.md
---

# KB-379: DGX Spark private ComfyUI（FLUX.2 Klein 9B 移行・workflow・NVFP4）

## Context

Ubuntu PC（RTX 4060 8GB）で運用していた ComfyUI ワークフローを、DGX Spark 上の **私用コンテナ `dgx-private-comfyui`** へ移行した。**破綻画像の除去**（2026-05-25）に続き、**2026-05-31** 時点で **実在モデルと workflow 参照の整合**を取った **基準線 workflow** により、運用者評価で **大幅改善**（プロンプト追随はまだ改善余地あり）。

| 項目 | 元環境 | 移行先（2026-05-31 基準線） |
|------|--------|------------------------------|
| ホスト | Ubuntu PC | DGX Spark（GB10・128GB UMA） |
| GPU | RTX 4060 8GB | 統合メモリ（ComfyUI 報告 ~124547 MB） |
| 元 workflow | `flux2_klein_9b_bloodforce88_snofs …`（Ubuntu 成功） | **`0531_flux2_klein_9b_DGXSpark_NEXT_standard_available_models.json`** |
| モデル既定 | FP8 UNET + fp8mixed CLIP | **NVFP4 UNET + bf16 CLIP**（**DGX 上に実在するファイルのみ**） |
| UI アクセス | ローカル | Mac → **SSH `-L 8188`**（[KB-378](./KB-378-dgx-private-comfyui-mac-ssh-access.md)） |
| 最終目的 | — | **Phase 1（2026-06-13）**: 入力画像の **プロンプト編集**（顔・構図保持）。**Phase 2（未着手）**: 別ポーズ画像への **顔 ID 差し替え** |

**インフラ正本**: コンテナ配置・境界・トンネル・Pi5 gateway と SSH の役割分担は [Runbook: dgx-private-comfyui.md](../runbooks/dgx-private-comfyui.md)。本 KB は **workflow 移行・品質/速度切り分け・基準線 workflow・モデル配置** に限定する。

**リポジトリ同梱の基準線 JSON**: [`scripts/dgx-private-comfyui/workflows/0531_flux2_klein_9b_DGXSpark_NEXT_standard_available_models.json`](../../scripts/dgx-private-comfyui/workflows/0531_flux2_klein_9b_DGXSpark_NEXT_standard_available_models.json)（DGX `user/default/workflows/` へインポートする正本コピー）。

### DGX 上のパス（実測）

```text
compose:  /srv/dgx/private-personal/compose/dgx-private-comfyui
models:   /srv/dgx/private-personal/comfyui/data/models   → /opt/ComfyUI/models
input:    /srv/dgx/private-personal/comfyui/data/input    → /opt/ComfyUI/input
output:   /srv/dgx/private-personal/comfyui/data/output   → /opt/ComfyUI/output
user:     /srv/dgx/private-personal/comfyui/data/user     → /opt/ComfyUI/user
```

### Ubuntu PC 成功ワークフロー（参照・そのまま DGX では破綻）

ユーザー提示の成功側（例: `flux2_klein_9b_bloodforce88_snofs …` / workflow ID `flux2-klein-9b-bloodforce88-flat`）の主な構成:

| 項目 | 値 |
|------|-----|
| UNET | `flux-2-klein-base-9b-fp8.safetensors` |
| CLIP | `qwen_3_8b_fp8mixed.safetensors` |
| VAE | `flux2-vae.safetensors` |
| Reference scale | `2.27` |
| LoRA r64 / r128 / SNOFS | `0.15` / `1.0` / `0.8` |
| **`Flux2KleinEnhancer`** | **使用** |
| 2 段サンプラー | `dpmpp_2m` · `sgm_uniform` · steps `10` · split `6` · CFG `3.5` / `1.0` · 2 段目 `DisableNoise` |

**この JSON を DGX へほぼそのまま持ち込むと破綻した**（単純移植では解決しない）。DGX では **Enhancer 除去**・**量子化（NVFP4）**・**実在モデルへの参照合わせ**が別途必要（下記 §2026-05-31）。

### 元 workflow の主な依存（KB 初版・2026-05-25 時点の記録）

| 種別 | ファイル名 |
|------|------------|
| UNET | `flux-2-klein-base-9b-fp8.safetensors` |
| CLIP | `qwen_3_8b_fp8mixed.safetensors` |
| VAE | `flux2-vae.safetensors` |
| LoRA | `klein_9B_Turbo_r64.safetensors`, `klein_9B_Turbo_r128.safetensors`, `klein_snofs_v1_1.safetensors` |
| 参照画像 | `DSC07559.JPG`（例） |
| Custom Node | **ComfyUI-Flux2Klein-Enhancer**（`Flux2KleinEnhancer`） |

## 2026-05-31 現状確認（実機・モデル配置・基準線 workflow）

### 接続・到達経路（Pi5 / Mac / DGX）

| 経路 | 結果（2026-05-31） | 用途 |
|------|-------------------|------|
| Mac → Pi5 SSH | 成功 | 職場 Pi5 管理 |
| Pi5 → DGX `http://100.118.82.72:38081/healthz` | **200 ok** | gateway 生存 |
| Pi5 → DGX `http://100.118.82.72:38081/private-comfyui/health` | **200**（ComfyUI HTML） | **管理画面・自動プローブ**（Ansible 既定: [inventory.yml](../../infrastructure/ansible/inventory.yml) の `api_dgx_resource_comfyui_health_url`） |
| Pi5 → DGX SSH `:22` | **timeout** | コンテナ内作業には使えない |
| Mac → DGX 管理 SSH | 成功 | **compose / workflow / モデル配置の変更** |

**解釈**: Pi5 から **Private ComfyUI が生きていることは gateway ヘルスで確認できる**が、**現行 Tailscale ACL では Pi5 から DGX 本体 SSH は不可**。コンテナ内部の修正は **Mac から DGX 管理 SSH** で実施する（Runbook 追補と整合）。

### DGX コンテナ（`dgx-private-comfyui`）

| 項目 | 値 |
|------|-----|
| 状態 | running |
| 公開 | `127.0.0.1:8188->8188/tcp` のみ |
| ComfyUI | **0.22.0** |
| PyTorch | **2.12.0+cu130** |
| メモリ報告 | 約 **124547 MB**（UMA） |
| ログ | `Dynamic vram disabled`（`--disable-dynamic-vram` 有効） |

**Compose（実測・既存推奨と一致）**: `--disable-dynamic-vram` · `--reserve-vram 8` · `--disable-pinned-memory` · `--disable-mmap` · `PYTORCH_NO_CUDA_MEMORY_CACHING=1`。

**同時稼働（当該確認時）**: `system-prod-trtllm` は **未稼働**（VRAM 競合 ~57GB は **主因ではなかった**）。`system-prod-embedding` は小さい。競合時の手順は [KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md) を参照。

**カスタムノード（コンテナ内に存在）**: `ComfyUI-PuLID-Flux2` · `ComfyUI-Flux2Klein-Enhancer`。**運用 workflow では `Flux2KleinEnhancer` は使わない**（DGX で Enhancer 追加時に破綻再現・2026-05-25 切り分けと整合）。

### 現在 DGX に実在するモデル（`/opt/ComfyUI/models`・2026-05-31）

| パス | ファイル |
|------|----------|
| `diffusion_models/` | `flux-2-klein-base-9b-bf16.safetensors` · **`flux-2-klein-base-9b-nvfp4.safetensors`** |
| `text_encoders/` | **`qwen_3_8b_bf16.safetensors`** |
| `vae/` | `flux2-vae.safetensors` |
| `loras/` | `klein_9B_Turbo_r128.safetensors` · `klein_snofs_v1_1.safetensors` |
| `pulid/` | `pulid_flux2_klein_v1.safetensors` · `pulid_flux2_klein_v2.safetensors` |

### 現在 DGX に見つからなかったモデル（workflow 参照ずれの原因）

| ファイル | 影響 |
|----------|------|
| `qwen_3_8b_fp8mixed.safetensors` | 旧標準 `0525_…_photoreal_nvfp4.json` の CLIP 参照 |
| `klein_9B_Turbo_r64.safetensors` | 同上・Ubuntu 成功 workflow の r64 |
| `flux-2-klein-base-9b-fp8.safetensors` | `0525_…_fixed_no_enhancer.json` 等 |

**結論**: 2026-05-25 文書上の「標準」`0525_flux2_klein_9b_DGXSpark_photoreal_nvfp4.json` は **設計意図としては妥当**だが、**2026-05-31 時点のディスク配置と不整合**。破綻・追随低下の一部は **パラメータだけでなくモデル未存在・LoRA 強度のずれ**（例: SNOFS が KB 推奨 `0.35` ではなく workflow 上 `0.8` のまま）として扱う。

### 既存 DGX workflow の検証結果（コンテナ内 `user/default/workflows/`）

| ファイル | 主な問題（2026-05-31） |
|----------|------------------------|
| `0525_flux2_klein_9b_DGXSpark_photoreal_nvfp4.json` | CLIP **fp8mixed 未配置** · r64 **未配置** · SNOFS **0.8**（KB 推奨 0.35 と不一致）· UNET nvfp4 は **存在** |
| `0525_flux2_klein_9b_DGXSpark_fixed_no_enhancer.json` | fp8 UNET · fp8mixed CLIP · r64 **いずれも未配置** |

### 基準線 workflow（2026-05-31 以降の正本）

**ファイル名（DGX / リポジトリで同一）**: **`0531_flux2_klein_9b_DGXSpark_NEXT_standard_available_models.json`**

| コンポーネント | 値 |
|----------------|-----|
| UNET | `flux-2-klein-base-9b-nvfp4.safetensors` |
| CLIP | `qwen_3_8b_bf16.safetensors` |
| VAE | `flux2-vae.safetensors` |
| r64 LoRA | `klein_9B_Turbo_r64.safetensors` — **未配置のため無効**（node mode `4` · strength `0.0`） |
| r128 LoRA | `klein_9B_Turbo_r128.safetensors` · strength **`0.45`** |
| SNOFS | `klein_snofs_v1_1.safetensors` · strength **`0.35`**（KB 推奨へ復帰） |
| Reference scale | **`2.27`** |
| サンプラー | `sgm_uniform` · steps **`10`** · split **`6`** · CFG **`3.0`** / **`1.0`** |
| Save prefix | `DGXSpark-NEXT-standard-available-models` |
| **`Flux2KleinEnhancer`** | **使用しない** |

**意図**: Ubuntu 成功側で有効だった **ReferenceLatent · 2 段サンプラー · r128 · SNOFS** を維持しつつ、**現在ディスクにあるファイルだけ**で実行経路を構成する。破綻防止の妥協版ではなく、以降の改善（プロンプト追随・base-edit 寄せ）の **1 本の基準線**とする。

**配置（DGX 実測）**:

```text
/opt/ComfyUI/user/default/workflows/0531_flux2_klein_9b_DGXSpark_NEXT_standard_available_models.json
/opt/ComfyUI/input/0531_flux2_klein_9b_DGXSpark_NEXT_standard_available_models.json  # 参照用コピー可
```

**ユーザー評価（2026-05-31）**: まだ改善点はあるが **大幅に改善**。最終状態ではない — 今後は **破綻防止よりプロンプト追随・構図・参照画像・公式 base-edit 構成**を主眼にする。

### Web / コミュニティ調査の要点（2026-05-31 整理）

- FLUX.2 Klein 9B は **base / distilled / fp8 / nvfp4 の混同**を避ける。
- 公式寄りの 9B base では **~20 steps** テンプレートがある場合がある（本基準線は引き続き **10 / split 6** で実測改善済み — 変更時は 1 要素ずつ）。
- Klein は **プロンプトを明示的**に書く必要がある。
- 参照画像は **大きすぎない**方が安定しうる。
- DGX Spark では **mmap / pinned memory / dynamic VRAM / aarch64・sm_121 向け custom node** の影響を疑う。
- **`Flux2KleinEnhancer` は DGX で最も疑わしい**（Enhancer 単独追加で破綻再現済み）。

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

### 1. 基準線 workflow（2026-05-31 以降の正本）

**正本**: **`0531_flux2_klein_9b_DGXSpark_NEXT_standard_available_models.json`**（構成は上記 §2026-05-31）。リポジトリ: [`scripts/dgx-private-comfyui/workflows/`](../../scripts/dgx-private-comfyui/workflows/)。

**運用ルール**:

- **似た名前の workflow を量産しない**。基準線を **1 本**決め、派生する場合は **意図を KB / コミットメッセージに明記**する。
- 変更は **1 要素ずつ**（seed・prompt・LoRA 強度・解像度など）で比較する。

### 2. レガシー workflow（2026-05-25・参照用・そのまま実行しない）

| ファイル | 状態（2026-05-31） |
|----------|---------------------|
| `0525_flux2_klein_9b_DGXSpark_photoreal_nvfp4.json` | **モデル参照ずれ**（fp8mixed CLIP・r64 未配置など）。履歴・意図の参照のみ |
| `0525_flux2_klein_9b_DGXSpark_fixed_no_enhancer.json` | fp8 / fp8mixed / r64 未配置 |
| `0525_flux2_klein_9b_DGXSpark_photoreal_tuned.json` | 同上系。写真寄せ tuning の記録用 |

**2026-05-25 時点の tuning 意図**（基準線に引き継ぎ済みのものは §2026-05-31 を優先）:

| 項目 | Ubuntu / 旧値 | DGX 基準線（0531） |
|------|----------------|-------------------|
| Turbo r64 | 0.15（Ubuntu）/ 0.08（KB 案） | **0.0（無効・ファイル未配置）** |
| Turbo r128 | 1.0 → **0.45** | **0.45** |
| SNOFS | 0.8 → **0.35** | **0.35** |
| CFG（1段目） | 3.5 → **3.0** | **3.0** |
| UNET | fp8 → **nvfp4** | **nvfp4** |
| CLIP | fp8mixed | **bf16**（実在ファイル） |

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

## 解決済み状態

### 2026-05-25（破綻除去・速度）

```text
ComfyUI は DGX 上で正常動作
Klein 9B / LoRA / ReferenceLatent は正常
破綻原因は Flux2KleinEnhancer と判明 → 除去 workflow で解消
NVFP4 + photoreal tuning で 3分台まで改善（1248×1824）
```

### 2026-05-31（実在モデル整合・大幅改善）

```text
0525 標準 workflow と DGX ディスク上のモデル配置がズレていることを確認
0531 基準線 workflow を作成（実在ファイルのみ・SNOFS 0.35・Enhancer なし）
ユーザー評価: 大幅改善（プロンプト追随は今後の主課題）
```

### 2026-06-12〜13（方向転換・Phase 1 完了）

#### 迷走の根本原因（再確認）

| 誤った前提 | 正しい理解 |
|------------|------------|
| `flux2_klein_9b_bloodforce88_snofs …` を「Ubuntu 成功版＝画像編集」とみなした | 実体は **EmptyFlux2Latent 起点の txt2img + 弱い ReferenceLatent**。入力画像を編集する workflow ではない |
| FLUX.2 Klein で顔保持編集を無理やり実現 | **Qwen-Image-Edit-2511**（編集専用）が本来の経路。`TextEncodeQwenImageEditPlus` + 入力 latent 起点 img2img |
| 0612 着せ替え系（head-mask / inpaint / FaceSwap / PuLID 混在）を主経路に | いずれも **貼り絵化・板挟み・空 latent 新規生成** で失敗。**再試行しない**（下表） |

#### 切り分けで確定した知見（2026-06-12〜13）

| 事象 | 原因 | 対処 |
|------|------|------|
| NVFP4 が効かず遅い | `flux-2-klein-base-9b-fp8.safetensors` が **bf16 への symlink**（ログ `19581MB loaded`） | UNET を `flux-2-klein-base-9b-nvfp4.safetensors` に変更 → `5540MB loaded`。`--bf16-unet` は付けない |
| bloodforce88 がモザイク | NVFP4/bf16 いずれでも再現。最小 txt2img は正常 | DGX 基盤は健全。**複雑 2 パス構成側**が破綻。FLUX 基準線 `0531_…` は txt2img+参照用として維持 |
| 0612 tryon / candidate 系 | 画面全体を動かす道具で部位別編集を denoise ノブだけで配分 | **不採用**。Phase 2 へ進む前に Phase 1（単一画像編集）を公式テンプレートで確立 |

#### 失敗した候補（再試行しない）

| 経路 | 結果 | 共通原因 |
|------|------|----------|
| 0612 tryon v1/v2/v3（head-mask + inpaint + FaceSwap） | 貼り絵化・ポーズ元顔残存・pose 崩れ | img2img denoise だけで部位別強度を配分できない |
| candidate A / A2（Qwen 小マスク低 denoise） | 板挟み・マスク跡 | 同上 |
| candidate B（FLUX + PuLID + ReferenceLatentPlus） | ReferenceLatentPlus **未導入**で実行不可 | — |
| candidate C / C2 / C3（FLUX + PuLID img2img） | 空 latent 新規生成 or ポーズ画像素通り | 顔 ID が乗らない |
| bloodforce88 NVFP4 / bf16 | モザイク | DGX で複雑 2 パスが破綻 |

#### Phase 1 完成（2026-06-13・画像編集の正本）

**正本 workflow**: [`scripts/dgx-private-comfyui/workflows/phase1_qwen_edit_2511_dgx_flat.json`](../../scripts/dgx-private-comfyui/workflows/phase1_qwen_edit_2511_dgx_flat.json)

[ComfyUI 公式 Qwen-Image-Edit-2511 テンプレート](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511) を **単一画像編集用にフラット展開**した版。サブグラフ・参照画像 2 枚前提を外し、API/UI ドロップ実行可能。

| 項目 | 値 |
|------|-----|
| UNET | `qwen_image_edit_2511_bf16.safetensors` |
| CLIP | `qwen_2.5_vl_7b_fp8_scaled.safetensors` |
| VAE | `qwen_image_vae.safetensors` |
| LoRA | `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` strength `1.0` |
| 前処理 | `LoadImage` → `FluxKontextImageScale` → `TextEncodeQwenImageEditPlus`（image1）+ `VAEEncode` |
| サンプル | `ModelSamplingAuraFlow` shift `3.1` · `CFGNorm` `1.0` · **KSampler** steps `4` · cfg `1.0` · euler · simple · **denoise `1.0`** |
| 起点 | **`VAEEncode` → `KSampler.latent_image`**（入力画像 latent から img2img） |
| 入力 | 1 枚（例: `DSC07559.JPG` を `/opt/ComfyUI/input/` に配置） |

**検証（2026-06-13・ComfyUI UI ドロップ実行）**:

| 項目 | 結果 |
|------|------|
| プロンプト例 | 「彼女を笑顔にする。顔の特徴と構図はそのまま保つ。」 |
| 出力 | **プロンプト通りに編集成功**（顔・構図保持） |
| 所要時間 | cold 約 **4 分台** / warm 約 **2 分 30 秒**（フォーラム実測と整合） |
| モデル | 上記 4 ファイルは DGX に **ファイル名完全一致で実在**（追加取得不要） |
| ノード | `TextEncodeQwenImageEditPlus` は ComfyUI **0.22.0 コア**（custom node 不要） |

**DGX 配置**:

```text
/opt/ComfyUI/user/default/workflows/phase1_qwen_edit_2511_dgx_flat.json
/opt/ComfyUI/input/DSC07559.JPG   # 例。通常 cp は権限エラー → docker cp で配置
```

**環境メモ（2026-06-13）**: swap 起動時 **72% 使用**。`sudo swapoff -a` は未実施（速度影響の可能性）。ComfyUI **0.22.0** / commit `0077d78`。

#### 2026-06-12 調査で残した知見（Phase 2 向け）

- **PuLID**: identity-only probe でも別人化 → 顔 ID 主経路として不採用（FLUX 側モザイク経緯あり）
- **InsightFace swap**: 方向性はあるが眼鏡・髪・顔つき保持が弱い
- **Qwen 2 画像入力**: 複数人物融合・キャラ一貫性が強い → Phase 2B 第一候補（image2 に差し替え顔）
- **ID 画像**: 全身を渡すと作業着までコピー → face-only crop が前提

## 今後の改善候補（優先順・2026-06-13）

| 優先 | 内容 |
|------|------|
| 1 | **Phase 1 固定**: `phase1_qwen_edit_2511_dgx_flat.json` を単一画像編集の正本とする |
| 2 | **Phase 2B（顔 ID 差し替え）**: 公式 2 画像テンプレートへ image2（差し替え顔）を追加し Qwen 経路で検証 |
| 3 | **Phase 2A（速度）**: `swapoff` · UMA cache flush · [Triplany/comfyui-dgx-spark](https://github.com/Triplany/comfyui-dgx-spark) · [comfy-aimdo 0.3.0](https://github.com/Comfy-Org/comfy-aimdo/releases/tag/v0.3.0) |
| 4 | **Phase 2C（運用）**: 入力画像/プロンプト差し替え容易化、解像度・denoise ノブ整理 |
| 5 | FLUX 基準線 `0531_…` は **txt2img+参照** 用として維持。Enhancer は再導入しない |

| 不足モデル（任意・比較用） | 備考 |
|---------------------------|------|
| `qwen_3_8b_fp8mixed.safetensors` | 旧 0525 CLIP。戻したら **0531 との A/B** |
| `klein_9B_Turbo_r64.safetensors` | r64 有効化の A/B |
| `flux-2-klein-base-9b-fp8.safetensors` | fp8 UNET 比較 |

| その他 | 内容 |
|--------|------|
| 解像度別 | 品質 **1248×1824** / 速度 **1024×1536** / **896×1344**（**別 workflow を増やさず**、基準線を複製して名前を付け替える場合は意図を明記） |
| Flux2KleinEnhancer | **通常運用に戻さない**。再検証は基準線 + **Enhancer のみ追加**でログ・出力を保存 |

### Enhancer 再検証時の注意

- Ubuntu では成功 workflow に含まれていたが、**DGX では Enhancer 追加で破綻再現**。
- DGX Spark / aarch64 / CUDA sm_121 / ComfyUI 0.22 との組み合わせで不安定な可能性。
- 再検証は **明示的な実験目的**がある場合のみ。本番基準線には戻さない。

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
2. Pi5（任意）: `curl -sS -o /dev/null -w '%{http_code}' http://100.118.82.72:38081/private-comfyui/health` → **200**（gateway 経路）
3. Mac: SSH トンネル後 `curl -I http://127.0.0.1:8188` → **200**（[KB-378](./KB-378-dgx-private-comfyui-mac-ssh-access.md)）
4. コンテナ内: `ls` で **workflow が参照する safetensors が実在**すること（§2026-05-31 の一覧と突合）
5. ComfyUI ログに **model not found / dtype mismatch** が無い
6. **Enhancer ノードが無い**こと（または使用しないこと）
7. 同一 prompt/seed で **破綻なし**・**プロンプト追随**・生成時間を記録
8. 業務 vLLM 再開時は **メモリ占有**を `nvidia-smi` で確認

## Prevention

- **破綻時**: `Flux2KleinEnhancer` の有無 → **モデルファイルの実在** → 0525 系レガシー JSON を誤って読み込んでいないか。
- **追随低下時**: CFG/steps だけでなく **CLIP/UNET の実体・参照画像サイズ・LoRA 強度**を確認（破綻防止だけを最終目的にしない）。
- `docker compose restart` ではなく **`up -d --force-recreate`**（起動フラグ反映）。
- workflow のモデル名は **実ファイル名**に一致（`fp8`/`bf16`/`nvfp4` 混在参照を残さない）。
- **workflow を増やしすぎない** — 基準線 1 本 + 明示的な実験ブランチ。
- 速度改善は SSH 経路より **解像度・量子化（NVFP4）・vLLM 停止**を優先して切り分ける。

## 別 AI / オペレータへの依頼テンプレ

```text
DGX Spark 上の Private ComfyUI（コンテナ dgx-private-comfyui）。

【画像編集 Phase 1 正本】
phase1_qwen_edit_2511_dgx_flat.json
（リポジトリ scripts/dgx-private-comfyui/workflows/ に同梱）
Qwen Image Edit 2511 bf16 + Lightning 4step、単一入力 img2img。
検証済み: プロンプト編集で顔・構図保持、cold ~4min / warm ~2.5min。

【FLUX txt2img+参照 基準線（編集用途ではない）】
0531_flux2_klein_9b_DGXSpark_NEXT_standard_available_models.json
UNET nvfp4 / CLIP bf16 / Enhancer 禁止。

0612 tryon / candidate 系は失敗済み。再試行しない。
次: Phase 2B 顔 ID 差し替え（Qwen image2 経路優先）、Phase 2A 速度最適化。
Pi5 gateway health OK。コンテナ内作業は Mac→DGX SSH。workflow 配置は docker cp。
```

## References

- [Runbook: dgx-private-comfyui.md](../runbooks/dgx-private-comfyui.md)
- [KB-378](./KB-378-dgx-private-comfyui-mac-ssh-access.md)
- [KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)
- [`scripts/dgx-private-comfyui/README.md`](../../scripts/dgx-private-comfyui/README.md)
- NVIDIA: [Comfy UI Instructions](https://build.nvidia.com/spark/comfy-ui/instructions)
- [ComfyUI 公式 Qwen-Image-Edit-2511](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511)
- [NVIDIA Forums: My Comfyui setup and patches](https://forums.developer.nvidia.com/t/my-comfyui-setup-and-patches/368344)
- 移行作業の元メモ（外部）: `DGX_Spark_ComfyUI_FLUX2_Klein9B_migration_notes.md`（2026-05-24/25 作業ログ）
