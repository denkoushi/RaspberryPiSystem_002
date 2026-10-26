import { z } from 'zod';

export const unifiedQuerySchema = z.object({
  search: z.string().optional(),
  category: z.enum(['TOOLS', 'MEASURING_INSTRUMENTS', 'RIGGING_GEARS', 'ALL']).optional().default('ALL'),
  itemStatus: z.enum(['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED']).optional(),
  instrumentStatus: z.enum(['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED']).optional(),
  riggingStatus: z.enum(['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED']).optional()
});
