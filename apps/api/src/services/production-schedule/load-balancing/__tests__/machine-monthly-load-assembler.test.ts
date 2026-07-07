import { describe, expect, it } from 'vitest';

import {
  aggregateMachineSummaries,
  aggregateResourceMonthCells,
  assembleMachineMonthlyLoadResult,
  buildMachineSummariesFromFseibanAgg,
  filterRowsByFhincd,
  listFseibansForMachineName
} from '../machine-monthly-load-assembler.js';
import type { MachineMonthlyLoadEnrichedRow } from '../machine-monthly-load.types.js';

const row = (partial: Partial<MachineMonthlyLoadEnrichedRow> & Pick<MachineMonthlyLoadEnrichedRow, 'rowId' | 'machineName' | 'resourceCd' | 'requiredMinutes' | 'yearMonth'>): MachineMonthlyLoadEnrichedRow => ({
  fseiban: 'S1',
  productNo: 'P1',
  fhincd: 'PART-A',
  fhinmei: '部品A',
  fkojun: '10',
  effectiveDueDate: new Date('2026-06-15T00:00:00.000Z'),
  effectiveDueDateSource: 'csv',
  ...partial
});

describe('machine-monthly-load-assembler', () => {
  it('aggregates machines and resource months for selected machine', () => {
    const rows: MachineMonthlyLoadEnrichedRow[] = [
      row({
        rowId: 'r1',
        machineName: 'DFD6362',
        resourceCd: 'A01',
        requiredMinutes: 100,
        yearMonth: '2026-06',
        effectiveDueDateSource: 'manual'
      }),
      row({
        rowId: 'r2',
        machineName: 'DFD6362',
        resourceCd: 'B02',
        requiredMinutes: 50,
        yearMonth: '2026-07',
        fseiban: 'S2',
        fhincd: 'PART-B',
        fhinmei: '部品B'
      }),
      row({
        rowId: 'r3',
        machineName: 'DFL7161',
        resourceCd: 'A01',
        requiredMinutes: 30,
        yearMonth: '2026-06'
      })
    ];

    const machines = aggregateMachineSummaries(rows);
    expect(machines).toHaveLength(2);
    expect(machines[0]?.machineName).toBe('DFD6362');
    expect(machines[0]?.requiredMinutes).toBe(150);

    const scoped = filterRowsByFhincd(
      rows.filter((r) => r.machineName === 'DFD6362'),
      'PART-B'
    );
    const cells = aggregateResourceMonthCells(scoped);
    expect(cells).toEqual([{ resourceCd: 'B02', month: '2026-07', requiredMinutes: 50 }]);

    const result = assembleMachineMonthlyLoadResult({
      siteKey: '第2工場',
      fromMonth: '2026-06',
      toMonth: '2026-07',
      months: ['2026-06', '2026-07'],
      rows,
      selectedMachineName: 'DFD6362'
    });
    expect(result.parts).toHaveLength(2);
    expect(result.resourceMonths).toHaveLength(2);
    expect(result.partRows).toHaveLength(2);
  });

  it('returns empty detail when machine is not selected', () => {
    const result = assembleMachineMonthlyLoadResult({
      siteKey: '第2工場',
      fromMonth: '2026-06',
      toMonth: '2026-06',
      months: ['2026-06'],
      rows: [row({ rowId: 'r1', machineName: 'DFD6362', resourceCd: 'A01', requiredMinutes: 10, yearMonth: '2026-06' })],
      selectedMachineName: null
    });
    expect(result.parts).toEqual([]);
    expect(result.resourceMonths).toEqual([]);
    expect(result.machines).toHaveLength(1);
  });

  it('keeps the part list for the selected machine even when fhincd filter narrows details', () => {
    const rows: MachineMonthlyLoadEnrichedRow[] = [
      row({
        rowId: 'r1',
        machineName: 'DFD6362',
        resourceCd: 'A01',
        requiredMinutes: 100,
        yearMonth: '2026-06',
        fhincd: 'PART-A'
      }),
      row({
        rowId: 'r2',
        machineName: 'DFD6362',
        resourceCd: 'B02',
        requiredMinutes: 50,
        yearMonth: '2026-07',
        fhincd: 'PART-B',
        fhinmei: '部品B'
      })
    ];

    const result = assembleMachineMonthlyLoadResult({
      siteKey: '第2工場',
      fromMonth: '2026-06',
      toMonth: '2026-07',
      months: ['2026-06', '2026-07'],
      rows,
      selectedMachineName: 'DFD6362',
      selectedFhincd: 'PART-B'
    });

    expect(result.parts.map((part) => part.fhincd)).toEqual(['PART-A', 'PART-B']);
    expect(result.resourceMonths).toEqual([{ resourceCd: 'B02', month: '2026-07', requiredMinutes: 50 }]);
    expect(result.partRows).toHaveLength(1);
  });

  it('builds machine summaries from fseiban aggregates and machine names', () => {
    const machines = buildMachineSummariesFromFseibanAgg(
      [
        { fseiban: 'S1', requiredMinutes: 100 },
        { fseiban: 'S2', requiredMinutes: 50 },
        { fseiban: 'S3', requiredMinutes: 30 }
      ],
      {
        S1: 'DFD6362',
        S2: 'DFD6362',
        S3: 'DFL7161'
      },
      '機種名未登録'
    );

    expect(machines).toEqual([
      { machineName: 'DFD6362', fseibanCount: 2, requiredMinutes: 150 },
      { machineName: 'DFL7161', fseibanCount: 1, requiredMinutes: 30 }
    ]);
  });

  it('lists fseibans for a selected machine name', () => {
    const aggregates = [
      { fseiban: 'S1', requiredMinutes: 10 },
      { fseiban: 'S2', requiredMinutes: 20 },
      { fseiban: '', requiredMinutes: 5 }
    ];
    const machineNames = { S1: 'DFD6362', S2: 'DFL7161' };

    expect(
      listFseibansForMachineName({
        aggregates,
        machineNames,
        machineName: 'DFD6362',
        unregisteredLabel: '機種名未登録'
      })
    ).toEqual(['S1']);
    expect(
      listFseibansForMachineName({
        aggregates,
        machineNames,
        machineName: '機種名未登録',
        unregisteredLabel: '機種名未登録'
      })
    ).toEqual(['']);
  });

  it('uses precomputed machines when provided to assembler', () => {
    const machines = [{ machineName: 'DFD6362', fseibanCount: 1, requiredMinutes: 10 }];
    const result = assembleMachineMonthlyLoadResult({
      siteKey: '第2工場',
      fromMonth: '2026-06',
      toMonth: '2026-06',
      months: ['2026-06'],
      rows: [],
      machines,
      selectedMachineName: null
    });

    expect(result.machines).toEqual(machines);
  });
});
