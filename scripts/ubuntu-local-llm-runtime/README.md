# Ubuntu LocalLLM オンデマンド制御（補助スクリプト）

Pi5 API の `LOCAL_LLM_RUNTIME_MODE=on_demand` と組み合わせ、`llama-server` コンテナだけを起動・停止するための **Ubuntu 側**の最小 HTTP サーバです。

## 前提

- 本システムの LocalLLM は [docs/runbooks/local-llm-tailscale-sidecar.md](../../docs/runbooks/local-llm-tailscale-sidecar.md) の Compose 構成を前提とする
- `docker compose` が `localllm` ユーザー等で `llama-server` サービスを操作できること

## 起動例

```bash
export LLM_RUNTIME_CONTROL_TOKEN='（Pi5 の LOCAL_LLM_RUNTIME_CONTROL_TOKEN と同じ長いランダム値）'
node /path/to/repo/scripts/ubuntu-local-llm-runtime/control-server.mjs
```

既定では **127.0.0.1:39090** のみ。Tailnet から Pi5 が叩くには **nginx 等でリバースプロキシ**し、別パスまたは別ポートを ACL で Pi5 のみに開ける。**例**: 同ディレクトリの `nginx-runtime-control.conf.example`（待受 `39091` → `39090` へ中継）。

## Pi5 側の環境変数（例）

- `LOCAL_LLM_RUNTIME_MODE=on_demand`
- `LOCAL_LLM_RUNTIME_CONTROL_START_URL=https://…/runtime/llm/start`（POST）
- `LOCAL_LLM_RUNTIME_CONTROL_STOP_URL=https://…/runtime/llm/stop`（POST）
- `LOCAL_LLM_RUNTIME_CONTROL_TOKEN`（上記 `LLM_RUNTIME_CONTROL_TOKEN` と一致）
- `LOCAL_LLM_RUNTIME_HEALTH_BASE_URL`（省略時は `LOCAL_LLM_BASE_URL`）

詳細は Runbook のオンデマンド節を参照。
