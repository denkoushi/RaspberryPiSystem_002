---
title: Runbook DGX Spark private ComfyUI（コンテナ・Tailscale）
tags: [運用, DGX Spark, ComfyUI, Docker, Tailscale, private-personal]
audience: [運用者, 開発者]
last-verified: 2026-04-29
related:
  - ../plans/dgx-spark-local-llm-migration-execplan.md
  - ../../scripts/dgx-private-comfyui/README.md
  - local-llm-tailscale-sidecar.md
  - dgx-system-prod-local-llm.md
category: runbooks
update-frequency: medium
---

# Runbook: DGX Spark private ComfyUI（コンテナ・Tailscale）

## 目的

- **私用**の ComfyUI を **`private-personal`** 領域のコンテナだけで実行する。
- **業務用 `system-prod` LocalLLM** のトークン・ログ・データパスと **混入しない**。
- **インターネットや LAN への無認証公開をしない**。Mac からは **Tailscale + SSH ポートフォワード**で UI に届ける。

## 前提

- DGX Spark 上に Docker と NVIDIA Container Toolkit が使える（`docker run --gpus=all … nvidia-smi` が成功）。
- 用途別ネットワーク `dgx_private_personal_net` が存在する（無ければ `docker network create dgx_private_personal_net`）。
- データルートは **`/srv/dgx/private-personal/`** 配下のみをマウントする。

## 禁止・非推奨

- **`/srv/dgx/system-prod/**` をこの Compose にマウントしない**（混入防止）。
- **`0.0.0.0` で LAN 全域に ComfyUI を晒さない**（既定の compose 雛形は **127.0.0.1 バインド**）。
- Playbook 相当の **認証無し URL をそのまま tailnet 全体に広げない**（必要なら別途 Basic 認証や Tailscale ACL で限定する）。

## 導入（リポジトリ雛形）

手順の正本: **[scripts/dgx-private-comfyui/README.md](../../scripts/dgx-private-comfyui/README.md)**

概要:

1. `compose.yaml.example` → `compose.yaml`、`Dockerfile.example` → `Dockerfile`、`.env.example` → `.env`
2. `./start-private-comfyui.sh`
3. DGX 上で `curl -I http://127.0.0.1:8188` が応答すること

## Mac ブラウザから使う（Tailscale + SSH）

**推奨**: Mac から DGX の tailnet アドレスへ SSH し、ローカル `8188` を DGX のループバックへ転送する。

```bash
ssh -N -L 8188:127.0.0.1:8188 <dgx_user>@<dgx_tailscale_ip_or_magicdns>
```

ブラウザで `http://127.0.0.1:8188` を開く。

別ユーザ・別マシンへ広げる場合は **ACL・認証・HTTPS 終端**を別途設計する（本 Runbook の既定範囲外）。

## 検証チェックリスト（受け入れ）

実機で順に確認する。

1. **分離**: `docker compose config`（または `docker inspect dgx-private-comfyui`）で **`/srv/dgx/system-prod` が volume に無い**こと。
2. **GPU**: コンテナ内から推論実行時に `nvidia-smi` でプロセスが見える（または ComfyUI の生成が成功する）。
3. **ループバックのみ**: ホストで `ss -lntp | grep 8188` が **`127.0.0.1:8188`** になっていること。
4. **Mac UI**: 上記 SSH フォワード後、`http://127.0.0.1:8188` でワークフロー編集・実行ができる。
5. **業務推論との競合**: 重いモデル利用時に Pi5→DGX の **`on_demand` LocalLLM** とタイミングが被る場合、どちらかが失敗・遅延しないかを観測（必要なら時間帯を分ける）。

## トラブルシュート（公式 Playbook との対応）

| 症状 | 典型原因 | まず試すこと |
|------|-----------|----------------|
| GPU が見えない | NVIDIA Container Toolkit / `--gpus` | `docker run --rm --gpus=all nvcr.io/nvidia/cuda:13.0.1-devel-ubuntu24.04 nvidia-smi` |
| `pip install` でビルド失敗（PyOpenGL 等） | dev ヘッダ不足 | `Dockerfile` に `python3-dev` と `build-essential` が入っているか確認（雛形では含有） |
| ブラウザが開けない | ポート転送・バインド | DGX で `curl -I http://127.0.0.1:8188`、Mac の SSH `-L` が生きているか |
| メモリ関連の不安定さ | UMA / キャッシュ | User Guide / Playbook の `drop_caches` は **運用上の最終手段**として慎重に |

## 参照

- NVIDIA Playbook（手順の前提）: [Comfy UI Instructions](https://build.nvidia.com/spark/comfy-ui/instructions)
- 多用途分離の全体文脈: [dgx-spark-local-llm-migration-execplan.md](../plans/dgx-spark-local-llm-migration-execplan.md)
- LocalLLM と VRAM 競合の背景: [local-llm-tailscale-sidecar.md](./local-llm-tailscale-sidecar.md)
- 業務側 DGX Runbook: [dgx-system-prod-local-llm.md](./dgx-system-prod-local-llm.md)
