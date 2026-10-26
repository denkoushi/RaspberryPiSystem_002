import { z } from 'zod/v3';

export const inspectionDrawingEnvShape = {
  INSPECTION_DRAWING_SIBLING_VISION_ENABLED: z
    .preprocess((v) => typeof v === 'string' ? v.trim().toLowerCase() : v, z.enum(['true', 'false']).default('true'))
    .transform((v) => v === 'true'),
  INSPECTION_DRAWING_TRANSFER_JEV_ENABLED: z
    .preprocess((v) => typeof v === 'string' ? v.trim().toLowerCase() : v, z.enum(['true', 'false']).default('false'))
    .transform((v) => v === 'true'),
  INSPECTION_DRAWING_REFERENCE_PLACEMENT_ENABLED: z
    .preprocess((v) => typeof v === 'string' ? v.trim().toLowerCase() : v, z.enum(['true', 'false']).default('false'))
    .transform((v) => v === 'true'),
  INSPECTION_DRAWING_TRANSFER_JEV_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
};
