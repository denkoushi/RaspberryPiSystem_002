# ADR-20260428: DGX `ACTIVE_LLM_BACKEND` の本番既定（green / blue）の扱い

Status: accepted

## Context

- DGX `system-prod` は **green**（`llama.cpp` + `mmproj`）と **blue**（例: `vLLM` + `Qwen3.6-27B-NVFP4`）を `ACTIVE_LLM_BACKEND` で切り替えられる。
- blue は技術的に **OpenAI 互換 API 到達**まで確認済みだが、cold start が **~12 分規模**になり得る、GPU/統一メモリの**占有**、VLM/画像経路の **400 系残課題**が残る。

## Decision

- **2026-04-28 時点の本番既定は `ACTIVE_LLM_BACKEND=green` を維持**する（本番の「常に選ばれる backend」は green）。
- blue を本番既定に切り替える場合は、上記トレードオフを運用で受容したうえで **Runbook を更新**し、必要なら本 ADR を **superseded** または追記で更新する。

## 運用上の実態（方針と実機は別）

- 本 ADR の **「本番既定」**は、**リポジトリと運用手順が目指す正（green を正とする方針）** を指す。一方、**DGX 実機の `ACTIVE_LLM_BACKEND` は `secrets/*.env` の更新や検証により blue になっていることがある**。
- **実際にどちらが active か**は、ドキュメントより **`POST /start` の JSON `backend` フィールド**と **`GET /v1/models` の各 model `root`**（例: `sakamakismile/Qwen3.6-27B-NVFP4`）で確認する。
- **VLM 画像 400**（PR [#204](https://github.com/denkoushi/RaspberryPiSystem_002/pull/204) / [#205](https://github.com/denkoushi/RaspberryPiSystem_002/pull/205) 反映後）の知見: 400 は単一不具合ではなく **入力条件依存**（コンテキスト超過・画像デコード失敗等）に分類できる。Pi5 保存画像の一括プローブでは **全件 200** の観測例あり（詳細は Runbook / `deployment.md`）。

## Alternatives

- **本番を blue 既定**: レイテンシ・占有のコストを払い、推論スタックを vLLM 側に統一する。
- **用途分割**（将来）: 管理 chat だけ blue 等は、Pi5 側ルーティング拡張が必要になるため、現時点では採用しない。

## Consequences

- 良い: 既知の安定経路（green VLM）を本番の正とし、blue は検証・比較に使い分けやすい。
- 注意: **方針（本 ADR）と DGX 実機の active は一致しないことがある**。実機は **`POST /start` / `GET /v1/models`** で確認する。blue へ切り替えるたびに **ready 待ち・リソース占有**を再確認する。

## References

- [docs/runbooks/dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)（Blue/Green・トラブルシューティング）
- [docs/plans/dgx-spark-local-llm-migration-execplan.md](../plans/dgx-spark-local-llm-migration-execplan.md)（Immediate Next Steps）
