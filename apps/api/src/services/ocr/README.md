# OCR サブシステム（API）

要領書（`kiosk-documents`）に依存しない **OCR の契約と実装**を置く。

- **ポート**: [`ports/ocr-engine.port.ts`](./ports/ocr-engine.port.ts) — `OcrEnginePort` / `OcrResult`
- **実装例**: [`adapters/ndlocr-engine.adapter.ts`](./adapters/ndlocr-engine.adapter.ts) — NDLOCR-Lite（環境変数は従来どおり `KIOSK_DOCUMENT_*` を参照し、既存デプロイと互換）
- **画像 OCR（ラスタ）**: [`ports/image-ocr.port.ts`](./ports/image-ocr.port.ts) — `ImageOcrPort`（PDF 向け `OcrEnginePort` とは分離）
- **実装**: [`adapters/tesseract-js-image-ocr.adapter.ts`](./adapters/tesseract-js-image-ocr.adapter.ts) — `tesseract.js`（`jpn+eng`）
- **取得**: [`image-ocr-runtime.ts`](./image-ocr-runtime.ts) — `getImageOcrPort()`。テスト時は `IMAGE_OCR_STUB_TEXT` で固定テキスト返却。

`kiosk-documents` 配下の `ports/ocr-engine.port.ts` / `adapters/ndlocr-engine.adapter.ts` は互換のための再エクスポートのみ。
