---

## title: StackChan 私用 Pi5 経由ワークフロー計画（会話反映）

tags: [StackChan, DGX Spark, Raspberry Pi 5, Tailnet, faster-whisper, VOICEVOX, Home Assistant]
audience: [開発者, 運用者]
last-verified: 2026-05-10
related:

- ../runbooks/dgx-system-prod-local-llm.md
- ../plans/dgx-spark-local-llm-migration-execplan.md
- ../runbooks/stackchan-community-text-only-e2e.md
- ../knowledge-base/KB-stackchan-community-firmware-supply-chain.md
- ../../scripts/stackchan-ai-stackchan-ex/README.md
- ../../EXEC_PLAN.md
category: plans
update-frequency: high

# StackChan 私用 Pi5 経由ワークフロー計画（会話反映）

## 目的

本ドキュメントは、2026-05-10 の会話で確定した方針を「そのまま作業計画」に落とし込み、進捗管理に使うための正本とする。

## 会話から確定した前提

- 業務用 Pi5 は職場にあり、自宅 Wi-Fi には参加していない。
- StackChan は自宅 Wi-Fi 側で使う。
- DGX Spark は自宅 Wi-Fi 側で使える。
- DGX Spark の安全方針は「入口をむやみに増やさない」。特に業務系の入口は維持する。
- 構成が複雑になりすぎる案（多段中継の暫定構成）は、保守負荷が高いので避けたい。
- 新品の Pi5 を自宅私用に使える。

## 会話で整理した結論（採用方針）

### 1) 機器分離を採用する

- 業務用 Pi5（職場）と、私用 Pi5（自宅）を分離する。
- 自宅の StackChan や将来の私用デバイスは、私用 Pi5 に集約する。

### 2) ネットワーク方針

- StackChan は自宅 Wi-Fi のまま（StackChan に Tailscale を直接入れる前提にはしない）。
- 私用 Pi5 を Tailnet に参加させ、必要に応じて外部連携の起点にする。

### 3) 推論リソース利用方針

- 私用ワークロードは「私用 Pi5 -> DGX Spark」で利用する。
- DGX 直叩きの経路は増やさず、私用 Pi5 側に入口を寄せる。

## 2系統アーキテクチャ（正本・2026-05-10 追記） {#two-path-architecture-private-work-2026-05-10}

| 経路 | クライアント | 境界ホスト | 上流 | ランタイム制御の契約 |
|------|--------------|------------|------|----------------------|
| **Private** | StackChan / 私用デバイス | **私用 Pi5** の `stackchan-bridge` | **DGX Spark**（gateway 直） | bridge 内 **`DgxUpstreamClient`**（[`dgx_runtime_client.py`](../../scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py)）。任意 **`DGX_RUNTIME_AUTO_START`** + **`DGX_RUNTIME_CONTROL_TOKEN`** で **`/start` → `GET /v1/models` 待ち → chat 1 回再試行**（502/503 および初回 `URLError` 時）。**職場 Pi5 API の単一キュー・JWT とは無関係**。 |
| **Work** | Pi4 / Pi3 等 | **職場 Pi5 API** | DGX Spark | `stackchan_chat` / `admin_console_chat` / `agent_container_task` 等は **`local-llm-on-demand-runtime`** + **`shouldSuppressLocalLlmRuntimeStop`**（keep-warm）。**`POST /api/system/stackchan/chat`** はこちら。 |

- **実装分離（repo）**: HTTP 受付と StackChan 向け JSON は [`bridge_server.py`](../../scripts/private-pi5-stackchan-bridge/bridge_server.py) のみ。DGX への **`/v1/chat/completions`**・**`/start`**・ready ポーリングは **`dgx_runtime_client.py`** に集約。エージェント用の**開発端末固定パス**へのデバッグ書き込みは**持たない**。
- **検証の注意**: 開発 Mac から Tailscale 越しに DGX を直叩きすると **timeout** になりやすい。ACL・経路が **私用 Pi5 経路と一致しない**ため、**切り分けの正は私用 Pi5 上の `curl` / bridge `POST`**（bridge `healthz` が 200 でも upstream 502 は別問題）。

## 採用しない方針（会話で棄却/優先度低）

- StackChan を直接 Tailnet 参加させる前提
- 業務用 Pi5 を自宅私用デバイスの入口に兼用する構成
- 会話のたびに暫定中継を増やす構成

## 想定ワークフロー（私用系）

1. StackChan が音声入力を受ける
2. 私用 Pi5 で STT（faster-whisper）
3. 私用 Pi5 から DGX Spark の Qwen3.6 に問い合わせ
4. 私用 Pi5 で TTS（VOICEVOX）
5. StackChan へ音声を返す
6. Home Assistant でトリガー/シーン/デバイス連携を管理

