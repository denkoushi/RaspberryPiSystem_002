import { z } from 'zod';

const cameraConfigSchema = z.object({
  CAMERA_TYPE: z.enum(['raspberry-pi-camera', 'usb-camera', 'mock']).default('mock'),
  CAMERA_DEVICE: z.string().default('/dev/video0'), // USBカメラの場合のデバイスパス
  CAMERA_WIDTH: z.coerce.number().default(800),
  CAMERA_HEIGHT: z.coerce.number().default(600),
  CAMERA_QUALITY: z.coerce.number().min(0).max(100).default(80), // JPEG品質 (0-100)
  THUMBNAIL_WIDTH: z.coerce.number().default(150),
  THUMBNAIL_HEIGHT: z.coerce.number().default(150),
  THUMBNAIL_QUALITY: z.coerce.number().min(0).max(100).default(70), // JPEG品質 (0-100)
  // 0-255 スケール。暗所でも撮影を許容するためデフォルトを下げる（必要に応じて環境変数で調整）
  CAMERA_MIN_MEAN_LUMA: z.coerce.number().min(0).max(255).default(1),
});

const parsedConfig = cameraConfigSchema.parse(process.env);

export const cameraConfig = {
  type: parsedConfig.CAMERA_TYPE,
  device: parsedConfig.CAMERA_DEVICE,
  resolution: {
    width: parsedConfig.CAMERA_WIDTH,
    height: parsedConfig.CAMERA_HEIGHT,
  },
  quality: parsedConfig.CAMERA_QUALITY,
  thumbnail: {
    width: parsedConfig.THUMBNAIL_WIDTH,
    height: parsedConfig.THUMBNAIL_HEIGHT,
    quality: parsedConfig.THUMBNAIL_QUALITY,
  },
  brightness: {
    minMeanLuma: parsedConfig.CAMERA_MIN_MEAN_LUMA,
  },
} as const;

