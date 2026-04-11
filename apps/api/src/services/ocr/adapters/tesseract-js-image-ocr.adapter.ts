import { createWorker, type Worker } from 'tesseract.js';

import type { ImageOcrInput, ImageOcrPort, ImageOcrResult } from '../ports/image-ocr.port.js';

/**
 * tesseract.js による画像 OCR（日本語＋英字。初回起動で学習データ取得の可能性あり）。
 */
export class TesseractJsImageOcrAdapter implements ImageOcrPort {
  private workerPromise: Promise<Worker> | null = null;

  async runOcrOnImage(input: ImageOcrInput): Promise<ImageOcrResult> {
    const worker = await this.getWorker();
    const {
      data: { text }
    } = await worker.recognize(input.imageBytes);
    return {
      text: text.trim(),
      engine: 'tesseract.js'
    };
  }

  private async getWorker(): Promise<Worker> {
    if (!this.workerPromise) {
      this.workerPromise = createWorker('jpn+eng');
    }
    return this.workerPromise;
  }
}