## 公式/コミュニティ調査結果（2026-05-10）

- 公式 `stack-chan/stack-chan`（Moddable, TypeScript）`main` には、現時点で AI 会話用の標準 MOD が含まれていない（`firmware/mods` は talk/calibration 等）。
- 実運用でよく使われる AI 系はコミュニティ実装（例: `ronron-gh/AI_StackChan_Ex`, `robo8080/AI_StackChan2`）。
- `AI_StackChan_Ex` は ChatGPT 実装が OpenAI エンドポイント固定になっている（`firmware/src/llm/ChatGPT/ChatGPT.cpp` の `https://api.openai.com/v1/chat/completions`）。
- したがって、今回の `private-pi5 bridge` を使うには、**StackChan 側ファームに最小パッチ**（エンドポイント差し替え）が必要。

## フェーズ計画（進捗管理）

### Phase 0: 基盤確定（ネットワーク・境界）

- 私用 Pi5 初期セットアップ（OS/SSH/時刻同期）
- 私用 Pi5 の Tailnet 参加（2026-05-10: `raspi5-private` / `100.89.190.21`）
- 自宅 LAN から私用 Pi5 API への疎通確認（2026-05-10: 初回は `http://192.168.128.112:18080/healthz` -> `200`。同日 late には private Pi5 の DHCP IP が **`192.168.128.113`** に変動していることを確認）
- 私用 Pi5 から DGX Spark への疎通確認（2026-05-10: `http://100.118.82.72:38081/healthz` -> `200 ok`）
- 認証情報（JWT/共有トークン）の保管場所を私用系として分離（2026-05-10: `**DGX_LLM_SHARED_TOKEN` は Pi5 bridge の `.env` のみ**・任意 `**STACKCHAN_TOKEN` は LAN 内ヘッダ認証**・コミュニティファームには **DGX トークンを載せない**方針を [bridge README](../../scripts/private-pi5-stackchan-bridge/README.md)・[KB](../knowledge-base/KB-stackchan-community-firmware-supply-chain.md)・`[scripts/stackchan-ai-stackchan-ex/README.md](../../scripts/stackchan-ai-stackchan-ex/README.md)` に明文化）

### Phase 1: テキスト対話の最短疎通

- 私用 Pi5 に最小 API（StackChan 受付 -> DGX 問い合わせ）を用意（2026-05-10: `stackchan-bridge` systemd 起動）
- StackChan からテキスト送受信（音声なし）を確認（2026-05-10 進捗: `AI_StackChan_Ex` を `m5stack-cores3` で build/upload 成功。SD 未挿入では起動ループ、SD + Wi-Fi 設定後は `**192.168.128.124**` を取得。前半は Mac から StackChan ルート `/` は `200`、Pi5 bridge `healthz` は `200`、StackChan `/speech` は `200` / `OK` で `テスト` を発話した一方、StackChan `/chat` 実行時のシリアルでは `**[HTTP] POST... code: 502**`（StackChan -> private Pi5 bridge `/simple`）を観測し、実機は `**わかりません**` を発話した。さらに Mac から bridge `/simple` に単発 `こんにちは` を送っても `**UPSTREAM_HTTP_ERROR / status: 502 / bad gateway: [Errno 111] Connection refused**` を再現し、前半の主因は **DGX upstream runtime / gateway backend 側** と判断。後半は DGX upstream 復旧後も StackChan が **旧 bridge IP `192.168.128.112`** を見ており、private Pi5 の当日 DHCP IP **`192.168.128.113`** と不一致だったため bridge ログが増えない事象を確認。Pi5 `wlan0` に **`192.168.128.112/24` の互換 alias** を一時追加した直後、StackChan `/chat` に対応して bridge ログ **`POST /api/stackchan/chat/simple 200`** を確認し、text-only 経路の成立まで到達）
- エラー時の標準応答（タイムアウト、認証失敗）を定義（2026-05-10: `error.code/message/retryable` 形式）
- StackChan 側ファームの LLM エンドポイント差し替え（OpenAI固定 -> 私用 Pi5 bridge）（2026-05-10: `[ai_stackchan_ex_private_bridge.patch](../../scripts/private-pi5-stackchan-bridge/patches/ai_stackchan_ex_private_bridge.patch)`・`CHATGPT_API_URL` / HTTP 分岐 / 任意 `CHATGPT_STACKCHAN_TOKEN`）

### Phase 2: 音声入出力統合

- faster-whisper を私用 Pi5 で動作確認
- VOICEVOX を私用 Pi5 で動作確認
- STT -> LLM -> TTS の直列処理を統合
- 遅延測定（目標応答時間）を記録

### Phase 3: Home Assistant 連携

