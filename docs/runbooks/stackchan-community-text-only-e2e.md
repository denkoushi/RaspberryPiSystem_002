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

## text-only 完了条件（正本） {#text-only-done-criteria}

次をすべて満たすこと。

1. **bridge 契約**: 実機（または切り分け用クライアント）から Pi5 の **`POST /api/stackchan/chat/simple` が `200`** を返し、JSON に**非空の `replyText`** が含まれる（中身は DGX 応答に従う）。
2. **利用者が観測できる成功**: StackChan が **その `replyText` を発話**する（スピーカー経路で聞き取れる）。`/speech?say=...` だけが成功し LLM 経路の返答が聞こえない場合は **未完了**。
3. **境界の確認**: 上記 POST は **私用 Pi5 bridge** に到達している（職場 Pi5 API キューは通していない）。

「`GET /chat?...` が `200`」だけでは **完了とみなさない**。StackChan は **HTTP 200 を返しても本体処理やフォールバックで `わかりません` だけ喋る**ことがある。

## 標準診断（`/chat` 200 なのに bridge が静か）

**第1疑義**: **宛先 IP ミスマッチ**（StackChan の `CHATGPT_API_URL` が **旧 Pi5 IP** のまま等）。

- 症状: StackChan 実機やシリアルでは **`200`** だが、私用 Pi5 で  
  **`journalctl -u stackchan-bridge --since ...` に当該操作時刻の `POST /api/stackchan/chat/simple` が出ない**。
- 対処: `hostname -I`（Pi5）と URL 内 IP を突き合わせる。**ファーム再ビルド**で URL を直すか、**playbook 管理の compatibility IP alias**（`private_pi5_stackchan_compat_ip`）で一致させる。
- 典型的な併発: DGX **502** は別系統。シリアルに **`POST... code: 502`** が出ていれば **upstream / runtime** を疑う（IP ミスマッチとは切り分け可能）。

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

2026-05-10 実測（前半・DGX upstream 障害切り分け）:

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

2026-05-10 実測（後半・通信成立の確認）:

- StackChan 実機の IP は **`192.168.128.124`**
- private Pi5 の当日 DHCP 取得 IP は **`192.168.128.113`**
- ただし StackChan ファームの `CHATGPT_API_URL` は **旧 bridge IP `192.168.128.112`** を見ていた
- この状態で `GET /chat?...` は StackChan 側で **`200`** を返しても、**private Pi5 `journalctl -u stackchan-bridge` に新規 `POST /api/stackchan/chat/simple` が現れない**ことを確認した
- private Pi5 の `wlan0` に **`192.168.128.112/24` の互換 alias** を一時追加した直後、同じ `GET /chat?...` 実行で **bridge ログに `POST /api/stackchan/chat/simple HTTP/1.1" 200`** が現れた
- その後、private Pi5 の標準 playbook に **compatibility alias 管理**を組み込み、**`stackchan-bridge-compat-ip.service`** を **`enabled` / `active`** にした状態でも、再度 `GET /chat?...` と bridge `POST /api/stackchan/chat/simple 200` の対応を確認した
- さらに **`http://192.168.128.112:18080/healthz`** が **`200`**、**`POST http://192.168.128.112:18080/api/stackchan/chat/simple`** が **`200` + `replyText`** を返すことを確認した
- よって、**StackChan (`192.168.128.124`) -> private Pi5 compatibility IP (`192.168.128.112`) -> bridge -> DGX** の text-only 経路は成立した

### 5.1) 当日確認した実 IP / 互換 IP

- StackChan 実機: **`192.168.128.124`**
- private Pi5 DHCP IP: **`192.168.128.113`**
- StackChan ファーム設定上の bridge IP: **`192.168.128.112`**

重要:

- StackChan 側設定が **旧 IP** のままでも、Pi5 側に **互換 alias** を持たせれば疎通は回復する
- 逆に、`/chat` が `200` を返しても **bridge ログに新規 POST が無い**なら、**StackChan が誤った IP を見ている**可能性を優先して疑う
- 一時 `ip addr add ...` で直った場合も、そのままでは再起動で消える。**手作業で終わらせず、playbook 管理の compatibility alias へ昇格**させる

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
| StackChan `/chat?...` は `200` だが、private Pi5 `journalctl -u stackchan-bridge` に新規 POST が出ない | **StackChan の `CHATGPT_API_URL` が旧 IP を見ている**可能性が高い。Pi5 の現在 LAN IP を確認し、**StackChan 設定更新**または **Pi5 側 compatibility IP alias** で一致させる。 |
| private Pi5 の `healthz` は `200` だが、Mac から `http://<旧IP>:18080` が timeout | Pi5 が **DHCP で別 IP** を取った。`hostname -I` と `arp -a` を突き合わせ、**現在 IP** と **StackChan が見ている IP** を分離して確認する。 |

