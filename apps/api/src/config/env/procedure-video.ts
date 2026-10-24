import { z } from 'zod/v3';

export const procedureVideoEnvShape = {
  PROCEDURE_VIDEO_AUTO_EDIT_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  PROCEDURE_VIDEO_AUTO_EDIT_JEV_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
};
