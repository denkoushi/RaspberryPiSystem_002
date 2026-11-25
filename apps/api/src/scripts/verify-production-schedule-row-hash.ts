/**
 * 生産日程の全行で、TS の `calculateProductionScheduleDataHash` と、移行
 * 20261125110000_keep_all_manufacturing_orders_rehash の SQL 式の値を突き合わせる。読み取りのみ。
 *
 *   pnpm --filter @raspi-system/api verify:production-schedule-row-hash
 *   node dist/scripts/verify-production-schedule-row-hash.js
 *
 * 不一致、または移行が中止する値(文字列以外、大小文字の差が出うる文字)があれば終了コード 1。
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';
import { calculateProductionScheduleDataHash } from '../services/production-schedule/row-resolver/constants.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../services/production-schedule/constants.js';
import {
  buildProductionScheduleRowHashSql,
  buildProductionScheduleRowHashUnsafeConditionSql,
} from './production-schedule-row-hash-sql.js';

const BATCH_SIZE = 5000;
const SAMPLE_LIMIT = 10;

type HashRow = {
  id: string;
  rowData: Record<string, unknown>;
  sqlHash: string;
  unsafe: boolean | null;
};

export type ProductionScheduleRowHashVerification = {
  totalRows: number;
  mismatchCount: number;
  unsafeValueCount: number;
  mismatches: Array<{ id: string; tsHash: string; sqlHash: string; keyValues: Record<string, unknown> }>;
  unsafeRows: Array<{ id: string; keyValues: Record<string, unknown> }>;
};

const keyValuesOf = (rowData: Record<string, unknown>): Record<string, unknown> => ({
  FSEIBAN: rowData.FSEIBAN,
  FHINCD: rowData.FHINCD,
  FSIGENCD: rowData.FSIGENCD,
  FKOJUN: rowData.FKOJUN,
  ProductNo: rowData.ProductNo,
});

export async function verifyProductionScheduleRowHash(
  client: Pick<PrismaClient, '$queryRaw'>
): Promise<ProductionScheduleRowHashVerification> {
  const result: ProductionScheduleRowHashVerification = {
    totalRows: 0,
    mismatchCount: 0,
    unsafeValueCount: 0,
    mismatches: [],
    unsafeRows: [],
  };
  const hashSql = Prisma.raw(buildProductionScheduleRowHashSql('r'));
  const unsafeSql = Prisma.raw(buildProductionScheduleRowHashUnsafeConditionSql('r'));
  let cursor = '';
  for (;;) {
    const rows = await client.$queryRaw<HashRow[]>`
      SELECT r."id", r."rowData", ${hashSql} AS "sqlHash", (${unsafeSql}) AS "unsafe"
      FROM "CsvDashboardRow" AS r
      WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND r."id" > ${cursor}
      ORDER BY r."id"
      LIMIT ${BATCH_SIZE}
    `;
    if (rows.length === 0) break;
    for (const row of rows) {
      result.totalRows += 1;
      const tsHash = calculateProductionScheduleDataHash(row.rowData);
      if (tsHash !== row.sqlHash) {
        result.mismatchCount += 1;
        if (result.mismatches.length < SAMPLE_LIMIT) {
          result.mismatches.push({ id: row.id, tsHash, sqlHash: row.sqlHash, keyValues: keyValuesOf(row.rowData) });
        }
      }
      if (row.unsafe === true) {
        result.unsafeValueCount += 1;
        if (result.unsafeRows.length < SAMPLE_LIMIT) {
          result.unsafeRows.push({ id: row.id, keyValues: keyValuesOf(row.rowData) });
        }
      }
    }
    cursor = rows[rows.length - 1].id;
  }
  return result;
}

async function main(): Promise<void> {
  const { prisma } = await import('../lib/prisma.js');
  try {
    const result = await verifyProductionScheduleRowHash(prisma);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.mismatchCount > 0 || result.unsafeValueCount > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
