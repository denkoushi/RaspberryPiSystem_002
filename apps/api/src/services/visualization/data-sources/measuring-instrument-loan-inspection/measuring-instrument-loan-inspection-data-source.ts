import { EmployeeStatus } from '@prisma/client';
import { prisma } from '../../../../lib/prisma.js';
import {
  resolveJstSignageBusinessDate,
} from '../../../../lib/signage-business-day.js';
import type { DataSource } from '../data-source.interface.js';
import type { TableVisualizationData, VisualizationData } from '../../visualization.types.js';
import { resolveJstDayRange } from '../_shared/data-source-utils.js';
import { MI_INSTRUMENT_DETAIL_COLUMN } from '../../renderers/measuring-instrument-loan-inspection/mi-instrument-display.types.js';
import { extractLoanIdFromEventRaw } from './extract-loan-id-from-event-raw.js';
import { formatLoanInspectionInstrumentLabel } from './format-loan-inspection-instrument-label.js';
import { loadCancelledLoanIdSet } from './load-cancelled-loan-id-set.js';

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

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmployeeName(value: string): string {
  return value.replace(/[\s\u3000]/g, '');
}

const TABLE_COLUMNS = [
  '従業員名',
  '貸出中計測機器数',
  '計測機器名称一覧',
  MI_INSTRUMENT_DETAIL_COLUMN,
] as const;

function buildEmptyTable(metadata: LoanInspectionMetadata): TableVisualizationData {
  return {
    kind: 'table',
    columns: [...TABLE_COLUMNS],
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
    const [inspectedGroup, borrowEvents] = await Promise.all([
      prisma.inspectionRecord.groupBy({
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
      prisma.measuringInstrumentLoanEvent.findMany({
        where: {
          action: '持ち出し',
          eventAt: {
            gte: startDateUtc,
            lt: snapshotUpperBoundUtc,
          },
        },
        select: {
          managementNumber: true,
          eventAt: true,
          raw: true,
        },
        orderBy: {
          eventAt: 'desc',
        },
      }),
    ]);

    const inspectedCountByEmployee = new Map(
      inspectedGroup.map((group) => [group.employeeId, group._count._all ?? 0]),
    );

    const borrowEventsWithLoanId = borrowEvents.map((event) => ({
      event,
      loanId: extractLoanIdFromEventRaw(event.raw),
    }));
    const loanIdsFromBorrowEvents = Array.from(
      new Set(
        borrowEventsWithLoanId.map(({ loanId }) => loanId).filter((id): id is string => Boolean(id)),
      ),
    );
    const cancelledLoanIdSet = await loadCancelledLoanIdSet(prisma, loanIdsFromBorrowEvents);

    const managementNumbers = Array.from(
      new Set(borrowEvents.map((event) => event.managementNumber).filter(Boolean)),
    );
    const returnEvents = managementNumbers.length
      ? await prisma.measuringInstrumentLoanEvent.findMany({
          where: {
            action: '返却',
            managementNumber: { in: managementNumbers },
            eventAt: { lt: snapshotUpperBoundUtc },
          },
          select: {
            managementNumber: true,
            eventAt: true,
          },
        })
      : [];

    const latestReturnByManagementNumber = new Map<string, Date>();
    for (const event of returnEvents) {
      const current = latestReturnByManagementNumber.get(event.managementNumber);
      if (!current || event.eventAt > current) {
        latestReturnByManagementNumber.set(event.managementNumber, event.eventAt);
      }
    }

    type ActiveInstrumentDetail = { name: string; managementNumber: string };
    const activeInstrumentDetailsByBorrower = new Map<string, Map<string, ActiveInstrumentDetail>>();
    for (const { event, loanId } of borrowEventsWithLoanId) {
      const raw = asRecord(event.raw);
      if (loanId && cancelledLoanIdSet.has(loanId)) {
        continue;
      }
      const latestReturn = latestReturnByManagementNumber.get(event.managementNumber);
      if (latestReturn && latestReturn >= event.eventAt) {
        continue;
      }
      const borrower = normalizeEmployeeName(asString(raw.borrower));
      const instrumentName = asString(raw.name);
      if (!borrower || !instrumentName) {
        continue;
      }
      const mgmt = event.managementNumber.trim();
      if (!mgmt) {
        continue;
      }
      const byMgmt =
        activeInstrumentDetailsByBorrower.get(borrower) ?? new Map<string, ActiveInstrumentDetail>();
      byMgmt.set(mgmt, { name: instrumentName, managementNumber: event.managementNumber });
      activeInstrumentDetailsByBorrower.set(borrower, byMgmt);
    }

    let inspectedUsers = 0;
    const rows = employees.map((employee) => {
      const inspectedCountToday = inspectedCountByEmployee.get(employee.id) ?? 0;
      const detailMap =
        activeInstrumentDetailsByBorrower.get(normalizeEmployeeName(employee.displayName)) ??
        new Map<string, ActiveInstrumentDetail>();
      const details = Array.from(detailMap.values());
      const activeInstrumentNames = details.map((d) =>
        formatLoanInspectionInstrumentLabel(d.name, d.managementNumber),
      );
      const activeInstrumentLoansCount = details.length;
      if (inspectedCountToday > 0) {
        inspectedUsers += 1;
      }
      const instrumentDetailsJson =
        details.length > 0
          ? JSON.stringify(
              details.map((d) => ({
                kind: 'active' as const,
                managementNumber: d.managementNumber,
                name: d.name,
              })),
            )
          : '';
      return {
        従業員名: employee.displayName,
        点検件数: inspectedCountToday,
        貸出中計測機器数: activeInstrumentLoansCount,
        計測機器名称一覧: activeInstrumentNames.join(', '),
        [MI_INSTRUMENT_DETAIL_COLUMN]: instrumentDetailsJson,
      };
    });

    return {
      kind: 'table',
      columns: [...TABLE_COLUMNS],
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
