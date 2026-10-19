import type { listPartMeasurementTemplates } from '../client';

export const partMeasurementTemplatesQueryKeys = {
  templatesAll: ['part-measurement-templates'] as const,
  templates: (params?: Parameters<typeof listPartMeasurementTemplates>[0]) =>
    ['part-measurement-templates', params] as const,
  visualTemplatesAll: ['part-measurement-visual-templates'] as const,
};
