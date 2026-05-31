---
title: "KB: StackChan コミュニティファーム（AI_StackChan_Ex）供給鎖・セキュリティ"
tags: [StackChan, supply-chain, firmware, security, Pi5, DGX]
audience: [開発者, 運用者]
last-verified: 2026-05-31
category: knowledge-base
update-frequency: high
---

# KB: StackChan コミュニティファーム（AI_StackChan_Ex）供給鎖・セキュリティ

## Context

- 目的: **M5Stack 公式製品ファーム**ではなく、**コミュニティ実装（`ronron-gh/AI_StackChan_Ex` 等）**を使って **private Pi5 bridge → DGX** の経路を作る。
- コミュニティ製 OSS は **企業製品の SBOM／署名付き更新と同等の保証はない**。依存が **Git のブランチ先端**を指すと、**同一手順でもビルド内容が変わる**。

## Symptoms / リスク

- `platformio.ini` の `https://github.com/...` 依存が、**コミット未固定**のままだと、**予期しないコードが混入**しうる（悪意／事故の両方）。
- `SC_SecConfig.yaml` 等に **クラウド API キー**を置く運用と **bridge 専用トークン**運用が混線すると、**高価値シークレットが端末に残る**。
- マルウェアというより実務では **「信頼できない依存の自動取得」「設定ファイル漏洩」「LAN 内 HTTP の盗聴」**が支配的。

## Investigation（推奨の確認）

1. 採用する **上流コミット SHA** を記録する（例: `git rev-parse HEAD`）。
2. `firmware/platformio.ini` の **GitHub URL を列挙**し、**コミット付き URL** にできるか確認する。
3. 端末設定（YAML/SPIFFS）に **DGX 用 `X-LLM-Token` 相当が無い**ことを確認する。

## Fix（最小の安全策）

1. **自分用フォーク** + 検証済みタグでビルドする。
2. 本リポジトリの **[`scripts/stackchan-ai-stackchan-ex/apply_platformio_github_pins.py`](../../scripts/stackchan-ai-stackchan-ex/apply_platformio_github_pins.py)** で **`platformio.ini` の GitHub 依存をピン留め**する（正は [`supply-chain-lock.json`](../../scripts/stackchan-ai-stackchan-ex/supply-chain-lock.json)）。
3. **機密の分離**
   - **DGX 共有トークン**: 私用 Pi5 の `stackchan-bridge` `.env`（`DGX_LLM_SHARED_TOKEN`）**のみ**。
   - **LAN 内ブリッジ用トークン**（任意）: `STACKCHAN_TOKEN`（ bridge 側）と、ファームの **`-DCHATGPT_STACKCHAN_TOKEN=...`**（同上文字列）で **`X-Stackchan-Token`** を送る。これは **DGX トークンとは別**。
4. **ネットワーク**: StackChan を **ゲスト SSID / VLAN** 等に置き、業務資産と **L3 で分離**。

## Prevention

- 依存更新は **差分レビュー → lock の SHA 更新 → 再ビルド**の一回りだけ通す。
- 端末紛失を想定し、**ローテ容易なのは bridge 側トークン**に寄せる。

## 2026-05-10 実機 bring-up

### Context

- 対象機は **M5Stack CoreS3 ベースの StackChan 実機**。
- 目的は **`AI_StackChan_Ex` + private Pi5 bridge** の最小 text-only 疎通確認。
- STT/TTS の本実装統合はまだスコープ外。まず **Wi-Fi / SD / bridge / LLM** のどこで詰まるかを分解した。

### Symptoms

- 初回起動では画面に **`Failed to load SD card settings. System reset after 5 seconds.`** が出て、起動ループした。
- SD 挿入後は `System status` 画面まで進んだが、**`WiFi: 0.0.0.0` / `IP addr: 0.0.0.0`** のまま。
- `wifi.txt` と `SC_SecConfig.yaml` を配置後も、当初は Wi-Fi 未接続のままだった。
- 接続後は会話画面へ進んだが、実機操作では **`わかりません`** を返す状態で、期待した LLM 応答には至っていない。

### Investigation

#### Hypothesis A: SD カード自体を読めていない

- **CONFIRMED**（初期症状）。
- 根拠: `main.cpp` は `SD.begin(GPIO_NUM_4, SPI, 25000000)` 失敗時にそのまま上記エラー表示へ進む。
- 対処: microSD を挿入すると起動ループは解消し、少なくとも `System status` 画面へ進むようになった。

#### Hypothesis B: CoreS3 では `wifi.txt` ではなく YAML が必須

- **PARTIALLY CONFIRMED**。
- 根拠:
  - CoreS3 側の正規読込先は **`/yaml/SC_SecConfig.yaml`** と **`/app/AiStackChanEx/SC_ExConfig.yaml`**。
  - 一方で secret config 不在時は **`/wifi.txt`** fallback も読む。
- 実運用では **YAML と legacy txt の両方を置く**のが安全。

#### Hypothesis C: Wi-Fi 設定ファイルは読めているが、資格情報が不正

- **CONFIRMED**。
- 根拠: USB 経由で取得した実機ログに **`SSID: HR02a-BF3159`** / **`Key: ...`** が出た。
- 当初はパスワード 4 文字目を **`O`** と誤記しており、後で **`0`** に修正した。
- 修正後、実機は **`192.168.128.124`** を取得した。

#### Hypothesis D: private Pi5 bridge 側が落ちている

- **REJECTED**。
- 根拠:
  - Mac から **`http://192.168.128.112:18080/healthz`** が `200`
  - Mac から **`POST /api/stackchan/chat`** が `200` で **`こんにちは`** を返した

#### Hypothesis E: StackChan 側 HTTP / TTS は動くが、会話 upstream だけ失敗している

- **CONFIRMED**。
- 根拠:
  - StackChan の **`/speech?say=テスト`** は `200` / `OK` で、実機も `テスト` を発話した
  - StackChan の **`/chat?text=こんにちは`** は `200` で完走するが、実機は **`わかりません`** を発話した
  - 同タイミングのシリアルログで、StackChan から private Pi5 bridge の **`/api/stackchan/chat/simple`** へ `POST` した結果が **`[HTTP] POST... code: 502`** だった
  - さらに Mac から **StackChan が送ったのと同等のメッセージ履歴**を bridge `/simple` に再送すると、**同じ 502** を再現した

#### Hypothesis F: 502 は StackChan 固有ではなく DGX upstream 不調

- **CONFIRMED**。
- 根拠:
  - bridge `/simple` へ **単発 `こんにちは`** を送っても、同時点では
    `{"code":"UPSTREAM_HTTP_ERROR","details":{"status":502,"body":"bad gateway: [Errno 111] Connection refused"}}`
    が返った
  - したがって、現時点の主因は **StackChan 本体ではなく、Pi5 bridge の先の DGX runtime / gateway backend**。

#### Hypothesis G: Spark 再起動後に DGX upstream は復旧した

- **REJECTED**（2026-05-10 18:44 時点）。
- 根拠:
  - Mac から **`http://100.118.82.72:38081/healthz`** は引き続き **timeout**
  - Mac から **`http://100.118.82.72:38081/v1/models`** も **timeout**
  - private Pi5 bridge **`/healthz`** は `200` のまま
  - bridge **`/api/stackchan/chat/simple`** は引き続き `502` / `bad gateway: [Errno 111] Connection refused`
  - StackChan 実機シリアルでは同タイミングで **`http post failed: connection refused`** を観測

### Root cause

- **第1段階の主因**: SD 未挿入、および Wi-Fi パスワードの誤記（`O` / `0`）。
- **第2段階の主因**: StackChan からの会話要求は private Pi5 bridge まで届くが、**bridge の先の DGX upstream が 502 / `Connection refused`** を返している。  
  StackChan 固有の不具合ではなく、**upstream runtime の不安定化または未起動**が主因。
- **第3段階の主因（2026-05-10 late）**: DGX upstream 復旧後も、StackChan ファームが **旧 bridge IP `192.168.128.112`** を見続けていた。一方、private Pi5 の当日 DHCP IP は **`192.168.128.113`** へ変わっていたため、**`GET /chat?...` の `200` だけでは bridge 到達を保証しなかった**。

