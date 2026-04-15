import { prisma } from '../../../lib/prisma.js';
import type {
  IMeasuringInstrumentLoanAnalyticsRepository,
  MeasuringInstrumentLoanAnalyticsAggregate,
  MeasuringInstrumentLoanAnalyticsEmployeeAggregateRow,
  MeasuringInstrumentLoanAnalyticsInstrumentAggregateRow,
  MeasuringInstrumentLoanAnalyticsOpenInfo,
  MeasuringInstrumentLoanAnalyticsPeriodEventRow,
  MeasuringInstrumentLoanAnalyticsQueryInput,
  MeasuringInstrumentUnifiedEvent,
  MeasuringInstrumentUnifiedEventSource,
} from './measuring-instrument-loan-analytics.types.js';

const EVENT_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

function toYearMonth(date: Date, timeZone: 'Asia/Tokyo' | 'UTC'): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

function asString(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asDate(input: unknown): Date | null {
  const raw = asString(input);
  if (!raw) {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeEmployeeName(input: string | null | undefined): string {
  if (!input) {
    return '';
  }
  return input.replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function parseUnifiedEvent(record: {
  managementNumber: string;
  eventAt: Date;
  action: string;
  raw: unknown;
  sourceCsvDashboardId: string | null;
}): MeasuringInstrumentUnifiedEvent | null {
  if (record.action !== '持ち出し' && record.action !== '返却') {
    return null;
  }

  const raw = asRecord(record.raw);
  const source: MeasuringInstrumentUnifiedEventSource = record.sourceCsvDashboardId ? 'csv' : 'nfc';
  const borrowerName = asString(raw.borrower) ?? asString(raw.employeeName);
  const instrumentName = asString(raw.name);
  const expectedReturnAt =
    asDate(raw.expectedReturnAt) ?? asDate(raw.expectedReturnDate) ?? asDate(raw.dueAt);

  return {
    managementNumber: record.managementNumber,
    action: record.action,
    eventAt: record.eventAt,
    source,
    loanId: asString(raw.loanId),
    borrowerName,
    instrumentName,
    expectedReturnAt,
  };
}

export function dedupeUnifiedEvents(
  events: MeasuringInstrumentUnifiedEvent[],
  windowMs = EVENT_DEDUPE_WINDOW_MS
): MeasuringInstrumentUnifiedEvent[] {
  const byKey = new Map<string, MeasuringInstrumentUnifiedEvent[]>();
  const sorted = [...events].sort((a, b) => a.eventAt.getTime() - b.eventAt.getTime());

  for (const event of sorted) {
    const key = `${event.managementNumber}::${event.action}`;
    const bucket = byKey.get(key) ?? [];
    let merged = false;

    for (let i = 0; i < bucket.length; i += 1) {
      const existing = bucket[i];
      const distance = Math.abs(existing.eventAt.getTime() - event.eventAt.getTime());
      if (distance > windowMs) {
        continue;
      }

      const existingPriority = existing.source === 'nfc' ? 2 : 1;
      const incomingPriority = event.source === 'nfc' ? 2 : 1;
      if (incomingPriority > existingPriority) {
        bucket[i] = event;
      } else if (incomingPriority === existingPriority && event.eventAt > existing.eventAt) {
        bucket[i] = event;
      }

      merged = true;
      break;
    }

    if (!merged) {
      bucket.push(event);
    }
    byKey.set(key, bucket);
  }

  return Array.from(byKey.values())
    .flat()
    .sort((a, b) => a.eventAt.getTime() - b.eventAt.getTime());
}

export class MeasuringInstrumentLoanAnalyticsRepository implements IMeasuringInstrumentLoanAnalyticsRepository {
  constructor(private readonly db: typeof prisma = prisma) {}

  async loadAggregate(input: MeasuringInstrumentLoanAnalyticsQueryInput): Promise<MeasuringInstrumentLoanAnalyticsAggregate> {
    const activeInstruments = await this.db.measuringInstrument.findMany({
      where: input.measuringInstrumentId
        ? { id: input.measuringInstrumentId }
        : { status: { not: 'RETIRED' } },
      orderBy: [{ managementNumber: 'asc' }, { name: 'asc' }],
    });
    const managementNumberFilter = input.measuringInstrumentId ? activeInstruments[0]?.managementNumber : undefined;

    const [eventRecords, employees, cancelledLoans] = await Promise.all([
      this.db.measuringInstrumentLoanEvent.findMany({
        where: {
          eventAt: {
            lte: input.now,
          },
          action: { in: ['持ち出し', '返却'] },
          ...(managementNumberFilter ? { managementNumber: managementNumberFilter } : {}),
        },
        select: {
          managementNumber: true,
          eventAt: true,
          action: true,
          raw: true,
          sourceCsvDashboardId: true,
        },
        orderBy: { eventAt: 'asc' },
      }),
      this.db.employee.findMany({
        where: { status: { not: 'INACTIVE' } },
        orderBy: { displayName: 'asc' },
      }),
      this.db.loan.findMany({
        where: {
          measuringInstrumentId: { not: null },
          cancelledAt: { not: null },
        },
        select: { id: true },
      }),
    ]);

    const cancelledLoanIds = new Set(cancelledLoans.map((loan) => loan.id));

    const unifiedEvents = dedupeUnifiedEvents(
      eventRecords.map(parseUnifiedEvent).filter((event): event is MeasuringInstrumentUnifiedEvent => Boolean(event))
    ).filter((event) => !(event.source === 'nfc' && event.loanId && cancelledLoanIds.has(event.loanId)));
    const monthStarts = Array.from({ length: input.monthlyMonths }, (_, index) => {
      const dt = new Date(input.now);
      dt.setUTCDate(1);
      dt.setUTCHours(0, 0, 0, 0);
      dt.setUTCMonth(dt.getUTCMonth() - (input.monthlyMonths - 1 - index));
      return toYearMonth(dt, input.timeZone);
    });
    const monthlyMap = new Map<string, { borrowCount: number; returnCount: number }>(
      monthStarts.map((yearMonth) => [yearMonth, { borrowCount: 0, returnCount: 0 }])
    );
    for (const event of unifiedEvents) {
      const yearMonth = toYearMonth(event.eventAt, input.timeZone);
      const point = monthlyMap.get(yearMonth);
      if (!point) {
        continue;
      }
      if (event.action === '持ち出し') {
        point.borrowCount += 1;
      } else {
        point.returnCount += 1;
      }
    }
    const periodEvents = unifiedEvents.filter(
      (event) => event.eventAt >= input.periodFrom && event.eventAt <= input.periodTo
    );

    const statusByManagement = new Map<
      string,
      { borrowerName: string | null; expectedReturnAt: Date | null; eventAt: Date }
    >();
    for (const event of unifiedEvents) {
      if (event.eventAt > input.now) {
        continue;
      }
      if (event.action === '持ち出し') {
        statusByManagement.set(event.managementNumber, {
          borrowerName: event.borrowerName,
          expectedReturnAt: event.expectedReturnAt,
          eventAt: event.eventAt,
        });
      } else {
        statusByManagement.delete(event.managementNumber);
      }
    }

    const periodBorrowByManagement = new Map<string, number>();
    const periodReturnByManagement = new Map<string, number>();
    const periodBorrowByEmployee = new Map<string, number>();
    const periodReturnByEmployee = new Map<string, number>();

    for (const event of periodEvents) {
      const normName = normalizeEmployeeName(event.borrowerName);
      if (event.action === '持ち出し') {
        periodBorrowByManagement.set(
          event.managementNumber,
          (periodBorrowByManagement.get(event.managementNumber) ?? 0) + 1
        );
        if (normName) {
          periodBorrowByEmployee.set(normName, (periodBorrowByEmployee.get(normName) ?? 0) + 1);
        }
      } else {
        periodReturnByManagement.set(
          event.managementNumber,
          (periodReturnByManagement.get(event.managementNumber) ?? 0) + 1
        );
        if (normName) {
          periodReturnByEmployee.set(normName, (periodReturnByEmployee.get(normName) ?? 0) + 1);
        }
      }
    }

    const employeeByNormalizedName = new Map(
      employees.map((employee) => [normalizeEmployeeName(employee.displayName), employee] as const)
    );

    const openCountByNormalizedName = new Map<string, number>();
    for (const open of statusByManagement.values()) {
      const normalized = normalizeEmployeeName(open.borrowerName);
      if (!normalized) {
        continue;
      }
      openCountByNormalizedName.set(normalized, (openCountByNormalizedName.get(normalized) ?? 0) + 1);
    }

    const knownManagement = new Set(activeInstruments.map((instrument) => instrument.managementNumber));
    const unknownAllowed = !input.measuringInstrumentId;
    const instrumentRows: MeasuringInstrumentLoanAnalyticsInstrumentAggregateRow[] = activeInstruments.map(
      (instrument) => {
        const open = statusByManagement.get(instrument.managementNumber);
        const openInfo: MeasuringInstrumentLoanAnalyticsOpenInfo | null = open
          ? {
              borrowerName: open.borrowerName,
              expectedReturnAt: open.expectedReturnAt,
              isOverdue: Boolean(open.expectedReturnAt && open.expectedReturnAt < input.now),
            }
          : null;

        return {
          instrumentId: instrument.id,
          managementNumber: instrument.managementNumber,
          name: instrument.name,
          status: instrument.status,
          periodBorrowCount: periodBorrowByManagement.get(instrument.managementNumber) ?? 0,
          periodReturnCount: periodReturnByManagement.get(instrument.managementNumber) ?? 0,
          open: openInfo,
        };
      }
    );

    const unknownManagementRows = unknownAllowed
      ? Array.from(statusByManagement.entries())
          .filter(([managementNumber]) => !knownManagement.has(managementNumber))
          .map(([managementNumber, open]) => ({
        instrumentId: `unknown:${managementNumber}`,
        managementNumber,
        name: '（マスタ未登録）',
        status: 'AVAILABLE' as const,
        periodBorrowCount: periodBorrowByManagement.get(managementNumber) ?? 0,
        periodReturnCount: periodReturnByManagement.get(managementNumber) ?? 0,
        open: {
          borrowerName: open.borrowerName,
          expectedReturnAt: open.expectedReturnAt,
          isOverdue: Boolean(open.expectedReturnAt && open.expectedReturnAt < input.now),
        },
      }))
      : [];

    const allInstrumentRows = [...instrumentRows, ...unknownManagementRows].sort((a, b) =>
      a.managementNumber.localeCompare(b.managementNumber)
    );

    const employeeKeys = new Set<string>([
      ...periodBorrowByEmployee.keys(),
      ...periodReturnByEmployee.keys(),
      ...openCountByNormalizedName.keys(),
    ]);

    const employeeRows: MeasuringInstrumentLoanAnalyticsEmployeeAggregateRow[] = Array.from(employeeKeys)
      .map((normalized) => {
        const employee = employeeByNormalizedName.get(normalized);
        const displayName = employee?.displayName ?? normalized;
        return {
          employeeId: employee?.id ?? `unknown:${normalized}`,
          displayName,
          employeeCode: employee?.employeeCode ?? '-',
          openInstrumentCount: openCountByNormalizedName.get(normalized) ?? 0,
          periodBorrowCount: periodBorrowByEmployee.get(normalized) ?? 0,
          periodReturnCount: periodReturnByEmployee.get(normalized) ?? 0,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    const managementToInstrument = new Map(
      activeInstruments.map((instrument) => [instrument.managementNumber, instrument] as const)
    );
    const periodEventRows: MeasuringInstrumentLoanAnalyticsPeriodEventRow[] = periodEvents
      .map((event) => {
        const instrument = managementToInstrument.get(event.managementNumber);
        const norm = normalizeEmployeeName(event.borrowerName);
        const employee = norm ? employeeByNormalizedName.get(norm) : undefined;
        const assetLabel = `${event.managementNumber} ${event.instrumentName ?? instrument?.name ?? '（名称未設定）'}`.trim();
        return {
          kind: (event.action === '持ち出し' ? 'BORROW' : 'RETURN') as MeasuringInstrumentLoanAnalyticsPeriodEventRow['kind'],
          eventAt: event.eventAt,
          assetId: instrument?.id ?? `unknown:${event.managementNumber}`,
          assetLabel,
          actorDisplayName: event.borrowerName,
          actorEmployeeId: employee?.id ?? null
        };
      })
      .sort((a, b) => b.eventAt.getTime() - a.eventAt.getTime());

    return {
      periodBorrowCount: periodEvents.filter((event) => event.action === '持ち出し').length,
      periodReturnCount: periodEvents.filter((event) => event.action === '返却').length,
      openLoanCount: allInstrumentRows.filter((row) => row.open !== null).length,
      overdueOpenCount: allInstrumentRows.filter((row) => row.open?.isOverdue).length,
      totalInstrumentsActive: input.measuringInstrumentId ? Math.min(1, activeInstruments.length) : activeInstruments.length,
      instrumentRows: allInstrumentRows,
      periodEventRows,
      employeeRows,
      monthlyTrend: monthStarts.map((yearMonth) => ({
        yearMonth,
        borrowCount: monthlyMap.get(yearMonth)?.borrowCount ?? 0,
        returnCount: monthlyMap.get(yearMonth)?.returnCount ?? 0,
      })),
    };
  }
}
