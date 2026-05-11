# StackChan Private Pi5 Bridge

自宅の StackChan から私用 Pi5 を入口にして DGX Spark へ chat を転送する最小ブリッジです。

## アーキテクチャ（職場 Pi5 API との 2 系統）

| 系統 | 経路 | 本ブリッジ |
|------|------|------------|
| **Private（本リポジトリ）** | StackChan 等 → **私用 Pi5**（当ブリッジ）→ **DGX** | **ここ**。JWT なし・**職場 Pi5 API の単一キューは通さない**。 |
| **Work** | Pi4/Pi3 等 → **職場 Pi5 API**（`POST /api/system/stackchan/chat` 等）→ DGX | **別経路**。`stackchan_chat` の keep-warm は `apps/api` 側ポリシー。**混線禁止**。 |

**実装ファイル**:

- [`bridge_server.py`](./bridge_server.py) — HTTP 受付・認証・レスポンス送出のみ（ルーティング I/O）
- [`stackchan_chat_core.py`](./stackchan_chat_core.py) — 入力検証・upstream ボディ生成・DGX 完了ワークフロー（`ChatCompletionWorkflow`）・`replyText` 整形
- [`dgx_runtime_client.py`](./dgx_runtime_client.py) — DGX への **`/v1/chat/completions`**、任意の **`/start`**、ready ポーリング（`DgxUpstreamClient`）
- [`stt_bridge_core.py`](./stt_bridge_core.py) — STT 入力検証と失敗マッピング（`SttWorkflow`）
- [`stt_runtime_client.py`](./stt_runtime_client.py) — STT 上流呼び出し（OpenAI 互換 transcription）/ optional `faster-whisper` ローカル実行

## ローカル検証（Python）

契約が変わらないことの最低限の回帰として、リポジトリ直下で次を実行できる。

```bash
uv sync --frozen --project scripts/private-pi5-stackchan-bridge
uv run --project scripts/private-pi5-stackchan-bridge \
  python -m unittest discover -s scripts/private-pi5-stackchan-bridge/tests -p 'test_*.py'
```

`uv.lock` をコミットし、Pi5 デプロイでは `uv sync --frozen` を使って lock 逸脱を防ぐ。
`uv` を使わない場合は従来どおり `python3 -m unittest ...` でも実行できるが、再現性と環境分離のため `uv` を推奨する。

