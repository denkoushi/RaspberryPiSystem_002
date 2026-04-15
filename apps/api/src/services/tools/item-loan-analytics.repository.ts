import { createHash } from 'node:crypto';
import { Prisma, type Prisma as PrismaTypes } from '@prisma/client';
import { PHOTO_LOAN_CARD_PRIMARY_LABEL } from '@raspi-system/shared-types';
import { prisma } from '../../lib/prisma.js';
import type {
  IItemLoanAnalyticsRepository,
  ItemLoanAnalyticsAggregate,
  ItemLoanAnalyticsEmployeeAggregateRow,
  ItemLoanAnalyticsItemAggregateRow,
  ItemLoanAnalyticsOpenLoanInfo,
  ItemLoanAnalyticsPeriodEventRow,
  ItemLoanAnalyticsQueryInput,
  ItemLoanAnalyticsTimeZone
} from './item-loan-analytics.types.js';

function timeZoneSql(tz: ItemLoanAnalyticsTimeZone): Prisma.Sql {
  return tz === 'UTC' ? Prisma.raw(`'UTC'`) : Prisma.raw(`'Asia/Tokyo'`);
}

/** 写真持出のみ（VLM/人レビュー表示名で集約）。ギャラリー教師行・NFC Item・吊具・計測は除外 */
const PHOTO_LOAN_WHERE = Prisma.raw(`
  l."photoUrl" IS NOT NULL
  AND l."itemId" IS NULL
  AND l."riggingGearId" IS NULL
  AND l."measuringInstrumentId" IS NULL
  AND l."cancelledAt" IS NULL
  AND l."photoToolGallerySeed" = false`);

const TOOL_LABEL_SQL = Prisma.raw(`
  COALESCE(
    NULLIF(TRIM(COALESCE(l."photoToolHumanDisplayName", '')), ''),
    NULLIF(TRIM(COALESCE(l."photoToolDisplayName", '')), ''),
    '${PHOTO_LOAN_CARD_PRIMARY_LABEL}'
  )`);

function stablePhotoToolRowId(toolLabel: string): string {
  const h = createHash('sha256').update(toolLabel, 'utf8').digest('hex').slice(0, 24);
  return `pt-${h}`;
}

const photoLoanPrismaWhere = {
  photoUrl: { not: null },
  itemId: null,
  riggingGearId: null,
  measuringInstrumentId: null,
  cancelledAt: null,
  photoToolGallerySeed: false
} as const;

function toolLabelMatchSql(toolLabelFilter?: string): Prisma.Sql {
  if (!toolLabelFilter) {
    return Prisma.empty;
  }
  return Prisma.sql`AND (${TOOL_LABEL_SQL}) = ${toolLabelFilter}`;
}

/**
 * 写真持出 Loan のみ。表示名はキオスク一覧と同順位（人 > VLM > 撮影mode）。
 * Prisma の Item マスタは参照しない。
 */
export class ItemLoanAnalyticsRepository implements IItemLoanAnalyticsRepository {
  constructor(private readonly db: typeof prisma = prisma) {}

  async resolveSyntheticItemIdToToolLabel(syntheticId: string): Promise<string | null> {
    if (!/^pt-[a-f0-9]{24}$/.test(syntheticId)) {
      return null;
    }
    const rows = await this.db.$queryRaw<Array<{ tl: string }>>`
      SELECT DISTINCT (${TOOL_LABEL_SQL}) AS tl
      FROM "Loan" l
      WHERE ${PHOTO_LOAN_WHERE}
    `;
    for (const row of rows) {
      if (stablePhotoToolRowId(row.tl) === syntheticId) {
        return row.tl;
      }
    }
    return null;
  }

