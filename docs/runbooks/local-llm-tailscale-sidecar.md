---
title: Runbook: Ubuntu LocalLLM を Tailscale sidecar で分離運用する
tags: [運用, LocalLLM, Tailscale, llama.cpp, Docker, Ubuntu]
audience: [運用者, 開発者]
last-verified: 2026-03-30
related:
  - ../security/tailscale-policy.md
  - ../security/system-inventory.md
  - ../knowledge-base/infrastructure/security.md#kb-317-ubuntu-localllm-を-tailscale-sidecar--tagllm-で分離公開する
  - ../knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env
  - ../decisions/ADR-20260328-ubuntu-local-llm-tailnet-sidecar.md
  - ../decisions/ADR-20260329-local-llm-pi5-api-operations.md
  - ../decisions/ADR-20260403-on-demand-local-llm-runtime-control.md
category: runbooks
update-frequency: medium
---

# Runbook: Ubuntu LocalLLM を Tailscale sidecar で分離運用する

## 目的

- Ubuntu ホストの実験環境とは分離して、本システム専用 LocalLLM だけを tailnet に参加させる
- Pi5 だけが LocalLLM に到達できる構成を維持する
- auth key と共有トークンの露出を防ぎつつ、再起動後も復旧できる形で運用する

## オンデマンド llama-server（VRAM を ComfyUI 等と分ける）

**判断**: [ADR-20260403](../decisions/ADR-20260403-on-demand-local-llm-runtime-control.md)

常駐 `llama-server` が GPU メモリを専有すると、同一マシンで ComfyUI が OOM になりやすい。次の構成で **推論が必要なときだけ** `llama-server` を起動し、ジョブ後に停止できる。

### Ubuntu 側

1. リポジトリの [scripts/ubuntu-local-llm-runtime/control-server.mjs](../../scripts/ubuntu-local-llm-runtime/control-server.mjs) を Ubuntu に配置し、`LLM_RUNTIME_CONTROL_TOKEN`（十分長いランダム値）を設定する。
2. `localllm` ユーザーで `node control-server.mjs` を起動する。`local-llm-system` の `nginx` コンテナから受けるため、`LLM_RUNTIME_LISTEN_HOST=0.0.0.0` を指定して **39090/tcp** をホスト上で待たせる（systemd 推奨）。
3. `/home/localllm/local-llm-system/config/runtime.env` に `LLM_RUNTIME_CONTROL_TOKEN=...` を追加し、`compose/compose.yaml` の `nginx` サービスで `envsubst` 対象に **`LLM_RUNTIME_CONTROL_TOKEN`** を加える。
4. `/home/localllm/local-llm-system/config/nginx/default.conf.template` に `POST /start`・`POST /stop` を追加し、Docker bridge gateway（例: `172.19.0.1`）経由で `http://172.19.0.1:39090/start|stop` へプロキシする。**location 例**: [`scripts/ubuntu-local-llm-runtime/nginx-runtime-control.conf.example`](../../scripts/ubuntu-local-llm-runtime/nginx-runtime-control.conf.example)
5. `sudo -u localllm bash -lc 'cd /home/localllm/local-llm-system/compose && docker compose up -d --force-recreate nginx'` で `compose-nginx-1` を再作成する。制御サーバは `docker compose start|stop llama-server` を実行する。`COMPOSE_DIR` は既定 `/home/localllm/local-llm-system/compose`。

### Pi5 API（`infrastructure/docker/.env` / Ansible `docker.env.j2`）

- `LOCAL_LLM_RUNTIME_MODE=on_demand`
- `LOCAL_LLM_RUNTIME_CONTROL_START_URL` … **`LOCAL_LLM_BASE_URL` と同じ tailnet nginx** に載せた **`/start`** のフル URL（例: `http://100.107.223.92:38081/start`）。本文は JSON、ヘッダ `X-Runtime-Control-Token` 必須。
- `LOCAL_LLM_RUNTIME_CONTROL_STOP_URL` … 同上（stop）
- `LOCAL_LLM_RUNTIME_CONTROL_TOKEN` … Ubuntu の `LLM_RUNTIME_CONTROL_TOKEN` と一致（未設定時は `LOCAL_LLM_SHARED_TOKEN` を流用可）
- `LOCAL_LLM_RUNTIME_HEALTH_BASE_URL` … 省略時は `LOCAL_LLM_BASE_URL`（`/healthz` 待ちに使用）

**補助スクリプトのパス**: `POST /start` と `POST /stop`（ルート直下）。**推論本体と同じ `38081` に共存**させる。

