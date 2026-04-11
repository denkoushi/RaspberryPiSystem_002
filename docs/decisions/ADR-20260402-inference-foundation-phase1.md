---
title: ADR-20260402 推論基盤フェーズ1（複数プロバイダ・用途別ルート・text/vision 分離）
status: accepted
date: 2026-04-02
---

# ADR-20260402: 推論基盤フェーズ1

## Context

- Pi5 を API/DB/保存の基幹として維持しつつ、Ubuntu 等の OpenAI 互換推論（llama-server）を複数用途で利用している。
- 従来は `LOCAL_LLM_*` 単数と、写真持出専用の vision アダプタ、管理用 `LocalLlmGateway` が別経路として共存していた。
- 将来、モデル差し替え・別高速 PC の追加・用途別モデル指定を行うには、**境界の明確化**と**設定の拡張**が必要。

## Decision

1. **`apps/api/src/services/inference/`** に共通推論モジュールを新設する。
   - **text** と **vision** を別ポート（`TextCompletionPort` / `VisionCompletionPort` 互換のルーティング実装）で扱う。
   - **InferenceRouter** で用途（`photo_label` / `document_summary`）→ プロバイダ id・モデルを固定マッピングする。
2. **プロバイダ定義**は `INFERENCE_PROVIDERS_JSON`（JSON 配列）で複数件を表現する。未設定時は既存 **`LOCAL_LLM_*` から id=`default` を1件合成**し、後方互換とする。
3. **写真持出 VLM**は `RoutedVisionCompletionAdapter` 経由で `photo_label` ルートを使用する。`max_tokens` / temperature は用途別 env（例: `INFERENCE_PHOTO_LABEL_VISION_MAX_TOKENS`）で調整可能。
4. **要領書要約**は `KIOSK_DOCUMENT_SUMMARY_INFERENCE_ENABLED=true` かつ `document_summary` が解決可能なときのみ、OCR 後に **テキスト completion** を試行する。失敗時は従来の機械スニペット（`buildSummaryCandidates`）へフォールバックし、**基幹処理（OCR 完了・DB 更新）は継続**する。
5. **`GET/POST /api/system/local-llm/*`** は **管理者の疎通・デバッグ入口**として残す。接続先は **既定プロバイダ（id=`default` または配列先頭）** の `baseUrl` / `defaultModel` を表示・代理に使用する。

## Observability

- 業務経路の推論呼び出しは `component: inference` の構造化ログで記録する（`useCase`, `providerId`, `model`, `latencyMs`, `result`, `errorReason`, `inputSize`, `outputSize`）。本文はログに出さない。

## Consequences

### Good

- プロバイダ追加が設定＋（必要なら）アダプタで閉じ、業務コードの変更を最小化できる。
- 用途別モデル・接続先を明示でき、運用・障害切り分けがしやすい。
- 要領書要約の推論はオプトインのため、既存デプロイを壊しにくい。

### Bad / Trade-offs

- `getInferenceRuntime()` のシングルトンは **プロセス内で env を変えるテスト**では `resetInferenceRuntimeForTests()` が必要（local-llm ルートテストで対応）。
- `INFERENCE_PROVIDERS_JSON` の構文エラー時は警告ログのうえ **LOCAL_LLM_* へフォールバック**する（運用では JSON 検証を推奨）。

## Verification（実機・2026-03-30）

- **ブランチ**: `feat/inference-foundation-phase1`（マージ前コミット例: `08db3f23`）。
- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`./scripts/update-all-clients.sh feat/inference-foundation-phase1 infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`**（Mac からは `RASPI_SERVER_HOST` 必須。SSH config エイリアス `raspi5-tailscale` 利用可）。Pi5 Detach Run ID 例: **`20260330-171021-10204`**（`PLAY RECAP` で `raspberrypi5` が `failed=0`。Pi4/Pi3 は `no hosts matched`）。
- **Phase12 一括**: リポジトリルートで `./scripts/deploy/verify-phase12-real.sh` → **PASS 37 / WARN 0 / FAIL 0**（約 95s、Tailscale 到達時）。要領書 API **200**・`documents` 配列を含むチェックを含む。
- **仕様上の注意**: 本番では要領書テキスト推論は既定 **OFF**（`KIOSK_DOCUMENT_SUMMARY_INFERENCE_ENABLED` 未設定または `false`）。Phase12 だけでは LLM 要約の成功／失敗は検証しない（API・DB・キオスク一覧の回帰が主眼）。写真ラベル VLM は **`photo_label` ルート**経由に切替済み；upstream 未到達時は既存ジョブのリトライ・フォールバック方針に従う。
- **トラブルシュート**: `INFERENCE_PROVIDERS_JSON` 不正時は起動ログに警告のうえ **`LOCAL_LLM_*` 合成**へフォールバック。観測は pino で `component: inference`（本文はログに出さない）。

## Verification（境界整理・実機・2026-04-11）

- **ブランチ**: `feat/ocr-vlm-boundary-refactor`（コミット `b0f4a180`）。**変更**: `VisionCompletionPort` を `inference/ports` へ集約、`RoutedVisionCompletionAdapter` に **`useCase` 注入**、OCR を `services/ocr` へ移動（挙動互換・`KIOSK_DOCUMENT_*` 維持）。
- **デプロイ・検証**: [KB-340](../knowledge-base/KB-340-api-ocr-vlm-boundary-refactor-deploy.md) のとおり Pi5→Pi4×4→Pi3 順次、`verify-phase12-real.sh` **PASS 43 / WARN 0 / FAIL 0**。

## References

- 実装: `apps/api/src/services/inference/`（OCR 契約は `apps/api/src/services/ocr/`・Vision 契約は `inference/ports/vision-completion.port.ts`）
- 境界整理の本番記録: [KB-340](../knowledge-base/KB-340-api-ocr-vlm-boundary-refactor-deploy.md)
- 要領書: [kiosk-documents.md](../runbooks/kiosk-documents.md)
- LocalLLM 運用: [local-llm-tailscale-sidecar.md](../runbooks/local-llm-tailscale-sidecar.md)
- 既存: [ADR-20260329](./ADR-20260329-local-llm-pi5-api-operations.md)
