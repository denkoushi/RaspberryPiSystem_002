---
title: Runbook DGX Spark private ComfyUI（コンテナ・Tailscale）
tags: [運用, DGX Spark, ComfyUI, Docker, Tailscale, private-personal]
audience: [運用者, 開発者]
last-verified: 2026-05-17
related:
  - ../plans/dgx-spark-local-llm-migration-execplan.md
  - ../../scripts/dgx-private-comfyui/README.md
  - ../knowledge-base/KB-378-dgx-private-comfyui-mac-ssh-access.md
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

ComfyUI のホスト公開は **`127.0.0.1:8188`（ループバック）のみ**とする。**Mac のブラウザが指す `http://127.0.0.1:8188` は「Mac自身のループバック」であり、転送無しでは DGX 上の ComfyUI に届かない**。Mac から UI に届ける **唯一の標準経路**は次である（**順序このとおり**。先にトンネル、後からブラウザ）。

### 実行順序（必須）

1. Mac が **Tailscale（tailnet）** に参加し、DGX に **`ssh tcp/22`** で到達できること（環境により **ACL で `tcp:22` が一時許可**が必要。**`timeout`** と **`Connection refused`** は別物。詳細は [KB-378](../knowledge-base/KB-378-dgx-private-comfyui-mac-ssh-access.md)）。
2. **トンネル用ターミナルを 1 本開いたままにする**。ローカル `8188` を DGX のループバックへ転送する。**プレースホルダの `<` と `>` をシェルに入力しない**。次は **環境依存の値を埋めた実例のみ**である：

   ```bash
   ssh -N -L 8188:127.0.0.1:8188 -i ~/.ssh/id_ed25519_raspi ubudgxkoushi@100.118.82.72
   ```

   - **tailnet の例として文書記録にある IPv4**: `100.118.82.72`。**実環境では `tailscale ip -4`（DGX側）または管理画面で確認**し、漂移したらこの Runbook を更新する運用でもよい。
   - **鍵ファイル**は自分の環境に合わせる（複数ホスト運用では `~/.ssh/config` で `IdentityFile` / `LocalForward` を固定してよい）。
3. **別のターミナル**またはブラウザで次を確認してから UI を開く：

   ```bash
   curl -I http://127.0.0.1:8188
   ```

4. ブラウザで **`http://127.0.0.1:8188`** を開く（ローカル側ポートを **`18188:127.0.0.1:8188`** のようにずらしたときは **`http://127.0.0.1:18188`** で **同じ順序**）。

### `ssh -N -L …` が「止まっている」ように見える件（正常）

- **`-N` はログインシェルを開かない**ため、転送だけが成功している場合 **標準出力に何も出ずプロンプトが戻らない**。これが **正常**。別ターミナルでの `curl` / ブラウザが唯一の確認手段。
- **「別のアプリ経由でも開けていた」ように見える**場合、多くは **ほかのターミナルまたはバックグラウンドで同名のトンネルが生存している**だけ。**切り分け**: すべての関連 `ssh` を切断（トンネル端末で `Ctrl+C`）後、**ブラウザを再読込**し **`127.0.0.1:8188` が不通になる**ことを確認すると、**標準経路は SSH 転送依存**であると実証できる。

### LAN IP（例 `192.168.128.x`）で `Connection refused`

- **ACL を閉じた tailnet と無関係**な経路で **LAN の実 IP に `ssh`** すると、環境により **ポート 22 が listen しない**運用になり **`Connection refused`** になり得る。まず **`sshd` と listen** を本体で確認（手順・ACL は [KB-357](../knowledge-base/infrastructure/security.md)）。
- **`Private Pi5` を Tailscale に追加したことそのものが、単独の直接原因となることは一般的に期待しない**。拒否／タイムアウトは **到達経路と DGX側のSSH待受の組合せ**で説明する。

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

## DGX Spark 最適化プロファイル（2026-04 反映）

`scripts/dgx-private-comfyui/compose.yaml.example` は DGX Spark 前提で次を既定化しています。

- `--bf16-unet`
- `--bf16-vae`
- `--bf16-text-enc`
- `--disable-dynamic-vram`

`.env` では以下を使う。

- `CUDA_CACHE_MAXSIZE=4294967296`
- `NCCL_P2P_DISABLE=1`

`--use-sage-attention` は環境に導入済みの場合のみ追加する（未導入では起動失敗）。

### safetensors コピー回避パッチ

`Dockerfile.example` は build 時に `comfy/utils.py` の `copy=True` を `copy=False` へ置換する。  
DGX Spark の unified memory での不要コピー抑制を狙う。

### DGX ホスト安定化（運用時）

```bash
sudo swapoff -a
echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
sudo nvidia-smi -pm 1
sudo nvidia-smi -lgc 300,2100
```

上記はホスト運用設定のため、Compose 内ではなく DGX ホストで実施する。

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

## 2026-05-01 追補（外出先運用・接続復旧・workflow エラー切り分け）

