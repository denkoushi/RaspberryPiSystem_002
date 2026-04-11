/**
 * OCR サブシステムの公開境界（要領書以外からも import 可能）。
 */
export type { OcrEnginePort, OcrResult } from './ports/ocr-engine.port.js';
export type { ImageOcrPort, ImageOcrInput, ImageOcrResult, ImageOcrMimeType } from './ports/image-ocr.port.js';
export { NdlOcrEngineAdapter } from './adapters/ndlocr-engine.adapter.js';
export { TesseractJsImageOcrAdapter } from './adapters/tesseract-js-image-ocr.adapter.js';
export { StubImageOcrAdapter } from './adapters/stub-image-ocr.adapter.js';
export { getImageOcrPort, resetImageOcrPortForTests } from './image-ocr-runtime.js';