### Fix

- SD カードへ以下を配置した。
  - ルート: `wifi.txt`
  - `yaml/SC_SecConfig.yaml`
  - `app/AiStackChanEx/SC_ExConfig.yaml`
- Wi-Fi パスワードを **`Mjt0gEaep9`** に修正した。
- CoreS3 実機で Wi-Fi 接続後、StackChan 自身の HTTP ルートが LAN から見えることを確認した。
- StackChan 実機の `/speech` が動作することを確認し、**TTS 単体は生きている**と切り分けた。
- StackChan 実機の `/chat` 実行時ログを取得し、**`/api/stackchan/chat/simple` への POST が 502** を返すことを確認した。
- 同一 payload を Mac から bridge `/simple` に再送し、**DGX upstream 502 / `bad gateway: [Errno 111] Connection refused`** を再現した。
- private Pi5 bridge 側に、**任意の `DGX_RUNTIME_AUTO_START` + `DGX_RUNTIME_CONTROL_TOKEN`** を使って `502` / `503` 時（および **`DGX_RUNTIME_AUTO_START` 有効時の初回 `URLError`**）に **`/start` -> `/v1/models` ready wait -> 1回再試行** する最小回復策を **`dgx_runtime_client.py`（`DgxUpstreamClient`）** に集約した。HTTP 受付・レスポンス I/O は **`bridge_server.py`**、入力検証と chat completion オーケストレーションは **`stackchan_chat_core.py`**（repo 側。live 反映は別途・Ansible は 3 ファイルを同期）。
- Spark 再起動後も、**DGX `/healthz` / `/v1/models` timeout・Pi5 bridge `/healthz` は 200・bridge `/simple` は 502** のままであることを再確認した。
- DGX upstream 復旧後、Mac から **`POST http://192.168.128.113:18080/api/stackchan/chat/simple`** は **`200` + `replyText`** を返す一方、StackChan の `GET /chat?...` 実行直後に **bridge ログが増えない**ことを確認した。
- そのため **private Pi5 の現在 IP (`192.168.128.113`)** と **StackChan が見ている bridge IP (`192.168.128.112`)** がずれている仮説を立て、Pi5 `wlan0` に **`192.168.128.112/24` の互換 alias** を一時追加した。
- 互換 alias 追加直後、同じ `GET /chat?...` 実行に対して **`journalctl -u stackchan-bridge` に `POST /api/stackchan/chat/simple HTTP/1.1" 200`** が現れ、**StackChan (`192.168.128.124`) -> private Pi5 bridge -> DGX** の text-only 経路が成立した。

### Prevention

- **文字起こしベースで Wi-Fi パスワードを扱う場合、`O` / `0`, `l` / `1` の混同を必ず二重確認**する。
- CoreS3 実機では **`wifi.txt` だけに頼らず YAML も併置**する。
- **bridge URL に IP リテラルを焼き込む場合、Pi5 の DHCP 変動で経路が静かに切れる**。実機の `GET /chat?...` が `200` でも **bridge ログに POST が出なければ宛先IPミスマッチ** を疑う。
- **将来の再発防止**は、`1.` Pi5 側で compatibility IP を恒久化する、または `2.` StackChan 側設定を現在 IP / mDNS / 固定IP 運用へ揃える、のどちらかに寄せる。
- bring-up は次の順で固定する。
  1. SD 認識
  2. Wi-Fi 接続（IP 取得）
  3. StackChan 自身の HTTP 到達性
  4. Pi5 bridge `healthz`
  5. StackChan `/speech` で TTS 単体確認
  6. bridge `/simple` の単発・実 payload 再現
- 実機会話が失敗したときは、**Mac から bridge を直接叩いて bridge 健全性を先に切る**。bridge が 502 の場合は **StackChan を疑う前に upstream runtime を疑う**。
- 実機会話が失敗したとき、**`/chat` が 200 でも bridge ログが無ければ upstream ではなく IP 経路を疑う**。`hostname -I`（Pi5）・`arp -a`（Mac）・`journalctl --since` をセットで確認する。
- direct-to-DGX の private bridge を使う場合は、**Pi5 API の on-demand 制御を通らない**ことを前提にする。必要なら **bridge 自身が `DGX_RUNTIME_CONTROL_TOKEN` で runtime 起動を吸収**する。**blue / vLLM cold start** では **60s 未満の ready 待ちでは不足しうる**ため、`.env` の **`DGX_RUNTIME_READY_TIMEOUT_SEC` は 300–600 秒級**を推奨（例は [`.env.example`](../../scripts/private-pi5-stackchan-bridge/.env.example)）。

## Bridge 実装の責務分離（2026-05-10）

