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

詳細・検証上の注意（**Mac 直 DGX と私用 Pi5 経路の差**）は [計画ドキュメント](../../docs/plans/stackchan-private-pi5-tailnet-workflow-plan.md#two-path-architecture-private-work-2026-05-10)・[KB-365 §私用 bridge](../../docs/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#private-pi5-stackchan-bridge-boundary-2026-05-10) を参照。

## Endpoint

- `GET /healthz`
  - ヘルスチェック
- `POST /api/stackchan/chat`
  - DGX upstream (`/v1/chat/completions`) の生レスポンスを返す
- `POST /api/stackchan/chat/simple`
  - StackChan 実装向けの簡易レスポンスを返す（`replyText`）
  - 任意設定で、upstream `502` / `503` 時、および **`DGX_RUNTIME_AUTO_START` 有効時の初回到達不能（`URLError`）** に **DGX runtime `/start` -> `/v1/models` ready wait -> 1回再試行** ができる

## Request body

```json
{
  "messages": [{ "role": "user", "content": "こんにちは" }],
  "maxTokens": 256,
  "temperature": 0.35,
  "enableThinking": false
}
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
- 標準 playbook では、任意変数 **`private_pi5_stackchan_compat_ip`**（+ `interface` / `prefix`）を与えると **`stackchan-bridge-compat-ip.service`** を配備して alias を維持できる。
