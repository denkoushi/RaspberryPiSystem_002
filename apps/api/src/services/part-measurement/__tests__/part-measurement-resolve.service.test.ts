import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getResourceCategoryPolicy } from '../../production-schedule/policies/resource-category-policy.service.js';
import { listScheduleRowsByProductNo, resolveMachineNameForSeiban } from '../../production-schedule/production-schedule-lookup.service.js';
import type { ProductionScheduleLookupRow } from '../../production-schedule/production-schedule-lookup.service.js';
import { PartMeasurementTemplateService } from '../part-measurement-template.service.js';
import { PartMeasurementResolveService } from '../part-measurement-resolve.service.js';

vi.mock('../../production-schedule/policies/resource-category-policy.service.js', () => ({ getResourceCategoryPolicy: vi.fn() }));
vi.mock('../../production-schedule/production-schedule-lookup.service.js', () => ({
  listScheduleRowsByProductNo: vi.fn(), resolveMachineNameForSeiban: vi.fn(),
}));
vi.mock('../part-measurement-template.service.js', () => ({
  PartMeasurementTemplateService: class { async findActiveByFhincdGroupAndResource() { return null; } },
}));

const first: ProductionScheduleLookupRow = {
  rowId: 'row-first', fseiban: 'SEIBAN-1', productNo: '100', fhincd: 'PART-A',
  fhinmei: 'Part A', fsigencd: 'MC01', fkojun: 10,
};
const second = { ...first, rowId: 'row-second', fhincd: 'PART-B', fkojun: 20 };

describe('part measurement schedule resolution compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getResourceCategoryPolicy).mockResolvedValue({ grindingResourceCds: [], cuttingExcludedResourceCds: [] });
    vi.mocked(resolveMachineNameForSeiban).mockResolvedValue('Model A');
  });

  it('keeps candidate order, ambiguity and one machine-name lookup per seiban', async () => {
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([first, second]);
    const result = await new PartMeasurementResolveService().resolveTicket({ productNo: '100', processGroup: 'cutting' });
    expect(result).toEqual({
      processGroup: 'cutting', candidates: [{ ...first, machineName: 'Model A' }, { ...second, machineName: 'Model A' }],
      ambiguous: true, selected: null, fhincdMismatch: false, template: null,
    });
    expect(listScheduleRowsByProductNo).toHaveBeenCalledExactlyOnceWith('100');
    expect(resolveMachineNameForSeiban).toHaveBeenCalledExactlyOnceWith('SEIBAN-1');
  });

  it('keeps all matching candidates when the scanned part does not match', async () => {
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([first, second]);
    const result = await new PartMeasurementResolveService().resolveTicket({ productNo: '100', processGroup: 'cutting', scannedFhincd: 'OTHER' });
    expect(result.fhincdMismatch).toBe(true);
    expect(result.ambiguous).toBe(true);
    expect(result.selected).toBeNull();
    expect(result.candidates.map((row) => row.rowId)).toEqual(['row-first', 'row-second']);
    expect(result.template).toBeNull();
  });

  it('keeps the selected row, scope and template lookup arguments', async () => {
    const template = { id: 'template-1' };
    const templateLookup = vi.spyOn(PartMeasurementTemplateService.prototype, 'findActiveByFhincdGroupAndResource');
    templateLookup.mockResolvedValue(template as never);
    vi.mocked(listScheduleRowsByProductNo).mockResolvedValue([first, second]);
    const result = await new PartMeasurementResolveService().resolveTicket({
      productNo: '100', processGroup: 'cutting', scannedFhincd: ' part-a ', resourceCd: ' MC01 ', deviceScopeKey: 'factory - terminal',
    });
    expect(result.selected).toEqual({ ...first, machineName: 'Model A' });
    expect(result.ambiguous).toBe(false);
    expect(result.fhincdMismatch).toBe(false);
    expect(result.template).toEqual(template);
    expect(templateLookup).toHaveBeenCalledExactlyOnceWith('PART-A', 'CUTTING', 'MC01');
    expect(getResourceCategoryPolicy).toHaveBeenCalledWith({ deviceScopeKey: 'factory - terminal' });
  });
});
