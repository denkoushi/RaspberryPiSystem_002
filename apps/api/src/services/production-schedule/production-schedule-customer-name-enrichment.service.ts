import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID } from './constants.js';

type ProductionScheduleLikeRow = {
  rowData: unknown;
};

export type RowWithCustomerName<T> = T & {
  customerName: string | null;
};

const readFseiban = (rowData: unknown): string => {
  if (!rowData || typeof rowData !== 'object') return '';
  const value = (rowData as Record<string, unknown>).FSEIBAN;
  return typeof value === 'string' ? value.trim() : '';
};

const BATCH = 500;

/**
 * 生産日程一覧へ CustomerSCAW 同期テーブル由来の `customerName` を付与する。
 */
export async function enrichProductionScheduleRowsWithCustomerName<T extends ProductionScheduleLikeRow>(
  rows: readonly T[]
): Promise<Array<RowWithCustomerName<T>>> {
  const unique = Array.from(
    new Set(rows.map((row) => readFseiban(row.rowData)).filter((f) => f.length > 0))
  );

  const nameByFseiban = new Map<string, string>();
  for (let i = 0; i < unique.length; i += BATCH) {
    const chunk = unique.slice(i, i + BATCH);
    if (chunk.length === 0) continue;
    const found = await prisma.productionScheduleFseibanCustomerScaw.findMany({
      where: {
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_CUSTOMER_SCAW_DASHBOARD_ID,
        fseiban: { in: chunk },
      },
      select: { fseiban: true, customerName: true },
    });
    for (const row of found) {
      nameByFseiban.set(row.fseiban, row.customerName);
    }
  }

  return rows.map((row) => {
    const fseiban = readFseiban(row.rowData);
    const customerName = fseiban.length > 0 ? nameByFseiban.get(fseiban) ?? null : null;
    return {
      ...row,
      customerName,
    };
  });
}
