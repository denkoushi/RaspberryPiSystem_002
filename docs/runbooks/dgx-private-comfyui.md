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

## 標準アクセス経路（これ以外は運用禁止）

ComfyUI のホスト公開は **`127.0.0.1:8188`（ループバック）のみ**とする。Mac から UI に届ける **唯一の標準経路**は次である。

1. Mac が **Tailscale（tailnet）** に参加し、DGX に SSH できること。
2. ローカル `8188` を DGX のループバックへ転送する:

```bash
ssh -N -L 8188:127.0.0.1:8188 <dgx_user>@<dgx_tailscale_ip_or_magicdns>
```

3. Mac のブラウザで **`http://127.0.0.1:8188`** を開く。

**運用禁止（「非推奨」ではなくやらない）**:

- ComfyUI を **`0.0.0.0`** で公開し、**LAN や実 LAN IP から直接**ブラウザで叩く。
- Tailscale を迂回した **広域・無認証公開**（当面は設計対象外）。
- **`/srv/dgx/system-prod/**` をこの Compose にマウントする**（混入防止）。
- Playbook 相当の **認証無し URL をそのまま tailnet 全体に広げる**（必要なら別途 Basic 認証や Tailscale ACL で限定する）。

## 導入（リポジトリ雛形）

手順の正本: **[scripts/dgx-private-comfyui/README.md](../../scripts/dgx-private-comfyui/README.md)**

概要:

1. `compose.yaml.example` → `compose.yaml`、`Dockerfile.example` → `Dockerfile`、`.env.example` → `.env`
2. `./start-private-comfyui.sh`
3. DGX 上で `curl -I http://127.0.0.1:8188` が応答すること

## 境界チェック（launcher が自動実行）

[`scripts/dgx-private-comfyui/boundary-check.sh`](../../scripts/dgx-private-comfyui/boundary-check.sh) は **ポリシーのみ**を担当する（単一責任）。

- **`COMFYUI_DATA_ROOT`**: **絶対パス**かつ **`/srv/dgx/private-personal` 配下のみ**（`..` 禁止。`system-prod` / `lab-experiments` 配下を指さない）。
- **解決済み Compose**: `docker compose … config` の出力に **`/srv/dgx/system-prod` または `/srv/dgx/lab-experiments`** が **ボリュームバインドとして現れたら起動失敗**。

`./start-private-comfyui.sh` は上記に加え **`docker network inspect`** で **`dgx_private_personal_net`**（または `.env` の `DGX_PRIVATE_NETWORK_NAME`）の存在を確認する。

## 検証チェックリスト（受け入れ・運用者が DGX で実施）

リポジトリ側では launcher の境界チェックとドキュメント整合まで。**実機の最終確認は運用者が DGX / Mac で実施**する（未実施の場合はチェックを空欄のままにしない）。

1. **自動境界**: `./start-private-comfyui.sh` が **`boundary-check` を通過**して compose が立ち上がること。
2. **分離**: `docker compose config`（または `docker inspect`）で **`/srv/dgx/system-prod` が volume に無い**こと（`boundary-check` と整合）。
3. **GPU**: コンテナ内から推論実行時に `nvidia-smi` でプロセスが見える（または ComfyUI の生成が成功する）。
4. **ループバックのみ**: ホストで `ss -lntp | grep 8188` が **`127.0.0.1:8188`** になっていること。
5. **Mac UI（標準経路のみ）**: [標準アクセス経路](#標準アクセス経路これ以外は運用禁止) の SSH `-L` 経由で、`http://127.0.0.1:8188` でワークフロー編集・実行ができる。
6. **保存先**: 生成物・ユーザー状態が **`COMFYUI_DATA_ROOT`（`/srv/dgx/private-personal/…`）配下のみ**であること。
7. **業務推論との競合**: 重いモデル利用時に Pi5→DGX の **`on_demand` LocalLLM** とタイミングが被る場合、どちらかが失敗・遅延しないかを観測（必要なら時間帯を分ける）。

別ユーザ・別マシンへ広げる場合は **ACL・認証・HTTPS 終端**を別途設計する（本 Runbook の既定範囲外）。

## 2026-04-29 実測結果

- **DGX 起動**: `/srv/dgx/private-personal/compose/dgx-private-comfyui` で `./start-private-comfyui.sh` 成功。
- **DGX 疎通**: `curl -I http://127.0.0.1:8188` は **`HTTP/1.1 200 OK`**。
- **公開面**: `ss -lnt` で **`127.0.0.1:8188`** のみ待受。
- **Mac 標準経路**: **`ssh -L 8188:127.0.0.1:8188`** でトンネル成功、Mac 側 `http://127.0.0.1:8188/` のページタイトルは **`ComfyUI`**。
- **保存先分離**: `COMFYUI_DATA_ROOT=/srv/dgx/private-personal/comfyui/data` 配下に `models/` `input/` `output/` `user/` を作成。`output/` は初期時点で空、`system-prod` への bind はなし。
- **未完了**: `models/checkpoints/` が空のため、**workflow の実行確認は未完了**。checkpoint 配置後に UI から実行し、生成物が `private-personal` 配下だけへ出ることを確認する。

## トラブルシュート（公式 Playbook との対応）

| 症状 | 典型原因 | まず試すこと |
|------|-----------|----------------|
| GPU が見えない | NVIDIA Container Toolkit / `--gpus` | `docker run --rm --gpus=all nvcr.io/nvidia/cuda:13.0.1-devel-ubuntu24.04 nvidia-smi` |
| `pip install` でビルド失敗（PyOpenGL 等） | dev ヘッダ不足 | `Dockerfile` に `python3-dev` と `build-essential` が入っているか確認（雛形では含有） |
| 初回 `docker compose build` が `Temporary failure resolving` で失敗 | DGX 側の一時 DNS 解決不安定 | DGX で `getent hosts ports.ubuntu.com` / `getent hosts developer.download.nvidia.com` を確認し、解決できる状態になってから `./start-private-comfyui.sh` を再実行する |
| ブラウザが開けない | ポート転送・バインド | DGX で `curl -I http://127.0.0.1:8188`、Mac の SSH `-L` が生きているか |
| Mac から DGX へ `ssh ...@100.x.x.x` が timeout | Tailscale ACL で `tag:admin -> tag:llm tcp:22` が未許可 | Tailscale ACL に一時許可を追加し、作業後は不要なら閉じる。鍵エラーなら `authorized_keys` も合わせて確認 |
| メモリ関連の不安定さ | UMA / キャッシュ | User Guide / Playbook の `drop_caches` は **運用上の最終手段**として慎重に |

## 参照

- NVIDIA Playbook（手順の前提）: [Comfy UI Instructions](https://build.nvidia.com/spark/comfy-ui/instructions)
- 多用途分離の全体文脈: [dgx-spark-local-llm-migration-execplan.md](../plans/dgx-spark-local-llm-migration-execplan.md)
- LocalLLM と VRAM 競合の背景: [local-llm-tailscale-sidecar.md](./local-llm-tailscale-sidecar.md)
- 業務側 DGX Runbook: [dgx-system-prod-local-llm.md](./dgx-system-prod-local-llm.md)
