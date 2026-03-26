import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { logger } from '../../../lib/logger.js';
import type { DocumentTextExtractorPort, ExtractedDocumentText } from '../ports/document-text-extractor.port.js';

const execFileAsync = promisify(execFile);

/**
 * poppler の `pdftotext` を使う抽出アダプタ。
 * 失敗時は空文字を返し、文書登録フローを止めない。
 */
export class PdfToTextExtractorAdapter implements DocumentTextExtractorPort {
  async extractText(pdfPath: string): Promise<ExtractedDocumentText> {
    const outPath = path.join(os.tmpdir(), `kiosk-doc-${randomUUID()}.txt`);
    try {
      await execFileAsync('pdftotext', ['-layout', pdfPath, outPath], { timeout: 60_000 });
      const text = await fs.readFile(outPath, 'utf8');
      return { text };
    } catch (error) {
      logger.warn({ err: error, pdfPath }, '[KioskDocument] pdftotext extraction failed');
      return { text: '' };
    } finally {
      try {
        await fs.unlink(outPath);
      } catch {
        // ignore
      }
    }
  }
}
