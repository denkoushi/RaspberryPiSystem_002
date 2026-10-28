import { describe, expect, it } from 'vitest';
import { visualizationDashboardCreateSchema, visualizationDashboardUpdateSchema } from '../schemas.js';

const base = { name: '作動油交換', dataSourceType: 'hydraulic_oil_exchange', rendererType: 'hydraulic_oil_exchange', rendererConfig: {} };
const valid = { csvDashboardId: '11111111-1111-1111-1111-111111111111' };
describe('hydraulic oil exchange config schema', () => {
  it.each([valid, { ...valid, targetEquipmentNumbers: [] }, { ...valid, targetEquipmentNumbers: [' M1 ', 'x'.repeat(30)] },
    { ...valid, targetEquipmentNumbers: Array.from({ length: 200 }, (_, i) => `M${i}`) }, { ...valid, inspectionItem: '作動油の交換', maxRows: 200 }])('accepts config %j', (dataSourceConfig) => {
    expect(visualizationDashboardCreateSchema.safeParse({ ...base, dataSourceConfig }).success).toBe(true);
    expect(visualizationDashboardUpdateSchema.safeParse({ ...base, dataSourceConfig }).success).toBe(true);
  });
  it('trims targets, defaults to an empty array and preserves unknown config keys', () => {
    for (const schema of [visualizationDashboardCreateSchema, visualizationDashboardUpdateSchema]) {
      expect(schema.parse({ ...base, dataSourceConfig: valid }).dataSourceConfig?.targetEquipmentNumbers).toEqual([]);
      expect(schema.parse({ ...base, dataSourceConfig: { ...valid, targetEquipmentNumbers: [' M1 '], extra: { keep: true } } }).dataSourceConfig)
        .toEqual({ ...valid, targetEquipmentNumbers: ['M1'], extra: { keep: true } });
    }
  });
  it.each([{}, { csvDashboardId: 'invalid' }, { ...valid, inspectionItem: '' }, { ...valid, inspectionItem: '　 ' },
    { ...valid, targetEquipmentNumbers: [''] }, { ...valid, targetEquipmentNumbers: ['　 '] },
    { ...valid, targetEquipmentNumbers: ['x'.repeat(31)] }, { ...valid, targetEquipmentNumbers: [1] },
    { ...valid, targetEquipmentNumbers: 'M1' }, { ...valid, targetEquipmentNumbers: null },
    { ...valid, targetEquipmentNumbers: Array(201).fill('M1') },
    { ...valid, inspectionItem: 'x'.repeat(51) }, { ...valid, maxRows: 0 }, { ...valid, maxRows: 1.5 }, { ...valid, maxRows: -1 },
  ])('rejects config %j on create and update', (dataSourceConfig) => {
    for (const schema of [visualizationDashboardCreateSchema, visualizationDashboardUpdateSchema]) {
      const result = schema.safeParse({ ...base, dataSourceConfig });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path[0]).toBe('dataSourceConfig');
    }
  });
});
