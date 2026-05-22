import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../lib/prisma.js', () => ({
  prisma: {
    employee: { findMany: vi.fn() },
    riggingInspectionRecord: { groupBy: vi.fn() },
    loan: { findMany: vi.fn() },
  },
}));

vi.mock('../../measuring-instrument-loan-inspection/load-cancelled-loan-id-set.js', () => ({
  loadCancelledLoanIdSet: vi.fn().mockResolvedValue(new Set()),
}));

import { prisma } from '../../../../../lib/prisma.js';
import { RiggingLoanInspectionDataSource } from '../rigging-loan-inspection-data-source.js';
import { RIGGING_ACTIVE_COUNT_COLUMN } from '../rigging-loan-inspection.constants.js';

describe('RiggingLoanInspectionDataSource', () => {
  let dataSource: RiggingLoanInspectionDataSource;

  beforeEach(() => {
    vi.clearAllMocks();
    dataSource = new RiggingLoanInspectionDataSource();
  });

  it('returns error metadata when sectionEquals is missing', async () => {
    const result = await dataSource.fetchData({});
    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.metadata).toMatchObject({ error: 'sectionEquals is required' });
      expect(result.rows).toEqual([]);
    }
  });

  it('aggregates inspection counts and active rigging loans per employee', async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: 'emp-1', displayName: '山田太郎' },
    ] as never);
    vi.mocked(prisma.riggingInspectionRecord.groupBy).mockResolvedValue([
      { employeeId: 'emp-1', _count: { _all: 2 } },
    ] as never);
    vi.mocked(prisma.loan.findMany).mockResolvedValue([
      {
        id: 'loan-1',
        employeeId: 'emp-1',
        borrowedAt: new Date('2026-04-30T01:00:00.000Z'),
        returnedAt: null,
        riggingGear: { name: 'チェーンスリング', managementNumber: 'RG-001' },
      },
      {
        id: 'loan-2',
        employeeId: 'emp-1',
        borrowedAt: new Date('2026-04-30T02:00:00.000Z'),
        returnedAt: new Date('2026-04-30T03:00:00.000Z'),
        riggingGear: { name: 'ワイヤロープ', managementNumber: 'RG-002' },
      },
    ] as never);

    const result = await dataSource.fetchData({ sectionEquals: '加工担当部署', period: 'today_jst' });
    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.['点検件数']).toBe(2);
      expect(result.rows[0]?.[RIGGING_ACTIVE_COUNT_COLUMN]).toBe(1);
      expect(result.rows[0]?.['返却件数']).toBe(1);
    }
  });
});
