import type { ImageOcrPort } from './ports/image-ocr.port.js';
import { StubImageOcrAdapter } from './adapters/stub-image-ocr.adapter.js';
import { TesseractJsImageOcrAdapter } from './adapters/tesseract-js-image-ocr.adapter.js';

let cached: ImageOcrPort | null = null;

/**
 * プロセス内シングルトン。`IMAGE_OCR_STUB_TEXT` 設定時はスタブ（テスト用）。
 */
export function getImageOcrPort(): ImageOcrPort {
  if (cached) {
    return cached;
  }
  const stubText = process.env.IMAGE_OCR_STUB_TEXT;
  if (typeof stubText === 'string') {
    cached = new StubImageOcrAdapter(stubText);
    return cached;
  }
  cached = new TesseractJsImageOcrAdapter();
  return cached;
}

/** 単体テスト用 */
export function resetImageOcrPortForTests(): void {
  cached = null;
}
