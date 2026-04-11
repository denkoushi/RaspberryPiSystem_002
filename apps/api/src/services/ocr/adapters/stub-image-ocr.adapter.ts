import type { ImageOcrInput, ImageOcrPort, ImageOcrResult } from '../ports/image-ocr.port.js';

/**
 * テストまたは OCR 無効環境向けの固定テキスト返却。
 */
export class StubImageOcrAdapter implements ImageOcrPort {
  constructor(private readonly fixedText: string) {}

  async runOcrOnImage(_input: ImageOcrInput): Promise<ImageOcrResult> {
    void _input;
    return { text: this.fixedText, engine: 'stub' };
  }
}