- **シリアルログ**: `[HTTP] begin...` に **意図した Pi5 URL** が出ているか。
- **Pi5**: `journalctl -u stackchan-bridge -n 200` 相当でリクエスト有無を確認。
- **Mac からの代替確認**:
  - `http://<StackChan-IP>/` が `200`
  - `http://<StackChan-IP>/speech?say=テスト` が `200`
  - `http://<StackChan-IP>/chat?text=こんにちは` が待てば `200` になるか
  - `http://<Pi5-LAN-IP>:18080/healthz` が `200`
  - `POST /api/stackchan/chat` が `200`
- **bridge 到達確認のコツ**:
  - `GET /chat?...` 実行前に時刻を控え、**その時刻以降の `journalctl -u stackchan-bridge --since ...`** を見る
  - **bridge ログが増えない**なら upstream ではなく **宛先IPミスマッチ** を先に疑う
- 実測で StackChan 実機の `/chat` が `200` でも、**シリアルに `POST... code: 502` が出て `わかりません` を喋う**なら、StackChan 側ではなく **bridge 以降の upstream 失敗**と判断してよい。

## E2E 検証チェックリスト（text-only → 音声） {#e2e-checklist-text-then-audio}

実機が手元にない場合は、できる項目だけを打ち消しし、**再発条件**（DGX 502、IP ドリフト）を記録する。

### Phase A — text-only（必須）

- [ ] 私用 Pi5: `curl -fsS http://127.0.0.1:18080/healthz`
- [ ] 私用 Pi5（または LAN 内クライアント）: `POST /api/stackchan/chat/simple` → **`200` + 非空 `replyText`**
- [ ] StackChan 実機: **同じ応答文がスピーカーから聞こえる**（[完了条件](#text-only-done-criteria)）
- [ ] `journalctl -u stackchan-bridge` に **対応する `POST`** がある（**`200` 単体では証明にならない**）

### Phase B — 音声入出力（デバイス側 STT/TTS）

- [ ] `http://<StackChan-IP>/speech?say=テスト` でスピーカー動作を確認（スピーカー経路の切り分け）
- [ ] `SC_ExConfig.yaml` / `yaml/SC_SecConfig.yaml` の **`stt` / `tts` / `wakeword`** を、製作元ファームの仕様に沿って有効化（**音声バイナリは Pi5 bridge に送らない**）
- [ ] ウェイクワードまたは UI から発話入力後、**bridge ログに `POST /api/stackchan/chat` 系が増える**こと（STT 結果がテキストとして LLM に渡っている証拠）

### Phase C — 再発条件の確認

- [ ] DGX cold start / runtime 停止時: bridge が **`502` / `UPSTREAM_UNREACHABLE`** を返し得る → `DGX_RUNTIME_AUTO_START` と **`DGX_RUNTIME_READY_TIMEOUT_SEC`（300–600）** を確認
- [ ] Pi5 DHCP 変更後: StackChan URL と **`hostname -I`** の不一致 → **compat alias** または **ファーム再ビルド**

### デプロイ直後の私用 Pi5 最小確認（`stackchan_chat_core` 同梱後・2026-05-10）

**目的**: 実機 StackChan を触る前に、**systemd とループバック `healthz` と新モジュール実配備**だけを短時間で確かめる。

**手順の正本**: [private-pi5-stackchan-bridge-deploy.md](./private-pi5-stackchan-bridge-deploy.md) の **「実測記録（2026-05-10）」** 節（playbook の `PLAY RECAP`・**Ansible `shell`** による `systemctl` / `curl` / `test -f …/stackchan_chat_core.py`）。

**注意**: ここまで **green** でも、StackChan 側の **text-only 正本**（[`#text-only-done-criteria`](#text-only-done-criteria)）は **別途**満たす必要がある（IP ミスマッチや DGX upstream はこの smoke だけでは判定できない）。

## ロールバック

- 公式製品の場合は **M5Burner** で工場出荷ファームへ戻せる（製品ドキュメント参照）。
- コミュニティ版のみの場合は、**書き込み前のバイナリまたは以前のビルド**を再フラッシュ。

## 関連

- 供給鎖: [KB-stackchan-community-firmware-supply-chain.md](../knowledge-base/KB-stackchan-community-firmware-supply-chain.md)
