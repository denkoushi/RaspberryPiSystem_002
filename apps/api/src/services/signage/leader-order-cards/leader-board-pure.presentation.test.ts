import { describe, expect, it } from 'vitest';

import { presentLeaderOrderRowSignage, type SignageLeaderBoardRow } from './leader-board-pure.js';

const baseRow = (): SignageLeaderBoardRow => ({
  id: '1',
  seibanJoinKey: 'BA1S1319',
  resourceCd: '060',
  dueDate: null,
  plannedEndDate: null,
  displayDue: '2026-01-06T00:00:00.000Z',
  fseiban: 'BA1S1319',
  productNo: 'MD004433830',
  fkojun: '010',
  fhincd: 'MH-2044',
  fhinmei: 'ストッパー台 (1)',
  customerName: '顧客A',
  machineName: 'L300KP',
  machineTypeCode: 'XY',
  plannedQuantity: 8,
  processingOrder: 1,
  isCompleted: false,
});

describe('presentLeaderOrderRowSignage', () => {
  it('matches kiosk cluster + machine line split (not combined machinePartLine)', () => {
    const pres = presentLeaderOrderRowSignage(baseRow());
    expect(pres.clusterSegments).toEqual(['BA1S1319', 'MH-2044']);
    expect(pres.quantityInlineJa).toBe('8個');
    expect(pres.machineTypeNameLine).toContain('XY');
    expect(pres.machineTypeNameLine).toContain('L300KP');
    expect(pres.partNameLine).toBe('ストッパー台 (1)');
    expect(pres.customerLine).toBe('');
  });

  it('truncates machine name to 10 characters for signage', () => {
    const pres = presentLeaderOrderRowSignage({
      ...baseRow(),
      machineName: 'ABCDEFGHIJKLMNOP',
      machineTypeCode: '',
    });
    expect(pres.machineTypeNameLine).toBe('ABCDEFGHI…');
  });
});
