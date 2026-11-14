import { Prisma, type PrismaClient } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { toTrimmedString } from '../../lib/string-normalize.js';
import { parseFkojunstStatusMailFupdteDt } from '../csv-dashboard/csv-dashboard-datetime-parse.js';
import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from './constants.js';

type RoutingTarget = { itemId: string; productNo: string; processOrder: string };
type OutsourcedRow = { rowData: unknown; occurredAt: Date; createdAt: Date };
const OUTSOURCED_ROUTING_INDEX_PREDICATE = Prisma.raw(
  `"csvDashboardId" = '${PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID}'`
  + ` AND BTRIM("rowData"->>'FKOTEICD') ~ '^[0-9]{10}$'`
);
/** 外作の工程CDは10桁の仕入先CD(製番ではない)。SQL側は索引の述語と同じ正規表現を使う。 */
const isSupplierProcessCode = (code: string) => code.length === 10 && /^\d+$/.test(code);
export type OutsourcedRoutingArrival = 'pending' | 'done' | 'none';

function processOrder(value: unknown): number | null {
  const token = toTrimmedString(value);
  const number = Number(token);
  return /^\d+$/.test(token) && Number.isFinite(number) ? number : null;
}

export function buildOutsourcedRoutingArrivalByItemId(
  items: readonly RoutingTarget[], rows: readonly OutsourcedRow[]
): Map<string, OutsourcedRoutingArrival> {
  const byProduct = new Map<string, Map<number, { status: string; updated: number; occurred: number; created: number }>>();
  for (const row of rows) {
    if (!row.rowData || typeof row.rowData !== 'object' || Array.isArray(row.rowData)) continue;
    const data = row.rowData as Record<string, unknown>;
    const productNo = toTrimmedString(data.FSEZONO);
    const order = processOrder(data.FKOJUN);
    if (!productNo || order === null || !isSupplierProcessCode(toTrimmedString(data.FKOTEICD))) continue;
    const current = {
      status: toTrimmedString(data.FKOJUNST).toUpperCase(),
      updated: parseFkojunstStatusMailFupdteDt(data.FUPDTEDT)?.getTime() ?? 0,
      occurred: row.occurredAt.getTime(), created: row.createdAt.getTime()
    };
    let byOrder = byProduct.get(productNo);
    if (!byOrder) { byOrder = new Map(); byProduct.set(productNo, byOrder); }
    const previous = byOrder.get(order);
    if (!previous || current.updated > previous.updated
      || (current.updated === previous.updated && (current.occurred > previous.occurred
        || (current.occurred === previous.occurred && current.created > previous.created)))) {
      byOrder.set(order, current);
    }
  }
  return new Map(items.map((item) => {
    const order = processOrder(item.processOrder);
    const preceding = order === null ? [] : [...(byProduct.get(item.productNo.trim()) ?? [])].filter(([candidate]) => candidate < order);
    return [item.itemId, preceding.length === 0 ? 'none'
      : preceding.every(([, row]) => row.status === 'C' || row.status === 'X') ? 'done' : 'pending'];
  }));
}

export async function findOutsourcedRoutingArrivalByItemId(
  items: readonly RoutingTarget[], client: Pick<PrismaClient, '$queryRaw'> = prisma
): Promise<Map<string, OutsourcedRoutingArrival>> {
  const productNos = [...new Set(items.map((item) => item.productNo.trim()).filter(Boolean))];
  if (!productNos.length) return buildOutsourcedRoutingArrivalByItemId(items, []);
  // The predicate is a literal so the planner can match the partial index
  // csv_dashboard_row_fkojunst_outsourced_idx (keep both in sync).
  const rows = await client.$queryRaw<OutsourcedRow[]>`
    SELECT "rowData", "occurredAt", "createdAt"
    FROM "CsvDashboardRow"
    WHERE ${OUTSOURCED_ROUTING_INDEX_PREDICATE}
      AND BTRIM("rowData"->>'FSEZONO') = ANY(${productNos}::text[])
  `;
  return buildOutsourcedRoutingArrivalByItemId(items, rows);
}
