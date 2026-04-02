import { describe, expect, it } from 'vitest';

import { buildFseibanToMachineDisplayName } from '../seibanMachineNameIndex';

import type { ProductionScheduleRow } from '../../../../api/client';

describe('buildFseibanToMachineDisplayName', () => {
  it('maps fseiban from MH header row FHINMEI', () => {
    const rows: ProductionScheduleRow[] = [
      {
        id: 'm1',
        occurredAt: 't',
        rowData: { FSEIBAN: 'S-1', FHINCD: 'MH01', FHINMEI: 'MyMachine' }
      },
      {
        id: 'p1',
        occurredAt: 't',
        rowData: { FSEIBAN: 'S-1', FHINCD: 'X1', FSIGENCD: '305', ProductNo: '1' }
      }
    ];
    const map = buildFseibanToMachineDisplayName(rows);
    expect(map.get('S-1')).toBe('MyMachine');
  });

  it('ignores non-MH rows for index', () => {
    const rows: ProductionScheduleRow[] = [
      {
        id: 'p1',
        occurredAt: 't',
        rowData: { FSEIBAN: 'S-1', FHINCD: 'X1', FHINMEI: 'not machine', FSIGENCD: '305' }
      }
    ];
    expect(buildFseibanToMachineDisplayName(rows).size).toBe(0);
  });
});