- Home Assistant から私用 Pi5 ワークフローを呼び出し
- シーン/デバイス連動（例: 呼びかけで家電状態参照）を追加
- 失敗時リカバリ（再試行/通知）を追加

### Phase 4: 運用化

- 起動順序と再起動時の復旧手順を Runbook 化
- ログ方針（保存期間、PII マスキング）を確定
- セキュリティ点検（不要ポート、公開範囲、鍵ローテーション）実施
- 「業務系と私用系が混線していない」最終確認

## いまの次アクション（着手順）

1. text-only 成功条件を「bridge `replyText` を StackChan が発話すること」へ固定する
2. StackChan 側 URL を **現 bridge 設定**へ寄せるか、compatibility alias を継続運用するかを最終決定する
3. その後 STT/TTS を重ねる
4. 最後に alias 依存を残すか撤去するかを決める

## 供給鎖・採用の固定（コミュニティ安全採用・2026-05-10）

- **上流コミット + GitHub lib の SHA**: `[scripts/stackchan-ai-stackchan-ex/supply-chain-lock.json](../../scripts/stackchan-ai-stackchan-ex/supply-chain-lock.json)`
- **ピン留めスクリプト**: `[scripts/stackchan-ai-stackchan-ex/apply_platformio_github_pins.py](../../scripts/stackchan-ai-stackchan-ex/apply_platformio_github_pins.py)`
- **手順の入口**: `[scripts/stackchan-ai-stackchan-ex/README.md](../../scripts/stackchan-ai-stackchan-ex/README.md)`
- **ナレッジ**: [KB-stackchan-community-firmware-supply-chain.md](../knowledge-base/KB-stackchan-community-firmware-supply-chain.md)
- **実機 text-only Runbook**: [stackchan-community-text-only-e2e.md](../runbooks/stackchan-community-text-only-e2e.md)

## StackChan 側パッチ方針（最小）

対象（AI_StackChan_Ex 例）:

- `firmware/src/llm/ChatGPT/ChatGPT.cpp`

変更点（最小）:

1. 固定 URL を private Pi5 bridge に変更（ビルド時 `**-DCHATGPT_API_URL=.../api/stackchan/chat`** でも可）
2. 必要なら HTTP 通信を許容（`WiFiClientSecure` 前提の場合は `WiFiClient` 分岐を追加）
3. 任意: bridge の `**STACKCHAN_TOKEN**` と揃え `**X-Stackchan-Token**` を送る（`**-DCHATGPT_STACKCHAN_TOKEN**`）
4. まず text のみ確認し、成功後に STT/TTS を既存機能へ統合

注記:

- 既存コードが OpenAI 固定 + HTTPS 前提の場合、URL 文字列変更だけでは不足する可能性があるため、HTTP 分岐の追加が実務上の最短。
- 逆に firmware を触りたくない場合は、Pi5 bridge 側に HTTPS リバースプロキシを追加し、ファームの HTTPS 要件を維持する案もある（運用はやや重い）。

### すぐ使えるパッチ

- 用意済みパッチ: `scripts/private-pi5-stackchan-bridge/patches/ai_stackchan_ex_private_bridge.patch`
- 対象想定: `ronron-gh/AI_StackChan_Ex` の `firmware/src/llm/ChatGPT/ChatGPT.cpp`

適用例:

```bash
git clone https://github.com/ronron-gh/AI_StackChan_Ex.git
cd AI_StackChan_Ex
git apply /path/to/RaspberryPiSystem_002/scripts/private-pi5-stackchan-bridge/patches/ai_stackchan_ex_private_bridge.patch
```

ビルド時の推奨フラグ（private Pi5 bridge 直結）:

```text
-DCHATGPT_API_URL=\"http://192.168.128.112:18080/api/stackchan/chat\"
-DCHATGPT_API_USE_AUTH_BEARER=0
# 任意（bridge の STACKCHAN_TOKEN と同一）: -DCHATGPT_STACKCHAN_TOKEN=\"...\"
```

## リスクと対策

- リスク: 私用系と業務系で認証情報が混ざる  
対策: シークレット管理を物理/論理で分離し、環境変数名も用途別に分離する。
- リスク: 入口増加による攻撃面拡大  
対策: 入口は私用 Pi5 に一本化し、DGX 側の公開経路を増やさない。
- リスク: 音声パイプラインの遅延  
対策: Phase 1 でテキスト疎通を先に固定し、STT/TTS は段階導入する。

## Decision Log（会話由来）

