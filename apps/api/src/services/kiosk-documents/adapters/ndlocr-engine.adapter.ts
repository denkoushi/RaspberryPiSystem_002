import { execFile } from 'child_process';
import { promisify } from 'util';

import { ApiError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import type { OcrEnginePort, OcrResult } from '../ports/ocr-engine.port.js';

const execFileAsync = promisify(execFile);
const DEFAULT_OCR_COMMAND = process.env.KIOSK_DOCUMENT_OCR_COMMAND || 'ndlocr-lite';

/**
 * NDLOCR-Lite 互換の外部コマンド実行アダプタ。
 * コマンドは stdout に抽出テキストを出力する前提。
 */
export class NdlOcrEngineAdapter implements OcrEnginePort {
  constructor(private readonly command = DEFAULT_OCR_COMMAND) {}

  async runOcr(pdfPath: string): Promise<OcrResult> {
    try {
      const { stdout } = await execFileAsync(this.command, [pdfPath], { timeout: 180_000 });
      const text = stdout?.toString?.() ?? '';
      if (text.trim().length === 0) {
        throw new Error('OCR出力が空です');
      }
      return { text, engine: 'NDLOCR-Lite' };
    } catch (error) {
      logger.error({ err: error, pdfPath, command: this.command }, '[KioskDocument] OCR command failed');
      throw new ApiError(500, 'OCR処理に失敗しました', undefined, 'KIOSK_DOC_OCR_FAILED');
    }
  }
}
