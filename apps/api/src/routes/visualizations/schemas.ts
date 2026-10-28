import { z } from 'zod';

const uninspectedConfigSchema = z.object({
  csvDashboardId: z.string().guid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  maxRows: z.number().int().positive().optional(),
});

const hydraulicOilExchangeConfigSchema = z.object({
  targetEquipmentNumbers: z.array(z.string().trim().min(1).max(30)).max(200).optional().default([]),
  csvDashboardId: z.string().guid(),
  inspectionItem: z.string().trim().min(1).max(50).optional(),
  maxRows: z.number().int().positive().optional(),
});

export const visualizationDashboardParamsSchema = z.object({
  id: z.string().guid(),
});

export const visualizationDashboardCreateSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional().nullable(),
    dataSourceType: z.string().min(1),
    rendererType: z.string().min(1),
    dataSourceConfig: z.record(z.string(), z.unknown()),
    rendererConfig: z.record(z.string(), z.unknown()),
    enabled: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.dataSourceType !== 'uninspected_machines' && input.dataSourceType !== 'hydraulic_oil_exchange') {
      return;
    }
    const schema = input.dataSourceType === 'hydraulic_oil_exchange' ? hydraulicOilExchangeConfigSchema : uninspectedConfigSchema;
    const parsed = schema.safeParse(input.dataSourceConfig);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dataSourceConfig', ...issue.path],
          message: issue.message,
        });
      }
    } else if (input.dataSourceType === 'hydraulic_oil_exchange') {
      input.dataSourceConfig = { ...input.dataSourceConfig, ...parsed.data };
    }
  });

export const visualizationDashboardUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    dataSourceType: z.string().min(1).optional(),
    rendererType: z.string().min(1).optional(),
    dataSourceConfig: z.record(z.string(), z.unknown()).optional(),
    rendererConfig: z.record(z.string(), z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
  .superRefine((input, ctx) => {
    const requiresConfig = input.dataSourceType === 'uninspected_machines' || input.dataSourceType === 'hydraulic_oil_exchange';
    if (!requiresConfig || input.dataSourceConfig === undefined) {
      return;
    }
    const schema = input.dataSourceType === 'hydraulic_oil_exchange' ? hydraulicOilExchangeConfigSchema : uninspectedConfigSchema;
    const parsed = schema.safeParse(input.dataSourceConfig);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dataSourceConfig', ...issue.path],
          message: issue.message,
        });
      }
    } else if (input.dataSourceType === 'hydraulic_oil_exchange') {
      input.dataSourceConfig = { ...input.dataSourceConfig, ...parsed.data };
    }
  });
