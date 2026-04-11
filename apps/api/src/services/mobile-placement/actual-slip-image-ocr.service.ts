import sharp from 'sharp';

import { logger } from '../../lib/logger.js';
import { getImageOcrPort } from '../ocr/image-ocr-runtime.js';
import type { ImageOcrMimeType } from '../ocr/ports/image-ocr.port.js';

import { buildActualSlipOcrPreviewSafe } from './actual-slip-ocr-preview.js';
import { parseActualSlipIdentifiersFromOcrText } from './actual-slip-identifier-parser.js';

const log = logger.child({ component: 'actualSlipImageOcr' });

export type ParseActualSlipImageResult = {
  engine: string;
  /** OCR 結合テキスト（ログ・パーサ用。ラベル＋数字＋英数字パス） */
  ocrText: string;
  /**
   * UI 向けプレビュー（数字・英数字パスのみ。ひらがな誤認が多いラベルパスは含めない）。
   * クライアントはこれを優先して表示し、無ければ `ocrText` にフォールバック可能。
   */
  ocrPreviewSafe: string | null;
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
  const jpegShared = await preprocessForOcrShared(params.imageBytes);
  const jpegBinary = await preprocessForOcrDigitBinary(params.imageBytes);
  const preprocessBytes = jpegShared.length;
  const preprocessBytesBinary = jpegBinary.length;
  const port = getImageOcrPort();

  // 同一 worker 内の setParameters を並列に走らせない（adapter 内の worker 共有のため）
  const labels = await port.runOcrOnImage({
    imageBytes: jpegShared,
    mimeType: 'image/jpeg',
    profile: 'actualSlipLabels'
  });
  const digits = await port.runOcrOnImage({
    imageBytes: jpegBinary,
    mimeType: 'image/jpeg',
    profile: 'actualSlipManufacturingDigits'
  });
  const aux = await port.runOcrOnImage({
    imageBytes: jpegShared,
    mimeType: 'image/jpeg',
    profile: 'actualSlipAuxiliaryAlnum'
  });

  const merged = [labels.text, digits.text, aux.text].filter((s) => s.length > 0).join('\n');
  const ocrPreviewSafe = buildActualSlipOcrPreviewSafe(digits.text, aux.text);
  const parsed = parseActualSlipIdentifiersFromOcrText(merged);
  const durationMs = Date.now() - startedMs;

  log.info(
    {
      event: 'parse-actual-slip-image',
      requestId: params.requestId,
      mimeType: params.mimeType,
      inputBytes,
      preprocessBytes,
      preprocessBytesBinary,
      engine: labels.engine,
      ocrTextChars: merged.length,
      hasManufacturingOrder10: parsed.manufacturingOrder10 != null,
      hasFseiban: parsed.fseiban != null,
      durationMs
    },
    'parse-actual-slip-image ocr completed'
  );

  return {
    engine: labels.engine,
    ocrText: merged,
    ocrPreviewSafe,
    manufacturingOrder10: parsed.manufacturingOrder10,
    fseiban: parsed.fseiban
  };
}

/** 共通前処理: リサイズ・グレースケール・正規化・余白付与（OCR エンジン外） */
async function preprocessForOcrShared(buffer: Buffer): Promise<Buffer> {
  let pipeline = sharp(buffer);
  const meta = await pipeline.metadata();
  if (meta.width && meta.width > 2200) {
    pipeline = sharp(buffer).resize({ width: 2200 });
  }
  return pipeline
    .greyscale()
    .normalize()
    .extend({
      top: 32,
      bottom: 32,
      left: 32,
      right: 32,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * 数字パス用: 二値化してコントラストを強め、桁の切れ目を読みやすくする。
 */
async function preprocessForOcrDigitBinary(buffer: Buffer): Promise<Buffer> {
  let pipeline = sharp(buffer);
  const meta = await pipeline.metadata();
  if (meta.width && meta.width > 2200) {
    pipeline = sharp(buffer).resize({ width: 2200 });
  }
  return pipeline
    .greyscale()
    .normalize()
    .threshold(160)
    .extend({
      top: 32,
      bottom: 32,
      left: 32,
      right: 32,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    })
    .jpeg({ quality: 92 })
    .toBuffer();
}
