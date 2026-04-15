import { Prisma, RiggingStatus } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import type {
  IRiggingLoanAnalyticsRepository,
  RiggingLoanAnalyticsAggregate,
  RiggingLoanAnalyticsEmployeeAggregateRow,
  RiggingLoanAnalyticsGearAggregateRow,
  RiggingLoanAnalyticsOpenLoanInfo,
  RiggingLoanAnalyticsPeriodEventRow,
  RiggingLoanAnalyticsQueryInput,
  RiggingLoanAnalyticsTimeZone
} from './rigging-loan-analytics.types.js';

function timeZoneSql(tz: RiggingLoanAnalyticsTimeZone): Prisma.Sql {
  return tz === 'UTC' ? Prisma.raw(`'UTC'`) : Prisma.raw(`'Asia/Tokyo'`);
}

/**
 * 吊具 Loan のみ対象。cancelledAt が非 null の行は全集計から除外する。
 */
export class RiggingLoanAnalyticsRepository implements IRiggingLoanAnalyticsRepository {
  constructor(private readonly db: typeof prisma = prisma) {}

  async loadAggregate(input: RiggingLoanAnalyticsQueryInput): Promise<RiggingLoanAnalyticsAggregate> {
    const tzSql = timeZoneSql(input.timeZone);
    const monthOffset = input.monthlyMonths - 1;
    const gearMonthlyFilter = input.riggingGearId
      ? Prisma.sql`AND l."riggingGearId" = ${input.riggingGearId}::uuid`
      : Prisma.sql`AND l."riggingGearId" IS NOT NULL`;

    const monthlyRows = await this.db.$queryRaw<
      Array<{ year_month: string; borrow_count: bigint; return_count: bigint }>
    >`
      WITH anchor AS (
        SELECT date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE ${tzSql}))::date AS cur_month_start
      ),
      bounds AS (
        SELECT (cur_month_start - (${monthOffset} * interval '1 month'))::date AS first_month,
               cur_month_start AS last_month
        FROM anchor
      ),
      month_starts AS (
        SELECT generate_series(first_month, last_month, interval '1 month')::date AS month_start
        FROM bounds
      ),
      borrows AS (
        SELECT date_trunc('month', (l."borrowedAt" AT TIME ZONE ${tzSql}))::date AS m,
               COUNT(*)::bigint AS c
        FROM "Loan" l
        WHERE l."cancelledAt" IS NULL
          ${gearMonthlyFilter}
        GROUP BY 1
      ),
      returns AS (
        SELECT date_trunc('month', (l."returnedAt" AT TIME ZONE ${tzSql}))::date AS m,
               COUNT(*)::bigint AS c
        FROM "Loan" l
        WHERE l."cancelledAt" IS NULL
          AND l."returnedAt" IS NOT NULL
          ${gearMonthlyFilter}
        GROUP BY 1
      )
      SELECT to_char(m.month_start, 'YYYY-MM') AS year_month,
             COALESCE(b.c, 0)::bigint AS borrow_count,
             COALESCE(r.c, 0)::bigint AS return_count
      FROM month_starts m
      LEFT JOIN borrows b ON b.m = m.month_start
      LEFT JOIN returns r ON r.m = m.month_start
      ORDER BY m.month_start ASC;
    `;

    const riggingLoanBase = input.riggingGearId
      ? ({
          riggingGearId: input.riggingGearId,
          cancelledAt: null
        } as const)
      : ({
          riggingGearId: { not: null },
          cancelledAt: null
        } as const);

    const [
      periodBorrowCount,
      periodReturnCount,
      openLoanCount,
      overdueOpenCount,
      totalRiggingGearsActive,
      gears,
      borrowByGear,
      returnByGear,
      openLoans,
      periodLoans,
      borrowByEmployee,
      returnByEmployee,
      openByEmployee
    ] = await Promise.all([
      this.db.loan.count({
        where: {
          ...riggingLoanBase,
          borrowedAt: { gte: input.periodFrom, lte: input.periodTo }
        }
      }),
      this.db.loan.count({
        where: {
          ...riggingLoanBase,
          returnedAt: { not: null, gte: input.periodFrom, lte: input.periodTo }
        }
      }),
      this.db.loan.count({
        where: {
          ...riggingLoanBase,
          returnedAt: null
        }
      }),
      this.db.loan.count({
        where: {
          ...riggingLoanBase,
          returnedAt: null,
          dueAt: { not: null, lt: input.now }
        }
      }),
      this.db.riggingGear.count({
        where: input.riggingGearId
          ? { id: input.riggingGearId }
          : { status: { not: RiggingStatus.RETIRED } }
      }),
      this.db.riggingGear.findMany({
        where: input.riggingGearId
          ? { id: input.riggingGearId }
          : { status: { not: RiggingStatus.RETIRED } },
        orderBy: [{ managementNumber: 'asc' }, { name: 'asc' }]
      }),
      this.db.loan.groupBy({
        by: ['riggingGearId'],
        where: {
          ...riggingLoanBase,
          borrowedAt: { gte: input.periodFrom, lte: input.periodTo }
        },
        _count: { _all: true }
      }),
      this.db.loan.groupBy({
        by: ['riggingGearId'],
        where: {
          ...riggingLoanBase,
          returnedAt: { not: null, gte: input.periodFrom, lte: input.periodTo }
        },
        _count: { _all: true }
      }),
      this.db.loan.findMany({
        where: { ...riggingLoanBase, returnedAt: null },
        select: {
          riggingGearId: true,
          dueAt: true,
          employee: { select: { displayName: true, employeeCode: true } }
        }
      }),
      this.db.loan.findMany({
        where: {
          ...riggingLoanBase,
          OR: [
            { borrowedAt: { gte: input.periodFrom, lte: input.periodTo } },
            { returnedAt: { not: null, gte: input.periodFrom, lte: input.periodTo } }
          ]
        },
        select: {
          riggingGearId: true,
          borrowedAt: true,
          returnedAt: true,
          employeeId: true,
          employee: { select: { displayName: true } },
          riggingGear: { select: { managementNumber: true, name: true } }
        }
      }),
      this.db.loan.groupBy({
        by: ['employeeId'],
        where: {
          ...riggingLoanBase,
          borrowedAt: { gte: input.periodFrom, lte: input.periodTo },
          employeeId: { not: null }
        },
        _count: { _all: true }
      }),
      this.db.loan.groupBy({
        by: ['employeeId'],
        where: {
          ...riggingLoanBase,
          returnedAt: { not: null, gte: input.periodFrom, lte: input.periodTo },
          employeeId: { not: null }
        },
        _count: { _all: true }
      }),
      this.db.loan.groupBy({
        by: ['employeeId'],
        where: {
          ...riggingLoanBase,
          returnedAt: null,
          employeeId: { not: null }
        },
        _count: { _all: true }
      })
    ]);

    const borrowGearMap = new Map(
      borrowByGear.filter((r) => r.riggingGearId).map((r) => [r.riggingGearId!, r._count._all])
    );
    const returnGearMap = new Map(
      returnByGear.filter((r) => r.riggingGearId).map((r) => [r.riggingGearId!, r._count._all])
    );

    const openByGearId = new Map<string, RiggingLoanAnalyticsOpenLoanInfo>();
    for (const loan of openLoans) {
      if (!loan.riggingGearId || !loan.employee) continue;
      const dueAt = loan.dueAt;
      openByGearId.set(loan.riggingGearId, {
        dueAt,
        employeeDisplayName: loan.employee.displayName,
        employeeCode: loan.employee.employeeCode,
        isOverdue: dueAt != null && dueAt < input.now
      });
    }

    const gearRows: RiggingLoanAnalyticsGearAggregateRow[] = gears.map((g) => {
      const open = openByGearId.get(g.id) ?? null;
      return {
        gearId: g.id,
        managementNumber: g.managementNumber,
        name: g.name,
        status: g.status,
        periodBorrowCount: borrowGearMap.get(g.id) ?? 0,
        periodReturnCount: returnGearMap.get(g.id) ?? 0,
        open
      };
    });

    const empIds = new Set<string>();
    for (const row of openByEmployee) {
      if (row.employeeId) empIds.add(row.employeeId);
    }
    for (const row of borrowByEmployee) {
      if (row.employeeId) empIds.add(row.employeeId);
    }
    for (const row of returnByEmployee) {
      if (row.employeeId) empIds.add(row.employeeId);
    }

    const borrowEmpMap = new Map(
      borrowByEmployee.filter((r) => r.employeeId).map((r) => [r.employeeId!, r._count._all])
    );
    const returnEmpMap = new Map(
      returnByEmployee.filter((r) => r.employeeId).map((r) => [r.employeeId!, r._count._all])
    );
    const openEmpMap = new Map(
      openByEmployee.filter((r) => r.employeeId).map((r) => [r.employeeId!, r._count._all])
    );

    /** Prisma の `in: []` は環境によって未定義動作のためスキップ */
    const employees =
      empIds.size === 0
        ? []
        : await this.db.employee.findMany({
            where: { id: { in: [...empIds] } },
            orderBy: { displayName: 'asc' }
          });

    const employeeRows: RiggingLoanAnalyticsEmployeeAggregateRow[] = employees.map((e) => ({
      employeeId: e.id,
      displayName: e.displayName,
      employeeCode: e.employeeCode,
      openRiggingCount: openEmpMap.get(e.id) ?? 0,
      periodBorrowCount: borrowEmpMap.get(e.id) ?? 0,
      periodReturnCount: returnEmpMap.get(e.id) ?? 0
    }));

    const periodEventRows: RiggingLoanAnalyticsPeriodEventRow[] = [];
    for (const loan of periodLoans) {
      if (!loan.riggingGearId || !loan.riggingGear) continue;
      const assetLabel = `${loan.riggingGear.managementNumber} ${loan.riggingGear.name}`.trim();
      if (loan.borrowedAt >= input.periodFrom && loan.borrowedAt <= input.periodTo) {
        periodEventRows.push({
          kind: 'BORROW',
          eventAt: loan.borrowedAt,
          assetId: loan.riggingGearId,
          assetLabel,
          actorDisplayName: loan.employee?.displayName ?? null,
          actorEmployeeId: loan.employeeId ?? null
        });
      }
      if (loan.returnedAt && loan.returnedAt >= input.periodFrom && loan.returnedAt <= input.periodTo) {
        periodEventRows.push({
          kind: 'RETURN',
          eventAt: loan.returnedAt,
          assetId: loan.riggingGearId,
          assetLabel,
          actorDisplayName: loan.employee?.displayName ?? null,
          actorEmployeeId: loan.employeeId ?? null
        });
      }
    }
    periodEventRows.sort((a, b) => b.eventAt.getTime() - a.eventAt.getTime());

    return {
      monthlyTrend: monthlyRows.map((r) => ({
        yearMonth: r.year_month,
        borrowCount: Number(r.borrow_count),
        returnCount: Number(r.return_count)
      })),
      periodBorrowCount,
      periodReturnCount,
      openLoanCount,
      overdueOpenCount,
      totalRiggingGearsActive,
      gearRows,
      periodEventRows,
      employeeRows
    };
  }
}
