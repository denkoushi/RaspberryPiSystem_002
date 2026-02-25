import { EmployeeStatus } from '@prisma/client';
import { prisma } from '../../../../lib/prisma.js';
import type { DataSource } from '../data-source.interface.js';
import type { TableVisualizationData, VisualizationData } from '../../visualization.types.js';

type LoanInspectionMetadata = {
  sectionEquals?: string;
  targetDate?: string;
  totalUsers?: number;
  inspectedUsers?: number;
  error?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function resolveTodayJstRange(nowUtc = new Date()): { startDateUtc: Date; endDateUtc: Date; dateLabel: string } {
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const nowJst = new Date(nowUtc.getTime() + jstOffsetMs);
  const startOfTodayJst = new Date(nowJst);
  startOfTodayJst.setHours(0, 0, 0, 0);
  const endOfTodayJst = new Date(nowJst);
  endOfTodayJst.setHours(23, 59, 59, 999);

  const startDateUtc = new Date(startOfTodayJst.getTime() - jstOffsetMs);
  const endDateUtc = new Date(endOfTodayJst.getTime() - jstOffsetMs);
  const yyyy = startOfTodayJst.getFullYear();
  const mm = String(startOfTodayJst.getMonth() + 1).padStart(2, '0');
  const dd = String(startOfTodayJst.getDate()).padStart(2, '0');
  return { startDateUtc, endDateUtc, dateLabel: `${yyyy}-${mm}-${dd}` };
}

function buildEmptyTable(metadata: LoanInspectionMetadata): TableVisualizationData {
  return {
    kind: 'table',
    columns: ['従業員名', '貸出中計測機器数', '計測機器名称一覧'],
    rows: [],
    metadata,
  };
}

export class MeasuringInstrumentLoanInspectionDataSource implements DataSource {
  readonly type = 'measuring_instrument_loan_inspection';

  async fetchData(config: Record<string, unknown>): Promise<VisualizationData> {
    const query = asRecord(config);
    const sectionEquals = typeof query.sectionEquals === 'string' ? query.sectionEquals.trim() : '';
    const period = typeof query.period === 'string' ? query.period.trim().toLowerCase() : 'today_jst';

    if (!sectionEquals) {
      return buildEmptyTable({ error: 'sectionEquals is required' });
    }
    if (period !== 'today_jst') {
      return buildEmptyTable({ sectionEquals, error: 'period must be today_jst' });
    }

    const { startDateUtc, endDateUtc, dateLabel } = resolveTodayJstRange();

    const employees = await prisma.employee.findMany({
      where: {
        department: sectionEquals,
        status: EmployeeStatus.ACTIVE,
      },
      select: {
        id: true,
        displayName: true,
      },
      orderBy: {
        displayName: 'asc',
      },
    });

    if (employees.length === 0) {
      return buildEmptyTable({
        sectionEquals,
        targetDate: dateLabel,
        totalUsers: 0,
        inspectedUsers: 0,
      });
    }

    const employeeIds = employees.map((employee) => employee.id);
    const [inspectedGroup, activeLoans] = await Promise.all([
      prisma.inspectionRecord.groupBy({
        by: ['employeeId'],
        where: {
          employeeId: { in: employeeIds },
          inspectedAt: {
            gte: startDateUtc,
            lte: endDateUtc,
          },
        },
        _count: {
          _all: true,
        },
      }),
      prisma.loan.findMany({
        where: {
          employeeId: { in: employeeIds },
          measuringInstrumentId: { not: null },
          returnedAt: null,
          cancelledAt: null,
        },
        select: {
          employeeId: true,
          measuringInstrument: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          borrowedAt: 'desc',
        },
      }),
    ]);

    const inspectedCountByEmployee = new Map(
      inspectedGroup.map((group) => [group.employeeId, group._count._all ?? 0]),
    );
    const activeLoanNamesByEmployee = new Map<string, string[]>();
    for (const loan of activeLoans) {
      const employeeId = loan.employeeId;
      if (!employeeId) {
        continue;
      }
      const name = loan.measuringInstrument?.name?.trim();
      if (!name) {
        continue;
      }
      const current = activeLoanNamesByEmployee.get(employeeId) ?? [];
      current.push(name);
      activeLoanNamesByEmployee.set(employeeId, current);
    }

    let inspectedUsers = 0;
    const rows = employees.map((employee) => {
      const inspectedCountToday = inspectedCountByEmployee.get(employee.id) ?? 0;
      const rawNames = activeLoanNamesByEmployee.get(employee.id) ?? [];
      const activeInstrumentNames = Array.from(new Set(rawNames));
      const activeInstrumentLoansCount = activeInstrumentNames.length;
      if (inspectedCountToday > 0) {
        inspectedUsers += 1;
      }
      return {
        従業員名: employee.displayName,
        点検件数: inspectedCountToday,
        貸出中計測機器数: activeInstrumentLoansCount,
        計測機器名称一覧: activeInstrumentNames.join(', '),
      };
    });

    return {
      kind: 'table',
      columns: ['従業員名', '貸出中計測機器数', '計測機器名称一覧'],
      rows,
      metadata: {
        sectionEquals,
        targetDate: dateLabel,
        totalUsers: employees.length,
        inspectedUsers,
      } satisfies LoanInspectionMetadata,
    };
  }
}
