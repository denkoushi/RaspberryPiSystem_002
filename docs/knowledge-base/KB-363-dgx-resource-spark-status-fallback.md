---
title: KB-363 DGX リソース Spark ホスト状態の既定フォールバック（admin Local LLM `/healthz`）
tags: [DGX, LocalLLM, Pi5, dgx-resource, 運用]
audience: [開発者, 運用者]
last-verified: 2026-05-02
category: knowledge-base
---

# KB-363: DGX リソース Spark ホスト状態の既定フォールバック（admin Local LLM `/healthz`）

## Context

管理コンソール `/admin/tools/dgx-resource` の `overview.sparkHost` は、Pi5 API が **HTTP GET** で疎通を確認する。**`DGX_RESOURCE_SPARK_HOST_STATUS_URL` が未設定**のとき、専用 sidecar が無くても **admin 向け `LOCAL_LLM_BASE_URL` の `/healthz`** を既定フォールバックとして叩き、ゲートウェイ到達時に **Spark（ホスト）パネルが「完全に沈黙」にならない**ようにする。

## Symptoms

- `DGX_RESOURCE_SPARK_HOST_STATUS_URL` を設定していない環境で、Spark ホスト面が **`unknown` のまま**、または運用上「見えない」ように感じる
- Ansible で **`DGX_RESOURCE_*` を `.env` に出していない**と、将来の明示設定がやりにくい（実装と運用設定のギャップ）

## Investigation / 仕様（CONFIRMED）

- API: [`dgx-resource.service.ts`](../../apps/api/src/services/system/dgx-resource/dgx-resource.service.ts) — `DGX_RESOURCE_SPARK_HOST_STATUS_URL` が空なら **`LOCAL_LLM_BASE_URL` + `/healthz`** を試行（admin token/`X-LLM-Token` は既存ポリシーに従う）
- テスト: [`dgx-resource.service.test.ts`](../../apps/api/src/services/system/dgx-resource/__tests__/dgx-resource.service.test.ts) — フォールバック成功・`/healthz` 失敗時の `stopped` を固定
- Ansible テンプレ: [`api.env.j2`](../../infrastructure/ansible/templates/api.env.j2) / [`docker.env.j2`](../../infrastructure/ansible/templates/docker.env.j2) — `DGX_RESOURCE_*` を出力対象へ追加（値が無ければコメントまたは空でもよい）

## Fix（実装済み）

- 代表コミット: **`6c6888d6`**（`fix(api): restore DGX spark status fallback`）
- PR: [#238](https://github.com/denkoushi/RaspberryPiSystem_002/pull/238)（タイポ修正と同 PR ブランチで API 修正を追随）

## 本番反映（2026-05-02）

- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）
- **ブランチ**: `fix/dgx-resource-admin-readable-typography`
- **コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh fix/dgx-resource-admin-readable-typography infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **Detach Run ID**（`ansible-update-` 接頭辞）: **`20260502-203857-20230`**
- **`PLAY RECAP`**: **`failed=0` / `unreachable=0`**（リモート runner **exit `0`**）
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**

## Troubleshooting

- **`--detach --follow` 中に `Connection closed by … port 22` が一度出る**: `docker compose` 再作成・API コンテナ再起動付近で **一時 SSH 切断がログに混ざり得る**。**正本は `PLAY RECAP` / 遠隔 `summary.json`**（既知の detach 運用知見と同系）
- **未認証で 401**: `GET /api/system/dgx-resource/overview` は **管理者セッション必須**。ルート生存確認だけなら **401 は正常系**（匿名で 200 しない）
- **専用 sidecar を使う場合**: `DGX_RESOURCE_SPARK_HOST_STATUS_URL` を **明示**し、ゲートウェイ `/healthz` との意味分離を維持する（Runbook の ENV 説明を正とする）

## References

- [Runbook: dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)
- [deployment.md](../guides/deployment.md)（2026-05-02 補足: DGX `sparkHost` フォールバック）
- [api.md §KB-363](./api.md#kb-363-dgx-リソース-spark-ホスト状態の既定フォールバックadmin-local-llm-healthz)
