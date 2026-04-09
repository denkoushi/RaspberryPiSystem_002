import { ItemStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import type {
  IItemLoanAnalyticsRepository,
  ItemLoanAnalyticsAggregate,
  ItemLoanAnalyticsEmployeeAggregateRow,
  ItemLoanAnalyticsItemAggregateRow,
  ItemLoanAnalyticsOpenLoanInfo,
  ItemLoanAnalyticsQueryInput,
  ItemLoanAnalyticsTimeZone
} from './item-loan-analytics.types.js';

function timeZoneSql(tz: ItemLoanAnalyticsTimeZone): Prisma.Sql {
  return tz === 'UTC' ? Prisma.raw(`'UTC'`) : Prisma.raw(`'Asia/Tokyo'`);
}

/** タグアイテム Loan のみ（SQL フラグメント） */
const ITEM_LOAN_WHERE = Prisma.raw(`
  l."itemId" IS NOT NULL
  AND l."riggingGearId" IS NULL
  AND l."measuringInstrumentId" IS NULL
  AND l."cancelledAt" IS NULL`);

/**
 * itemId あり・吊具・計測機器でない Loan のみ。cancelledAt 非 null は除外。
 */
export class ItemLoanAnalyticsRepository implements IItemLoanAnalyticsRepository {
  constructor(private readonly db: typeof prisma = prisma) {}

  async loadAggregate(input: ItemLoanAnalyticsQueryInput): Promise<ItemLoanAnalyticsAggregate> {
    const tzSql = timeZoneSql(input.timeZone);
    const monthOffset = input.monthlyMonths - 1;

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
        WHERE ${ITEM_LOAN_WHERE}
        GROUP BY 1
      ),
      returns AS (
        SELECT date_trunc('month', (l."returnedAt" AT TIME ZONE ${tzSql}))::date AS m,
               COUNT(*)::bigint AS c
        FROM "Loan" l
        WHERE ${ITEM_LOAN_WHERE}
          AND l."returnedAt" IS NOT NULL
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

    const baseWhere = {
      itemId: { not: null },
      riggingGearId: null,
      measuringInstrumentId: null,
      cancelledAt: null
    } as const;

    const [
      periodBorrowCount,
      periodReturnCount,
      openLoanCount,
      overdueOpenCount,
      totalItemsActive,
      items,
      borrowByItem,
      returnByItem,
      openLoans,
      borrowByEmployee,
      returnByEmployee,
      openByEmployee
    ] = await Promise.all([
      this.db.loan.count({
        where: {
          ...baseWhere,
          borrowedAt: { gte: input.periodFrom, lte: input.periodTo }
        }
      }),
      this.db.loan.count({
        where: {
          ...baseWhere,
          returnedAt: { not: null, gte: input.periodFrom, lte: input.periodTo }
        }
      }),
      this.db.loan.count({
        where: { ...baseWhere, returnedAt: null }
      }),
      this.db.loan.count({
        where: {
          ...baseWhere,
          returnedAt: null,
          dueAt: { not: null, lt: input.now }
        }
      }),
      this.db.item.count({
        where: { status: { not: ItemStatus.RETIRED } }
      }),
      this.db.item.findMany({
        where: { status: { not: ItemStatus.RETIRED } },
        orderBy: [{ itemCode: 'asc' }, { name: 'asc' }]
      }),
      this.db.loan.groupBy({
        by: ['itemId'],
        where: {
          ...baseWhere,
          borrowedAt: { gte: input.periodFrom, lte: input.periodTo }
        },
        _count: { _all: true }
      }),
      this.db.loan.groupBy({
        by: ['itemId'],
        where: {
          ...baseWhere,
          returnedAt: { not: null, gte: input.periodFrom, lte: input.periodTo }
        },
        _count: { _all: true }
      }),
      this.db.loan.findMany({
        where: { ...baseWhere, returnedAt: null },
        select: {
          itemId: true,
          dueAt: true,
          employee: { select: { displayName: true, employeeCode: true } }
        }
      }),
      this.db.loan.groupBy({
        by: ['employeeId'],
        where: {
          ...baseWhere,
          borrowedAt: { gte: input.periodFrom, lte: input.periodTo },
          employeeId: { not: null }
        },
        _count: { _all: true }
      }),
      this.db.loan.groupBy({
        by: ['employeeId'],
        where: {
          ...baseWhere,
          returnedAt: { not: null, gte: input.periodFrom, lte: input.periodTo },
          employeeId: { not: null }
        },
        _count: { _all: true }
      }),
      this.db.loan.groupBy({
        by: ['employeeId'],
        where: {
          ...baseWhere,
          returnedAt: null,
          employeeId: { not: null }
        },
        _count: { _all: true }
      })
    ]);

    const borrowItemMap = new Map(
      borrowByItem.filter((r) => r.itemId).map((r) => [r.itemId!, r._count._all])
    );
    const returnItemMap = new Map(
      returnByItem.filter((r) => r.itemId).map((r) => [r.itemId!, r._count._all])
    );

    const openByItemId = new Map<string, ItemLoanAnalyticsOpenLoanInfo>();
    for (const loan of openLoans) {
      if (!loan.itemId || !loan.employee) continue;
      const dueAt = loan.dueAt;
      openByItemId.set(loan.itemId, {
        dueAt,
        employeeDisplayName: loan.employee.displayName,
        employeeCode: loan.employee.employeeCode,
        isOverdue: dueAt != null && dueAt < input.now
      });
    }

    const itemRows: ItemLoanAnalyticsItemAggregateRow[] = items.map((it) => {
      const open = openByItemId.get(it.id) ?? null;
      return {
        itemId: it.id,
        itemCode: it.itemCode,
        name: it.name,
        status: it.status,
        periodBorrowCount: borrowItemMap.get(it.id) ?? 0,
        periodReturnCount: returnItemMap.get(it.id) ?? 0,
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

    const employees =
      empIds.size === 0
        ? []
        : await this.db.employee.findMany({
            where: { id: { in: [...empIds] } },
            orderBy: { displayName: 'asc' }
          });

    const employeeRows: ItemLoanAnalyticsEmployeeAggregateRow[] = employees.map((e) => ({
      employeeId: e.id,
      displayName: e.displayName,
      employeeCode: e.employeeCode,
      openItemCount: openEmpMap.get(e.id) ?? 0,
      periodBorrowCount: borrowEmpMap.get(e.id) ?? 0,
      periodReturnCount: returnEmpMap.get(e.id) ?? 0
    }));

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
      totalItemsActive,
      itemRows,
      employeeRows
    };
  }
}
