import { z } from 'zod';

export const visualizationDashboardParamsSchema = z.object({
  id: z.string().uuid(),
});

export const visualizationDashboardCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  dataSourceType: z.string().min(1),
  rendererType: z.string().min(1),
  dataSourceConfig: z.record(z.unknown()),
  rendererConfig: z.record(z.unknown()),
  enabled: z.boolean().optional(),
});

export const visualizationDashboardUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  dataSourceType: z.string().min(1).optional(),
  rendererType: z.string().min(1).optional(),
  dataSourceConfig: z.record(z.unknown()).optional(),
  rendererConfig: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});
