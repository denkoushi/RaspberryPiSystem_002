---
title: "KB: StackChan コミュニティファーム（AI_StackChan_Ex）供給鎖・セキュリティ"
tags: [StackChan, supply-chain, firmware, security, Pi5, DGX]
audience: [開発者, 運用者]
last-verified: 2026-05-10
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
- **音声（STT/TTS）**は **デバイス側**で完結させ、bridge はテキスト境界を維持する（手順: [`scripts/stackchan-ai-stackchan-ex/README.md`](../../scripts/stackchan-ai-stackchan-ex/README.md) §5）。
- **text-only 完了条件の正本**: [`stackchan-community-text-only-e2e.md` §text-only-done-criteria](../runbooks/stackchan-community-text-only-e2e.md#text-only-done-criteria)
- **2026-05-10（`stackchan_chat_core` 同梱後）**: 私用 Pi5 へ **標準 playbook を再実行**し、**`PLAY RECAP` `ok=17` `changed=2` `failed=0`** を確認。playbook 付帯 **`/healthz` `200`** に加え、**Ansible `shell`** で **`systemctl is-active stackchan-bridge`・loopback `curl /healthz`・`stackchan_chat_core.py` 実在**を確認（詳細は [private-pi5-stackchan-bridge-deploy.md](../runbooks/private-pi5-stackchan-bridge-deploy.md) **実測記録** 節）。

## References

- 手順の中心: [`scripts/stackchan-ai-stackchan-ex/README.md`](../../scripts/stackchan-ai-stackchan-ex/README.md)
- ブリッジ: [`scripts/private-pi5-stackchan-bridge/README.md`](../../scripts/private-pi5-stackchan-bridge/README.md)
- 計画: [`docs/plans/stackchan-private-pi5-tailnet-workflow-plan.md`](../plans/stackchan-private-pi5-tailnet-workflow-plan.md)
- 実機 text-only 検証: [`docs/runbooks/stackchan-community-text-only-e2e.md`](../runbooks/stackchan-community-text-only-e2e.md)
