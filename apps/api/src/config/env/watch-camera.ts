import { z } from 'zod';

export const watchCameraEnvShape = {
  WATCH_CAMERA_JUDGE_ENHANCE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  WATCH_CAMERA_PERSON_PROMPT: z.string().max(1000).default('この写真に人が写っていますか。人の体の一部でも写っていれば true。'),
  WATCH_CAMERA_PERSON_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.5),
  WATCH_CAMERA_JUDGE_INTERVAL_SEC: z.coerce.number().int().min(1).max(86400).default(30),
  WATCH_CAMERA_UNJUDGED_INTERVAL_SEC: z.coerce.number().int().min(1).max(86400).default(60),
  WATCH_CAMERA_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  WATCH_CAMERA_SAMPLE_MAX_BYTES: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(2 * 1024 ** 3),
  WATCH_CAMERA_MAX_BYTES: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(2 * 1024 ** 3),
};
