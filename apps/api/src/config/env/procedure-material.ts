import { z } from 'zod';

export const procedureMaterialEnvShape = {
  PROCEDURE_MATERIAL_IMAGE_DESCRIPTION_ENABLED: z
    .preprocess((v) => typeof v === 'string' ? v.trim().toLowerCase() : v, z.enum(['true', 'false']).default('true'))
    .transform((v) => v === 'true'),
  PROCEDURE_MATERIAL_IMAGE_DESCRIPTION_CRON: z.string().default('*/5 * * * *'),
  PROCEDURE_MATERIAL_IMAGE_DESCRIPTION_BATCH_SIZE: z.coerce.number().int().min(1).max(20).default(3),
};
