# Ubuntu LocalLLM オンデマンド制御（補助スクリプト）

Pi5 API の `LOCAL_LLM_RUNTIME_MODE=on_demand` と組み合わせ、`llama-server` コンテナだけを起動・停止するための **Ubuntu 側**の最小 HTTP サーバです。

## 前提

- 本システムの LocalLLM は [docs/runbooks/local-llm-tailscale-sidecar.md](../../docs/runbooks/local-llm-tailscale-sidecar.md) の Compose 構成を前提とする
- `docker compose` が `localllm` ユーザー等で `llama-server` サービスを操作できること

## 起動例

```bash
export LLM_RUNTIME_CONTROL_TOKEN='（Pi5 の LOCAL_LLM_RUNTIME_CONTROL_TOKEN と同じ長いランダム値）'
export LLM_RUNTIME_LISTEN_HOST='0.0.0.0'
node /path/to/repo/scripts/ubuntu-local-llm-runtime/control-server.mjs
```

`local-llm-system/compose/compose.yaml` の `nginx` が `network_mode: service:tailscale` のとき、`control-server.mjs` は **`0.0.0.0:39090`** で待たせ、同一ホストの Docker bridge gateway（例: `172.19.0.1`）経由で受ける。

## `local-llm-system` へ追加すること

1. `config/runtime.env` に `LLM_RUNTIME_CONTROL_TOKEN=...` を追加する
2. `compose/compose.yaml` の `nginx` コマンドで `envsubst` 対象に `LLM_RUNTIME_CONTROL_TOKEN` を追加する
3. `config/nginx/default.conf.template` に `/start` `/stop` を追加する

`/start` `/stop` の location 例は同ディレクトリの `nginx-runtime-control.conf.example` を参照。

## Pi5 側の環境変数（例）

- `LOCAL_LLM_RUNTIME_MODE=on_demand`
- `LOCAL_LLM_RUNTIME_CONTROL_START_URL=http://100.107.x.x:38081/start`（POST）
- `LOCAL_LLM_RUNTIME_CONTROL_STOP_URL=http://100.107.x.x:38081/stop`（POST）
- `LOCAL_LLM_RUNTIME_CONTROL_TOKEN`（上記 `LLM_RUNTIME_CONTROL_TOKEN` と一致）
- `LOCAL_LLM_RUNTIME_HEALTH_BASE_URL`（省略時は `LOCAL_LLM_BASE_URL`）

詳細は Runbook のオンデマンド節を参照。
