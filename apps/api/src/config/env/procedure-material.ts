import { z } from 'zod';

export const procedureMaterialEnvShape = {
  ASSEMBLY_PROCEDURE_TERM_LEARNING_ENABLED: z.enum(['true', 'false']).default('true'),
  TYPESAFE_API_KEY: z.string().optional(),
  PROCEDURE_MATERIAL_SPLIT_SUGGESTION_ENABLED: z
    .preprocess((v) => typeof v === 'string' ? v.trim().toLowerCase() : v, z.enum(['true', 'false']).default('false'))
    .transform((v) => v === 'true'),
  PROCEDURE_MATERIAL_SPLIT_SUGGESTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
  PROCEDURE_MATERIAL_IMAGE_DESCRIPTION_ENABLED: z
    .preprocess((v) => typeof v === 'string' ? v.trim().toLowerCase() : v, z.enum(['true', 'false']).default('true'))
    .transform((v) => v === 'true'),
  PROCEDURE_MATERIAL_IMAGE_DESCRIPTION_CRON: z.string().default('*/5 * * * *'),
  PROCEDURE_MATERIAL_IMAGE_DESCRIPTION_BATCH_SIZE: z.coerce.number().int().min(1).max(20).default(3),
};
