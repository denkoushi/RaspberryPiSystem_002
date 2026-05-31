---
title: KB-378 DGX Spark private ComfyUI と Mac アクセス（SSH 順序・トンネル・切り分け）
tags: [DGX Spark, ComfyUI, Tailscale, SSH, private-personal, 運用, Mac]
audience: [運用者, 開発者]
last-verified: 2026-05-31
category: knowledge-base
related:
  - ../runbooks/dgx-private-comfyui.md
  - ../../scripts/dgx-private-comfyui/README.md
  - ./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md
  - ./infrastructure/security.md
---

# KB-378: DGX Spark private ComfyUI と Mac アクセス（SSH 順序・トンネル・切り分け）

## Context

[`dgx-private-comfyui.md`](../runbooks/dgx-private-comfyui.md) の **標準アクセス経路**は「**Mac → tailnet で DGX に SSH → ポートフォワード → ブラウザで `http://127.0.0.1:8188`**」である。**ComfyUI は DGX 上で `127.0.0.1:8188` のみ**にバインドする設計のため、**トンネル無しでは Mac のブラウザから到達しない**。

## Symptoms（運用実測）

- Runbook に **`ssh -N -L … <dgx_user>@<tailnet>** のプレースホルダだけが書いてあり、ユーザーが **`<>` をそのまま貼って zsh が `parse error near '\n'`** になる。
- **LAN の実 IP（例 `192.168.128.156`）**で `ssh` すると **`Connection refused`** が出る（**22 番に何も待受していない**か、経路側の問題の可能性）。
- **`ssh -N -L 8188:127.0.0.1:8188 …`** を実行すると**プロンプトが戻らずシェルが「点灯したまま止まっている」ように見える**。
- **`Ctrl+C` で SSH を切るとブラウザの `http://127.0.0.1:8188` が開かなくなる** → トンネルが張っていたときだけ UI が見えていたと確定する。

## Investigation

| 現象 | 第一候補（CONFIRMED/REJECTED の目安） | 備考 |
|------|----------------------------------------|------|
| `zsh: parse error …` と `<dgx_user>` が残っている | CONFIRMED: **シェルにとって不正な入力**。**`<>` は入力しない**。実ユーザー名・IP を入れるか `~/.ssh/config` で短縮。 | ドキュメントは「説明」と「実例」を分離して再発を抑える（Runbook 2026-05-17 追補）。 |
| **`Connection refused`（ポート 22）** | CONFIRMED 寄り:**宛先ホスト側で SSH デーモンが `:22` を listen していない**。**REJECTED 寄り（単独説明として）:「Private Pi5 を tailnet に追加した」こと自体**。Pi5 は DGX の **listen 状態を変えない**。 | LAN 経路と tailnet 経路は別。LAN で refused でも **Tailscale IP（`100.x`）経由では通る**ことがある。 |
| **`Connection timed out`（tailnet 経由）** | Tailscale ACL で **`tag:admin` → `tag:llm` の `tcp:22` が閉じている**等を疑う（[KB-357](./infrastructure/security.md) と整合）。timeout と refused は別物。 | |
| **`ssh -N -L …` が無言で進まない** | CONFIRMED: **`-N` はシェルを開かない転送モード**。成功時も **標準出力に何も出ないのが通常**。ブラウザ用は **別ターミナル**で開く。 | 「SSH 不要」の誤認を防ぐ: 別セッションでトンネルがまだ動いていただけ、というパターンが多い。**停止実験**で証明できる。 |

## Fix（運用手順・正順序）

### 標準どおり進めるとき（Mac）

1. **トンネル用ターミナル（開きっぱなし）**で実行（値は環境で置換）:

   ```bash
   ssh -N -L 8188:127.0.0.1:8188 -i ~/.ssh/id_ed25519_raspi ubudgxkoushi@100.118.82.72
   ```

   - **記録済み tailnet の例**: `100.118.82.72`（実環境では `tailscale ip -4` 等で確認）。**LAN IP はドキュメント上の一例に過ぎない**（運用での直 SSH は Runbook と別議論）。
2. **別ターミナル**またはブラウザで:

   ```bash
   curl -I http://127.0.0.1:8188
   ```

   と **`HTTP/… 200`** を確認後、ブラウザで **`http://127.0.0.1:8188`** を開く。
3. **終わったら**: トンネル側で `Ctrl+C`（または `ssh` セッション終了）。

### DGX が listen しない場合の初手（`Connection refused` 時）

- DGX に **コンソール／別経路でログイン**し、**`ssh`（`openssh-server`）が有効か**・**`ss -lntp`** で **`:22` が LISTEN** しているか確認（運用環境により **LAN 側 22 が閉じ、tailnet のみ許可**等もあり得る）。  
- 詳細は [KB-357 §DGX と Tailscale／SSH](./infrastructure/security.md)・[Tailscale ACL](../security/tailscale-policy.md)。

### ときどき使う確認

- **`ssh -v -N -L …`**: 「ローカルで 8188 を listen した」ログが出れば転送側は進んでいる。
- **`IdentityFile` が必要な環境**では **`-i` を明示**（非対話の自動化側と鍵運用がズレないよう DGX **`authorized_keys` を整合**）。

## Prevention

- Runbook と README で **実例コマンドと「コピペ禁止のプレースホルダ」** を明確に区切る。
- 「トンネルが無言」の **仕様説明を必ず同梱**（初見での「SSH 不要」誤認の抑止）。
- 「トンネル切断で UI 不通」での **単回検証を推奨**（オンボーディング時）。

## Relation to DGX Resource UI / Pi5 gateway

管理コンソールの運用モード **`private_ok`**（[KB-365](./KB-365-dgx-resource-phase3-workload-orchestration.md)）へ切り替えても、**Mac が ComfyUI UI に届ける経路（SSH ローカルフォワード）の要否は変わらない**。競合や GPU は [KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md) と正本 Runbook へ。

**Pi5 からのヘルス確認（2026-05-31）**: 職場 Pi5 は DGX gateway の **`GET http://100.118.82.72:38081/private-comfyui/health`** で ComfyUI 生存を確認できる（管理画面 `DGX_RESOURCE_COMFYUI_HEALTH_URL`）。**Pi5→DGX SSH `:22` は現行 ACL で timeout** のため、**workflow 配置・`docker exec` は Mac 管理 SSH**（[KB-379 §2026-05-31](./KB-379-dgx-private-comfyui-nvfp4-migration-and-workflow-tuning.md#2026-05-31-現状確認実機モデル配置基準線-workflow)・Runbook **Pi5・gateway・SSH** 節）。

## References

- [Runbook: dgx-private-comfyui.md](../runbooks/dgx-private-comfyui.md)（**2026-05-17 追補**・実例・TS 表）
- [`scripts/dgx-private-comfyui/README.md`](../../scripts/dgx-private-comfyui/README.md)
- [KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md) · [KB-357](./infrastructure/security.md) · [KB-365](./KB-365-dgx-resource-phase3-workload-orchestration.md)
