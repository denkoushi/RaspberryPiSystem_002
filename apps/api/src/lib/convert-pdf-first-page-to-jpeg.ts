import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';

import { ApiError } from './errors.js';
import { logger } from './logger.js';
import {
  PART_MEASUREMENT_DRAWING_SAVED_MAX_BYTES,
  PART_MEASUREMENT_PDF_CONVERT_TIMEOUT_MS,
  PART_MEASUREMENT_PDF_JPEG_QUALITY,
  PART_MEASUREMENT_PDF_RENDER_DPI
} from './part-measurement-drawing-import.constants.js';
import { withPdfConvertSlot } from './pdf-convert-semaphore.js';

const execFileAsync = promisify(execFile);

/** pdftoppm 引数（単体テスト用） */
export function buildPdftoppmFirstPageArgs(
  pdfFilePath: string,
  outputPrefix: string,
  dpi: number,
  quality: number
): string[] {
  return [
    '-f',
    '1',
    '-l',
    '1',
    '-singlefile',
    '-jpeg',
    '-r',
    String(dpi),
    '-jpegopt',
    `quality=${quality}`,
    pdfFilePath,
    outputPrefix
  ];
}

export type ConvertPdfFirstPageOptions = {
  dpi?: number;
  quality?: number;
  timeoutMs?: number;
};

function mapPdftoppmFailure(stderr: string, err: unknown): ApiError {
  const combined = `${stderr} ${err instanceof Error ? err.message : String(err)}`.toLowerCase();
  if (combined.includes('password') || combined.includes('encrypted') || combined.includes('owner password')) {
    return new ApiError(400, '暗号化された PDF は取り込めません');
  }
  return new ApiError(400, 'PDF の変換に失敗しました');
}

/**
 * 既存 PDF ファイルの 1 ページ目のみを JPEG に変換する（singlefile 契約）。
 */
export async function convertPdfFirstPageToJpeg(
  pdfFilePath: string,
  outputDir: string,
  options?: ConvertPdfFirstPageOptions
): Promise<Buffer> {
  const dpi = options?.dpi ?? PART_MEASUREMENT_PDF_RENDER_DPI;
  const quality = options?.quality ?? PART_MEASUREMENT_PDF_JPEG_QUALITY;
  const timeoutMs = options?.timeoutMs ?? PART_MEASUREMENT_PDF_CONVERT_TIMEOUT_MS;
  const outputPrefix = path.join(outputDir, 'page');

  await fs.mkdir(outputDir, { recursive: true });

  const args = buildPdftoppmFirstPageArgs(pdfFilePath, outputPrefix, dpi, quality);

  const run = async (): Promise<Buffer> => {
    try {
      await execFileAsync('pdftoppm', args, { timeout: timeoutMs });
    } catch (error) {
      const stderr =
        error && typeof error === 'object' && 'stderr' in error
          ? String((error as { stderr?: Buffer | string }).stderr ?? '')
          : '';
      logger.warn({ err: error, pdfFilePath, args }, 'pdftoppm first-page conversion failed');
      throw mapPdftoppmFailure(stderr, error);
    }

    const entries = await fs.readdir(outputDir);
    const jpegNames = entries.filter((name) => /\.jpe?g$/i.test(name)).sort();
    if (jpegNames.length !== 1) {
      throw new ApiError(400, 'PDF の変換に失敗しました');
    }

    const jpegPath = path.join(outputDir, jpegNames[0]!);
    const buffer = await fs.readFile(jpegPath);
    if (buffer.length > PART_MEASUREMENT_DRAWING_SAVED_MAX_BYTES) {
      throw new ApiError(400, '変換後の図面画像が大きすぎます');
    }
    if (buffer.length === 0) {
      throw new ApiError(400, 'PDF の変換に失敗しました');
    }
    return buffer;
  };

  return withPdfConvertSlot(run);
}