  async loadAggregate(input: ItemLoanAnalyticsQueryInput): Promise<ItemLoanAnalyticsAggregate> {
    const tzSql = timeZoneSql(input.timeZone);
    const monthOffset = input.monthlyMonths - 1;
    const labelSql = toolLabelMatchSql(input.toolLabelFilter);

    const loanIdsForPrisma =
      input.toolLabelFilter === undefined
        ? undefined
        : (
            await this.db.$queryRaw<Array<{ id: string }>>`
              SELECT l.id FROM "Loan" l
              WHERE ${PHOTO_LOAN_WHERE}
              ${labelSql}
            `
          ).map((r) => r.id);

    const withLoanScope = (extra: PrismaTypes.LoanWhereInput): PrismaTypes.LoanWhereInput =>
      loanIdsForPrisma === undefined
        ? { AND: [photoLoanPrismaWhere, extra] }
        : { AND: [photoLoanPrismaWhere, { id: { in: loanIdsForPrisma } }, extra] };

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
        WHERE ${PHOTO_LOAN_WHERE}
        ${labelSql}
        GROUP BY 1
      ),
      returns AS (
        SELECT date_trunc('month', (l."returnedAt" AT TIME ZONE ${tzSql}))::date AS m,
               COUNT(*)::bigint AS c
        FROM "Loan" l
        WHERE ${PHOTO_LOAN_WHERE}
          AND l."returnedAt" IS NOT NULL
        ${labelSql}
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

    const [
      periodBorrowCount,
      periodReturnCount,
      openLoanCount,
      overdueOpenCount,
      labelAggRows,
      openByLabelRows,
      periodEventRowsRaw,
      borrowByEmployee,
      returnByEmployee,
      openByEmployee
    ] = await Promise.all([
      this.db.loan.count({
        where: withLoanScope({
          borrowedAt: { gte: input.periodFrom, lte: input.periodTo }
        })
      }),
      this.db.loan.count({
        where: withLoanScope({
          returnedAt: { not: null, gte: input.periodFrom, lte: input.periodTo }
        })
      }),
      this.db.loan.count({
        where: withLoanScope({ returnedAt: null })
      }),
      this.db.loan.count({
        where: withLoanScope({
          returnedAt: null,
          dueAt: { not: null, lt: input.now }
        })
      }),
      this.db.$queryRaw<
        Array<{
          tool_label: string;
          period_borrow_count: bigint;
          period_return_count: bigint;
        }>
      >`
        WITH labeled AS (
          SELECT ${TOOL_LABEL_SQL} AS tool_label,
                 l."borrowedAt",
                 l."returnedAt"
          FROM "Loan" l
          WHERE ${PHOTO_LOAN_WHERE}
          ${labelSql}
        )
        SELECT d.tool_label,
               COALESCE(
                 SUM(
                   CASE
                     WHEN lb."borrowedAt" >= ${input.periodFrom} AND lb."borrowedAt" <= ${input.periodTo}
                     THEN 1 ELSE 0
                   END
                 ),
                 0
               )::bigint AS period_borrow_count,
               COALESCE(
                 SUM(
                   CASE
                     WHEN lb."returnedAt" IS NOT NULL
                       AND lb."returnedAt" >= ${input.periodFrom}
                       AND lb."returnedAt" <= ${input.periodTo}
                     THEN 1 ELSE 0
                   END
                 ),
                 0
               )::bigint AS period_return_count
        FROM (SELECT DISTINCT tool_label FROM labeled) d
        LEFT JOIN labeled lb ON lb.tool_label = d.tool_label
        GROUP BY d.tool_label
        ORDER BY d.tool_label ASC;
      `,
      this.db.$queryRaw<
        Array<{
          tool_label: string;
          borrowedAt: Date;
          returnedAt: Date | null;
          employeeId: string | null;
          displayName: string | null;
        }>
      >`
        SELECT
          ${TOOL_LABEL_SQL} AS tool_label,
          l."borrowedAt" AS "borrowedAt",
          l."returnedAt" AS "returnedAt",
          l."employeeId" AS "employeeId",
          e."displayName" AS "displayName"
        FROM "Loan" l
        LEFT JOIN "Employee" e ON e."id" = l."employeeId"
        WHERE ${PHOTO_LOAN_WHERE}
        ${labelSql}
          AND (
            (l."borrowedAt" >= ${input.periodFrom} AND l."borrowedAt" <= ${input.periodTo})
            OR
            (l."returnedAt" IS NOT NULL AND l."returnedAt" >= ${input.periodFrom} AND l."returnedAt" <= ${input.periodTo})
          )
      `,
      this.db.$queryRaw<
        Array<{
          tool_label: string;
          dueAt: Date | null;
          displayName: string | null;
          employeeCode: string | null;
        }>
      >`
        WITH labeled AS (
          SELECT 
            ${TOOL_LABEL_SQL} AS tool_label,
            l."dueAt",
            l."borrowedAt",
            l."employeeId",
            l."returnedAt"
          FROM "Loan" l
          WHERE ${PHOTO_LOAN_WHERE}
          ${labelSql}
        )
        SELECT DISTINCT ON (v.tool_label)
          v.tool_label,
          v."dueAt" AS "dueAt",
          e."displayName" AS "displayName",
          e."employeeCode" AS "employeeCode"
        FROM labeled v
        LEFT JOIN "Employee" e ON e."id" = v."employeeId"
        WHERE v."returnedAt" IS NULL
          AND v."employeeId" IS NOT NULL
        ORDER BY v.tool_label, v."borrowedAt" ASC;
      `,
      this.db.loan.groupBy({
        by: ['employeeId'],
        where: withLoanScope({
          borrowedAt: { gte: input.periodFrom, lte: input.periodTo },
          employeeId: { not: null }
        }),
        _count: { _all: true }
      }),
      this.db.loan.groupBy({
        by: ['employeeId'],
        where: withLoanScope({
          returnedAt: { not: null, gte: input.periodFrom, lte: input.periodTo },
          employeeId: { not: null }
        }),
        _count: { _all: true }
      }),
      this.db.loan.groupBy({
        by: ['employeeId'],
        where: withLoanScope({
          returnedAt: null,
          employeeId: { not: null }
        }),
        _count: { _all: true }
      })
    ]);

    /** `labelAggRows` は `labeled` 内の全 tool_label を1行ずつ返すため、件数がユニーク表示名数 */
    const totalItemsActive = labelAggRows.length;

    const openByLabel = new Map<string, ItemLoanAnalyticsOpenLoanInfo>();
    for (const row of openByLabelRows) {
      if (!row.displayName || !row.employeeCode) continue;
      const dueAt = row.dueAt;
      openByLabel.set(row.tool_label, {
        dueAt,
        employeeDisplayName: row.displayName,
        employeeCode: row.employeeCode,
        isOverdue: dueAt != null && dueAt < input.now
      });
    }

    const itemRows: ItemLoanAnalyticsItemAggregateRow[] = labelAggRows.map((row) => {
      const toolLabel = row.tool_label;
      const open = openByLabel.get(toolLabel) ?? null;
      const isOutNow = open !== null;
      const periodBorrowCount = Number(row.period_borrow_count);
      const periodReturnCount = Number(row.period_return_count);
      return {
        itemId: stablePhotoToolRowId(toolLabel),
        itemCode: '',
        name: toolLabel,
        status: isOutNow ? 'IN_USE' : 'AVAILABLE',
        periodBorrowCount,
        periodReturnCount,
        open
      };
    });

    const periodEventRows: ItemLoanAnalyticsPeriodEventRow[] = [];
    for (const row of periodEventRowsRaw) {
      const assetId = stablePhotoToolRowId(row.tool_label);
      if (row.borrowedAt >= input.periodFrom && row.borrowedAt <= input.periodTo) {
        periodEventRows.push({
          kind: 'BORROW',
          eventAt: row.borrowedAt,
          assetId,
          assetLabel: row.tool_label,
          actorDisplayName: row.displayName ?? null,
          actorEmployeeId: row.employeeId ?? null
        });
      }
      if (row.returnedAt && row.returnedAt >= input.periodFrom && row.returnedAt <= input.periodTo) {
        periodEventRows.push({
          kind: 'RETURN',
          eventAt: row.returnedAt,
          assetId,
          assetLabel: row.tool_label,
          actorDisplayName: row.displayName ?? null,
          actorEmployeeId: row.employeeId ?? null
        });
      }
    }
    periodEventRows.sort((a, b) => b.eventAt.getTime() - a.eventAt.getTime());

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
      periodEventRows,
      employeeRows
    };
  }
}