- **`bridge_server.py`**: HTTP ルーティング・`STACKCHAN_TOKEN` 検証・JSON I/O のみ。
- **`stackchan_chat_core.py`**: `messages` 検証、upstream ボディ構築、リトライ付き completion（`ChatCompletionWorkflow`）、`replyText` 抽出。
- **`dgx_runtime_client.py`**: DGX への生 HTTP（chat・`/start`・ready プローブ）。
- **音声境界（2026-05-11 最終）**: TTS 再生はデバイス側、STT 文字起こしは private Pi5 bridge（`/api/stackchan/stt`）で処理し、bridge は LLM 境界を含む会話オーケストレーションを担当する。
- **text-only 完了条件の正本**: [`stackchan-community-text-only-e2e.md` §text-only-done-criteria](../runbooks/stackchan-community-text-only-e2e.md#text-only-done-criteria)
- **2026-05-10（`stackchan_chat_core` 同梱後）**: 私用 Pi5 へ **標準 playbook を再実行**し、**`PLAY RECAP` `ok=17` `changed=2` `failed=0`** を確認。playbook 付帯 **`/healthz` `200`** に加え、**Ansible `shell`** で **`systemctl is-active stackchan-bridge`・loopback `curl /healthz`・`stackchan_chat_core.py` 実在**を確認（詳細は [private-pi5-stackchan-bridge-deploy.md](../runbooks/private-pi5-stackchan-bridge-deploy.md) **実測記録** 節）。

## 2026-05-11 追加: `わかりません` 継続事象の根因（payload 空）

### Context

- 2026-05-10 までの対処（DGX 502 切り分け、compatibility alias、NetworkManager dispatcher）後も、実機で `わかりません` が再発した。
- private Pi5 bridge のログでは **`POST /api/stackchan/chat/simple` が `200`** であり、DGX 由来応答も取得されていたため、障害点は StackChan ファーム側に絞られた。

### Symptoms

- StackChan シリアルで **`[HTTP] POST... code: 200`** が出るのに **`[HTTP] payload length: 0`**。
- 同じ 1 リクエストで retry 2 回とも `payload length: 0`。
- bridge 側には同時刻に **`POST /api/stackchan/chat/simple HTTP/1.1" 200 -`** が残る。

### Investigation

#### Hypothesis H: bridge が空ボディを返している

- **REJECTED**。
- 根拠:
  - Mac から `POST /api/stackchan/chat/simple` を直接実行すると `Content-Length: 955`（実測）と非空 JSON を返す。
  - したがって、bridge 応答は空ではない。

#### Hypothesis I: StackChan ファームの HTTP レスポンス読取タイミング不整合

- **CONFIRMED**。
- 根拠:
  - `ChatGPT.cpp` `https_post_json()` で `WiFiClient`（HTTP/HTTPS）を内側スコープで生成し、`HTTPClient::getString()` がそのスコープ外で実行され得る構造だった。
  - `HTTP 200` を受けても payload が空化し、`deserializeJson` 対象が空となり `わかりません` 分岐に入る。

### Root cause

- StackChan ファーム `ChatGPT.cpp` の **`https_post_json` における client ライフタイム不整合**。  
  `HTTPClient` は成功コードを返すが、本文読取時点で下位 `WiFiClient` が生存しておらず、payload が空になるケースがあった。

### Fix

- `https_post_json` を修正し、`http.getString()` と payload 判定を **HTTP/HTTPS 各分岐の client 生存スコープ内**で実行するように変更。
- retry（`CHATGPT_HTTP_MAX_ATTEMPTS=2`）と診断ログは維持。
- 再書き込み後の実測:
  - シリアル: **`[HTTP] payload length: 1027`**（非空）
  - 本文: `replyText` を含む JSON を確認
  - bridge: `POST /api/stackchan/chat/simple 200` と整合

### Prevention

- ファーム側の HTTP ラッパーで、`HTTPClient` と `WiFiClient` の寿命を同一スコープに固定する。
- `HTTP 200` だけで成功判定せず、**payload 長と `replyText` 有無**を診断ログに必ず残す。
- private Pi5 bridge とデバイス側の責務を分離し、text 経路と音声経路を独立して切り分ける。

### Current status / Next issue

- **解消済み**: `200` なのに payload が空で `わかりません` になる主因。
- **継続課題**: 一部実行で `MP3:ERROR_BUFLEN 0` / `I2S: register I2S object to platform failed` が発生。  
  これは bridge ではなく **デバイス側の音声再生経路**（TTS/MP3/I2S）問題として別トラックで追跡する。
- 2026-05-11 追加検証: `WebVoiceVoxTTS.cpp` を **`mp3StreamingUrl` から `mp3DownloadUrl` 優先**へ変更して再書き込みしたが、同一シナリオで `MP3:ERROR_BUFLEN 0` は再現。**URL種別だけでは解消しない**ため、次は `AudioFileSourceHTTPSStream` / `PlayMP3` のバッファ供給と I2S 初期化順序を追う。

## 2026-05-11 追加（late）: 無音・failed 発話・Spark 連携疑義の再切り分け

### Context

- ユーザー観測として「音は出る回があるが、`http post failed` など失敗文言を話すため会話として成立していない」が報告された。
- 同時刻帯で、Mac から private Pi5 bridge / StackChan HTTP / private Pi5 SSH（Tailscale）への到達性が不安定化した。

### Symptoms

- `http://192.168.128.112:18080/healthz` / `/api/stackchan/chat/simple` が timeout / host down。
- `ansible ... private-pi5-stackchan-bridge -m ping` が `UNREACHABLE`（`ssh ... 100.89.190.21:22 timed out`）。
- `100.118.82.72:38081`（DGX 側）TCP 到達も timeout。
- StackChan 側は「音が出る」局面がある一方、内容は `http post failed: connection refused` 系が混在。

### Investigation

#### Hypothesis J: Spark 推論が壊れている（アプリ不具合）

- **INCONCLUSIVE**。
- 根拠:
  - 同時間帯で private Pi5 までの SSH 到達自体が失敗しており、アプリ層より前段のネットワーク断が混在。
  - 到達不能時は `bridge` 実体状態（service active / alias 保持）を取得できず、アプリ原因の断定は不可。

#### Hypothesis K: 音声失敗の主因は `.mp3s` ストリーム供給不足

- **PARTIALLY CONFIRMED**。
- 根拠:
  - `mp3StreamingUrl(.mp3s)` 直再生では `avail=0` 連発後 `MP3:ERROR_BUFLEN 0` を高頻度に再現。
  - `mp3DownloadUrl(.mp3)` 優先で 404 になるケースがあり、URL種別だけでは不十分。
  - URLプローブ後に `.mp3` を選択しても `BUFLEN` が残る回があり、I2S 切替競合が併発。

#### Hypothesis L: ストリーム直再生をやめれば安定する

- **PARTIALLY CONFIRMED**（完全解消には未到達）。
- 実装:
  - `WebVoiceVoxTTS.cpp` を「URL選定（`200` チェック）→ MP3をSPIFFS保存 → `playMP3SPIFFS` 再生」へ変更。
  - `writeToStream` 経由で **`mp3 download bytes=99885 expected=99885`** を確認（欠損ダウンロードは解消）。
- 結果:
  - それでも `MP3:ERROR_BUFLEN 0` と `I2S: register I2S object to platform failed` が残る回あり。
  - したがって「ダウンロード欠損」は一因だが、根本は I2S ライフサイクル競合を含む。

### Root cause（現時点）

- **複合要因**:
  1. 時間帯によって **private Pi5 / DGX へのネットワーク到達不能**が発生し、Spark 連携可否の判定自体が不安定。
  2. 到達可能時でも、デバイス側の音声再生経路で **`BUFLEN` + I2S 競合**が残り、失敗文言発話に繋がる。

### Fix / Mitigation（実施済み）

- ファーム側:
  - MP3 URL選定を `HTTP 200` 確認付きへ変更。
  - `.mp3` を SPIFFS に保存してから再生する経路へ切替（ストリーム依存を削減）。
  - `playMP3` の Mic/Speaker 切替に遅延と成否ログを追加。
- 診断側:
  - `debug_stackchan_audio_probe.py` を強化（シリアル切断・Ansible失敗を握りつぶして継続採取）。

### Prevention / Next actions

- private Pi5 / DGX 到達性が落ちたときは、先に **ネットワーク断**として扱い、アプリ改修判定を止める。
- 音声系は text 経路と分離し、`download complete` / `mp3 begin` / `loopFalse` / `I2S error` を同一 run で採取して判定する。
- I2S 競合は `Mic↔Speaker` 切替経路の一元化（排他・順序固定）を優先して詰める。

## 2026-05-11 最終（night）: 会話 E2E 成立

### Context

- 上記 late 調査後、STT 経路を private Pi5 bridge に統合し、音声再生の既知失敗経路（I2S 再初期化・chunked MP3 保存失敗）を順に修正した。
- 目的は「WakeWord から返答発話までを連続で成立させること」。

### Root cause（最終）

- 音声会話不成立は単一原因ではなく、主に以下の複合だった。
  1. 旧 `M5Unified` での I2S 再初期化競合（`I2S: register I2S object to platform failed`）
  2. VOICEVOX 応答が chunked transfer の場合に MP3 保存が欠損し得る実装
  3. STT 経路が private Pi5 bridge 側で未実装だった初期構成

### Fix

- `platformio.ini` で `M5Unified` を `0.1.17` -> `0.2.7` へ更新。
- `WebVoiceVoxTTS.cpp` の MP3 ダウンロードを chunked transfer 対応の手動保存へ置換し、`bytes=-11 expected=-1` を解消。
- private Pi5 bridge に `POST /api/stackchan/stt`（`stt_bridge_core.py` / `stt_runtime_client.py`）を追加し、`faster-whisper-local` で運用。
- `CloudSpeechClient.cpp` から raw WAV を bridge STT endpoint へ送る構成へ変更（`STT_BRIDGE_*` マクロ）。
- 実機 UI 側は仮想 `BtnB` / `BtnA` の操作経路を整え、ウェイクワード登録・有効化を再現可能化。

### Result

- 実機で **WakeWord -> STT -> LLM -> TTS** が成立し、ユーザー音声質問に対する返答発話を確認。
- 以降の運用上の注意は「ファーム再書き込み後はモードが初期化されるため、ウェイクワード登録/有効化を再実施する」。

## 2026-05-11 追加: Realtime API 先行導入時の失敗履歴（上流由来）

### Context

- 5秒級応答を狙うため Realtime API を先行検討する要求があり、現仕様（text/STT/TTS 分離）へ至った背景を再確認した。
- 参照した上流は `ronron-gh/AI_StackChan_Ex` の Realtime 関連コミット群。

### Confirmed history

- `db27921`: Core2 で Realtime + TTS を同時有効化するとヒープ不足が出るため、録音バッファを静的配列化。
- `7362c03`: Realtime WebSocket イベント処理の優先度不足で音声が途切れるため、高優先タスクへ移行。
- `31fec2e`: Gemini Live の改善が OpenAI Realtime に副作用を出し、`delay(1)` 追加で調整。
- `f28b966`: 非Realtime ビルドで WebSocket 依存を除外し、通常経路への副作用を遮断。

### Decision

- Realtime 化は「一括切替」ではなく、**Realtime本体 -> 計測 -> TTS拡張**の順で段階導入する。
- 既存 private Pi5 bridge 経路はロールバック経路として維持する。
- Spark（DGX）Realtime 化は gateway 側 WebSocket 境界の追加が必要で、現行 text API とは別トラックで扱う。

## 2026-05-11 追加（night）: Realtime 先行導入の仕様不整合と復旧

### Context

- 5秒級応答を狙った試行として、`AI_StackChan_Ex` の Realtime API（OpenAI/Gemini WebSocket）を先行導入した。
- その後、運用正本仕様が **`faster-whisper (private Pi5) + Qwen3.6 on DGX Spark + VOICEVOX + Home Assistant + StackChan`** であることを再確認した。

### Symptoms

- 実機に `RealtimeAPIKeyError` が表示され、連続会話が成立しない。
- Realtime 経路では `AI_StackChan_Ex` が OpenAI/Gemini 向けセッションを前提としており、Spark（text API）とは境界が一致しない。

### Root cause

- 障害の主因は API キー文字列の有無ではなく、**Realtime 経路の境界そのものが Spark 現行仕様と不整合**だったこと。
- すなわち、既存の private Pi5 bridge（HTTP text/STT 境界）を使う構成に対し、Realtime WebSocket 境界を混在させたことが原因。

### Fix

- Realtime 先行導入を停止し、**Spark 正本経路（WakeWord -> STT -> LLM -> TTS）へロールバック**。
- CoreS3 実機で物理ボタンを使えない構成向けに、UI タッチから `BtnA`/`BtnB(long)` 相当を呼べる経路を戻し、**ウェイクワード登録・有効化を再運用可能化**。
- 以降、Realtime は「Spark 側に WebSocket 境界が実装された場合のみ」別トラックで再評価する。

### Prevention

- 「遅延改善策」を入れる前に、**現在の正本境界（Spark/text か Realtime/WebSocket か）を先に固定**する。
- 仕様不整合が疑われる場合は、まず text 経路の完了条件（`replyText` 実発話）に戻してから次の改善を行う。

## 2026-05-13 追補: `CHATGPT_API_URL` ドリフト・bridge リクエスト読取タイムアウト・URL 境界の錯覚・調査上の断定ルール

### Context

- 再ビルド・SD 再配置・ローカル `pio run` だけの書き込みを繰り返すと、**ビルドフラグ無しで OpenAI 直結既定へ戻る**・**別パスを見ている**・**bridge が本文を読み切る前にタイムアウトする**、が混ざり、ログ断片だけで「原因確定」しやすい。
- 本リポジトリは **手順・supply-chain lock・パッチ**の正本だが、**編集・flash した `ChatGPT.cpp` 等の実体**は多くの場合 **clone 作業ツリー**（例: `/tmp/AI_StackChan_Ex`）側にあり、**Git の `main` だけを見て実機ファームと一致していると決めつけない**。

### Symptoms

- private Pi5 の **`journalctl -u stackchan-bridge`** に **会話用 `POST /api/stackchan/chat/simple` が一切出ない**のに、実機だけがクラウド側や別ホストへ向いている。
- STT 実行直後、bridge 側に **`request read timeout after …s`**（`STACKCHAN_REQUEST_READ_TIMEOUT_SEC` を正にした場合）と **`408` / `REQUEST_TIMEOUT`**。StackChan シリアルでは **HTTP read 失敗**、`errno` **`-11`**（環境により `EAGAIN` 系の読取タイムアウトとして表現）が混在しうる。
- OpenAPI や DGX の **`/v1/chat/completions`** などと、StackChan が実際に叩く **`http://<Pi5>:18080/api/stackchan/chat/simple`** を混同し、「経路は合っている」ように見える。

### Investigation

- **CONFIRMED（構成）**: `AI_StackChan_Ex` 系では **`CHATGPT_API_URL` をビルド時マクロで明示**しない限り、**OpenAI API 向け既定 URL**へ落ちうる。**`PLATFORMIO_BUILD_FLAGS='-DCHATGPT_API_URL=...'` 無しの `pio run` は設定ドリフトの典型**。
- **CONFIRMED（bridge 実装）**: private Pi5 bridge（`bridge_server.py`）は **`STACKCHAN_REQUEST_READ_TIMEOUT_SEC` が正の値のときだけ** `do_POST` で **`connection.settimeout(...)`** を掛け、**本文読取**がその秒数を超えると **`socket.timeout`** として **`408` / `request read timed out`** を返す。**未設定・空・`0`・解析不能時は無効**（従来どおりブロッキング読取で上限なし）。**STT の生 WAV** は **チャット JSON よりボディが大きく**、上限を**狭く**しすぎるとここで落ちうる（上流の `STT_UPSTREAM_TIMEOUT_SEC` や `faster-whisper` 処理時間とは**別レイヤ**）。
- **CONFIRMED（bridge 実装・2026-05-13 追加）**: 音声会話では長文生成と thinking が遅延/無発話に見えやすいため、private Pi5 bridge は `STACKCHAN_CHAT_DEFAULT_MAX_TOKENS=160` / `STACKCHAN_CHAT_MAX_TOKENS_CAP=192` / `STACKCHAN_CHAT_MAX_MESSAGES=8` / `STACKCHAN_CHAT_ALLOW_THINKING=false` を標準値として持つ。`faster-whisper-local` は短発話で VAD が空結果を返す場合に、`STT_LOCAL_RETRY_WITHOUT_VAD=true` なら **language 自動判定 + VAD 無しで1回再試行**する。必要時のみ `STT_LOCAL_FALLBACK_TO_UPSTREAM_ON_EMPTY=true` で上流 STT へフォールバックできる。
- **観測補助**: セッション調査で **`log_message` に route や STT 成否を追加**したことがある。本番の `main` 実装では必須ではないが、**`journalctl` で path・`stt success` 行**を追うと chat / STT / upstream の層が分かれる。
- **INCONCLUSIVE until 連続 E2E**: **`openapi` のパス誤記や単発 `curl` 成功**だけで「本番経路は直った」と**閉じない**。**WakeWord → STT → LLM → TTS** が**同一条件で複数回**通るまで、ドキュメント・口頭とも **仮説段**として扱う（過去に Realtime / Spark 境界と同一系の**早すぎる確定**が問題になった教訓）。

### Fix / Mitigation

- **毎回** `PLATFORMIO_BUILD_FLAGS` に **私用 Pi5 bridge の URL をフルで固定**する。`replyText` 安定を優先するなら **`.../api/stackchan/chat/simple`**（詳細は [text-only runbook](../runbooks/stackchan-community-text-only-e2e.md)）。
- STT や大きめボディを扱うなら Pi5 bridge の `.env` で **`STACKCHAN_REQUEST_READ_TIMEOUT_SEC`** を **30〜120** 秒規模へ**明示設定**し（**未設定は無制限読取**）、**`stackchan-bridge` を再起動**。上流 STT の **`STT_UPSTREAM_TIMEOUT_SEC`** や **`faster-whisper`** の VAD 設定は **その内側**の別ノブ。
- 短い呼びかけが `聞き取れない` になる場合は、まず `STT_LOCAL_RETRY_WITHOUT_VAD=true` の反映と `STT_LOCAL_VAD_FILTER` を確認する。短文優先なら `STT_LOCAL_VAD_FILTER=false`、安定した上流 STT がある場合だけ `STT_LOCAL_FALLBACK_TO_UPSTREAM_ON_EMPTY=true` を検討する。
- 宛先 IP は **DHCP ドリフト**と **compat alias**（既存節）をセットで見る。

### Prevention

- CI に乗らない **実機ファーム**は、**ビルドコマンド（env の全文）を作業メモに残す**。「直近成功したフラグセット」と **ずれたビルド**を無意識に flash しない。
- **分報ログだけで root cause を確定扱いにしない**。**bridge ログ・実機シリアル・Mac `curl` の path/HTTP を同一時刻で突き合わせる**。

## 2026-05-14 追補: private Pi5 bridge 実装（低遅延 chat・STT 再試行・Home Assistant 読み取り context）

### Context

- 別案件への切り替えに先立ち、このリポジトリ側で **音声インタラクション向けの bridge 機能**を進め、`main` に取り込む前提で文書とコードを同期した。
- 目標アーキテクチャ（正本）は変わらない: **`faster-whisper`（私用 Pi5）→ Qwen3.6 on DGX Spark → VOICEVOX（デバイス）→ StackChan**。Home Assistant は **まず読み取り専用 context** から開始する。

### 仕様（リポジトリ実装）

- **Chat 検証・低遅延既定**（`stackchan_chat_core.py` の `ChatValidationConfig`、`bridge_server.py` が環境変数で上書き可）  
  - 既定値の例: **`maxTokens` デフォルト 160**、**上限キャップ**、**会話メッセージ本数上限**（先頭の `system` 1 件は維持しつつトリム）、**`enableThinking` は既定で効かせない**（`STACKCHAN_CHAT_ALLOW_THINKING` で許可）。
- **`faster-whisper-local` の短発話耐性**（`stt_runtime_client.py`）  
  - 初回: 既定言語（例 `ja`）+ `vad_filter=true` で推論。  
  - **空文字なら 1 回だけ**、`language=None`（自動判定相当）かつ **`vad_filter=false`** で再試行（`STT_LOCAL_RETRY_WITHOUT_VAD`。既定で有効化しやすい）。  
  - それでも空なら、任意で **`STT_LOCAL_FALLBACK_TO_UPSTREAM_ON_EMPTY=true`** により上流 transcription（`upstream-openai`）へフォールバック。
- **Home Assistant（読み取り専用）**（`home_assistant_client.py`）  
  - **`HOME_ASSISTANT_CONTEXT_ENABLED=true`** かつ base URL・token・**カンマ区切り entity allowlist**（`HOME_ASSISTANT_CONTEXT_ENTITIES`）が揃っているときのみ有効。  
  - **`GET /api/states/<entity_id>`** で取得した状態を 1 行ずつ整形し、**先頭に `system` メッセージ**として LLM に付与（**デバイス制御はしない**）。
- **Ansible / `.env.example`**: `private_pi5_stackchan_chat_*`、`private_pi5_stt_local_*`、`private_pi5_home_assistant_*` と playbook の同期ファイルリストに **`home_assistant_client.py`** を追加済み。
- **回帰テスト**: `scripts/private-pi5-stackchan-bridge/tests/` に `test_stt_runtime_client.py`・`test_home_assistant_client.py` を追加し、既存 `test_stackchan_chat_core.py` を追随。

### 運用上の順序（再開時）

1. 私用 Pi5: playbook 再適用後 **`/healthz`** と **`POST /api/stackchan/chat/simple`**（Mac から）で LLM 層が生きていることを確認。  
2. 続けて **`POST /api/stackchan/stt`**（短文 WAV）で `STT_LOCAL_*` が期待どおりか `journalctl` で確認。  
3. StackChan 実機へ戻り、[text-only runbook の E2E チェックリスト](../runbooks/stackchan-community-text-only-e2e.md#e2e-checklist-text-then-audio) に沿って **WakeWord→STT→chat→TTS** を順に復活させる。

## 2026-05-14 追補: 実機ワークストリーム（ウェイクワード登録／オフラインモード／シリアル）— **本 repo 未コミットの試行含む**

### Context

- セッション後半では **上流 `AI_StackChan_Ex` のクローン作業ツリー**（開発者環境では例として `/tmp/AI_StackChan_Ex`。**パスは環境依存**）上で、`AiStackChanMod.cpp` / `WakeWord.cpp` を試験編集していた。**これらの C++ 差分は RaspberryPiSystem_002 の `main` には載っていない**。再開時は「どのツリーでビルドしたか」と **SHA／パッチ一覧**を必ず自分で固定すること。
- 観測された課題の主軸は **「UI（右タッチ＝ BtnB long 相当）は成功しているが、ウェイクワード登録で音声が取れていない／処理が終わらない」**と **ネットワーク未接続**の切り分け。

### Symptoms

- **`Smart Config failed. Running in offline mode.`** と周辺ログが出て **Wi-Fi IP が取得できない**局面と、ウェイクワード登録で **`ウェイクワード登録開始` が長時間終わらない**局面が混在しうる。**オフラインでもタッチ UI は進む**ため、**「タッチが効く = ネットワークとマイクが正常」ではない**。
- ウェイクワード登録で **自分の発話が反映されない**（登録インデックスに進まない、無音相当）。
- `pio run … -t upload` が **`Could not open /dev/cu.usbmodem… port doesn't exist`** で失敗（USB 経路またはポート名の変化）。

### Investigation

#### Hypothesis M: 「登録開始のまま」は VAD/録音経路だけの問題である

- **PARTIALLY CONFIRMED（設計論点）**。  
  根拠: 登録側が **`rxMic()` など VAD 待ち主体**だと **無音扱いのまま進まず**ユーザーには「終わらない」に見える。対策案として試したのは **通常 STT と同様の固定時間録音**（コードベースにより `Audio::Record()` の 3 秒録音）へ寄せて **無音でもバッファは埋まる**経路を確保すること。ただし **実測での「音声が載った」証明まで到達しないケース**が残った。
- **区別**: **タイムアウトでモード復帰**させる処理はユーザー体験の安全策になるが、「マイクが死んでいる」疑惑には **ピーク検出ログ／画面表示**などの別証拠が必要（次項）。

#### Hypothesis N: マイク未入力または `M5.Mic` とスピーカ切替競合ではないか

- **INCONCLUSIVE**（2026-05-14 時点・本セッション打ち切り）。  
  検証計画として **録音波形の統計（例: peak、平均絶対値）をシリアルとディスプレイに出す**改修を検討したが、**USB ポート消失**により当該ビルドの書き込み確認まで至らず。

#### Hypothesis O: 「オフラインモード」のままだと音声対話チェーン全体が検証にならない

- **PARTIALLY CONFIRMED**。  
  根拠: SD カードの `wifi.txt` / `yaml/SC_SecConfig.yaml` 不備、Smart Config 失敗、または誤った SSID/パス（`O`/`0` 混同等）により **スタック状態**になると、**HTTP での `/chat` や upstream 側の問題と独立に**音声パイプラインの期待動作が揃わない。**まず LAN IP と bridge への到達を正本**として直す。

#### Hypothesis P: macOS 上で `pio device monitor` が使えない

- **OBSERVED**。  
  ある環境では **`termios.error: (19, 'Operation not supported by device')`** が出て PlatformIO のデバイスモニタが使えなかった。**回避策**: `pyserial` 等で **`/dev/cu.usbmodem*` を直接読む**、`screen`/`minicom` の利用、またはログを UART 側に限定する別手段。

### Fix / Mitigation（試行済み・または推奨の次ステップ）

- **優先順（再度ブリングアップするときの固定順）**: microSD と Wi-Fi が **`0.0.0.0` でない実 IP** を取るまで、ウェイクワードや STT の結論を出さない。既存 Prevention（YAML+txt 併置、パスワード誤記確認）に従う。
- **登録処理が VAD で止まりうる**場合: 上流ファーム側で「固定秒録音」経路との差分をレビューし、**ログで `record_size`/ピークが 0 に近くないか**を必ず確認。
- **USB フラッシュ**: `ls /dev/cu.usbmodem*` でポートを確認し、抜き差し後に **`pio … --upload-port`** をやり直す。

### Prevention

- 「タッチイベントが取れている」を **音声入力またはネットワークの正常の代理指標にしない**。  
- 実機差分は **上流リポジトリの fork/tag** または **このリポジトリの patch ディレクトリ**（[`ai_stackchan_ex_private_bridge.patch`](../../scripts/private-pi5-stackchan-bridge/patches/ai_stackchan_ex_private_bridge.patch) のように）へ昇格しない限り、**同じ問題を別マシンで再現できない**。

### Current status（2026-05-14）

- **リポ側**: bridge の chat/STT/Home Assistant context 機能と Ansible/Runbook/README/KB の整合を **`main` へ載せる**のが本分。  
- **実機ウェイクワード/マイク**: **未解決**。次は Wi-Fi とオフラインモードの根治 → 波形統計ログ付きファームでの **死活確認** を推奨。

## 2026-05-23: 私用 Pi5 `utterance` 一括 API・ファーム overlay・実機ブリングアップ（**作業中断**）

### Context

- **上流ファーム**: [`ronron-gh/AI_StackChan_Ex`](https://github.com/ronron-gh/AI_StackChan_Ex)（供給鎖固定: [`supply-chain-lock.json`](../../scripts/stackchan-ai-stackchan-ex/supply-chain-lock.json) の `pinned_commit` = `d894859648d4323044761cd49615694027abeb25`）。
- **目標アーキテクチャ（継続）**: **faster-whisper（private Pi5）→ Qwen3.6 on DGX Spark → VOICEVOX（デバイス）**。職場 Pi5 API（`POST /api/system/stackchan/chat`）とは **別系統**（[計画 §2系統](../plans/stackchan-private-pi5-tailnet-workflow-plan.md#two-path-architecture-private-work-2026-05-10)）。
- **今回の設計判断**: ESP32 が **STT → LLM → TTS** を多段 HTTP するのをやめ、**私用 Pi5 で 1 リクエストに集約**（`POST /api/stackchan/utterance`）。Realtime API / xiaozhi 全面移行は **見送り**。
- **作業状態**: リポ実装・実機書き込み・部分疎通まで進んだが、**画面真っ黒・無音・USB シリアル消失**で **実機復旧が未完了のまま中断**（2026-05-23）。

### 仕様（repo 正本）

| 層 | 成果物 | 役割 |
|----|--------|------|
| Pi5 bridge | [`stackchan_utterance_core.py`](../../scripts/private-pi5-stackchan-bridge/stackchan_utterance_core.py) | WAV → STT（`SttWorkflow`）→ chat（`ChatCompletionWorkflow`）→ `{ sttText, replyText }` |
| Pi5 HTTP | [`bridge_server.py`](../../scripts/private-pi5-stackchan-bridge/bridge_server.py) | `POST /api/stackchan/utterance`（`audio/wav` 生バイナリ or JSON `audioBase64`） |
| テスト | [`tests/test_stackchan_utterance_core.py`](../../scripts/private-pi5-stackchan-bridge/tests/test_stackchan_utterance_core.py) | ワークフロー単体（**20 件 OK** をローカルで確認） |
| Ansible | [`private-pi5-stackchan-bridge.yml`](../../infrastructure/ansible/playbooks/private-pi5-stackchan-bridge.yml) | `stackchan_utterance_core.py` を Pi5 同期対象に追加 |
| ファーム適用 | [`apply_chatgpt_private_bridge.py`](../../scripts/stackchan-ai-stackchan-ex/apply_chatgpt_private_bridge.py) | `ChatGPT.cpp` の private bridge POST / `replyText` パース（**`git apply` 不可の monolithic patch の代替**） |
| ファーム overlay | [`apply_utterance_overlay.py`](../../scripts/stackchan-ai-stackchan-ex/apply_utterance_overlay.py) + [`firmware-overlay/`](../../scripts/stackchan-ai-stackchan-ex/firmware-overlay/) | `PrivateBridgeUtterance.*`・`STT_ChatGPT` から **utterance 優先** |
| Mac USB | [`mac_usb_dev.sh`](../../scripts/stackchan-ai-stackchan-ex/mac_usb_dev.sh) | clone / パッチ / `PLATFORMIO_BUILD_FLAGS`（`CHATGPT_API_URL` + `STACKCHAN_UTTERANCE_URL`）/ build / upload / monitor |

**ビルドフラグ（CoreS3 / `m5stack-cores3`）**:

- `CHATGPT_API_URL` → `http://<私用Pi5-LAN-IP>:18080/api/stackchan/chat/simple`（履歴・フォールバック）
- `STACKCHAN_UTTERANCE_URL` → `http://<私用Pi5-LAN-IP>:18080/api/stackchan/utterance`（会話 1 回）
- `CHATGPT_API_USE_AUTH_BEARER=0`（トークンは任意で `CHATGPT_STACKCHAN_TOKEN`）

**注意**: [`patches/ai_stackchan_ex_private_bridge.patch`](../../scripts/private-pi5-stackchan-bridge/patches/ai_stackchan_ex_private_bridge.patch) は **二重 diff で `git apply` 不可**。適用は **`apply_chatgpt_private_bridge.py` を正**とする。

### 実測ネットワーク（自宅 LAN・2026-05-23）

| 機器 | アドレス | 備考 |
|------|----------|------|
| Mac | `192.168.128.191` | 開発端末 |
| 私用 Pi5 | `192.168.128.113`（`112` は compat alias・同一 MAC） | bridge `:18080` |
| StackChan（CoreS3） | `192.168.128.116` | USB MAC 付近 `44:1b:f6:e2:7a:e0` |
| DGX（Tailscale） | `http://100.118.82.72:38081` | LLM upstream |

### Symptoms（時系列）

#### フェーズ A: SD / Wi-Fi（起動ループ・Smart Config）

- `Failed to open SD.` / `/sd/yaml/SC_BasicConfig.yaml does not exist`（**`read_sd_file` 由来**。`main.cpp` の `SD.begin` 成功後でも servo 等の個別ファイルで出うる）。
- `WiFi connection failed` → **`Waiting for SmartConfig`**（画面 `#####`）で「起動しない」ように見える。
- **CONFIRMED（過去 KB と同型）**: microSD 未挿入・接触不良・`SC_SecConfig.yaml` 不備・パスワード誤記（`O`/`0`）。

#### フェーズ B: シリアルは正常・画面のみ真っ黒（2026-05-23 昼）

- USB シリアルでは **`Successfully established a Wi-Fi connection`**・`192.168.128.116`・`HTTP server started`・アバター初期化・ヒープ OK まで進む。
- ユーザー観測は **起動直後 1〜2 秒も文字が出ない・スピーカー無音**。
- シリアルでは **`[UTTERANCE] record start` / `POST .../utterance`** が **ウェイクワードまたはタッチ**で繰り返し出る。
- **`[UTTERANCE] POST failed: connection refused`**（Pi5 bridge 未到達 or `stackchan-bridge` 停止）。
- **切り分け**: **MCU・Wi-Fi・ファームは動作**している可能性が高い。**表示バックライト / LCD / 排線**、または **メインループが utterance 同期 POST で長時間ブロック**して UI が更新されない、の二系統。

#### フェーズ C: 完全無反応（2026-05-23 夕・作業中断直前）

- **起動文字なし・音なし・`/dev/cu.usbmodem*` なし**（Mac で `ls /dev/cu.usb*` が空）。
- **ファーム破損だけでは説明しにくい**（通常は USB CDC は出る）。**USB 未接続・充電専用ケーブル・電源 OFF・本体故障**を優先疑い。

### Investigation

| 仮説 | 結果 | 根拠 |
|------|------|------|
| utterance ファームが起動直後に必ず落ちる | **REJECTED** | シリアルで setup 完走・HTTP 起動を確認（フェーズ B） |
| SD 未読込で `ESP.restart()` ループ | **PARTIAL** | `SD.begin` 失敗時は `Failed to load SD card settings` → 5 秒再起動（`main.cpp`）。フェーズ B では Wi-Fi まで進んでいる |
| Pi5 `/utterance` 未デプロイ | **CONFIRMED（初回）** | 初回 deploy 後 **404** → 再 deploy でルート有効化 |
| DGX `/v1/audio/transcriptions` 不足 | **CONFIRMED** | `STT_PROVIDER=upstream-openai` 時、upstream STT が **404** → **`private_pi5_stt_provider=faster-whisper-local`** で再デプロイ |
| bridge へ POST `connection refused` | **CONFIRMED** | 実機シリアル・Mac から `113:18080` タイムアウトの時期あり |
| 画面真っ黒 = ソフトのみ | **INCONCLUSIVE** | シリアル正常とユーザー無表示の矛盾 → **ハード層**を疑うべき |
| USB ポート消失 = ケーブル/電源 | **LIKELY** | Mac に **usbmodem デバイスゼロ** |

### Fix（実施済み）

- private Pi5: **`stackchan_utterance_core.py`** 追加・playbook 同期・`POST /api/stackchan/utterance` ルート。
- STT: Ansible **`private_pi5_stt_provider=faster-whisper-local`** 再デプロイ（DGX transcription API 不要）。
- ファーム: `apply_chatgpt_private_bridge.py`（`ChatGPT::chat()` 削除事故を `\nvoid ChatGPT::chat` 基準で回避）、`apply_utterance_overlay.py`、`mac_usb_dev.sh`。
- CoreS3 へ **USB upload 成功**（`m5stack-cores3`、ビルドフラグで Pi5 `113` 向け utterance URL）。

### Prevention / 再開時の固定順

1. **ハード**: データ対応 USB 直結 → `ls /dev/cu.usb*`。**出ない**場合は **BOOT 押しながら USB 挿入**（ダウンロードモード）→ それでも出なければ **本体電源・ケーブル・基板**。
2. **シリアル**: `STACKCHAN_USB_PORT=/dev/cu.usbmodem* ./scripts/stackchan-ai-stackchan-ex/mac_usb_dev.sh monitor`（`pio device monitor` が `termios` で失敗する場合は **pyserial 直読**）。
3. **SD + Wi-Fi**: `yaml/SC_SecConfig.yaml`・`app/AiStackChanEx/SC_ExConfig.yaml`・任意 `wifi.txt`。**実 IP ≠ `0.0.0.0`** まで進めてから音声検証。
4. **Pi5 bridge**: `curl -fsS http://127.0.0.1:18080/healthz` → **`POST /api/stackchan/utterance`**（短文 WAV）→ `journalctl -u stackchan-bridge`。
5. **IP 整合**: `hostname -I`（Pi5）とファームの **`CHATGPT_API_URL` / `STACKCHAN_UTTERANCE_URL`**・compat alias（`192.168.128.112`）。
6. **utterance E2E**: ウェイクワード **右タッチ登録 → 左タッチ有効化**（再フラッシュ後は必須）。
7. **完了判定**: [text-only 完了条件](../runbooks/stackchan-community-text-only-e2e.md#text-only-done-criteria) に加え、**utterance 1 回で `replyText` が聞こえる**こと。

### Current status（2026-05-23・中断時点）

| 項目 | 状態 |
|------|------|
| repo: `POST /api/stackchan/utterance` + テスト + Ansible | **実装済み**（本セッションで `main` へマージ予定） |
| Pi5 bridge 実機デプロイ | **部分**（`/utterance` 404 → 再 deploy で解消した記録あり。最終は `connection refused` 観測あり） |
| ファーム utterance overlay | **書き込み済み**（疎通未完了） |
| 実機表示・音声 | **未復旧**（真っ黒・無音・USB 未認識） |
| utterance E2E（聞こえるまで） | **未完了** |

**次のタスク（再開時）**: 実機 **USB 認識・電源** の復旧 → シリアルで boot 完走確認 → Pi5 bridge 到達 → utterance WAV スモーク → WakeWord 再設定。

## 2026-05-31: voice-turn 再設計（Pi5 VOICEVOX 正本・utterance 除外）

### Decision

- **初期正本**を `POST /api/stackchan/voice-turn` に変更。StackChan は **録音 → WAV POST → `audioUrl` 再生**のみ。STT / LLM / VOICEVOX / 会話状態は **私用 Pi5 bridge**。
- **`POST /api/stackchan/utterance`** と [`apply_utterance_overlay.py`](../../scripts/stackchan-ai-stackchan-ex/apply_utterance_overlay.py) は **新規 Mac USB フローから除外**（2026-05-23 実機不安定化の再発防止）。
- [`mac_usb_dev.sh`](../../scripts/stackchan-ai-stackchan-ex/mac_usb_dev.sh) safe mode（**既定**）: `CHATGPT_API_URL=/api/stackchan/chat/simple` のみ。録音 overlay は `STACKCHAN_ENABLE_VOICE_OVERLAY=1` の明示 opt-in。`setup` は毎回 [`revert_firmware_overlays.py`](../../scripts/stackchan-ai-stackchan-ex/revert_firmware_overlays.py) で `PrivateBridge/` 削除と overlay 変更ファイルを `git checkout` 復元してから chat パッチを当てる。
- Pi5 `audioUrl` は **`VOICE_AUDIO_PUBLIC_BASE_URL`（または compat IP から Ansible 自動設定）必須**。未設定時は `127.0.0.1` にフォールバックしない。

### Repo 成果物

| 層 | ファイル | 役割 |
|----|----------|------|
| Pi5 | [`voice_assistant_core.py`](../../scripts/private-pi5-stackchan-bridge/voice_assistant_core.py) | STT → chat → VOICEVOX → `audioUrl` |
| Pi5 | [`bridge_server.py`](../../scripts/private-pi5-stackchan-bridge/bridge_server.py) | `POST /voice-turn`・`GET /audio/<id>.wav` |
| ファーム | [`apply_voice_rework_overlay.py`](../../scripts/stackchan-ai-stackchan-ex/apply_voice_rework_overlay.py) | `PrivateBridgeVoiceTurn`・`private-bridge/*` Web ルート |
| テスト | [`test_voice_assistant_core.py`](../../scripts/private-pi5-stackchan-bridge/tests/test_voice_assistant_core.py) 等 | ワークフロー・safe mode 分岐 |

### 実機検証（未実施・再開時）

1. 公式／安定ファームで USB・表示復旧（utterance 書き込み機は **safe mode 再 flash**）。
2. Pi5: `VOICEVOX_*`・`VOICE_AUDIO_PUBLIC_BASE_URL`（StackChan から到達可能な Pi5 URL）。
3. `mac_usb_dev.sh all` → シリアル `[VOICE] POST` → `audioUrl` GET 再生。

## 2026-05-31: safe mode 後の黒画面 → 公式復旧 → CoreS3 probe 方針

### Symptoms

- safe mode（`STACKCHAN_ENABLE_VOICE_OVERLAY=0`）upload 後、画面真っ黒。USB JTAG/serial は Mac から認識。
- フル erase + esptool で公式 bin 書き込み後も黒画面の事例あり。

### Fix（復旧）

- 完全電源 OFF → USB 挿し直し → 電源 ON で公式画面復旧した報告あり。
- 復旧しない場合は **M5Burner** で公式ファームを優先（単体 bin より初期化が揃う可能性）。

### Prevention / 次の正本

- **voice-turn が原因ではない**（overlay 無しでも不安定）→ `AI_StackChan_Ex` 再 flash より **CoreS3 bring-up probe** を先に実施。
- 正本（**停止中**）: [stackchan-cores3-bringup-probe.md](../runbooks/stackchan-cores3-bringup-probe.md)

### 2026-05-31: Step C（Avatar-only）— シリアル OK・画面 FAIL

- **CONFIRMED**: `cores3-probe-stepc` upload 後、Serial は `avatar: init OK`・再起動ループなし。
- **CONFIRMED**: 実機目視は **真っ黒**（probe テキスト・顔とも見えない）→ **Step C は FAIL**。Step D（safe mode）へは進めない。
- **切り分け probe**: **停止**（2026-05-31）。Step B 再確認も目視真っ黒（シリアル・SD・YAML 正常）。E2 / C 系 / 本体 upload は行わない。
- **復旧**: `erase_flash` + `StackChan-UserDemo-V1.4.1.bin` @ 0x0（esptool）。**probe は復旧確認後も即 upload しない**。

### 2026-05-31: CoreS3 表示 — 確定結論（probe 全面停止）

**Status**: StackChan 実機への **probe / `AI_StackChan_Ex` upload 全面停止**。当面 **追加 flash 禁止**。実機は **公式ファームのまま**。

| 確定 | 内容 |
|------|------|
| 公式 | **StackChan-UserDemo-V1.4.1** — full erase + write 後 **画面表示 OK** → **ハード故障ではない** |
| Step B | **以前一度**「CoreS3 probe B」表示できた。**その後**はシリアル・SD・3 YAML 正常でも **真っ黒**（再確認 2026-05-31） |
| E1 | **m5stack-avatar なし**・M5Unified/`M5Canvas` のみでも **真っ黒**（brightness=255、createSprite OK） |
| 原因 | **m5stack-avatar 単体ではない**。疑い: PlatformIO / M5Unified / board(`esp32s3box`) / Arduino core / LCD・backlight 初期化 / flash・partition・boot と **公式 stack-chan (IDF+LVGL)** の **表示互換性ギャップ** |
| 禁止 | **full `AI_StackChan_Ex`**、**safe mode**、**voice overlay**、**utterance overlay**、**bring-up probe 再 upload** |

**ADR**: [ADR-20260531-stackchan-cores3-probe-display-halt.md](../decisions/ADR-20260531-stackchan-cores3-probe-display-halt.md)  
**正本手順（履歴・全 Step ログ）**: [stackchan-cores3-bringup-probe.md](../runbooks/stackchan-cores3-bringup-probe.md)

#### 経緯（時系列）

| 日付 | 事象 | シリアル | 目視 |
|------|------|----------|------|
| 以前 | Step B 初回 upload | SD/YAML OK | **CoreS3 probe B 表示 OK** |
| 2026-05-31 | safe mode / probe 試行後 | 各 Step で論理正常多い | **黒画面化** |
| 同日 | Step C `avatar.init(16)` | init OK、再起動なし | 真っ黒 |
| 同日 | C1 `avatar.init()` | **xQueueGenericSend assert**、再起動ループ | 真っ黒 |
| 同日 | C2 loop+Avatar 同時描画 | overlay 数回後 **assert** | 真っ黒 |
| 同日 | C3 vendored avatar | init OK、再起動なし | 真っ黒 |
| 同日 | Step E スプライト+Face 単発 | createSprite OK、draw done | 真っ黒（未分離） |
| 同日 | E1 スプライトのみ | createSprite OK、brightness=255 | 真っ黒 |
| 同日 | Step B **再確認** | SD + 3 YAML OK | **真っ黒** |
| 同日 | 公式 UserDemo V1.4.1 | stack-chan 1.4.1、IlI9342/LVGL 起動ログ | **公式 UI 表示 OK** |

#### Probe 一覧（実測サマリ）

| ID | ディレクトリ | 目的 | lib | 目視 | シリアル特記 |
|----|--------------|------|-----|------|----------------|
| A/B | `cores3-probe/` | SD + YAML + 直接 `M5.Display` テキスト | M5Unified 0.2.7 | B: 以前 OK → 再確認 **FAIL** | 再確認: 3 YAML OK |
| C | `cores3-probe-stepc/` | `avatar.init(16)` のみ | GitHub avatar v0.8.2 | FAIL | 安定 |
| C1 | `cores3-probe-stepc1/` | `init()` colorDepth=1 | 同上 | FAIL | **assert ループ** |
| C2 | `cores3-probe-stepc2/` | 1Hz `fillScreen` 上書きテスト | 同上 | FAIL | loop vs drawLoop **競合** |
| C3 | `cores3-probe-stepc3/` | vendored avatar | AI_StackChan_Ex lib | FAIL | 安定 |
| E | `cores3-probe-stepe/` | スプライト + Face 1 回 | vendored | FAIL | 安定 |
| E1 | `cores3-probe-stepe1/` | **スプライトのみ** | avatar **なし** | **FAIL** | 安定 |
| E2 | `cores3-probe-stepe2/` | Face のみ（3s 待ち） | vendored | **upload 見送り** | build のみ |

#### PlatformIO probe 共通設定（`cores3-probe` 系）

| 項目 | probe 値 | 公式 UserDemo（参考） |
|------|----------|------------------------|
| platform | `espressif32@6.3.2` | ESP-IDF **v5.5.4**（シリアルログ） |
| board | `esp32s3box` | `m5stack-stack-chan` 専用 HAL |
| framework | Arduino | IDF native app |
| M5Unified | **0.2.7** | 不使用（専用 display スタック） |
| partition | `my_cores3_16MB.csv`（16MB） | OTA + assets 複合（公式ログ） |
| 表示 API | `M5.Display` / `M5Canvas` | **IlI9342** + **LVGL** + `StackChanAvatarDisplay` |
| バックライト | `setBrightness()`（probe 側） | AXP2101 + 専用 `Backlight` クラス（例: 75） |

**仮説（優先度順）**

1. **公式 stack-chan と Arduino 経路の LCD 初期化が別物**（パネルドライバ・バックライト PMIC・リセットシーケンス）。
2. **`esp32s3box` board 定義**が CoreS3 StackChan 実機のピン/バスと一致していない可能性（GPIO / SPI / RGB パネル差）。
3. **partition / boot 状態** — probe 書き込み後に公式 full erase で復旧したため、**壊れた partition や app 領域**の影響も否定できない（ただし Step B 一度表示できた事実と両立させるには「累積状態 or ハードリセット依存」も疑う）。
4. **vendored Face** の `M5Canvas(&M5.Lcd)` と `pushSprite(&M5.Display)` の混在（E 系）— ただし **E1 は avatar 無しでも黒**のため主因ではない。
5. **m5stack-avatar** — C3 で GitHub/vendored 差は主因ではないと判断済み。

#### トラブルシュート（再開時のチェックリスト）

1. **実機は公式ファームのまま**か（probe を焼いていないか）。
2. 公式が黒い場合 → USB 抜き差し / 電源 OFF → **M5Burner**（esptool 単体 bin より優先）。
3. probe 再開時は **Step A 相当の直接 `M5.Display` テキストのみ**から（スプライト・Avatar は後段）。
4. **Avatar 利用時** — `avatar.init()` は CoreS3 で **assert**。`init(16)` はシリアル安定だが目視黒。**`M5.Display` を複数タスクから無ロック共有しない**（C2 教訓）。
5. 公式と probe の **board 定義・起動ログ（IlI9342 / LVGL）** を並べて差分を取る。
6. Pi5 bridge / LLM は **表示問題解決後**に再開（`CHATGPT_API_URL` ビルドフラグ固定は従来どおり）。

#### 公式復旧コマンド（実施済み・参考）

```bash
export PORT=/dev/cu.usbmodem1101
python3 ~/.platformio/packages/tool-esptoolpy/esptool.py --chip auto --port "$PORT" --baud 921600 erase_flash
python3 ~/.platformio/packages/tool-esptoolpy/esptool.py --chip auto --port "$PORT" --baud 921600 \
  --before default_reset write_flash -z --flash_mode dio --flash_freq 80m --flash_size detect \
  0x000 /path/to/StackChan-UserDemo-V1.4.1.bin
```

書き込み後: **USB 抜き差しまたは電源リセット** → 公式 UI 目視確認 → **probe は焼かない**。

## References

- 手順の中心: [`scripts/stackchan-ai-stackchan-ex/README.md`](../../scripts/stackchan-ai-stackchan-ex/README.md)
- ブリッジ: [`scripts/private-pi5-stackchan-bridge/README.md`](../../scripts/private-pi5-stackchan-bridge/README.md)
- 計画: [`docs/plans/stackchan-private-pi5-tailnet-workflow-plan.md`](../plans/stackchan-private-pi5-tailnet-workflow-plan.md)
- 実機 text-only 検証: [`docs/runbooks/stackchan-community-text-only-e2e.md`](../runbooks/stackchan-community-text-only-e2e.md)
- Realtime 段階移行 Runbook: [`docs/runbooks/stackchan-community-realtime-api-migration.md`](../runbooks/stackchan-community-realtime-api-migration.md)
