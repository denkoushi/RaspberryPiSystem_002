import sharp from 'sharp';

import { logger } from '../../lib/logger.js';
import { getImageOcrPort } from '../ocr/image-ocr-runtime.js';
import type { ImageOcrMimeType } from '../ocr/ports/image-ocr.port.js';

import { buildActualSlipOcrPreviewSafe } from './actual-slip-ocr-preview.js';
import {
  extractFseiban,
  parseManufacturingOrder10Extraction
} from './actual-slip-identifier-parser.js';

const log = logger.child({ component: 'actualSlipImageOcr' });

export type ParseActualSlipImageResult = {
  engine: string;
  /** OCR 結合テキスト（ログ・パーサ用。必要時はラベル単独で早期終了する） */
  ocrText: string;
  /**
   * UI 向けプレビュー。
   * 通常は数字・英数字パスのみを使うが、ラベル単独で十分な場合は確定値だけを返す。
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
  const preprocessBytes = jpegShared.length;
  const port = getImageOcrPort();

  // 同一 worker 内の setParameters を並列に走らせない（adapter 内の worker 共有のため）
  const labels = await port.runOcrOnImage({
    imageBytes: jpegShared,
    mimeType: 'image/jpeg',
    profile: 'actualSlipLabels'
  });

  const labelsOnlyMo = parseManufacturingOrder10Extraction(labels.text);
  const labelsOnlyFseiban = extractFseiban(labels.text);
  if (labelsOnlyMo.value && labelsOnlyFseiban) {
    const durationMs = Date.now() - startedMs;
    const ocrPreviewSafe = buildActualSlipOcrPreviewSafe(labelsOnlyMo.value, labelsOnlyFseiban);
    log.info(
      {
        event: 'parse-actual-slip-image',
        requestId: params.requestId,
        mimeType: params.mimeType,
        inputBytes,
        preprocessBytes,
        engine: labels.engine,
        ocrTextChars: labels.text.length,
        hasManufacturingOrder10: true,
        hasFseiban: true,
        mo10Candidate10Count: labelsOnlyMo.diagnostics.candidate10Count,
        mo10AfterOrderBlockFilterCount: labelsOnlyMo.diagnostics.afterOrderBlockFilterCount,
        mo10ParseSource: labelsOnlyMo.diagnostics.source,
        durationMs
      },
      'parse-actual-slip-image ocr completed'
    );
    return {
      engine: labels.engine,
      ocrText: labels.text,
      ocrPreviewSafe,
      manufacturingOrder10: labelsOnlyMo.value,
      fseiban: labelsOnlyFseiban
    };
  }

  const jpegBinary = await preprocessForOcrDigitBinary(params.imageBytes);
  const preprocessBytesBinary = jpegBinary.length;

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
  const mo = parseManufacturingOrder10Extraction(merged);
  const fseiban = extractFseiban(merged);
  // 確定した製造order・FSEIBAN の両方があるときは、数字/英数字パスの生テキストではなく確定値でプレビューする（Tesseract の誤認識が UI に乗らない）
  const ocrPreviewSafe =
    mo.value != null && fseiban != null
      ? buildActualSlipOcrPreviewSafe(mo.value, fseiban)
      : buildActualSlipOcrPreviewSafe(digits.text, aux.text);
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
      hasManufacturingOrder10: mo.value != null,
      hasFseiban: fseiban != null,
      mo10Candidate10Count: mo.diagnostics.candidate10Count,
      mo10AfterOrderBlockFilterCount: mo.diagnostics.afterOrderBlockFilterCount,
      mo10ParseSource: mo.diagnostics.source,
      durationMs
    },
    'parse-actual-slip-image ocr completed'
  );

  return {
    engine: labels.engine,
    ocrText: merged,
    ocrPreviewSafe,
    manufacturingOrder10: mo.value,
    fseiban
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
