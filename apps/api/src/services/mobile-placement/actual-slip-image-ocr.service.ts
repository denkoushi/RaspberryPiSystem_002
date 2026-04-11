import sharp from 'sharp';

import { getImageOcrPort } from '../ocr/image-ocr-runtime.js';
import type { ImageOcrMimeType } from '../ocr/ports/image-ocr.port.js';

import { parseActualSlipIdentifiersFromOcrText } from './actual-slip-identifier-parser.js';

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
}): Promise<ParseActualSlipImageResult> {
  const jpegBytes = await preprocessForOcr(params.imageBytes);
  const port = getImageOcrPort();
  const { text, engine } = await port.runOcrOnImage({ imageBytes: jpegBytes, mimeType: 'image/jpeg' });
  const parsed = parseActualSlipIdentifiersFromOcrText(text);
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
