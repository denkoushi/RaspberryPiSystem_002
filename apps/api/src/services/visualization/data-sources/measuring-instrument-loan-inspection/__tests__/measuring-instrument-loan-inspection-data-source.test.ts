import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployeeStatus } from '@prisma/client';
import { MeasuringInstrumentLoanInspectionDataSource } from '../measuring-instrument-loan-inspection-data-source.js';
import { prisma } from '../../../../../lib/prisma.js';

vi.mock('../../../../../lib/prisma.js', () => ({
  prisma: {
    employee: {
      findMany: vi.fn(),
    },
    inspectionRecord: {
      groupBy: vi.fn(),
    },
    loan: {
      findMany: vi.fn(),
    },
  },
}));

describe('MeasuringInstrumentLoanInspectionDataSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error metadata when sectionEquals is missing', async () => {
    const source = new MeasuringInstrumentLoanInspectionDataSource();
    const result = await source.fetchData({});

    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.rows).toEqual([]);
      expect(result.metadata?.error).toBe('sectionEquals is required');
    }
    expect(prisma.employee.findMany).not.toHaveBeenCalled();
  });

  it('returns error metadata for unsupported period', async () => {
    const source = new MeasuringInstrumentLoanInspectionDataSource();
    const result = await source.fetchData({
      sectionEquals: '加工担当部署',
      period: 'weekly',
    });

    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.rows).toEqual([]);
      expect(result.metadata?.error).toBe('period must be today_jst');
    }
  });

  it('returns empty rows when target section has no active employees', async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([]);

    const source = new MeasuringInstrumentLoanInspectionDataSource();
    const result = await source.fetchData({
      sectionEquals: '加工担当部署',
      period: 'today_jst',
    });

    expect(prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          section: '加工担当部署',
          status: EmployeeStatus.ACTIVE,
        },
      }),
    );
    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.rows).toEqual([]);
      expect(result.metadata?.totalUsers).toBe(0);
      expect(result.metadata?.inspectedUsers).toBe(0);
    }
  });

  it('aggregates inspection status and active loan count by employee', async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: 'emp-1', displayName: '山田 太郎' },
      { id: 'emp-2', displayName: '佐藤 花子' },
    ] as never);
    vi.mocked(prisma.inspectionRecord.groupBy).mockResolvedValue([
      { employeeId: 'emp-1', _count: { _all: 3 } },
    ] as never);
    vi.mocked(prisma.loan.findMany).mockResolvedValue([
      { employeeId: 'emp-1', measuringInstrument: { name: 'デジタルノギス' } },
      { employeeId: 'emp-1', measuringInstrument: { name: 'マイクロメータ' } },
      { employeeId: 'emp-2', measuringInstrument: { name: 'トルクレンチ' } },
    ] as never);

    const source = new MeasuringInstrumentLoanInspectionDataSource();
    const result = await source.fetchData({
      sectionEquals: '加工担当部署',
      period: 'today_jst',
    });

    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.rows).toEqual([
        {
          従業員名: '山田 太郎',
          点検件数: 3,
          貸出中計測機器数: 2,
          計測機器名称一覧: 'デジタルノギス, マイクロメータ',
        },
        {
          従業員名: '佐藤 花子',
          点検件数: 0,
          貸出中計測機器数: 1,
          計測機器名称一覧: 'トルクレンチ',
        },
      ]);
      expect(result.metadata?.sectionEquals).toBe('加工担当部署');
      expect(result.metadata?.totalUsers).toBe(2);
      expect(result.metadata?.inspectedUsers).toBe(1);
      expect(result.metadata?.targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