### 挙動（要約）

- **写真持出**: 登録 API 成功後にラベルバッチを非同期キック。各ローン処理の前後で ensure/release（参照カウントあり）。
- **要領書**: `KIOSK_DOCUMENT_SUMMARY_INFERENCE_ENABLED=true` かつ推論設定が有効なとき、**深夜 OCR バッチ**の前後で ensure/release。
- **既定**: `LOCAL_LLM_RUNTIME_MODE=always_on` のとき従来どおり（制御 HTTP は使わない）。

### 本番反映後の実機検証（Phase12）

- [deployment.md](../guides/deployment.md) 前提で Mac から Tailscale 経由の到達が取れる状態で、`../../scripts/deploy/verify-phase12-real.sh` を実行する。API・キオスク系・サイネージサービス等の回帰を一括確認できる。**2026-03-30 実測**: **PASS 37 / WARN 0 / FAIL 0**（約 100s）。Pi5+Pi4×4 に本ブランチを順次載せた直後の確認に使用可（Pi3 はスクリプトが別途 SSH する。**Pi3 専用の慎重手順**は deployment ガイドのサイネージ節に従う）。
- **`on_demand` を本番で有効化した後**は Phase12 に加え、Pi5 ログの **`component: localLlmRuntimeControl`**（`runtime_ready` / `runtime_stopped` 等）と Ubuntu の **`nvidia-smi`**（プロセスに `/app/llama-server` が常時残っていないか）で起停を目視確認する。VRAM 競合の背景は [KB-319](../knowledge-base/KB-319-photo-loan-vlm-tool-label.md) と [ADR-20260403](../decisions/ADR-20260403-on-demand-local-llm-runtime-control.md) の Verification を参照。

## 現在の構成（2026-03-28）

- ノード名: `ubuntu-local-llm-system`
- Tailscale IP: `100.107.223.92`
- Tailscale タグ: `tag:llm`
- ACL: `tag:server -> tag:llm: tcp:38081`（推論 `/v1/*`・埋め込み `/embed`・オンデマンド `/start` `/stop` を同じ tailnet nginx で受ける）
- 外部入口: `nginx` が `38081`
- 内部推論: `llama-server` が `127.0.0.1:38082`
- 内部制御: `control-server.mjs` が `0.0.0.0:39090`、`compose-nginx-1` から Docker bridge gateway 経由で到達
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

### 実機検証メモ（管理 UI 反映後・2026-03-28）

次は **認証トークンなし**＋ **Tailscale 経由（例: `https://100.106.158.2`）** で実施した記録である（**秘密はログに貼らない**）。

| 確認 | コマンド例 | 期待 |
|------|------------|------|
| API 生存 | `curl -sk https://<pi5-tailscale>/api/system/health` | `status` が `ok` または運用上の `degraded`（**`checks.database.status=ok`** なら DB 系切り分けは継続可） |
| LocalLLM 境界 | `curl -sk -o /dev/null -w "%{http_code}\n" https://<pi5-tailscale>/api/system/local-llm/status` | **401**（`errorCode`: `AUTH_TOKEN_REQUIRED`） |
| 管理 UI ルート | `curl -sk -o /dev/null -w "%{http_code}\n" https://<pi5-tailscale>/admin/local-llm` | **200**（SPA。ログイン後に `ADMIN`/`MANAGER` で操作） |
| upstream `/healthz` | Pi5 上で本節「Pi5 実機スモーク」の `docker compose ... exec -T api node -e "..."` | **status 200** |

**トラブルシュート**: `401` 以外の失敗は [KB-318](../knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env)（`LOCAL_LLM_*` の compose 経路）と共有トークン不一致を疑う。

## 写真持出 VLM ラベル（内部ジョブ）

- 写真持出 VLM ラベルは **公開 API ではなく、Pi5 API 内部の cron ジョブ**として動作する
- LocalLLM への到達は **既存の `LOCAL_LLM_*`** を再利用する
- 追加のジョブ設定:
  - `PHOTO_TOOL_LABEL_CRON`（既定 `*/5 * * * *`）
  - `PHOTO_TOOL_LABEL_BATCH_SIZE`（既定 `3`）
  - `PHOTO_TOOL_LABEL_STALE_MINUTES`（既定 `30`）
  - `PHOTO_TOOL_LABEL_VISION_SOURCE`（`original` \| `thumbnail`、既定 **`original`** … 元画像を長辺 `PHOTO_TOOL_LABEL_VISION_MAX_LONG_EDGE` 前後に縮小した JPEG を VLM へ渡す）
  - `PHOTO_TOOL_LABEL_VISION_MAX_LONG_EDGE` / `PHOTO_TOOL_LABEL_VISION_JPEG_QUALITY` / 任意 `PHOTO_TOOL_LABEL_USER_PROMPT`
