import sharp from 'sharp';

import { logger } from '../../lib/logger.js';
import { getImageOcrPort } from '../ocr/image-ocr-runtime.js';
import type { ImageOcrMimeType } from '../ocr/ports/image-ocr.port.js';

import { buildActualSlipOcrPreviewSafe } from './actual-slip-ocr-preview.js';
import { DEFAULT_GENPYO_SLIP_ROIS } from './genpyo-slip/genpyo-slip-template.js';
import { cropNormalizedRegion } from './genpyo-slip/genpyo-slip-roi-crop.js';
import { resolveGenpyoSlipFromRegionTexts } from './genpyo-slip/genpyo-slip-resolver.js';

const log = logger.child({ component: 'actualSlipImageOcr' });

export type ParseActualSlipImageResult = {
  engine: string;
  /** ROI ごとの OCR 結合テキスト（ログ・デバッグ用） */
  ocrText: string;
  /**
   * UI 向けプレビュー。
   * 確定した製造order・製番を優先して短く表示する。
   */
  ocrPreviewSafe: string | null;
  manufacturingOrder10: string | null;
  fseiban: string | null;
};

/**
 * 現品票画像を OCR し、製造order / FSEIBAN 候補を抽出する。
 * 固定レイアウト前提で ROI 単位に切り出してから OCR し、Schema 集約で確定する。
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
  const sharedMeta = await sharp(jpegShared).metadata();
  const sharedWidth = sharedMeta.width ?? 0;
  const sharedHeight = sharedMeta.height ?? 0;
  if (sharedWidth <= 0 || sharedHeight <= 0) {
    throw new Error('Invalid preprocessed image dimensions');
  }

  const regionTexts: { moHeader: string; fseibanMain: string; moFooter: string } = {
    moHeader: '',
    fseibanMain: '',
    moFooter: ''
  };
  let engine = 'unknown';

  for (const roi of DEFAULT_GENPYO_SLIP_ROIS) {
    const cropBuffer = await cropNormalizedRegion(jpegShared, roi.rect, {
      width: sharedWidth,
      height: sharedHeight
    });
    const ocr = await port.runOcrOnImage({
      imageBytes: cropBuffer,
      mimeType: 'image/jpeg',
      profile: roi.profile
    });
    regionTexts[roi.id] = ocr.text;
    engine = ocr.engine;
  }

  const resolved = resolveGenpyoSlipFromRegionTexts({
    moHeader: regionTexts.moHeader,
    fseibanMain: regionTexts.fseibanMain,
    moFooter: regionTexts.moFooter
  });

  const ocrText = DEFAULT_GENPYO_SLIP_ROIS.map((roi) => `[${roi.id}]\n${regionTexts[roi.id] ?? ''}`).join(
    '\n\n'
  );

  const ocrPreviewSafe = buildActualSlipOcrPreviewSafe(
    resolved.manufacturingOrder10 ?? '',
    resolved.fseiban ?? ''
  );

  const durationMs = Date.now() - startedMs;

  log.info(
    {
      event: 'parse-actual-slip-image',
      requestId: params.requestId,
      mimeType: params.mimeType,
      inputBytes,
      preprocessBytes,
      engine,
      ocrTextChars: ocrText.length,
      hasManufacturingOrder10: resolved.manufacturingOrder10 != null,
      hasFseiban: resolved.fseiban != null,
      mo10Candidate10Count: resolved.moDiagnostics.candidate10Count,
      mo10AfterOrderBlockFilterCount: resolved.moDiagnostics.afterOrderBlockFilterCount,
      mo10ParseSource: resolved.moDiagnostics.source,
      mo10ResolvedFromRoi: resolved.moResolvedFromRoi,
      durationMs
    },
    'parse-actual-slip-image ocr completed'
  );

  return {
    engine,
    ocrText,
    ocrPreviewSafe,
    manufacturingOrder10: resolved.manufacturingOrder10,
    fseiban: resolved.fseiban
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
