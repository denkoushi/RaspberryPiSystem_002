Title: ADR-20260329: Pi5 API 上の LocalLLM 代理の運用境界とログ方針
Status: accepted
Context:
  - [ADR-20260328](./ADR-20260328-ubuntu-local-llm-tailnet-sidecar.md) は Ubuntu 側の tailnet 参加・ACL・`X-LLM-Token` 入口までを扱う。Pi5 API が同トークンで upstream を呼ぶ **アプリ層の責務**は別ドキュメントで固定したい。
  - エンドポイントは `GET /api/system/local-llm/status` と `POST /api/system/local-llm/chat/completions`（[`local-llm.ts`](../../apps/api/src/routes/system/local-llm.ts)）。認可は `ADMIN` / `MANAGER` のみ。キオスク・サイネージ経路には載せない。
  - `LOCAL_LLM_*` の本番実効値は compose の `env_file` 経由であり、Ansible の `docker.env.j2` が正本（[KB-318](../knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env)）。
Decision:
  - **利用者**: LocalLLM 代理 API は **管理ロール（`ADMIN` / `MANAGER`）のみ**。一般キオスク利用者や外部公開を前提としない。
  - **秘密情報**: `LOCAL_LLM_SHARED_TOKEN` および `X-LLM-Token` は **ログ・メトリクスラベル・クライアント応答に含めない**。変更は Ansible vault / `host_vars` と `docker.env.j2` の配線で行い、ローテーション後は旧トークンを Ubuntu `api-token` 側と揃えて無効化する（手順の詳細は [local-llm-tailscale-sidecar.md](../runbooks/local-llm-tailscale-sidecar.md)）。
  - **構造化ログでよいもの**: 処理時間（ms）、成否、`ApiError.code` 相当のエラーコード、upstream HTTP ステータス（health のみ）、メッセージ件数、`max_tokens` / `temperature`、`usage` の数値フィールド（トークン数の集計値）。
  - **ログに出してはならないもの**: チャット **プロンプト／応答本文**、共有トークン、upstream の **生ボディ全文**（必要なら長さやハッシュのみを検討し、現状は未採用）。
Alternatives:
  - **監査ログを DB 永続化**: コンプライアンス要件が出た段階で検討。現状は構造化ログとコンテナログ集約で十分とする。
Consequences:
  - 運用・開発が「誰が触れるか」「ログに何が載るか」で齟齬しにくい。
  - 将来の管理 UI やレート制限を足すとき、本 ADR を拡張または子 ADR で追記する。
References:
  - [ADR-20260328](./ADR-20260328-ubuntu-local-llm-tailnet-sidecar.md)
  - [KB-317](../knowledge-base/infrastructure/security.md#kb-317-ubuntu-localllm-を-tailscale-sidecar--tagllm-で分離公開する)
  - [KB-318](../knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env)
  - [local-llm-tailscale-sidecar.md](../runbooks/local-llm-tailscale-sidecar.md)