- **ComfyUI 稼働確認**: DGX 上 `docker ps` で `dgx-private-comfyui` は `Up`、`curl -I http://127.0.0.1:8188` は **`HTTP 200`**。
- **SSH トンネル運用**:
  - `ssh -N -L ...` は **標準出力が出ないのが正常**。疎通確認は別ターミナルで `curl -I http://127.0.0.1:8188`。
  - `bind [127.0.0.1]:8188: Address already in use` は、**DGX 上で `ssh -L` してしまった**ときに発生する（トンネルは Mac 側で張る）。
- **外出先での接続差**:
  - Mac ではパスワード SSH が通るが、AI 実行環境は非対話のため `publickey` が必須。
  - DGX 側 `~/.ssh/authorized_keys` に AI 実行環境の公開鍵を追加すると、`BatchMode` で接続復旧できる。
- **workflow エラー（ログ実測）**:
  - `Flux2KleinEnhancer.mid_layer_scale` に文字列 `linear` が入り、`FLOAT` 変換失敗。
  - `UNETLoader` / `CLIPLoader` が `fp8` と `bf16` の不一致で検証失敗。
  - `Node 'Note' not found` は、当該カスタムノード未導入が原因。
- **2026-05-01 実施対策（暫定互換ホットフィックス）**:
  - `Flux2KleinEnhancer` の `mid_layer_scale` を `STRING` 許容にし、`linear` を `1.0` として扱う互換変換を追加。
  - `Note` 互換 custom node（`note_compat.py`）を追加し、古い workflow の `class_type: Note` を受理可能化。
  - モデル名互換 alias を追加（`flux-2-klein-base-9b-fp8.safetensors` / `qwen_3_8b_fp8mixed.safetensors`）。
- **モデル実体（2026-05-01 実測）**:
  - `diffusion_models`: `flux-2-klein-base-9b-bf16.safetensors`
  - `text_encoders`: `qwen_3_8b_bf16.safetensors`
  - したがって loader は **bf16 側へ揃える**のが正。
- **補足**: `models/checkpoints/` が空でも、今回の Flux2Klein 系 workflow は `diffusion_models` / `text_encoders` 参照のため、直接原因ではない。

## 2026-05-17 追補（Mac 復旧での実機知見）

- **復旧コンテキスト**: 管理コンソール [`/admin/tools/dgx-resource`](../guides/deployment.md) で運用モードを **私用寄り（`private_ok`）へ切替**済み。**切替によって Mac→Comfy のネットワーク経路要件は変わらない**（GPU 競合許容のみ。業務側との VRAM は [KB-364](../knowledge-base/KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)）。
- **`zsh: parse error near '\n'`**: Runbook 旧表記の `<dgx_user>@<dgx_tailnet_ip>` を **`>` `<` を含めてそのまま貼った**ため。シェル上は **記号無しで実ユーザー・実 IP / MagicDNS を入力**すること（本節の実例）。
- **`Connection refused`（`192.168.128.156` 等・LAN の実 IP で `ssh`）**: 「tailnet が 22 を塞いでいる」より先に **`sshd がその経路・ポートで待受しているか`** を疑う。また **Tailscale と LAN は評価単位が別**（LAN refused が tailnet と同値とは限らない）。
- **`100.118.82.72`（tailnet）へ `ssh -N -L …` が「無応答」**: **正常系**（転送維持中）。 **`curl -I http://127.0.0.1:8188` が 200 → ブラウザでワークフロー表示**まで到達。
- **検証済み結論**: トンネル維持中のみ `http://127.0.0.1:8188` が開き、**`Ctrl+C` 後は開かない → SSH 転送が必須**であることを再確認。**「SSH が不要」の誤認**は別セッションの生存トンネルで説明できる。
- **ナレッジ正本**: [KB-378](../knowledge-base/KB-378-dgx-private-comfyui-mac-ssh-access.md)。

## 2026-05-17 追補2（生成品質/遅延と NVFP4 移行メモ）

- **モザイク/ゴミ出力**: `fp8` 経路での NaN 伝播が疑われるケースは、**`--bf16-unet`（+ `--bf16-vae` / `--bf16-text-enc`）**を優先し、workflow 側 `weight_dtype=default` と整合させる。
- **17分超の遅延**: DGX Spark UMA 条件での **safetensors 二重ロード/コピー**が主因になり得る。対策として **`--disable-mmap`** と **`copy=False` パッチ**を併用し、設定反映は **`docker compose up -d --force-recreate`** で行う。
- **高解像度時の遅さ**: 2048x3008 + 2pass + LoRA 3本 + bf16 は計算量が大きい。経路（SSH）ではなく **モデル量子化と workflow 設計**を見直す。
- **次タスク（推奨）**: FLUX.2 Klein 9B の **NVFP4** 版を取得し、UNET を段階的に差し替えて比較する。詳細手順は [KB-379](../knowledge-base/KB-379-dgx-private-comfyui-nvfp4-migration-and-workflow-tuning.md) を正本とする。

## トラブルシュート（公式 Playbook との対応）

