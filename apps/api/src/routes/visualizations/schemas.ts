import { z } from 'zod';

const uninspectedConfigSchema = z.object({
  csvDashboardId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  maxRows: z.number().int().positive().optional(),
});

export const visualizationDashboardParamsSchema = z.object({
  id: z.string().uuid(),
});

export const visualizationDashboardCreateSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional().nullable(),
    dataSourceType: z.string().min(1),
    rendererType: z.string().min(1),
    dataSourceConfig: z.record(z.unknown()),
    rendererConfig: z.record(z.unknown()),
    enabled: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.dataSourceType !== 'uninspected_machines') {
      return;
    }
    const parsed = uninspectedConfigSchema.safeParse(input.dataSourceConfig);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dataSourceConfig', ...issue.path],
          message: issue.message,
        });
      }
    }
  });

export const visualizationDashboardUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    dataSourceType: z.string().min(1).optional(),
    rendererType: z.string().min(1).optional(),
    dataSourceConfig: z.record(z.unknown()).optional(),
    rendererConfig: z.record(z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    const isUninspected = input.dataSourceType === 'uninspected_machines';
    if (!isUninspected || input.dataSourceConfig === undefined) {
      return;
    }
    const parsed = uninspectedConfigSchema.safeParse(input.dataSourceConfig);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dataSourceConfig', ...issue.path],
          message: issue.message,
        });
      }
    }
  });
