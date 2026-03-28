---
title: Runbook: Ubuntu LocalLLM を Tailscale sidecar で分離運用する
tags: [運用, LocalLLM, Tailscale, llama.cpp, Docker, Ubuntu]
audience: [運用者, 開発者]
last-verified: 2026-03-28
related:
  - ../security/tailscale-policy.md
  - ../security/system-inventory.md
  - ../knowledge-base/infrastructure/security.md#kb-317-ubuntu-localllm-を-tailscale-sidecar--tagllm-で分離公開する
  - ../knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env
  - ../decisions/ADR-20260328-ubuntu-local-llm-tailnet-sidecar.md
category: runbooks
update-frequency: medium
---

# Runbook: Ubuntu LocalLLM を Tailscale sidecar で分離運用する

## 目的

- Ubuntu ホストの実験環境とは分離して、本システム専用 LocalLLM だけを tailnet に参加させる
- Pi5 だけが LocalLLM に到達できる構成を維持する
- auth key と共有トークンの露出を防ぎつつ、再起動後も復旧できる形で運用する

## 現在の構成（2026-03-28）

- ノード名: `ubuntu-local-llm-system`
- Tailscale IP: `100.107.223.92`
- Tailscale タグ: `tag:llm`
- ACL: `tag:server -> tag:llm: tcp:38081`
- 外部入口: `nginx` が `38081`
- 内部推論: `llama-server` が `127.0.0.1:38082`
- API 認証: `X-LLM-Token`
- 専用ユーザー: `localllm`
- 既存の手動実験用 `~/llama.cpp` + `8081` は別系統として残す

## ディレクトリ

```text
/home/localllm/local-llm-system/
  compose/compose.yaml
  config/runtime.env
  config/nginx/default.conf.template
  models/vlm/
  state/tailscale/

/home/localllm/.config/local-llm-system/
  api-token
```

## 起動確認

```bash
sudo -u localllm bash -lc 'cd /home/localllm/local-llm-system/compose && docker compose ps'
sudo -u localllm bash -lc 'cd /home/localllm/local-llm-system/compose && docker compose exec tailscale tailscale status'
```

期待:

- `tailscale` / `nginx` / `llama-server` が起動している
- `tailscale status` に `ubuntu-local-llm-system` が表示される

## ローカル疎通確認（Ubuntu 上）

```bash
sudo -u localllm bash -lc 'cd /home/localllm/local-llm-system/compose && docker compose exec tailscale sh -lc "wget -qO- http://127.0.0.1:38081/healthz && echo"'
```

期待:

- `ok`

認証なし拒否:

```bash
sudo -u localllm bash -lc 'cd /home/localllm/local-llm-system/compose && docker compose exec tailscale sh -lc "wget -S --spider -O /dev/null http://127.0.0.1:38081/v1/models 2>&1 | grep \"HTTP/\" | tail -1"'
```

期待:

- `HTTP/1.1 403 Forbidden`

認証あり確認:

```bash
sudo bash -lc 'TOKEN=$(cat /home/localllm/.config/local-llm-system/api-token); cd /home/localllm/local-llm-system/compose && docker compose exec -e TOKEN="$TOKEN" tailscale sh -lc "wget -qO- --header=\"X-LLM-Token: $TOKEN\" http://127.0.0.1:38081/v1/models | head -c 400; echo"'
```

## 再起動・再作成

```bash
sudo -u localllm bash -lc 'cd /home/localllm/local-llm-system/compose && docker compose up -d'
sudo -u localllm bash -lc 'cd /home/localllm/local-llm-system/compose && docker compose restart tailscale nginx llama-server'
```

## Pi5 API から使う入口

- Pi5 API 側には、Ubuntu LocalLLM を直接ブラウザへ見せずに代理呼び出しする管理系エンドポイントを用意する
- 入口:
  - `GET /api/system/local-llm/status`
  - `POST /api/system/local-llm/chat/completions`
- 認証:
  - Pi5 API の通常ログイン後の `Authorization: Bearer ...`
  - ロールは `ADMIN` / `MANAGER`
- Pi5 API の返り値:
  - upstream の生JSONをそのまま返さず、`model` / `content` / `finishReason` / `usage` に正規化した DTO を返す
- Pi5 API 側の環境変数:
  - `LOCAL_LLM_BASE_URL=http://100.107.223.92:38081`
  - `LOCAL_LLM_SHARED_TOKEN=<Ubuntu の api-token>`
  - `LOCAL_LLM_MODEL=Qwen_Qwen3.5-9B-Q4_K_M.gguf`
  - `LOCAL_LLM_TIMEOUT_MS=60000`

### Pi5 API への恒久設定

