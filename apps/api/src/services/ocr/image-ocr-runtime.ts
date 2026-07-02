import type { ImageOcrPort } from './ports/image-ocr.port.js';
import type { ImageOcrLayoutPort } from './ports/image-ocr-layout.port.js';
import { StubImageOcrAdapter } from './adapters/stub-image-ocr.adapter.js';
import { TesseractJsImageOcrAdapter } from './adapters/tesseract-js-image-ocr.adapter.js';

let cached: ImageOcrPort | null = null;

type TerminableImageOcrPort = ImageOcrPort & {
  terminate?: () => Promise<void>;
};

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

/**
 * CLI / テスト向け。API常駐プロセスでは worker を再利用するため通常は呼ばない。
 */
export async function shutdownImageOcrPort(): Promise<void> {
  const port = cached as TerminableImageOcrPort | null;
  cached = null;
  if (port?.terminate) {
    await port.terminate();
  }
}

/** 単体テスト用 */
export function resetImageOcrPortForTests(): void {
  cached = null;
}
