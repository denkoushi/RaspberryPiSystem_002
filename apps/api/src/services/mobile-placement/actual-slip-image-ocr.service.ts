import sharp from 'sharp';

import { logger } from '../../lib/logger.js';
import { getImageOcrPort } from '../ocr/image-ocr-runtime.js';
import type { ImageOcrMimeType } from '../ocr/ports/image-ocr.port.js';

import { parseActualSlipIdentifiersFromOcrText } from './actual-slip-identifier-parser.js';

const log = logger.child({ component: 'actualSlipImageOcr' });

export type ParseActualSlipImageResult = {
  engine: string;
  /** OCR 全文（確認用。ログには出さない運用） */
  ocrText: string;
  manufacturingOrder10: string | null;
  fseiban: string | null;
};

/**
 * 現品票画像を OCR し、製造order / FSEIBAN 候補を抽出する。
 */
export async function parseActualSlipImageFromUpload(params: {
  imageBytes: Buffer;
  mimeType: ImageOcrMimeType;
  /** リクエスト相関用（任意） */
  requestId?: string;
}): Promise<ParseActualSlipImageResult> {
  const startedMs = Date.now();
  const inputBytes = params.imageBytes.length;
  const jpegBytes = await preprocessForOcr(params.imageBytes);
  const preprocessBytes = jpegBytes.length;
  const port = getImageOcrPort();
  const { text, engine } = await port.runOcrOnImage({ imageBytes: jpegBytes, mimeType: 'image/jpeg' });
  const parsed = parseActualSlipIdentifiersFromOcrText(text);
  const durationMs = Date.now() - startedMs;

  log.info(
    {
      event: 'parse-actual-slip-image',
      requestId: params.requestId,
      mimeType: params.mimeType,
      inputBytes,
      preprocessBytes,
      engine,
      ocrTextChars: text.length,
      hasManufacturingOrder10: parsed.manufacturingOrder10 != null,
      hasFseiban: parsed.fseiban != null,
      durationMs
    },
    'parse-actual-slip-image ocr completed'
  );

  return {
    engine,
    ocrText: text,
    manufacturingOrder10: parsed.manufacturingOrder10,
    fseiban: parsed.fseiban
  };
}

async function preprocessForOcr(buffer: Buffer): Promise<Buffer> {
  const meta = await sharp(buffer).metadata();
  if (meta.width && meta.width > 2200) {
    return sharp(buffer).resize({ width: 2200 }).jpeg({ quality: 90 }).toBuffer();
  }
  return sharp(buffer).jpeg({ quality: 90 }).toBuffer();
}