詳細・検証上の注意（**Mac 直 DGX と私用 Pi5 経路の差**）は [計画ドキュメント](../../docs/plans/stackchan-private-pi5-tailnet-workflow-plan.md#two-path-architecture-private-work-2026-05-10)・[KB-365 §私用 bridge](../../docs/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#private-pi5-stackchan-bridge-boundary-2026-05-10) を参照。

## Endpoint

- `GET /healthz`
  - ヘルスチェック
- `POST /api/stackchan/chat`
  - DGX upstream (`/v1/chat/completions`) の生レスポンスを返す
- `POST /api/stackchan/chat/simple`
  - StackChan 実装向けの簡易レスポンスを返す（`replyText`）
  - 任意設定で、upstream `502` / `503` 時、および **`DGX_RUNTIME_AUTO_START` 有効時の初回到達不能（`URLError`）** に **DGX runtime `/start` -> `/v1/models` ready wait -> 1回再試行** ができる
- `POST /api/stackchan/stt`
  - STT 変換 API。`audio/wav` の生バイナリ、または JSON (`audioBase64`) を受け取って `text` を返す
  - provider は `STT_PROVIDER` で切り替え:
    - `upstream-openai`（既定）: OpenAI 互換 transcription endpoint に中継
    - `faster-whisper-local`: Pi5 ローカルで `faster-whisper` 実行

## Request body

```json
{
  "messages": [{ "role": "user", "content": "こんにちは" }],
  "maxTokens": 256,
  "temperature": 0.35,
  "enableThinking": false
}
```

STT（JSON）:

```json
{
  "audioBase64": "<base64 wav bytes>",
  "contentType": "audio/wav",
  "language": "ja",
  "model": "whisper-1"
}
```

STT（生バイナリ）:

```bash
curl -sS -X POST "http://<bridge-ip>:18080/api/stackchan/stt" \
  -H "Content-Type: audio/wav" \
  -H "X-Stt-Language: ja" \
  --data-binary @sample.wav
```

Pi5 ローカルで `faster-whisper` を使う場合は、追加依存を入れてから `STT_PROVIDER=faster-whisper-local` を指定する:

```bash
uv sync --frozen --extra local-stt --project scripts/private-pi5-stackchan-bridge
```

## Simple response example

```json
{
  "ok": true,
  "replyText": "こんにちは。",
  "model": "system-prod-primary",
  "usage": { "prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18 },
  "upstream": { "...": "raw chat completion response" }
}
```

## Error response (standardized)

```json
{
  "ok": false,
  "error": {
    "code": "UPSTREAM_TIMEOUT",
    "message": "upstream request timed out",
    "retryable": true
  }
}
```

`code` 例:

- `BAD_REQUEST`
- `UNAUTHORIZED`
- `UPSTREAM_HTTP_ERROR`
- `UPSTREAM_UNREACHABLE`
- `UPSTREAM_TIMEOUT`
- `BRIDGE_INTERNAL_ERROR`

## Environment

`.env.example` を参照。

標準デプロイ手順は [`docs/runbooks/private-pi5-stackchan-bridge-deploy.md`](../../docs/runbooks/private-pi5-stackchan-bridge-deploy.md) を参照。

必須:

- `DGX_LLM_SHARED_TOKEN`

任意:

- `STACKCHAN_TOKEN`（自宅LAN内でも簡易認証を掛けたい場合）
- `DGX_RUNTIME_AUTO_START=true`
- `DGX_RUNTIME_CONTROL_TOKEN`（DGX `/start` 用）
- `DGX_RUNTIME_START_PATH` / `DGX_RUNTIME_READY_PATH`
- `DGX_RUNTIME_READY_TIMEOUT_SEC` / `DGX_RUNTIME_READY_POLL_SEC`
- `STT_PROVIDER=upstream-openai|faster-whisper-local`
- `STT_UPSTREAM_BASE_URL` / `STT_UPSTREAM_PATH` / `STT_UPSTREAM_AUTH_MODE` / `STT_UPSTREAM_TOKEN` / `STT_UPSTREAM_MODEL`
- `STT_LOCAL_MODEL` / `STT_LOCAL_DEVICE` / `STT_LOCAL_COMPUTE_TYPE`

## Runtime auto-start（任意）

bridge が DGX gateway を **直接**叩く構成では、backend が idle / stop 中だと `502 bad gateway` を返すことがあります。

その場合は private Pi5 bridge にだけ次を持たせると、`POST /api/stackchan/chat*` 実行時に:

1. upstream `502` / `503`（または到達不能）を検出（**auto-start 時は初回 `URLError` も対象**）
2. DGX `POST /start`
3. `GET /v1/models` が `200` になるまで待機（**blue cold start には数分かかることがあり、`DGX_RUNTIME_READY_TIMEOUT_SEC` は 300–600 秒級を推奨**）
4. chat completion を **1回だけ再試行**

できます。

```env
DGX_RUNTIME_AUTO_START=true
DGX_RUNTIME_CONTROL_TOKEN=replace-me
```

注意:

- `DGX_RUNTIME_CONTROL_TOKEN` は **private Pi5 bridge の `.env` のみ**に置く
- StackChan ファーム / SD カード / ビルドログへ載せない
- 失敗時は bridge の標準エラー JSON に `runtimeRecovery` を含めて返す

## 認証トークンの分離（StackChan / DGX）

| シークレット | 置き場所 | 用途 |
|--------------|-----------|------|
| **`DGX_LLM_SHARED_TOKEN`** | **private Pi5 の `.env` のみ** | ブリッジ → DGX upstream の共有トークン（例: `X-LLM-Token`）。**ESP32 / StackChan ファーム・SD カード・ビルドログに載せない。** |
| **`DGX_RUNTIME_CONTROL_TOKEN`** | **private Pi5 の `.env` のみ**。任意 | bridge が **DGX `/start`** を叩いて backend を起こすための制御トークン。**StackChan には載せない。** |
| **`STACKCHAN_TOKEN`** | **同上（ブリッジのみ）**。任意 | LAN 内の簡易認証。設定時、クライアントは **`X-Stackchan-Token`** で同値を送る。コミュニティファーム側は **`-DCHATGPT_STACKCHAN_TOKEN=...`**（[`patches/ai_stackchan_ex_private_bridge.patch`](./patches/ai_stackchan_ex_private_bridge.patch) 適用後）でヘッダを付与。**DGX トークンとは別物でよい（推奨）。** |
| **OpenAI API キー等** | 原則どこにも置かない | bridge 経由運用なら不要。`SC_SecConfig.yaml` 等にクラウドキーを残さない運用を推奨。 |

ブリッジは `STACKCHAN_TOKEN` が空なら **`X-Stackchan-Token` 検証をスキップ**します。開発・初回疎通で役立ちますが、恒常運用では **トークンを設定**した方がよいです。

## Security notes

- DGX 直入口は増やさず、私用 Pi5 のみに集約する。
- `.env` は `chmod 600` を維持する。
- `DGX_LLM_SHARED_TOKEN` はログやチャットに貼らない。
- **業務系と私用系の資格情報を混線させない**（環境変数名・`.env` ファイル・ホストを分離する）。

## LAN IP drift の注意

- 2026-05-10 実測では、private Pi5 の DHCP IP が **`192.168.128.112` -> `192.168.128.113`** へ変わった一方、StackChan ファームは **旧 bridge IP** を見続けていた。
- この状態では、StackChan の `GET /chat?...` が **`200`** を返しても **bridge ログに新規 `POST /api/stackchan/chat/simple` が出ない**ことがある。
- 切り分けは **`hostname -I`（Pi5）** と **`journalctl -u stackchan-bridge --since ...`** を正とし、必要なら **StackChan 側設定更新**または **Pi5 側 compatibility IP alias** で一致させる。
- 標準 playbook では、任意変数 **`private_pi5_stackchan_compat_ip`**（+ `interface` / `prefix`）を与えると **`stackchan-bridge-compat-ip.service`**（起動時 oneshot）に加え、**NetworkManager dispatcher**（`up` / `dhcp4-change` で同じ `ip addr` 手順を再実行）を配備し、Wi‑Fi 再接続後も alias が戻るようにできる。

## 2026-05-11 調査メモ（`200` なのに `わかりません`）

- `stackchan-bridge` 観点では、`POST /api/stackchan/chat/simple` は `200` かつ非空 `replyText` を返していた。
- にもかかわらず実機で `わかりません` が出るケースは、**デバイス側ファームの `ChatGPT.cpp`** が原因だった。
  - `https_post_json` で `HTTPClient::getString()` を `WiFiClient` 破棄後に呼び得る構造があり、`HTTP 200` でも payload 空化。
  - 修正版では `getString()` を client 生存スコープ内へ移動し、シリアルで `payload length > 0` を確認済み。
- 本ブリッジの運用上は、`HTTP 200` 単体ではなく **`replyText` の非空**と **実機シリアルの payload 長**をセットで成功判定する。
- 2026-05-11 時点の残課題は **音声再生系**（`MP3:ERROR_BUFLEN 0` / `I2S ... failed`）であり、bridge text 経路とは分離して追う（この時点の観測）。

## 2026-05-11 追加メモ（late: failed 発話と経路断）

- ユーザー観測「音は出るが failed 文言で会話にならない」を受け、Mac から到達性を再確認したところ、時間帯によって
  - `http://192.168.128.112:18080/healthz`（private bridge）
  - `100.89.190.21:22`（private Pi5 SSH / Tailscale）
  - `100.118.82.72:38081`（DGX 側）
  が同時に timeout する局面を確認した。
- この局面では bridge アプリ自体の正常/異常を確定できないため、**ネットワーク経路復旧を先行**し、アプリ改修判定は保留する。
- 音声側は `WebVoiceVoxTTS.cpp` で
  1. MP3 URLの `HTTP 200` 判定
  2. SPIFFS へ保存
  3. `playMP3SPIFFS` 再生
  へ切替済み。`bytes==expected` を確認できる回があるため、残る主因は **I2S 切替競合**（`MP3:ERROR_BUFLEN 0` / `I2S ... failed`）と判断している。

## 2026-05-11 最終メモ（E2E 会話成立）

- private Pi5 bridge に STT endpoint（`POST /api/stackchan/stt`）を組み込み、`STT_PROVIDER=faster-whisper-local` で再デプロイ。
- StackChan ファームは STT を private Pi5 bridge へ送る設定に変更し、音声入力を bridge 側で文字起こしして DGX へ転送する流れへ統一。
- デバイス側は `M5Unified` 更新（`0.1.17` -> `0.2.7`）と chunked MP3 保存対応により主要な再生失敗を解消し、**WakeWord -> STT -> LLM -> TTS** の会話を実機で確認。
- 運用上の成功判定は `POST /api/stackchan/chat/simple` の `replyText` 非空に加え、`POST /api/stackchan/stt` の応答成功を併せて確認する。
