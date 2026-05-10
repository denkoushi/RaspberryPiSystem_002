---
title: Runbook — StackChan コミュニティファーム text-only 疎通（Pi5 bridge → DGX）
audience: [開発者, 運用者]
last-verified: 2026-05-10
related:
  - ../knowledge-base/KB-stackchan-community-firmware-supply-chain.md
  - ../../scripts/stackchan-ai-stackchan-ex/README.md
  - ../../scripts/private-pi5-stackchan-bridge/README.md
---

# Runbook — StackChan コミュニティファーム text-only 疎通

## 目的

**音声なし**で、StackChan（`AI_StackChan_Ex`）から **私用 Pi5 の `stackchan-bridge`** 経由で LLM 応答が返ることを確認する。

## 前提

- 私用 Pi5 で `stackchan-bridge` が動作し、`GET /healthz` が `200`。
- Mac 等から `POST /api/stackchan/chat/simple` が成功している（bridge → DGX は済み）。
- `AI_StackChan_Ex` に **[`patches/ai_stackchan_ex_private_bridge.patch`](../../scripts/private-pi5-stackchan-bridge/patches/ai_stackchan_ex_private_bridge.patch)** を適用済み。
- （推奨）[`apply_platformio_github_pins.py`](../../scripts/stackchan-ai-stackchan-ex/apply_platformio_github_pins.py) で `platformio.ini` の GitHub 依存を **コミット固定**済み。
- CoreS3 実機では **microSD が必須**。未挿入だと **`Failed to load SD card settings`** で起動ループする。

## 手順

### 1) ビルド（CoreS3 / `m5stack-cores3`）

`firmware` ディレクトリで、bridge の URL と bearer 無効を指定する。

```bash
cd AI_StackChan_Ex/firmware
export PLATFORMIO_BUILD_FLAGS='-DCHATGPT_API_URL=\"http://<Pi5-LAN-IP>:18080/api/stackchan/chat\" -DCHATGPT_API_USE_AUTH_BEARER=0'
# 任意: bridge の STACKCHAN_TOKEN と揃える
# export PLATFORMIO_BUILD_FLAGS='-DCHATGPT_API_URL=\"http://<Pi5-LAN-IP>:18080/api/stackchan/chat\" -DCHATGPT_API_USE_AUTH_BEARER=0 -DCHATGPT_STACKCHAN_TOKEN=\"<token>\"'
pio run -e m5stack-cores3
```

### 2) 書き込み

USB 接続後、ポートを指定して upload。

```bash
pio run -e m5stack-cores3 -t upload --upload-port /dev/cu.usbmodemXXXX
```

### 3) SD カードへ最小設定を置く

CoreS3 実機では、少なくとも Wi-Fi 設定を SD に置く。  
**実測では `wifi.txt` だけで不安定だったため、`wifi.txt` と YAML の両方を置く**のが安全。

`wifi.txt`（ルート直下）:

```text
<SSID>
<PASSWORD>
```

`yaml/SC_SecConfig.yaml`:

```yaml
wifi:
  ssid: "<SSID>"
  password: "<PASSWORD>"
apikey:
  stt: ""
  aiservice: ""
  tts: ""
```

`app/AiStackChanEx/SC_ExConfig.yaml`:

```yaml
llm:
  type: 0
  model: "private-pi5-bridge"
  mcpServers: []
  enableMemory: false
tts:
  type: 0
  model: ""
  voice: ""
stt:
  type: 0
  model: ""
wakeword:
  type: 0
  keyword: ""
audio:
  speaker_volume: 180
moduleLLM:
  rxPin: -1
  txPin: -1
```

注意:

- パスワードは **`O` / `0`、`l` / `1`** の見間違いを必ず確認する。
- Wi-Fi は **2.4GHz / WPA2** を優先する。5GHz only / WPA3 only は実機側で失敗しやすい。

### 4) 実機確認（まず IP 取得）

1. StackChan を **検証用 Wi-Fi**（例: 自宅ゲスト SSID）に接続。Pi5 と **同一 L2 またはルーティング可能**であること。
2. 再起動後、`System status` 画面で **`IP addr` が `0.0.0.0` 以外**になることを確認する。
3. 期待: 例として **`192.168.x.x`** のアドレスがつく。

### 5) 実機確認（text-only / 疑似 text-only）

このコミュニティファームは、実測上 **「常時ウェイクワードで自然に会話開始」ではなく、画面操作や `/chat` HTTP を経由して会話が始まる場面がある**。  
STT/TTS の本実装統合前は、まず次の順で切り分ける。

