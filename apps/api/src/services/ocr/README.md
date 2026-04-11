# OCR サブシステム（API）

要領書（`kiosk-documents`）に依存しない **OCR の契約と実装**を置く。

- **ポート**: [`ports/ocr-engine.port.ts`](./ports/ocr-engine.port.ts) — `OcrEnginePort` / `OcrResult`
- **実装例**: [`adapters/ndlocr-engine.adapter.ts`](./adapters/ndlocr-engine.adapter.ts) — NDLOCR-Lite（環境変数は従来どおり `KIOSK_DOCUMENT_*` を参照し、既存デプロイと互換）

`kiosk-documents` 配下の `ports/ocr-engine.port.ts` / `adapters/ndlocr-engine.adapter.ts` は互換のための再エクスポートのみ。
