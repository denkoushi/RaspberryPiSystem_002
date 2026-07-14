import { describe, expect, it } from 'vitest';

import { presentNotStartedAssemblyItems } from './assemblyHomeItemPresentation';

import type { AssemblyLotSummaryDto } from './types';

const lot: AssemblyLotSummaryDto = {
  id: 'lot-1',
  templateId: 'template-1',
  productNo: 'B260401',
  expectedQuantity: 3,
  registeredSerialCount: 3,
  notStartedCount: 2,
  inProgressCount: 0,
  completedCount: 0,
  cancelledCount: 1,
  approvedCount: 0,
  isWorkComplete: false,
  isFullyApproved: false,
  operatorEmployeeId: null,
  operatorNameSnapshot: '田中',
  targetUnit: '長い機種名',
  torqueWrenchId: 'CEM20N3X10D-BTLA',
  clientDeviceId: null,
  clientDeviceNameSnapshot: null,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:01:00.000Z',
  template: {
    id: 'template-1',
    modelCode: 'MODEL-1',
    procedurePattern: '標準',
    name: 'MODEL-1 標準',
    version: 1
  },
  serials: [
    {
      id: 'serial-1',
      lotId: 'lot-1',
      sortOrder: 0,
      serialNo: 'S-010',
      status: 'not_started',
      workSessionId: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      updatedAt: '2026-07-06T00:01:00.000Z',
      approval: null
    },
    {
      id: 'serial-2',
      lotId: 'lot-1',
      sortOrder: 1,
      serialNo: 'S-011',
      status: 'not_started',
      workSessionId: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      updatedAt: '2026-07-06T00:01:00.000Z',
      approval: null
    },
    {
      id: 'serial-3',
      lotId: 'lot-1',
      sortOrder: 2,
      serialNo: 'S-012',
      status: 'cancelled',
      workSessionId: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: '2026-07-06T00:01:00.000Z',
      updatedAt: '2026-07-06T00:01:00.000Z',
      approval: null
    }
  ]
};

describe('presentNotStartedAssemblyItems', () => {
  it('creates one item per not-started serial and omits cancelled serials', () => {
    const items = presentNotStartedAssemblyItems([lot]);

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.serialNo)).toEqual(['S-010', 'S-011']);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lotId: 'lot-1', lotSerialId: 'serial-1', progressText: '0%', machineName: '長い機種名' })
      ])
    );
  });
});