- 本番 Pi5 では `infrastructure/docker/.env` へ手動で直接追記せず、Ansible で維持する
- 非 secret 値は `infrastructure/ansible/inventory.yml` の `raspberrypi5` ホスト変数で管理する
  - `api_local_llm_base_url`
  - `api_local_llm_model`
  - `api_local_llm_timeout_ms`
- secret は `infrastructure/ansible/host_vars/raspberrypi5/vault.yml` で管理する
  - `vault_api_local_llm_shared_token`

設定例:

```bash
ansible-vault edit infrastructure/ansible/host_vars/raspberrypi5/vault.yml
```

```yaml
vault_api_local_llm_shared_token: "<Ubuntu の api-token>"
```

反映:

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

最小確認:

```bash
curl -k -H "Authorization: Bearer <PI5_API_TOKEN>" \
  https://<pi5-host>/api/system/local-llm/status
```

```bash
curl -k \
  -H "Authorization: Bearer <PI5_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "日本語で一文だけ、疎通確認OKですと返答してください。" }
    ],
    "maxTokens": 80,
    "temperature": 0.2,
    "enableThinking": false
  }' \
  https://<pi5-host>/api/system/local-llm/chat/completions
```

## Mac ローカルで Pi5 API を検証する

- 本番用 `docker-compose.server.yml` は `/opt/RaspberryPiSystem_002/...` 前提なので、そのままでは Mac ローカルで起動できない
- ローカル検証時は `infrastructure/docker/docker-compose.mac-local.override.yml` を単体で使う
- 目的:
  - `db` と `api` をワークスペース配下 `.docker/local/` へ逃がして起動する
  - `/opt/...` bind mount 不足や Linux 専用 mount で落ちる事象を避ける

起動:

```bash
docker compose -f infrastructure/docker/docker-compose.mac-local.override.yml up -d db api
```

停止:

```bash
docker compose -f infrastructure/docker/docker-compose.mac-local.override.yml down
```

補足:

- API は `http://localhost:8080`
- DB は `localhost:5432`
- LocalLLM 代理検証まで行う場合は、ローカルの API 用 `.env` または実行環境に `LOCAL_LLM_BASE_URL` / `LOCAL_LLM_SHARED_TOKEN` / `LOCAL_LLM_MODEL` を入れる

## 秘密情報の扱い

- `TS_AUTHKEY` は **新規参加時のみ**使用する
- 参加後は auth key を **Tailscale 管理画面で revoke** し、ローカルの auth key ファイルも削除する
- 平常時に残す秘密は `api-token` と `config/runtime.env` のみ
- **`docker compose config` は live secret 入りで実行しない**
  - 展開後の環境変数が端末へ表示されるため

## トラブルシュート

### `tailscale` が再起動ループする

典型例:

- `tailscale up` で `--advertise-tags=tag:llm` を一度有効化した
- なのに `compose.yaml` の `TS_EXTRA_ARGS` に同じオプションが無い

対処:

- `compose.yaml` の `TS_EXTRA_ARGS` に `--advertise-tags=tag:llm` を入れる
- `docker compose up -d tailscale` で再作成する

### `llama-server` が `unhealthy` だが実際は応答する

確認:

```bash
sudo -u localllm bash -lc 'cd /home/localllm/local-llm-system/compose && docker compose logs --tail=200 llama-server'
```

補足:

- `http://127.0.0.1:38082/health` が `{"status":"ok"}` なら、まず実サービスは生きている
- イメージ既定の healthcheck 表示が実態とズレることがある

### モデルファイルにアクセスできない

原因:

- `localllm` から既存ユーザーのホーム配下を読めない

対処:

- 本システム専用のモデルは `localllm` 配下へコピーする
- 既存の `~/models` をそのまま bind mount しない

### Pi5 API で `/api/system/local-llm/status` が未設定（`configured=false`）

- **切り分け**: Pi5 上で API コンテナ内の `printenv LOCAL_LLM_BASE_URL` 等を確認する。ホストの `apps/api/.env` に値があっても、**本番 `docker-compose.server.yml` の `api` はそのファイルを `env_file` に含めない**ため、コンテナに渡らないことがある。
- **正規の更新経路**: Ansible が生成する **`infrastructure/docker/.env`**（テンプレート `docker.env.j2`）に `LOCAL_LLM_*` があるか。手作業で `apps/api/.env` だけ直すとデプロイや次回 Ansible で上書き・不一致になりやすい。
- **詳細**: [KB-318](../knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env)

## 参照

- [KB-317](../knowledge-base/infrastructure/security.md#kb-317-ubuntu-localllm-を-tailscale-sidecar--tagllm-で分離公開する)
- [KB-318](../knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env)
- [ADR-20260328](../decisions/ADR-20260328-ubuntu-local-llm-tailnet-sidecar.md)
- [Tailscale Policy](../security/tailscale-policy.md)
