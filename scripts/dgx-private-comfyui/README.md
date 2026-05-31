# DGX Spark: private ComfyUI（コンテナ雛形）

`private-personal` 用途専用の **ComfyUI** を Docker で動かすための雛形です。  
業務用 **`system-prod` LocalLLM** のディレクトリ・シークレット・ログとは **マウントもネットワークも共有しません**。

## 公式準拠の考え方

NVIDIA の Playbook（ホスト直インストール）は次を前提とします。

- PyTorch **CUDA 13.0**（`cu130` wheel）
- ComfyUI を GitHub から取得し `requirements.txt` を導入

本ディレクトリの **`Dockerfile.example`** は上記に沿ってコンテナ内に閉じています（参考: [Comfy UI \| DGX Spark](https://build.nvidia.com/spark/comfy-ui/instructions)）。

## レイヤ分担（疎結合）

| 役割 | 置き場所 |
|------|-----------|
| ビルド・ランタイム | `Dockerfile`（`Dockerfile.example` からコピー） |
| オーケストレーション | `compose.yaml`（`compose.yaml.example` からコピー） |
| ホスト固有値 | `.env`（`.env.example` からコピー） |
| 起停の入口 | `start-private-comfyui.sh` / `stop-private-comfyui.sh` |

## DGX ホストでの初回セットアップ

1. このリポジトリを DGX に同期する（または tarball で配置）。
2. `scripts/dgx-private-comfyui/` に移動。
3. コピーして編集:

```bash
cp compose.yaml.example compose.yaml
cp Dockerfile.example Dockerfile
cp .env.example .env
# COMFYUI_DATA_ROOT は必ず /srv/dgx/private-personal/ 配下にする
```

4. **用途別ネットワーク**が無ければ作成（ExecPlan で定義済みの名前に合わせる）:

```bash
docker network create dgx_private_personal_net
```

5. GPU ランタイム確認（User Guide 準拠の例）:

```bash
docker run --rm --gpus=all nvcr.io/nvidia/cuda:13.0.1-devel-ubuntu24.04 nvidia-smi
```

6. 起動:

```bash
./start-private-comfyui.sh
```

7. DGX **本体では** `curl -I http://127.0.0.1:8188` が `HTTP/1` で応答することを確認。

## DGX Spark 追加最適化（推奨）

### ComfyUI ランタイム

`compose.yaml.example` の既定 command（**2026-05-25・FLUX.2 Klein 9B NVFP4 workflow 実測**）:

- `--disable-dynamic-vram`
- `--reserve-vram 8`
- `--disable-pinned-memory`
- `--disable-mmap`

環境変数は `.env` で次を指定します（既定値あり）。

- `CUDA_CACHE_MAXSIZE=4294967296`
- `NCCL_P2P_DISABLE=1`
- `PYTORCH_NO_CUDA_MEMORY_CACHING=1`（任意。compose 雛形では既定 `1`）

**基準線 workflow**（2026-05-31 以降・ComfyUI にインポート）: [`workflows/0531_flux2_klein_9b_DGXSpark_NEXT_standard_available_models.json`](./workflows/0531_flux2_klein_9b_DGXSpark_NEXT_standard_available_models.json)。**`Flux2KleinEnhancer` は使わない**。レガシー `0525_…` は **モデル未配置と参照ずれ**のためそのまま使わない（[KB-379 §2026-05-31](../../docs/knowledge-base/KB-379-dgx-private-comfyui-nvfp4-migration-and-workflow-tuning.md#2026-05-31-現状確認実機モデル配置基準線-workflow)）。

**Pi5 からの疎通**: `http://<dgx_tailnet>:38081/private-comfyui/health`（gateway）。**コンテナ内の workflow 更新は Mac→DGX 管理 SSH**（Pi5→DGX SSH は現行 ACL で不可 — Runbook 追補）。

`--use-sage-attention` は導入済み環境でのみ有効化してください（未導入で付けると起動失敗）。

**過去の `--bf16-unet` 系**: fp8 NaN 由来モザイク対策用。NVFP4 標準 workflow では必須ではない。

### safetensors コピー最小化

`Dockerfile.example` は ComfyUI の `comfy/utils.py` にある `copy=True` を `copy=False` に置換するパッチを build 時に適用します。  
DGX Spark の unified memory で不要コピーを抑え、メモリ圧迫を避ける目的です。

遅延要因の切り分けと NVFP4 移行手順は [KB-379](../../docs/knowledge-base/KB-379-dgx-private-comfyui-nvfp4-migration-and-workflow-tuning.md) を参照してください。

### ホスト側（DGX）安定化手順

電力スパイクとスワップ由来の不安定化を避けるため、DGX ホスト側で次を実施します。

```bash
sudo swapoff -a
echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
sudo nvidia-smi -pm 1
sudo nvidia-smi -lgc 300,2100
```

## データの置き場所

既定 (`COMFYUI_DATA_ROOT`) は次を想定しています。

- `models/` … チェックポイント・LoRA 等（例: Playbook の SD1.5 は `models/checkpoints/`）
- `input/` / `output/` / `user/` … ComfyUI の入出力とユーザー状態

**`/srv/dgx/system-prod` はマウントしないでください。**

## 境界チェック（自動）

[`boundary-check.sh`](./boundary-check.sh) は **`start-private-comfyui.sh` / `stop-private-comfyui.sh` から読み込まれ**、起動前に次を検証します。

- **`COMFYUI_DATA_ROOT`** が **`/srv/dgx/private-personal` 配下の絶対パス**であること（`..` 禁止。`system-prod` / `lab-experiments` を指さないこと）。
- **`docker compose … config`** で解決した設定に **`/srv/dgx/system-prod` または `/srv/dgx/lab-experiments` のホストバインドが含まれない**こと。

ポリシー変更は **このスクリプトと Runbook** に集約し、compose 側はデータルート変数のみを参照する形を維持します。

## Tailscale 経由で Mac ブラウザから使う（標準経路・これ以外は運用禁止）

`compose.yaml` では **`127.0.0.1:${COMFYUI_PORT:-8188}` のみ** にポート公開しています（**LAN 全域 `0.0.0.0` バインドは運用禁止**。ループバックのみ）。

Mac は **SSH ポートフォワードで「Mac の `127.0.0.1` と DGX の `127.0.0.1:8188`」を繋ぐ**必要があります（**転送無しではブラウザの `127.0.0.1` は Mac 側の空ポート**で、仕様どおり）。

### 手順の順番（省略しない）

1. **Tailscale が通る状態**で、**転送を張る SSH を先に開始**して **終了させないでおく**:

   ```bash
   ssh -N -L 8188:127.0.0.1:8188 -i ~/.ssh/id_ed25519_raspi ubudgxkoushi@100.118.82.72
   ```

   **`ssh -N -L`** は転送のみのため **標準出力に何も出ずプロンプトが戻らないのが通常**（異常ではない）。
2. **別ターミナル**: `curl -I http://127.0.0.1:8188` が **`200`** であることを確認。
3. **ブラウザ**: `http://127.0.0.1:8188`。

**実例の値と「コピペしてはならないプレースホルダ」を混同しない**こと（`<user>@<host>` で zsh が `parse error` になる）。

**詳細・切り分け表・運用コンソール `private_ok` と独立である旨**: Runbook **`[dgx-private-comfyui.md](../../docs/runbooks/dgx-private-comfyui.md)`**、ナレッジ **[KB-378](../../docs/knowledge-base/KB-378-dgx-private-comfyui-mac-ssh-access.md)**。

## Private と LocalLLM（VRAM）

同一 GPU 上では **`llama-server` 常駐 + ComfyUI** で VRAM が競合し得ます。本番系は Pi5 側で **`on_demand`** を前提にしているため、私用 ComfyUI を重く動かすときは業務推論の実行状況に注意してください（過去の Ubuntu 時代の観測: `docs/runbooks/local-llm-tailscale-sidecar.md`）。
