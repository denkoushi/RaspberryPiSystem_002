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

## データの置き場所

既定 (`COMFYUI_DATA_ROOT`) は次を想定しています。

- `models/` … チェックポイント・LoRA 等（例: Playbook の SD1.5 は `models/checkpoints/`）
- `input/` / `output/` / `user/` … ComfyUI の入出力とユーザー状態

**`/srv/dgx/system-prod` はマウントしないでください。**

## Tailscale 経由で Mac ブラウザから使う（推奨）

`compose.yaml` では **`127.0.0.1:${COMFYUI_PORT:-8188}` のみ** にポート公開しています（LAN 全域へのバインド回避）。

Mac からは **SSH ポートフォワード** でローカルブラウザへ載せ替えます。

```bash
ssh -N -L 8188:127.0.0.1:8188 <user>@<dgx-tailscale-ip-or-dns>
```

ブラウザ: `http://127.0.0.1:8188`

詳細・境界・検証項目は Runbook **[dgx-private-comfyui.md](../../docs/runbooks/dgx-private-comfyui.md)** を参照。

## Private と LocalLLM（VRAM）

同一 GPU 上では **`llama-server` 常駐 + ComfyUI** で VRAM が競合し得ます。本番系は Pi5 側で **`on_demand`** を前提にしているため、私用 ComfyUI を重く動かすときは業務推論の実行状況に注意してください（過去の Ubuntu 時代の観測: `docs/runbooks/local-llm-tailscale-sidecar.md`）。
