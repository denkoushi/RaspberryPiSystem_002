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

- **単一アクティブ運用（コード側のガード）**: `control-server.py` は既定で **`POST /start` の直前に非アクティブ側（green/blue のもう一方）へ実 stop** を掛け、その後にアクティブ側を起動する（環境変数 `DGX_LLM_SINGLE_ACTIVE_GUARD`、実装は [`scripts/dgx-local-llm-system/dgx_llm_single_active_guard.py`](../../scripts/dgx-local-llm-system/dgx_llm_single_active_guard.py)）。`BLUE_LLM_RUNTIME_STOP_MODE=keep_warm` 等は **アクティブ側 blue の `/stop` のみ**に効き、非アクティブ側のクリーンアップには適用されない。詳細は Runbook「Blue/Green backend での安全な差し替え」を参照。
- **私用モードでの強制退避**: 管理コンソールの **`private_ok`** は、Comfy 向けに Spark メモリを空けるため **`system-prod-gateway` を `POST /stop-force` で停止**し、**blue active + `keep_warm`** でも実ランタイムを退避させる。この **強制停止は通常 `/stop` と別契約**であり、Hermes や通常運用の keep-warm 方針を壊さない。

## Alternatives

- **本番を blue 既定**: レイテンシ・占有のコストを払い、推論スタックを vLLM 側に統一する。
- **用途分割**（将来）: 管理 chat だけ blue 等は、Pi5 側ルーティング拡張が必要になるため、現時点では採用しない。

## Consequences

- 良い: 既知の安定経路（green VLM）を本番の正とし、blue は検証・比較に使い分けやすい。
- 注意: **方針（本 ADR）と DGX 実機の active は一致しないことがある**。実機は **`POST /start` / `GET /v1/models`** で確認する。blue へ切り替えるたびに **ready 待ち・リソース占有**を再確認する。
- 注意: **`private_ok` は active backend を変更しない**。Comfy のために **いったん強制停止してメモリを空ける**だけであり、`business_first` 復帰時に **同じ `ACTIVE_LLM_BACKEND`** を再度起動する前提で運用する。
- 注意: **`DGX_LLM_SINGLE_ACTIVE_GUARD` が有効なとき**、`control-server.py` の起動検証で **green/blue 両系統の実 stop コマンド**が解決できない場合は **プロセス終了**する。片側だけを用意する検証環境では **`DGX_LLM_SINGLE_ACTIVE_GUARD=false`** を明示する。

## References

- [scripts/dgx-local-llm-system/dgx_llm_single_active_guard.py](../../scripts/dgx-local-llm-system/dgx_llm_single_active_guard.py)（単一アクティブ判定）
- [docs/runbooks/dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)（Blue/Green・トラブルシューティング）
- [docs/plans/dgx-spark-local-llm-migration-execplan.md](../plans/dgx-spark-local-llm-migration-execplan.md)（Immediate Next Steps）
