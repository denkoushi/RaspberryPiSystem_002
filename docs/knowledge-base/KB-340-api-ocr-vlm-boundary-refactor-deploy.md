---
title: KB-340 API OCR/VLM 境界整理リファクタ（本番デプロイ・実機検証）
tags: [api, ocr, vlm, inference, deploy]
audience: [開発者, 運用者]
last-verified: 2026-04-11
related: [ADR-20260402-inference-foundation-phase1.md, KB-313-kiosk-documents.md, KB-319-photo-loan-vlm-tool-label.md]
category: knowledge-base
---

# KB-340: API OCR/VLM 境界整理リファクタ（本番デプロイ・実機検証）

## Context

- **いつ**: 2026-04-11
- **何を**: `apps/api` において、**要領書 OCR** と **写真持出 VLM（OpenAI 互換 vision）** のモジュール境界を整理（ポートの中立化・`RoutedVisionCompletionAdapter` の `useCase` 注入・`kiosk-documents` からの再エクスポート互換）。
- **コード**: コミット `b0f4a180`（ブランチ `feat/ocr-vlm-boundary-refactor`）。設計の背景は [ADR-20260402](../decisions/ADR-20260402-inference-foundation-phase1.md) を参照。

## 仕様（運用者向けサマリ）

- **挙動互換**: 既存の **NDLOCR-Lite パイプライン**（`KIOSK_DOCUMENT_*`）と **写真ラベル VLM**（`photo_label` ルート・観測メタの `useCase`）は、**リファクタ前と同じ契約・同じ環境変数**を前提とする（境界移動のみ）。
- **新規 import 先（推奨）**:
  - OCR: `apps/api/src/services/ocr/`（`OcrEnginePort` / `NdlOcrEngineAdapter`）
  - Vision: `apps/api/src/services/inference/ports/vision-completion.port.ts`（`VisionCompletionPort`）
- **互換 import**: `kiosk-documents/ports/ocr-engine.port.ts`・`photo-tool-label-ports.ts` は **再エクスポート**を維持。

## 本番デプロイ

- **手順の正**: [deployment.md](../guides/deployment.md)
- **対象ホスト（順次・1 台ずつ）**: `raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01` → **`raspberrypi3`（最後・単独・Pi3 リソース制約に従う）**
- **コマンド例**:
  - `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`
  - `./scripts/update-all-clients.sh feat/ocr-vlm-boundary-refactor infrastructure/ansible/inventory.yml --limit "<host>" --detach --follow`
- **Detach Run ID（Pi5 上のログ接頭辞・2026-04-11 実施）**:
  - Pi5: `ansible-update-20260411-155343-23597`
  - `raspberrypi4`: `…160223-21963`
  - `raspi4-robodrill01`: `…160651-9277`
  - `raspi4-fjv60-80`: `…161016-6897`
  - `raspi4-kensaku-stonebase01`: `…161439-6340`
  - Pi3: `…161804-15059`
- **成功判定**: 各実行で **`PLAY RECAP` `failed=0`**、リモート **`…summary.json` の success チェック true**（[deployment.md](../guides/deployment.md) の共通条件）。

## 実機検証（自動）

- `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 49s・Mac / Tailscale・2026-04-11）
- 要領書スモーク: `GET /api/kiosk-documents`（`documents` 配列）を含む既存チェックで **回帰なし**。

## トラブルシューティング

1. **`update-all-clients.sh` がローカル作業ツリーで停止**（未 commit / 未追跡ファイル）  
   - メッセージ: 未 commit 変更があるためデプロイ不可。  
   - **対処**: `git status` を確認し、**追跡外のみ**なら `git stash push -u -m "pre-deploy"` で退避してから再実行（[deployment.md](../guides/deployment.md)・[KB-333](./KB-333-signage-compact24-footer-kiosk-cancel-readability.md) と同型）。

2. **Pi3 デプロイ後ログに `signage-lite` の一時 exit-code**  
   - [deployment.md](../guides/deployment.md)「ラズパイ3（サイネージ）」および [KB-216](./infrastructure/ansible-deployment.md#kb-216-pi3デプロイ時のpost_tasksでunreachable1が発生するがサービスは正常動作している) に従い、**`failed=0` を正本**とし、必要なら `systemctl is-active signage-lite.service` で確認。

3. **OCR パイプラインの切り分け**（従来どおり）  
   - [KB-313](./KB-313-kiosk-documents.md) の環境変数・`ndlocr-lite` / `pdftoppm`・ログ `[KioskDocument]` を参照。

4. **VLM 写真ラベルの切り分け**（従来どおり）  
   - [KB-319](./KB-319-photo-loan-vlm-tool-label.md)・LocalLLM 配線 [KB-318](../knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env)。

## References

- [ADR-20260402](../decisions/ADR-20260402-inference-foundation-phase1.md)
- [KB-313](./KB-313-kiosk-documents.md)
- [KB-319](./KB-319-photo-loan-vlm-tool-label.md)
- [deployment.md](../guides/deployment.md)
- [EXEC_PLAN.md](../../EXEC_PLAN.md)
