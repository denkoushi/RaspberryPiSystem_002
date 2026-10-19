import { describe, expect, it } from 'vitest';

import { countAssemblyHomeBoard, presentAssemblyHomeBoard, shortAssemblyWorkIdLabel } from './assemblyHomeBoardPresentation';

import type { AssemblyLotSerialDto, AssemblyLotSummaryDto, AssemblyWorkSessionSummaryDto } from './types';

function serial(patch: Partial<AssemblyLotSerialDto>): AssemblyLotSerialDto {
  return {
    id: 'serial-1',
    workUnitId: 'unit-1',
    lotId: 'lot-1',
    sortOrder: 0,
    serialNo: 'P-1-001',
    status: 'not_started',
    workSessionId: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    updatedAt: '2026-07-06T00:00:00.000Z',
    approval: null,
    ...patch
  };
}

function lot(serials: AssemblyLotSerialDto[]): AssemblyLotSummaryDto {
  return {
    id: 'lot-1',
    templateId: 'template-1',
    productNo: 'P-1',
    expectedQuantity: serials.length,
    registeredSerialCount: serials.length,
    notStartedCount: 0,
    inProgressCount: 0,
    completedCount: 0,
    cancelledCount: 0,
    approvedCount: 0,
    isWorkComplete: false,
    isFullyApproved: false,
    operatorEmployeeId: null,
    operatorNameSnapshot: null,
    targetUnit: 'MH-AX',
    torqueWrenchId: 'WRENCH',
    clientDeviceId: null,
    clientDeviceNameSnapshot: null,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    template: { id: 'template-1', modelCode: 'MH-AX', procedurePattern: '標準', name: 'MH-AX 標準', version: 1 },
    serials
  };
}

function session(patch: Partial<AssemblyWorkSessionSummaryDto>): AssemblyWorkSessionSummaryDto {
  return {
    id: 'session-1',
    workUnitId: 'unit-2',
    lotSerialId: 'serial-2',
    templateId: 'template-1',
    status: 'in_progress',
    productNo: 'P-1',
    serialNo: 'P-1-002',
    nameplateNo: 'P-1-002',
    operatorNameSnapshot: '佐藤',
    targetUnit: 'MH-AX',
    torqueWrenchId: 'WRENCH',
    startedAt: '2026-07-06T00:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    updatedAt: '2026-07-06T00:01:00.000Z',
    templateModelCode: 'MH-AX',
    templateProcedurePattern: '標準',
    templateName: 'MH-AX 標準',
    templateVersion: 1,
    currentAreaId: 'area-1',
    currentAreaName: 'ベース',
    currentBoltId: 'bolt-1',
    currentBoltMarkerNo: 1,
    acceptedBoltCount: 3,
    totalBoltCount: 12,
    approval: null,
    ...patch
  };
}

describe('presentAssemblyHomeBoard', () => {
  it('puts every unit of a lot on one row with its state and omits cancelled units', () => {
    const rows = presentAssemblyHomeBoard(
      [
        lot([
          serial({ id: 'serial-3', sortOrder: 2, serialNo: 'P-1-003', status: 'completed', workSessionId: 'session-3' }),
          serial({}),
          serial({ id: 'serial-2', sortOrder: 1, serialNo: 'P-1-002', status: 'in_progress', workSessionId: 'session-1' }),
          serial({ id: 'serial-4', sortOrder: 3, serialNo: 'P-1-004', status: 'cancelled' })
        ])
      ],
      [session({})],
      [session({ id: 'session-3', status: 'completed', serialNo: 'P-1-003', lotSerialId: 'serial-3' })]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ productNo: 'P-1', machineName: 'MH-AX', totalCount: 3, finishedCount: 1 });
    expect(rows[0]!.units.map((unit) => [unit.label, unit.state])).toEqual([
      ['001', 'before'],
      ['002', 'wip'],
      ['003', 'pending']
    ]);
    expect(rows[0]!.units[1]).toMatchObject({ operatorName: '佐藤', progressText: '3/12', progressPercent: 25, lotId: 'lot-1' });
    expect(countAssemblyHomeBoard(rows)).toEqual({ before: 1, wip: 1, pending: 1, done: 0 });
  });

  it('groups sessions that belong to no listed lot by product number', () => {
    const rows = presentAssemblyHomeBoard(
      [],
      [session({ lotSerialId: null })],
      [session({ id: 'session-9', status: 'cancelled' })]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'session:P-1', totalCount: 1 });
    expect(rows[0]!.units[0]).toMatchObject({ key: 'session-1', state: 'wip', lotId: null });
  });
});

describe('shortAssemblyWorkIdLabel', () => {
  it('drops the product number prefix only when a suffix remains', () => {
    expect(shortAssemblyWorkIdLabel('P-1', 'P-1-002')).toBe('002');
    expect(shortAssemblyWorkIdLabel('P-1', 'S002')).toBe('S002');
  });
});