| 症状 | 典型原因 | まず試すこと |
|------|-----------|----------------|
| GPU が見えない | NVIDIA Container Toolkit / `--gpus` | `docker run --rm --gpus=all nvcr.io/nvidia/cuda:13.0.1-devel-ubuntu24.04 nvidia-smi` |
| `pip install` でビルド失敗（PyOpenGL 等） | dev ヘッダ不足 | `Dockerfile` に `python3-dev` と `build-essential` が入っているか確認（雛形では含有） |
| 初回 `docker compose build` が `Temporary failure resolving` で失敗 | DGX 側の一時 DNS 解決不安定 | DGX で `getent hosts ports.ubuntu.com` / `getent hosts developer.download.nvidia.com` を確認し、解決できる状態になってから `./start-private-comfyui.sh` を再実行する |
| ブラウザが開けない | ポート転送・バインド | **トンネル用 `ssh -N -L …` が生きているか**。**別ターミナルで** `curl -I http://127.0.0.1:8188`。続けて DGX で `curl -I http://127.0.0.1:8188` が 200 か |
| **`zsh: parse error`** と `\n` | **`<dgx_user>` 等をそのまま貼っている**（`<>` はシェル構文になる） | **`<` `>` を含めず**ユーザー名・IP を実値に置換（本節 **実例**・[KB-378](../knowledge-base/KB-378-dgx-private-comfyui-mac-ssh-access.md)） |
| Mac から **`ssh …@LAN実IP` が `Connection refused`** | **`sshd` が待受しない**構成・サービス停止 | **tailnet と LAN は別判定**。DGX本機で `:22` listen・`ssh` service を確認。**tailnet側は通っても LAN refused は両立しうる** |
| 「開いていた UI が **`Ctrl+C` 後に開かなくなった」** | **転送のみのセッションを切断した**ため | **標準**。再度 `ssh -N -L …` を張る。**バックグラウンドの別 `ssh`** が無いか `ps`/Activity Monitor で確認 |
| Mac から DGX へ `ssh ...@100.x.x.x` が timeout | Tailscale ACL で `tag:admin -> tag:llm tcp:22` が未許可 | Tailscale ACL に一時許可を追加し、作業後は不要なら閉じる。鍵エラーなら `authorized_keys` も合わせて確認 |
| `ssh -N -L ...` 後に何も出ず止まって見える | トンネル専用モード（正常） | 別ターミナルで `curl -I http://127.0.0.1:8188` を実行し `200` を確認する |
| `bind [127.0.0.1]:8188: Address already in use` | DGX 上で `ssh -L` を実行している | トンネルは **Mac 側**で実行する。必要ならローカル側を `18188` など別ポートに変える |
| AI 実行環境からは `Permission denied (publickey,password)` だが、Mac 手動 SSH は成功 | AI 側は非対話実行でパスワード入力不可。公開鍵が DGX に未登録 | DGX の `~/.ssh/authorized_keys` に AI 実行環境の公開鍵を追加し、`ssh -o BatchMode=yes ...` で再確認 |
| メモリ関連の不安定さ | UMA / キャッシュ | User Guide / Playbook の `drop_caches` は **運用上の最終手段**として慎重に |
| 起動時に `--use-sage-attention` で失敗 | SageAttention 未導入 | フラグを外して起動し、導入済みイメージに切り替えてから再度有効化 |
| BF16指定でモデルが見つからない | BF16実体ファイル未配置 | `models/diffusion_models` と `models/text_encoders` に BF16実体を配置し、必要なら不要なFP8を削除して容量を確保 |
| workflow 実行時に `mid_layer_scale ... could not convert string to float: 'linear'` | workflow JSON の型不一致 | `Flux2KleinEnhancer.mid_layer_scale` を数値（例: `1.0`）へ修正する |
| `UNETLoader/CLIPLoader Value not in list` | workflow が存在しないモデル名（`fp8`/`bf16` 混在）を参照 | 現在の実体ファイル名（例: `flux-2-klein-base-9b-bf16.safetensors` / `qwen_3_8b_bf16.safetensors`）に合わせる |
| `Node 'Note' not found` | カスタムノード未導入 | ノードを削除するか、必要なら該当 custom node を導入する |

## 参照

- [KB-378](../knowledge-base/KB-378-dgx-private-comfyui-mac-ssh-access.md)（Mac と SSH とトンネル・順序・切り分け）
- [KB-379](../knowledge-base/KB-379-dgx-private-comfyui-nvfp4-migration-and-workflow-tuning.md)（NVFP4 移行・遅延要因・workflow 調整）
- NVIDIA Playbook（手順の前提）: [Comfy UI Instructions](https://build.nvidia.com/spark/comfy-ui/instructions)
- 多用途分離の全体文脈: [dgx-spark-local-llm-migration-execplan.md](../plans/dgx-spark-local-llm-migration-execplan.md)
- LocalLLM と VRAM 競合の背景: [local-llm-tailscale-sidecar.md](./local-llm-tailscale-sidecar.md)
- 業務側 DGX Runbook: [dgx-system-prod-local-llm.md](./dgx-system-prod-local-llm.md)
