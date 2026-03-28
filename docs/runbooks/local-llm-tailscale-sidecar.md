---
title: Runbook: Ubuntu LocalLLM を Tailscale sidecar で分離運用する
tags: [運用, LocalLLM, Tailscale, llama.cpp, Docker, Ubuntu]
audience: [運用者, 開発者]
last-verified: 2026-03-29
related:
  - ../security/tailscale-policy.md
  - ../security/system-inventory.md
  - ../knowledge-base/infrastructure/security.md#kb-317-ubuntu-localllm-を-tailscale-sidecar--tagllm-で分離公開する
  - ../knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env
  - ../decisions/ADR-20260328-ubuntu-local-llm-tailnet-sidecar.md
  - ../decisions/ADR-20260329-local-llm-pi5-api-operations.md
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

## Pi5 API 側の運用・ログ（本 Runbook の範囲外の判断）

- **正本**: [ADR-20260329](../decisions/ADR-20260329-local-llm-pi5-api-operations.md)（誰が `GET|POST /api/system/local-llm/*` を使えるか、ログに何を載せるか、秘密をどう扱うか）。
- Ubuntu 上の `api-token` と Pi5 の `LOCAL_LLM_SHARED_TOKEN` は運用上セットでローテーションする。

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

### Pi5 実機スモーク（認証トークンなしでできる範囲）

運用者が **管理画面用 JWT を持たない**場合でも、次で **経路と境界**だけを確認できる（**秘密はログに出さない**）。

1. **API 全体の生存**: Pi5 上で `curl -sk https://localhost/api/system/health`。**`status` が `degraded` でも `checks.database.status` が `ok` なら**、DB 前提の切り分けは継続しやすい（メモリ高負荷は Pi5 運用でよくある）。
2. **LocalLLM ルートが認可で守られていること**: 同じく Pi5 上で  
   `curl -sk -o /dev/null -w "%{http_code}\n" https://localhost/api/system/local-llm/status`  
   → **`401` 期待**（`errorCode` は `AUTH_TOKEN_REQUIRED`）。
3. **API コンテナから Ubuntu upstream まで到達すること**（`LOCAL_LLM_BASE_URL` がコンテナ内にある前提）:

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api node -e "
const b = process.env.LOCAL_LLM_BASE_URL;
const t = process.env.LOCAL_LLM_SHARED_TOKEN;
if (!b) { console.error('LOCAL_LLM_BASE_URL missing'); process.exit(1); }
const h = t ? { 'X-LLM-Token': t } : {};
fetch(new URL('/healthz', b), { headers: h })
  .then(async r => { const x = await r.text(); console.log('status', r.status, 'len', x.length); if (!r.ok) process.exit(1); })
  .catch(e => { console.error(e); process.exit(1); });
"
```

期待: `status 200`（本文は短いプレーンテキスト）。

**注意**: 上記は **`/healthz` の到達確認**であり、`GET /api/system/local-llm/status` の JSON（`configured` / `health`）やチャット本文の確認は、**`Authorization: Bearer` 付きの「最小確認」**が必要。

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

## 共有トークンのローテーション

Ubuntu 側の `X-LLM-Token`（ファイル `api-token`）と Pi5 API コンテナの `LOCAL_LLM_SHARED_TOKEN`（Ansible の `vault_api_local_llm_shared_token`）は **常に同一値**である必要がある。いずれか一方だけ更新すると **401** や upstream 失敗になる（切り分けは [KB-318](../knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env)）。

### 新しいトークン値の用意

- **十分長いランダム文字列**を生成する（例: `openssl rand -hex 32`）。平文をチャット・Issue・スクリーンショットに貼らない。

### Ubuntu（正本ファイル）

1. `localllm` ユーザーで、次のファイルを **新しい値だけ**に置き換える（改行は入れない想定）。

   ```text
   /home/localllm/.config/local-llm-system/api-token
   ```

2. `nginx` がトークンを読み込む構成の場合、反映のため **`nginx` コンテナの再起動**が必要なことがある。通常は `docker compose restart nginx`（`compose` ディレクトリは上記「ディレクトリ」節と同じ）。

3. Ubuntu 上の「認証あり確認」（本 Runbook の「ローカル疎通確認」）で `v1/models` が通ることを確認する。

### Pi5（Ansible vault）

1. リポジトリで vault を編集する。

   ```bash
   ansible-vault edit infrastructure/ansible/host_vars/raspberrypi5/vault.yml
   ```

2. `vault_api_local_llm_shared_token` を **Ubuntu の `api-token` と同じ文字列**に更新する。

### 反映デプロイ（Pi5 のみ）

- [deployment.md](../guides/deployment.md) に従い、**全クライアントではなく Pi5 のみ**に限定する。

  ```bash
  export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
  ./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
  ```

  （ホストやスクリプトのパスは環境に合わせて読み替える。）

### 検証

- 本 Runbook の「最小確認」（`GET /api/system/local-llm/status` と `POST .../chat/completions` に `Authorization: Bearer` を付与）。
- 必要に応じて「Pi5 実機スモーク」（API コンテナから upstream `/healthz`）。

### 失敗時（401 や `health.ok=false`）

- **両者の値が一致しているか**を再確認する（Ubuntu ファイルと vault の typo・古い値の残り）。
- Pi5 側の環境変数が **`infrastructure/docker/.env`（Ansible 生成）** に載っているかは [KB-318](../knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env) を参照。

## 管理画面からの試用

- 管理コンソールの **`/admin/local-llm`** から、ステータス取得と試用チャットができる（Pi5 API の `ADMIN` / `MANAGER` と同じ権限。**VIEWER** は API も画面も利用不可）。

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
