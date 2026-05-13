---
title: Runbook — StackChan コミュニティファーム text-only 疎通（Pi5 bridge → DGX）
audience: [開発者, 運用者]
last-verified: 2026-05-13
related:
  - ../knowledge-base/KB-stackchan-community-firmware-supply-chain.md
  - ./stackchan-community-realtime-api-migration.md
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
**推奨**: `replyText` 抽出が安定するため、`/chat` より **`/chat/simple`** を使う。

**重要（再発防止）**: `PLATFORMIO_BUILD_FLAGS` **無し**の `pio run` では **`CHATGPT_API_URL` が未定義**のままになり、**OpenAI 直結など上流既定 URL に戻る**ことがある。実機で **bridge に POST が来ない**ときは、まず **シリアル・ビルドログに意図した `http://<Pi5>:18080/api/stackchan/chat/simple` が焼かれているか**を確認する（[`KB-stackchan-community-firmware-supply-chain` §2026-05-13](../knowledge-base/KB-stackchan-community-firmware-supply-chain.md#2026-05-13-追補-chatgpt_api_url-ドリフトbridge-リクエスト読取タイムアウトurl-境界の錯覚調査上の断定ルール)）。

```bash
cd AI_StackChan_Ex/firmware
export PLATFORMIO_BUILD_FLAGS='-DCHATGPT_API_URL=\"http://<Pi5-LAN-IP>:18080/api/stackchan/chat/simple\" -DCHATGPT_API_USE_AUTH_BEARER=0'
# 任意: bridge の STACKCHAN_TOKEN と揃える
# export PLATFORMIO_BUILD_FLAGS='-DCHATGPT_API_URL=\"http://<Pi5-LAN-IP>:18080/api/stackchan/chat/simple\" -DCHATGPT_API_USE_AUTH_BEARER=0 -DCHATGPT_STACKCHAN_TOKEN=\"<token>\"'
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
- **追記（2026-05-10）**: Wi‑Fi 再接続や DHCP 更新で secondary alias が落ちうるため、同 playbook は **NetworkManager dispatcher**（`up` / `dhcp4-change`）でも同じ `ip addr` を冪等適用する。**`systemctl is-active` だけの確認は不十分**（oneshot は `exited` のまま alias 欠落し得る）。切り分け時は **`ip -brief addr show <iface>`** と **再接続後の再確認**を正とする。
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
| `POST .../simple` が `200` でもシリアルの `payload length` が `0`（`わかりません`） | **ファームの `ChatGPT.cpp`（`https_post_json`）を確認**。`HTTPClient::getString()` が `WiFiClient` 生存スコープ外だと空 payload 化し得る。`getString()` を client 生存中に実行する版へ更新して再書き込みする。 |
| `replyText` は取れているのに発話で失敗する（`MP3:ERROR_BUFLEN 0` / `I2S ... failed`） | text-only 経路は成立。未解決は **音声再生系（デバイス側）**。`/speech?say=...` と同条件で MP3 再生/I2S 初期化を切り分ける。bridge 側を変更せず、デバイス側 TTS 再生経路を調査対象にする。 |
| Mac から `bridge healthz` / `private Pi5 SSH` / `DGX:38081` が同時に timeout | **アプリ不具合の前にネットワーク断を疑う**。`100.89.190.21:22`（private Pi5）と `100.118.82.72:38081`（DGX）へ TCP 到達性を先に確認し、到達不能時は Spark 連携判定を保留する。 |
| `mp3` ダウンロードは完了（`bytes == expected`）なのに `MP3:ERROR_BUFLEN 0` が残る | ストリーム欠損ではなく **I2S 切替競合**の可能性が高い。`playMP3` の `Mic.end -> Speaker.begin -> ... -> Speaker.end -> Mic.begin` を排他・順序固定で追跡する。 |
| STT 直後、bridge が `request read timeout after ...s` / `408 REQUEST_TIMEOUT`、実機が read **`errno -11`** 等 | **`STACKCHAN_REQUEST_READ_TIMEOUT_SEC`（既定 3s）が短すぎ**て **WAV 本文を読み切る前**にソケットが切れている典型。**Pi5 bridge `.env` で 30〜120s 級**へ延長して再起動（KB §2026-05-13・[`private-pi5-stackchan-bridge` README](../../scripts/private-pi5-stackchan-bridge/README.md)）。 |
| OpenAPI / `v1/chat/completions` だけ合っていて、実機は `404` や別ホスト | **StackChan が叩く path は `/api/stackchan/chat` 系**。**文書上の OpenAPI と実リクエスト URL を混同しない**。Mac `curl` は **実機と同じ path** で再現する。 |
| 「単発修正で root cause 確定」と言いたくなる | **WakeWord→STT→LLM→TTS が連続で複数回成功**するまで**確定扱いしない**（早すぎる断定は Realtime/Spark 混乱時と同種の再発要因）。 |

### 6.1) 2026-05-11 追加調査（`わかりません` 継続時）

- 事象: `StackChan -> private Pi5 /api/stackchan/chat/simple` は **`200`**、bridge ログにも **`POST .../simple 200`** が残るのに、実機は `わかりません` を発話。
- 観測: 修正前シリアルで **`[HTTP] payload length: 0`**（`attempt=1/2` と `attempt=2/2` の両方）を確認。
- 根因: `ChatGPT.cpp` の `https_post_json` で `WiFiClient` を内側スコープに置いたまま、`http.getString()` を外側で実行し得る構造があり、レスポンス本文参照時点で client が破棄されるケースがあった。
- 対応: `http.getString()` と payload 判定を **HTTP/HTTPS 分岐それぞれの client 生存スコープ内**へ移動（再試行ロジックは維持）。
- 再確認結果:
  - シリアル: **`[HTTP] payload length: 1027`**、JSON に `replyText` を確認。
  - bridge: `journalctl -u stackchan-bridge` に **`POST /api/stackchan/chat/simple 200`** を確認。
  - 残課題: 返信文取得後に **`MP3:ERROR_BUFLEN 0` / `I2S ... failed`** が出る場合があり、音声再生系は別経路で継続調査。
  - 追加検証（2026-05-11）: `WebVoiceVoxTTS.cpp` で `mp3DownloadUrl` 優先化を試しても同エラーは再現。**URL種別のみでは改善しない**。

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

### 6.2) 2026-05-11 追加調査（late: 音声は出るが failed 文言）

- 事象:
  - ユーザー観測として「音は出るが会話は成立しない（`http post failed` など失敗文言）」が継続。
  - 同時間帯で Mac から private Pi5 bridge / private Pi5 SSH / DGX への到達が同時に不安定。
- 切り分け結果:
  - **ネットワーク断トラック**: `192.168.128.112:18080` と `100.89.190.21:22`、`100.118.82.72:38081` が timeout になる局面あり。
  - **音声再生トラック**: 到達可能局面では `replyText` と MP3 完全取得（`bytes==expected`）まで進むが、`MP3:ERROR_BUFLEN 0` / `I2S ... failed` が残る回あり。
- 対応:
  - `WebVoiceVoxTTS.cpp` を **URLヘルスチェック + `.mp3` 保存再生（SPIFFS）**へ切替。
  - `playMP3` の Mic/Speaker 切替に遅延と成否ログを追加。
- 判定ルール:
  - `failed` 発話の再現時、まずネットワーク到達性を確認し、到達不能なら Spark 判定は保留。
  - 到達可能時のみ、デバイス音声再生系（I2S競合）を調査対象として扱う。

### 6.3) 2026-05-11 最終到達点（WakeWord -> STT -> LLM -> TTS 成立）

- 最終的に、以下の連鎖が実機で成立した。
  1. ウェイクワード有効化（`BtnB` 長押し登録 -> `BtnA` タップ有効）
  2. StackChan 録音音声を `POST /api/stackchan/stt` へ送信
  3. private Pi5 `faster-whisper` で STT 文字起こし
  4. bridge 経由で DGX Spark（Qwen3.6）へ問い合わせ
  5. VOICEVOX 由来 MP3 を再生
- 音声経路の主要な確定修正:
  - `M5Unified` を `0.1.17` から `0.2.7` へ更新し、`I2S: register I2S object to platform failed` の再現を解消。
  - `WebVoiceVoxTTS.cpp` の MP3 保存処理を chunked transfer 対応へ変更し、`mp3 download bytes=-11 expected=-1` を解消。
- 注意: ファーム再書き込み後はモードが初期化されるため、ウェイクワード登録/有効化を再実施する。

## E2E 検証チェックリスト（text-only → 音声） {#e2e-checklist-text-then-audio}

実機が手元にない場合は、できる項目だけを打ち消しし、**再発条件**（DGX 502、IP ドリフト）を記録する。

### Phase A — text-only（必須）

- [ ] 私用 Pi5: `curl -fsS http://127.0.0.1:18080/healthz`
- [ ] 私用 Pi5（または LAN 内クライアント）: `POST /api/stackchan/chat/simple` → **`200` + 非空 `replyText`**
- [ ] StackChan 実機: **同じ応答文がスピーカーから聞こえる**（[完了条件](#text-only-done-criteria)）
- [ ] `journalctl -u stackchan-bridge` に **対応する `POST`** がある（**`200` 単体では証明にならない**）

### Phase B — 音声入出力（デバイス側 STT/TTS）

- [ ] `http://<StackChan-IP>/speech?say=テスト` でスピーカー動作を確認（スピーカー経路の切り分け）
- [ ] `SC_ExConfig.yaml` / `yaml/SC_SecConfig.yaml` の **`stt` / `tts` / `wakeword`** を有効化し、**STT 音声は private Pi5 bridge `/api/stackchan/stt` へ送る構成**で一致させる
- [ ] ウェイクワードまたは UI から発話入力後、**bridge ログに `POST /api/stackchan/chat` 系が増える**こと（STT 結果がテキストとして LLM に渡っている証拠）

### CoreS3 実機の WakeWord 操作（2026-05-11 復旧仕様）

- CoreS3 の物理ボタン非依存構成では、画面タッチを `BtnA` / `BtnB(long)` 相当に割り当てたファームを使う。
- 左タッチ: `BtnA` 相当（WakeWord 有効/無効切替）。
- 右タッチ: `BtnB` 長押し相当（WakeWord 登録）。
- ファーム再書き込み直後は mode 初期化で WakeWord が無効化されるため、**右タッチで登録 -> 左タッチで有効化**を毎回実施する。

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
- Realtime 段階移行: [stackchan-community-realtime-api-migration.md](./stackchan-community-realtime-api-migration.md)
