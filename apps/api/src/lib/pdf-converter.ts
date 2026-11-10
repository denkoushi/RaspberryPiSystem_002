import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { promises as fs } from 'fs';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

export interface PdfConversionOptions {
  /**
   * 出力ファイルの接頭辞
   */
  prefix?: string;
  /**
   * 画像フォーマット
   */
  format?: 'jpeg' | 'png';
  /**
   * 出力DPI
   */
  dpi?: number;
  /**
   * JPEG画質（1-100）
   */
  quality?: number;
  /**
   * 変換する最後のページ（1 始まり）。未指定なら全ページ
   */
  lastPage?: number;
  /**
   * 変換の打ち切り時間（ミリ秒）
   */
  timeoutMs?: number;
}

export const PDF_CONVERT_DEFAULT_TIMEOUT_MS = 300_000;

/**
 * pdftoppm（poppler-utils）を使用してPDFを画像に変換する
 */
export async function convertPdfToImages(
  pdfFilePath: string,
  outputDir: string,
  options?: PdfConversionOptions,
): Promise<void> {
  const format = options?.format ?? 'jpeg';
  const dpi = options?.dpi ?? 144;
  const prefix = options?.prefix ?? 'page';
  const quality = options?.quality ?? 85;

  await fs.mkdir(outputDir, { recursive: true });

  const timeoutMs = options?.timeoutMs ?? PDF_CONVERT_DEFAULT_TIMEOUT_MS;

  const outputPrefix = path.join(outputDir, prefix);
  const pageArgs = options?.lastPage === undefined ? [] : ['-l', String(options.lastPage)];
  const args =
    format === 'png'
      ? ['-png', '-r', String(dpi), ...pageArgs, pdfFilePath, outputPrefix]
      : ['-jpeg', '-r', String(dpi), '-jpegopt', `quality=${quality}`, ...pageArgs, pdfFilePath, outputPrefix];

  logger.info(
    {
      pdfFilePath,
      outputDir,
      args,
    },
    'Converting PDF to images via pdftoppm',
  );

  try {
    await execFileAsync('pdftoppm', args, { timeout: timeoutMs });
  } catch (error) {
    logger.error({ err: error, pdfFilePath, args }, 'pdftoppm conversion failed');
    throw error;
  }
}

