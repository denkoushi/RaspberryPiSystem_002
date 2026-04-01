import sharp from 'sharp';

import { cameraConfig } from '../config/camera.config.js';

export type PhotoLoanStorageBuffers = {
  originalJpeg: Buffer;
  thumbnailJpeg: Buffer;
};

/**
 * 写真持出・教師登録で共通: 解像度・JPEG 品質・サムネを揃えたバッファを生成する。
 */
export async function preparePhotoAndThumbnailForStorage(imageBuffer: Buffer): Promise<PhotoLoanStorageBuffers> {
  let originalImage = await sharp(imageBuffer)
    .resize(cameraConfig.resolution.width, cameraConfig.resolution.height, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: cameraConfig.quality })
    .toBuffer();

  let quality = cameraConfig.quality;
  for (let i = 0; i < 5 && originalImage.length > 100 * 1024; i++) {
    quality = Math.max(50, quality - 10);
    originalImage = await sharp(imageBuffer)
      .resize(cameraConfig.resolution.width, cameraConfig.resolution.height, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality })
      .toBuffer();
  }

  const thumbnailJpeg = await sharp(originalImage)
    .resize(cameraConfig.thumbnail.width, cameraConfig.thumbnail.height, {
      fit: 'cover',
    })
    .jpeg({ quality: cameraConfig.thumbnail.quality })
    .toBuffer();

  return { originalJpeg: originalImage, thumbnailJpeg };
}
