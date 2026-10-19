import { describe, expect, it } from 'vitest';

import { partMeasurementTemplatesQueryKeys } from './partMeasurementTemplates';

describe('partMeasurementTemplatesQueryKeys', () => {
  it('preserves constant keys and invalidation prefix lengths', () => {
    expect(partMeasurementTemplatesQueryKeys.templatesAll).toEqual(['part-measurement-templates']);
    expect(partMeasurementTemplatesQueryKeys.visualTemplatesAll).toEqual(['part-measurement-visual-templates']);
  });

  it('preserves template filters and boundary values', () => {
    expect(partMeasurementTemplatesQueryKeys.templates({ includeInactive: true })).toEqual(['part-measurement-templates', { includeInactive: true }]);
    expect(partMeasurementTemplatesQueryKeys.templates({ includeInactive: false })).toEqual(['part-measurement-templates', { includeInactive: false }]);
    expect(partMeasurementTemplatesQueryKeys.templates()).toEqual(['part-measurement-templates', undefined]);
    expect(partMeasurementTemplatesQueryKeys.templates(undefined)).toEqual(['part-measurement-templates', undefined]);
    expect(partMeasurementTemplatesQueryKeys.templates({})).toEqual(['part-measurement-templates', {}]);
    expect(Reflect.apply(partMeasurementTemplatesQueryKeys.templates, undefined, [null])).toEqual(['part-measurement-templates', null]);
  });
});
