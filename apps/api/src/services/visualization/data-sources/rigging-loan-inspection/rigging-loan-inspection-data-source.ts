import { EmployeeStatus } from '@prisma/client';
import { prisma } from '../../../../lib/prisma.js';
import { resolveJstSignageBusinessDate } from '../../../../lib/signage-business-day.js';
import type { DataSource } from '../data-source.interface.js';
import type { TableVisualizationData, VisualizationData } from '../../visualization.types.js';
import { resolveJstDayRange } from '../_shared/data-source-utils.js';
import { formatLoanInspectionInstrumentLabel } from '../../shared/loan-inspection-card/format-instrument-label.js';
import { loadCancelledLoanIdSet } from '../measuring-instrument-loan-inspection/load-cancelled-loan-id-set.js';
import {
  RIGGING_ACTIVE_COUNT_COLUMN,
  RIGGING_INSTRUMENT_DETAIL_COLUMN,
  RIGGING_LOAN_INSPECTION_TABLE_COLUMNS,
  RIGGING_NAMES_COLUMN,
  RIGGING_RETURNED_COUNT_COLUMN,
} from './rigging-loan-inspection.constants.js';

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

function buildEmptyTable(metadata: LoanInspectionMetadata): TableVisualizationData {
  return {
    kind: 'table',
    columns: [...RIGGING_LOAN_INSPECTION_TABLE_COLUMNS],
    rows: [],
    metadata,
  };
}

export class RiggingLoanInspectionDataSource implements DataSource {
  readonly type = 'rigging_loan_inspection';

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

    const nowUtc = new Date();
    const dateLabel = resolveJstSignageBusinessDate(nowUtc);
    const { start: startDateUtc, end: endDateUtcExclusive } = resolveJstDayRange(dateLabel);
    const currentCalendarDate = resolveJstDayRange().date;
    const snapshotUpperBoundUtc =
      dateLabel === currentCalendarDate ? nowUtc : endDateUtcExclusive;

    const employees = await prisma.employee.findMany({
      where: {
        section: sectionEquals,
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
    const [inspectedGroup, riggingLoans] = await Promise.all([
      prisma.riggingInspectionRecord.groupBy({
        by: ['employeeId'],
        where: {
          employeeId: { in: employeeIds },
          inspectedAt: {
            gte: startDateUtc,
            lt: endDateUtcExclusive,
          },
        },
        _count: {
          _all: true,
        },
      }),
      prisma.loan.findMany({
        where: {
          riggingGearId: { not: null },
          employeeId: { in: employeeIds },
          cancelledAt: null,
          borrowedAt: {
            gte: startDateUtc,
            lt: snapshotUpperBoundUtc,
          },
        },
        select: {
          id: true,
          employeeId: true,
          borrowedAt: true,
          returnedAt: true,
          riggingGear: {
            select: {
              name: true,
              managementNumber: true,
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

    const loanIds = riggingLoans.map((loan) => loan.id);
    const cancelledLoanIdSet = await loadCancelledLoanIdSet(prisma, loanIds);

    type ActiveDetail = { name: string; managementNumber: string };
    type ReturnedDetail = { name: string; managementNumber: string };
    const activeDetailsByEmployee = new Map<string, Map<string, ActiveDetail>>();
    const returnedDetailsByEmployee = new Map<string, Map<string, ReturnedDetail>>();

    const seenGearKey = new Set<string>();
    for (const loan of riggingLoans) {
      if (cancelledLoanIdSet.has(loan.id)) {
        continue;
      }
      const employeeId = loan.employeeId;
      const gear = loan.riggingGear;
      if (!employeeId || !gear) {
        continue;
      }
      const mgmt = gear.managementNumber.trim();
      const name = gear.name.trim();
      if (!mgmt && !name) {
        continue;
      }
      const pairKey = `${employeeId}\n${mgmt}`;
      if (seenGearKey.has(pairKey)) {
        continue;
      }
      seenGearKey.add(pairKey);

      const detail = { name, managementNumber: gear.managementNumber };
      const isReturned = Boolean(loan.returnedAt && loan.returnedAt <= snapshotUpperBoundUtc);
      if (isReturned) {
        const byMgmt = returnedDetailsByEmployee.get(employeeId) ?? new Map<string, ReturnedDetail>();
        byMgmt.set(mgmt, detail);
        returnedDetailsByEmployee.set(employeeId, byMgmt);
      } else {
        const byMgmt = activeDetailsByEmployee.get(employeeId) ?? new Map<string, ActiveDetail>();
        byMgmt.set(mgmt, detail);
        activeDetailsByEmployee.set(employeeId, byMgmt);
      }
    }

    let inspectedUsers = 0;
    const rows = employees.map((employee) => {
      const inspectedCountToday = inspectedCountByEmployee.get(employee.id) ?? 0;
      const activeMap = activeDetailsByEmployee.get(employee.id) ?? new Map<string, ActiveDetail>();
      const returnedMap = returnedDetailsByEmployee.get(employee.id) ?? new Map<string, ReturnedDetail>();
      const activeDetails = Array.from(activeMap.values());
      const returnedDetails = Array.from(returnedMap.values());
      const nameTokens = [
        ...activeDetails.map((d) => formatLoanInspectionInstrumentLabel(d.name, d.managementNumber)),
        ...returnedDetails.map((d) => formatLoanInspectionInstrumentLabel(d.name, d.managementNumber)),
      ];
      if (inspectedCountToday > 0) {
        inspectedUsers += 1;
      }
      const instrumentDetailsJson =
        activeDetails.length + returnedDetails.length > 0
          ? JSON.stringify([
              ...activeDetails.map((d) => ({
                kind: 'active' as const,
                managementNumber: d.managementNumber,
                name: d.name,
              })),
              ...returnedDetails.map((d) => ({
                kind: 'returned' as const,
                managementNumber: d.managementNumber,
                name: d.name,
              })),
            ])
          : '';
      return {
        従業員名: employee.displayName,
        点検件数: inspectedCountToday,
        [RIGGING_ACTIVE_COUNT_COLUMN]: activeDetails.length,
        [RIGGING_RETURNED_COUNT_COLUMN]: returnedDetails.length,
        [RIGGING_NAMES_COLUMN]: nameTokens.join(', '),
        [RIGGING_INSTRUMENT_DETAIL_COLUMN]: instrumentDetailsJson,
      };
    });

    return {
      kind: 'table',
      columns: [...RIGGING_LOAN_INSPECTION_TABLE_COLUMNS],
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
