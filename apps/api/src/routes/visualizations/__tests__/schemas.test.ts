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
      expect(schema.parse({ ...base, dataSourceConfig: valid }).dataSourceConfig?.defaultCycle).toBe('半年１回');
      expect(schema.parse({ ...base, dataSourceConfig: { ...valid, targetEquipmentNumbers: [' M1 '], extra: { keep: true } } }).dataSourceConfig)
        .toEqual({ ...valid, targetEquipmentNumbers: ['M1'], defaultCycle: '半年１回', extra: { keep: true } });
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
  it.each(['2024-02-29', '2000-02-29', '2026-10-28', '2099-12-31'])('accepts valid calendar date %s including future dates', (date) => {
    for (const schema of [visualizationDashboardCreateSchema, visualizationDashboardUpdateSchema]) {
      expect(schema.parse({ ...base, dataSourceConfig: { ...valid, manualLastExchangeDates: { M1: date } } })
        .dataSourceConfig?.manualLastExchangeDates).toEqual({ M1: date });
    }
  });
  it.each(['2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-1-01', '2026-01-01T00:00:00Z', '', null, 20261028])('rejects invalid calendar date %j', (date) => {
    for (const schema of [visualizationDashboardCreateSchema, visualizationDashboardUpdateSchema]) {
      expect(schema.safeParse({ ...base, dataSourceConfig: { ...valid, manualLastExchangeDates: { M1: date } } }).success).toBe(false);
    }
  });
  it.each([200, 201])('limits manual date entries to 200 (%i)', (count) => {
    const dates = Object.fromEntries(Array.from({ length: count }, (_, i) => [`M${i}`, '2026-01-01']));
    for (const schema of [visualizationDashboardCreateSchema, visualizationDashboardUpdateSchema]) {
      expect(schema.safeParse({ ...base, dataSourceConfig: { ...valid, manualLastExchangeDates: dates } }).success).toBe(count <= 200);
    }
  });
  it.each(['３ヶ月１回', '半年１回', '年１回', '6M'])('accepts parsed default cycle %s', (defaultCycle) => {
    for (const schema of [visualizationDashboardCreateSchema, visualizationDashboardUpdateSchema]) {
      expect(schema.parse({ ...base, dataSourceConfig: { ...valid, defaultCycle } }).dataSourceConfig?.defaultCycle).toBe(defaultCycle);
    }
  });
  it.each(['', 'unknown', '0M', '1.5M', null, 6])('rejects invalid default cycle %j', (defaultCycle) => {
    for (const schema of [visualizationDashboardCreateSchema, visualizationDashboardUpdateSchema]) {
      expect(schema.safeParse({ ...base, dataSourceConfig: { ...valid, defaultCycle } }).success).toBe(false);
    }
  });
});
