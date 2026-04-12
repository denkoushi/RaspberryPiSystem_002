/**
 * 正規化矩形で画像を切り出す（Sharp）。OCR 入力用。
 */

import sharp from 'sharp';

import type { GenpyoNormalizedRect } from './genpyo-slip-template.js';

export type ImagePixelSize = { width: number; height: number };

function clampExtractRect(size: ImagePixelSize, rect: GenpyoNormalizedRect) {
  const left = Math.min(size.width - 1, Math.max(0, Math.floor(rect.x * size.width)));
  const top = Math.min(size.height - 1, Math.max(0, Math.floor(rect.y * size.height)));
  const width = Math.min(size.width - left, Math.max(1, Math.floor(rect.w * size.width)));
  const height = Math.min(size.height - top, Math.max(1, Math.floor(rect.h * size.height)));
  return { left, top, width, height };
}

export async function cropNormalizedRegion(
  imageBuffer: Buffer,
  rect: GenpyoNormalizedRect,
  size?: ImagePixelSize
): Promise<Buffer> {
  let resolvedSize = size;
  if (!resolvedSize) {
    const meta = await sharp(imageBuffer).metadata();
    const iw = meta.width ?? 0;
    const ih = meta.height ?? 0;
    if (iw <= 0 || ih <= 0) {
      throw new Error('Invalid image dimensions for ROI crop');
    }
    resolvedSize = { width: iw, height: ih };
  }

  const { left, top, width, height } = clampExtractRect(resolvedSize, rect);

  return sharp(imageBuffer).extract({ left, top, width, height }).jpeg({ quality: 92 }).toBuffer();
}