1. Mac から `http://<StackChan-IP>/` が `200` になることを確認する。
2. Mac から `http://<Pi5-LAN-IP>:18080/healthz` が `200` になることを確認する。
3. Mac から Pi5 bridge の `POST /api/stackchan/chat` を叩き、DGX 応答が返ることを確認する。
4. その後に実機操作で会話を試す。

2026-05-10 実測:

- StackChan 自体の `/` は `200`
- Pi5 bridge `healthz` は `200`
- Pi5 bridge `POST /api/stackchan/chat` は、正常時は `200` + `こんにちは`
- `http://<StackChan-IP>/speech?say=テスト` は `200` / `OK`
- `http://<StackChan-IP>/chat?text=こんにちは` は初回 20 秒でタイムアウトしたが、80 秒待つと約 36 秒で `200`
- 実機は `テスト` を発話できた一方、`/chat` 実行時は `わかりません` を返した
- 同時取得のシリアルログでは **`[HTTP] POST... code: 502`**（StackChan -> Pi5 bridge `/simple`）を観測
- さらに Mac から bridge `/simple` へ単発 `こんにちは` を送っても、その時点では  
  `UPSTREAM_HTTP_ERROR` / `status: 502` / `body: bad gateway: [Errno 111] Connection refused`  
  を再現した

したがって現時点では、**text-only の第1ゲートは「実機が IP を取り、Pi5 bridge が返答できること」**、第2ゲートは **upstream runtime が 502 なく応答すること** とするのが妥当。

### 6) 失敗時の切り分け

| 症状 | 確認 |
|------|------|
| 起動直後に `Failed to load SD card settings` | microSD 未挿入 / 認識失敗 |
| `IP addr: 0.0.0.0` のまま | `wifi.txt` / `SC_SecConfig.yaml` の配置、SSID/パスワード誤記、5GHz only / WPA3 only |
| HTTP 401 / bridge `UNAUTHORIZED` | Pi5 `.env` の `STACKCHAN_TOKEN` とファームの `CHATGPT_STACKCHAN_TOKEN` の一致 |
| 403 upstream | Pi5 の `DGX_LLM_SHARED_TOKEN`（**端末には載せない**） |
| `NOT_FOUND` | bridge のパスが `/api/stackchan/chat` であること（末尾 `/` や互換パスは bridge README 参照） |
| タイムアウト | `UPSTREAM_TIMEOUT_SEC`、Tailscale/LAN 経路、DGX 負荷 |
| 実機が `わかりません` を返す | `ChatGPT.cpp` の upstream 文字列が空。StackChan -> Pi5 bridge もしくはその後段を追加調査 |
| bridge から `502 bad gateway: [Errno 111] Connection refused` | **DGX runtime / gateway backend 未起動または不安定**。StackChan ではなく upstream を復旧 |
| Mac から DGX `healthz` / `v1/models` が **timeout** だが、私用 Pi5 の bridge は **200** | **経路・ACL が開発端末と私用 Pi5で異なる**典型。**結論づけは私用 Pi5 上**の `curl` と bridge **`POST /api/stackchan/chat`** を正とする（計画・[KB-365 §私用 bridge](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#private-pi5-stackchan-bridge-boundary-2026-05-10)）。 |
| `DGX_RUNTIME_AUTO_START=true` なのに cold start で毎回失敗 | **`DGX_RUNTIME_READY_TIMEOUT_SEC` が短すぎ**（推奨 **300–600**）。bridge は [`dgx_runtime_client.py`](../../scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py) のタイムアウトを使用。 |

- **シリアルログ**: `[HTTP] begin...` に **意図した Pi5 URL** が出ているか。
- **Pi5**: `journalctl -u stackchan-bridge -n 200` 相当でリクエスト有無を確認。
- **Mac からの代替確認**:
  - `http://<StackChan-IP>/` が `200`
  - `http://<StackChan-IP>/speech?say=テスト` が `200`
  - `http://<StackChan-IP>/chat?text=こんにちは` が待てば `200` になるか
  - `http://<Pi5-LAN-IP>:18080/healthz` が `200`
  - `POST /api/stackchan/chat` が `200`
- 実測で StackChan 実機の `/chat` が `200` でも、**シリアルに `POST... code: 502` が出て `わかりません` を喋う**なら、StackChan 側ではなく **bridge 以降の upstream 失敗**と判断してよい。

## ロールバック

- 公式製品の場合は **M5Burner** で工場出荷ファームへ戻せる（製品ドキュメント参照）。
- コミュニティ版のみの場合は、**書き込み前のバイナリまたは以前のビルド**を再フラッシュ。

## 関連

- 供給鎖: [KB-stackchan-community-firmware-supply-chain.md](../knowledge-base/KB-stackchan-community-firmware-supply-chain.md)
