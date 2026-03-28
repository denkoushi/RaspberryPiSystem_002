import { env } from '../../../config/env.js';
import { PhotoStorage } from '../../../lib/photo-storage.js';

import type { PhotoToolVisionImageSourcePort } from './photo-tool-label-ports.js';

/**
 * 写真 URL から VLM 入力用 JPEG を読み込む。
 * `PHOTO_TOOL_LABEL_VISION_SOURCE=thumbnail` のときは従来どおりサムネのみ。
 */
export class PhotoStorageVisionImageSource implements PhotoToolVisionImageSourcePort {
  async readImageBytesForVision(photoUrl: string): Promise<Buffer> {
    if (env.PHOTO_TOOL_LABEL_VISION_SOURCE === 'thumbnail') {
      return PhotoStorage.readThumbnailBuffer(photoUrl);
    }
    return PhotoStorage.readVisionInferenceJpeg(photoUrl, {
      maxLongEdge: env.PHOTO_TOOL_LABEL_VISION_MAX_LONG_EDGE,
      jpegQuality: env.PHOTO_TOOL_LABEL_VISION_JPEG_QUALITY,
    });
  }
}
