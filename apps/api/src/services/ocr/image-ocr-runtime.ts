import type { ImageOcrPort } from './ports/image-ocr.port.js';
import type { ImageOcrLayoutPort } from './ports/image-ocr-layout.port.js';
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

export function getImageOcrLayoutPort(): ImageOcrLayoutPort {
  const port = getImageOcrPort();
  if ('runLayoutOcrOnImage' in port && typeof port.runLayoutOcrOnImage === 'function') {
    return port as ImageOcrLayoutPort;
  }
  return new TesseractJsImageOcrAdapter();
}

/** 単体テスト用 */
export function resetImageOcrPortForTests(): void {
  cached = null;
}
