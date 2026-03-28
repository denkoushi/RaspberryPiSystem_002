---
title: Runbook: Ubuntu LocalLLM を Tailscale sidecar で分離運用する
tags: [運用, LocalLLM, Tailscale, llama.cpp, Docker, Ubuntu]
audience: [運用者, 開発者]
last-verified: 2026-03-28
related:
  - ../security/tailscale-policy.md
  - ../security/system-inventory.md
  - ../knowledge-base/infrastructure/security.md#kb-317-ubuntu-localllm-を-tailscale-sidecar--tagllm-で分離公開する
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

## 参照

- [KB-317](../knowledge-base/infrastructure/security.md#kb-317-ubuntu-localllm-を-tailscale-sidecar--tagllm-で分離公開する)
- [ADR-20260328](../decisions/ADR-20260328-ubuntu-local-llm-tailnet-sidecar.md)
- [Tailscale Policy](../security/tailscale-policy.md)
