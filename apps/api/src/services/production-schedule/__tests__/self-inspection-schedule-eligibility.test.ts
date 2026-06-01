import { describe, expect, it } from 'vitest';

import {
  filterSelfInspectionEligibleProductionScheduleRows,
  hasSelfInspectionCandidateListFilters,
  isSelfInspectionEligibleProductionScheduleRow,
  resolveProductionSchedulePlannedQuantity
} from '../self-inspection-schedule-eligibility.js';

describe('self-inspection-schedule-eligibility', () => {
  it('requires entry path and core row fields', () => {
    expect(
      isSelfInspectionEligibleProductionScheduleRow({
        rowData: {
          ProductNo: 'PN',
          FHINCD: 'H',
          FHINMEI: '名',
          FSIGENCD: '581',
          FSEIBAN: 'FS'
        },
        partMeasurementProcessGroup: 'cutting',
        selfInspectionEntryPath: '/kiosk/part-measurement/self-inspection/start?x=1'
      })
    ).toBe(true);
    expect(
      isSelfInspectionEligibleProductionScheduleRow({
        rowData: { ProductNo: 'PN', FHINCD: 'H', FHINMEI: '名', FSIGENCD: '581', FSEIBAN: 'FS' },
        partMeasurementProcessGroup: 'cutting',
        selfInspectionEntryPath: null
      })
    ).toBe(false);
  });

  it('filters rows', () => {
    const rows = filterSelfInspectionEligibleProductionScheduleRows([
      {
        rowData: { ProductNo: '1', FHINCD: 'H', FHINMEI: '名', FSIGENCD: '1', FSEIBAN: 'S' },
        partMeasurementProcessGroup: 'cutting',
        selfInspectionEntryPath: '/sessions/abc'
      },
      {
        rowData: { ProductNo: '2', FHINCD: 'H', FHINMEI: '名', FSIGENCD: '1', FSEIBAN: 'S' },
        partMeasurementProcessGroup: 'cutting',
        selfInspectionEntryPath: null
      }
    ]);
    expect(rows).toHaveLength(1);
  });

  it('resolves planned quantity only when supplement value is a positive integer', () => {
    expect(resolveProductionSchedulePlannedQuantity(5)).toBe(5);
    expect(resolveProductionSchedulePlannedQuantity(null)).toBeNull();
    expect(resolveProductionSchedulePlannedQuantity(0)).toBeNull();
    expect(resolveProductionSchedulePlannedQuantity(1.9)).toBe(1);
  });

  it('requires text or resource filters for candidate list scan', () => {
    expect(hasSelfInspectionCandidateListFilters({ queryText: '', resourceCds: [] })).toBe(false);
    expect(hasSelfInspectionCandidateListFilters({ queryText: 'P', resourceCds: [] })).toBe(false);
    expect(hasSelfInspectionCandidateListFilters({ queryText: 'PN', resourceCds: [] })).toBe(true);
    expect(hasSelfInspectionCandidateListFilters({ queryText: 'P', resourceCds: ['581'] })).toBe(true);
    expect(hasSelfInspectionCandidateListFilters({ queryText: '', resourceCds: ['581'] })).toBe(true);
  });
});
