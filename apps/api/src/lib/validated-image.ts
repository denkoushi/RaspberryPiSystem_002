import sharp from 'sharp';
import { ApiError } from './errors.js';

export const IMAGE_INPUT_MAX_PIXELS = 100_000_000;
const MIME_FORMATS: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpeg', 'image/jpg': 'jpeg', 'image/webp': 'webp',
  'image/tiff': 'tiff', 'image/tif': 'tiff', 'image/x-tiff': 'tiff',
};

/** Validate decoded image headers before persisting or generating derivatives. */
export async function validateImageBuffer(buffer: Buffer, mimetype: string): Promise<void> {
  try {
    const expectedFormat = MIME_FORMATS[mimetype.toLowerCase()];
    const metadata = await sharp(buffer, { limitInputPixels: IMAGE_INPUT_MAX_PIXELS }).metadata();
    const pixels = (metadata.width ?? 0) * (metadata.height ?? 0) * (metadata.pages ?? 1);
    if (!expectedFormat || metadata.format !== expectedFormat || pixels <= 0 || pixels > IMAGE_INPUT_MAX_PIXELS) {
      throw new Error('Invalid image format or dimensions');
    }
  } catch {
    throw new ApiError(400, '画像の形式または画素数が不正です');
  }
}
