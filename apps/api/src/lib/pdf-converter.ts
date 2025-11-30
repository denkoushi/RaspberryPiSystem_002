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
}

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

  const outputPrefix = path.join(outputDir, prefix);
  const args =
    format === 'png'
      ? ['-png', '-r', String(dpi), pdfFilePath, outputPrefix]
      : ['-jpeg', '-r', String(dpi), '-jpegopt', `quality=${quality}`, pdfFilePath, outputPrefix];

  logger.info(
    {
      pdfFilePath,
      outputDir,
      args,
    },
    'Converting PDF to images via pdftoppm',
  );

  try {
    await execFileAsync('pdftoppm', args);
  } catch (error) {
    logger.error({ err: error, pdfFilePath, args }, 'pdftoppm conversion failed');
    throw error;
  }
}