- 保存先は `Loan.photoToolDisplayName` であり、**Item マスタには紐づけない**
- **表示**（2026-03-29 以降）: キオスク・サイネージは `resolvePhotoLoanToolDisplayLabel` により **`photoToolHumanDisplayName`（人レビュー）> `photoToolDisplayName`（VLM）> `撮影mode`**。人レビュー API/UI は [KB-319](../knowledge-base/KB-319-photo-loan-vlm-tool-label.md) フェーズ1節・[photo-loan.md](../modules/tools/photo-loan.md) を参照

### Pi5 実機確認（写真持出 VLM）

1. **API 全体の生存**

```bash
curl -sk https://localhost/api/system/health
```

期待: `status=ok`、少なくとも `checks.database.status=ok`

2. **API コンテナに LocalLLM 設定があること**

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api \
  node -e "const b=process.env.LOCAL_LLM_BASE_URL; const t=process.env.LOCAL_LLM_SHARED_TOKEN; const m=process.env.LOCAL_LLM_MODEL; console.log(JSON.stringify({hasBaseUrl:Boolean(b), hasToken:Boolean(t), model:m||null}, null, 2));"
```

期待: `hasBaseUrl: true`, `hasToken: true`, `model` が null でない

3. **DB の VLM 進捗を確認**

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return -v ON_ERROR_STOP=1 -P pager=off -F $'\t' -A -c \
  "SELECT COUNT(*) FILTER (WHERE \"photoToolLabelRequested\" IS TRUE) AS requested,
          COUNT(*) FILTER (WHERE \"photoToolDisplayName\" IS NOT NULL) AS labeled,
          COUNT(*) FILTER (WHERE \"photoToolLabelClaimedAt\" IS NOT NULL) AS claimed
   FROM \"Loan\";"
```

期待:

- `requested` が新規写真持出件数に応じて増える
- 正常時は `labeled` が追随する
- `claimed` は通常 0、または短時間のみ非 0

4. **付与済みラベルのサンプルを見る**

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return -v ON_ERROR_STOP=1 -P pager=off -F $'\t' -A -c \
  "SELECT \"photoToolDisplayName\", COUNT(*)
   FROM \"Loan\"
   WHERE \"photoToolDisplayName\" IS NOT NULL
   GROUP BY 1
   ORDER BY COUNT(*) DESC, 1 ASC
   LIMIT 10;"
```

### 写真持出 VLM のトラブルシュート

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| `requested > 0` なのに `labeled = 0` | LocalLLM 未設定、upstream 不達、scheduler 未起動 | 本 Runbook の `LOCAL_LLM_*` 確認と `/healthz` 到達確認を実施し、API 再起動後に次回 cron を待つ |
| `claimed > 0` が戻らない | 推論途中で API が落ちた、または claim がスタック | `PHOTO_TOOL_LABEL_STALE_MINUTES` 経過後に解放されるか確認。継続する場合は DB 行の件数と API 再起動ログを確認 |
| 写真持出カードが常に `撮影mode` | 人レビュー・VLM とも表示名なし、または VLM 空応答で claim 解放のみ | DB で `photoToolHumanDisplayName` / `photoToolDisplayName` を確認。VLM 側はジョブログの `responseCharLen` / warning を確認 |
| マルチモーダル推論だけ 4xx/5xx になる | llama-server の `messages[].content` JSON 形が実機ビルド差分と不一致 | `apps/api/src/services/vision/llama-server-vision-completion.adapter.ts` の payload 形を実機に合わせて調整する |
| ラベルが工具名ではない | 初版仕様が「最も目立つ 1 つ」の短い表示名であり、物品種別の厳密判定ではない | 表示仕様として許容。マスタ照合や候補提示は別機能で検討する |

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
- **実装要点（Web）**: HTTP は `apps/web/src/api/local-llm.ts` に集約。503 時も `GET …/status` の JSON を表示する。チャット送信はクライアント側で短いクールダウンあり。**本番ではプロンプト／応答全文を `console.log` しない**（[ADR-20260329](../decisions/ADR-20260329-local-llm-pi5-api-operations.md)）。

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