- 2026-05-10: DGX 入口を増やすより、業務/私用 Pi5 の分離を優先する方針で合意。
- 2026-05-10: StackChan を Tailnet 参加前提にしない方針で合意。
- 2026-05-10: 私用 Pi5 を自宅側のデバイス集約ポイントにする方針で合意。
- 2026-05-10: 私用 Pi5 (`raspi5-private`) を Tailnet 参加し、`private-server` タグ方針で ACL を分離運用することで合意。
- 2026-05-10: 私用 Pi5 に `stackchan-bridge`（`/healthz`, `/api/stackchan/chat`）を配置し、LAN と localhost からの `healthz` `200` を確認。DGX への chat は `DGX_LLM_SHARED_TOKEN` 未設定のため現時点 `403`（期待どおり）。
- 2026-05-10: DGX `api-token` を私用 Pi5 の `DGX_LLM_SHARED_TOKEN` に同期し、`/api/stackchan/chat` の E2E（Pi5 bridge -> DGX chat completion）を `curl` で確認（応答: `了解しました。`）。
- 2026-05-10: StackChan 実装向けに `POST /api/stackchan/chat/simple` を追加。`replyText` を返す簡易レスポンスと、`error.code/message/retryable` の標準エラー形式を導入。`BAD_REQUEST` 応答を実測確認。
- 2026-05-10: `NOT_FOUND` 対策としてブリッジの受理パスを拡張（`/api/system/stackchan/chat` 互換、末尾 `/` 許容）。`/api/stackchan/chat/simple` と `/api/stackchan/chat/simple/` の両方で応答確認。
- 2026-05-10: 公式/コミュニティ調査で、AI_StackChan系は OpenAI エンドポイント固定実装があることを確認。private Pi5 bridge 接続には StackChan 側最小パッチ（URL差し替え + HTTP分岐）が必要と判断。
- 2026-05-10: Mac に PlatformIO を導入し、USB 接続された StackChan 候補機 (`/dev/cu.usbmodem1101`) が `ESP32-S3` と判明。`AI_StackChan_Ex` の private Pi5 bridge 向けビルドは `m5stack-cores3` / `m5stack-atoms3r` の両方で成功。残作業は実機のボード種別確定と対応 env の書き込み。
- 2026-05-10: CoreS3 実機 bring-up では microSD が必須で、未挿入時は `**Failed to load SD card settings**` で再起動ループすることを確認。
- 2026-05-10: CoreS3 実機は `wifi.txt` fallback に加え、`yaml/SC_SecConfig.yaml` と `app/AiStackChanEx/SC_ExConfig.yaml` を併置すると bring-up が安定した。
- 2026-05-10: Wi-Fi パスワードの `O` / `0` 誤記を修正後、StackChan 実機が `**192.168.128.124**` を取得し、LAN 参加を確認。
- 2026-05-10: Mac から StackChan 実機の `/` は `200`、private Pi5 bridge `healthz` は `200`、StackChan `/speech` は `200` / `OK` で `テスト` を発話した。一方で `/chat` 実行時のシリアルでは `**[HTTP] POST... code: 502**` を観測し、実機は `**わかりません**` を発話した。
- 2026-05-10: Mac から bridge `/api/stackchan/chat/simple` へ単発 `こんにちは` と StackChan 実 payload 再現の両方で、`**UPSTREAM_HTTP_ERROR / status: 502 / bad gateway: [Errno 111] Connection refused**` を再現。現時点の主因は **DGX upstream runtime / gateway backend 側** と判断。
- 2026-05-10: Spark 再起動後も **DGX `38081/healthz` / `/v1/models` は timeout**、private Pi5 bridge `healthz` は `200`、bridge `/simple` は **`502 bad gateway: [Errno 111] Connection refused`** のままだった。StackChan 実機シリアルでも **`http post failed: connection refused`** を観測し、未復旧を再確認。
- 2026-05-10: DGX upstream 復旧後、StackChan 実機 (`192.168.128.124`) は **旧 bridge IP `192.168.128.112`** を見ており、private Pi5 の当日 DHCP IP **`192.168.128.113`** とのズレで `GET /chat?...` が bridge に届かないことを確認。private Pi5 `wlan0` に **`192.168.128.112/24` の互換 alias** を一時追加すると、bridge ログに **`POST /api/stackchan/chat/simple 200`** が出て通信が成立した。
- 2026-05-10: private Pi5 の標準 playbook に **compatibility alias 管理**（`private_pi5_stackchan_compat_ip` -> `stackchan-bridge-compat-ip.service`）を追加し、**`enabled` / `active`** 状態で **`wlan0: 192.168.128.113/24 192.168.128.112/24`** を確認。標準手順の範囲で StackChan 旧設定との互換を維持できるようにした。

## 更新ルール

- 各フェーズ完了時にチェックボックスを更新する。
- 実測値（遅延、失敗率）は本ドキュメントに追記する。
- 方針変更が出た場合は、先に Decision Log を更新してから実装を進める。

