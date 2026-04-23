import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    measuringInstrumentLoanEvent: {
      findMany: vi.fn(),
    },
    loan: {
      findMany: vi.fn(),
    },
  },
}));

describe('MeasuringInstrumentLoanInspectionDataSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.loan.findMany).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-25T10:00:00+09:00'));

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
      expect(result.metadata?.targetDate).toBe('2026-02-25');
    }
  });

  it('aggregates inspection status and active loan count by employee', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-25T10:00:00+09:00'));

    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: 'emp-1', displayName: '山田 太郎' },
      { id: 'emp-2', displayName: '佐藤 花子' },
    ] as never);
    vi.mocked(prisma.inspectionRecord.groupBy).mockResolvedValue([
      { employeeId: 'emp-1', _count: { _all: 3 } },
    ] as never);
    vi.mocked(prisma.measuringInstrumentLoanEvent.findMany)
      .mockResolvedValueOnce([
        {
          managementNumber: 'AG1001',
          eventAt: new Date('2026-02-25T01:00:00.000Z'),
          raw: { borrower: '山田太郎', name: 'デジタルノギス' },
        },
        {
          managementNumber: 'AG1002',
          eventAt: new Date('2026-02-25T02:00:00.000Z'),
          raw: { borrower: '山田太郎', name: 'マイクロメータ' },
        },
        {
          managementNumber: 'AG1003',
          eventAt: new Date('2026-02-25T03:00:00.000Z'),
          raw: { borrower: '佐藤花子', name: 'トルクレンチ' },
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

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
          計測機器名称一覧: 'デジタルノギス (AG1001), マイクロメータ (AG1002)',
          計測機器明細:
            '[{"kind":"active","managementNumber":"AG1001","name":"デジタルノギス"},{"kind":"active","managementNumber":"AG1002","name":"マイクロメータ"}]',
        },
        {
          従業員名: '佐藤 花子',
          点検件数: 0,
          貸出中計測機器数: 1,
          計測機器名称一覧: 'トルクレンチ (AG1003)',
          計測機器明細:
            '[{"kind":"active","managementNumber":"AG1003","name":"トルクレンチ"}]',
        },
      ]);
      expect(result.metadata?.sectionEquals).toBe('加工担当部署');
      expect(result.metadata?.totalUsers).toBe(2);
      expect(result.metadata?.inspectedUsers).toBe(1);
      expect(result.metadata?.targetDate).toBe('2026-02-25');
    }
    expect(prisma.loan.findMany).not.toHaveBeenCalled();
  });

  it('NFC 由来の loanId が取消済み Loan と一致する持ち出しは貸出中に含めない', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-25T10:00:00+09:00'));

    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: 'emp-1', displayName: '山田 太郎' },
    ] as never);
    vi.mocked(prisma.inspectionRecord.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.loan.findMany).mockResolvedValue([{ id: 'loan-cancelled-1' }] as never);
    vi.mocked(prisma.measuringInstrumentLoanEvent.findMany)
      .mockResolvedValueOnce([
        {
          managementNumber: 'AG1001',
          eventAt: new Date('2026-02-25T01:00:00.000Z'),
          raw: {
            borrower: '山田太郎',
            name: 'デジタルノギス',
            loanId: 'loan-cancelled-1',
          },
        },
        {
          managementNumber: 'AG1002',
          eventAt: new Date('2026-02-25T02:00:00.000Z'),
          raw: { borrower: '山田太郎', name: 'マイクロメータ' },
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const source = new MeasuringInstrumentLoanInspectionDataSource();
    const result = await source.fetchData({
      sectionEquals: '加工担当部署',
      period: 'today_jst',
    });

    expect(prisma.loan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['loan-cancelled-1'] },
          cancelledAt: { not: null },
        }),
      }),
    );
    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.rows).toEqual([
        {
          従業員名: '山田 太郎',
          点検件数: 0,
          貸出中計測機器数: 1,
          計測機器名称一覧: 'マイクロメータ (AG1002)',
          計測機器明細: '[{"kind":"active","managementNumber":"AG1002","name":"マイクロメータ"}]',
        },
      ]);
    }
  });

  it('JST 7:41 では targetDate は前日で固定され、当日 9:00 前の新規持出は前日スナップショットに混ざらない', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-17T07:41:00+09:00'));

    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      { id: 'emp-1', displayName: '山田 太郎' },
    ] as never);
    vi.mocked(prisma.inspectionRecord.groupBy).mockResolvedValue([] as never);
    vi.mocked(prisma.measuringInstrumentLoanEvent.findMany)
      .mockImplementationOnce(async (args: any) => {
        const start = args.where.eventAt.gte as Date;
        const end = args.where.eventAt.lt as Date;
        return [
          {
            managementNumber: 'AG1001',
            eventAt: new Date('2026-04-16T08:30:00.000Z'),
            raw: { borrower: '山田太郎', name: 'デジタルノギス' },
          },
          {
            managementNumber: 'AG1002',
            eventAt: new Date('2026-04-16T22:30:00.000Z'),
            raw: { borrower: '山田太郎', name: 'マイクロメータ' },
          },
        ].filter((event) => event.eventAt >= start && event.eventAt < end) as never;
      })
      .mockResolvedValueOnce([] as never);

    const source = new MeasuringInstrumentLoanInspectionDataSource();
    const result = await source.fetchData({
      sectionEquals: '加工担当部署',
      period: 'today_jst',
    });

    expect(result.kind).toBe('table');
    if (result.kind === 'table') {
      expect(result.metadata?.targetDate).toBe('2026-04-16');
      expect(result.rows).toEqual([
        {
          従業員名: '山田 太郎',
          点検件数: 0,
          貸出中計測機器数: 1,
          計測機器名称一覧: 'デジタルノギス (AG1001)',
          計測機器明細: '[{"kind":"active","managementNumber":"AG1001","name":"デジタルノギス"}]',
        },
      ]);
    }

    expect(prisma.measuringInstrumentLoanEvent.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          eventAt: {
            gte: new Date('2026-04-15T15:00:00.000Z'),
            lt: new Date('2026-04-16T15:00:00.000Z'),
          },
        }),
      }),
    );
  });
});
