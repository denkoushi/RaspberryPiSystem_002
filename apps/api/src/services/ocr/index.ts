/**
 * OCR サブシステムの公開境界（要領書以外からも import 可能）。
 */
export type { OcrEnginePort, OcrResult } from './ports/ocr-engine.port.js';
export { NdlOcrEngineAdapter } from './adapters/ndlocr-engine.adapter.js';
