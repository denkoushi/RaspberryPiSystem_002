/**
 * 生産日程の全行で、TS の `calculateProductionScheduleDataHash` と、移行
 * 20261125110000_keep_all_manufacturing_orders_rehash の SQL 式の値を突き合わせる。読み取りのみ。
 *
 *   pnpm --filter @raspi-system/api verify:production-schedule-row-hash
 *   node dist/scripts/verify-production-schedule-row-hash.js
 *
 * ハッシュの不一致、または移行の中止条件に該当する行があれば終了コード 1。
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';
import { calculateProductionScheduleDataHash } from '../services/production-schedule/row-resolver/constants.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../services/production-schedule/constants.js';
import {
  buildProductionScheduleRowHashSql,
  buildProductionScheduleRowHashUnsafeConditionSql,
  PRODUCTION_SCHEDULE_ROW_HASH_KEY_JSON_COLUMNS,
  RISKY_CHAR_REGEX,
} from './production-schedule-row-hash-sql.js';

const BATCH_SIZE = 5000;
const SAMPLE_LIMIT = 10;

type HashRow = {
  id: string;
  rowData: Record<string, unknown>;
  sqlHash: string;
  unsafe: boolean | null;
};

type CheckSummary = { count: number; sampleIds: string[] };
const checkKinds = [
  'missingKey', 'invalidKeyType', 'riskyCharacters', 'duplicateHash',
  'overrideCollision', 'arrivalCollision', 'firstProcessArrivalCollision',
] as const;
type CheckKind = typeof checkKinds[number];
type PieceSetSummary = { multipleMatches: number; noMatch: number };

export type ProductionScheduleRowHashVerification = {
  totalRows: number;
  mismatchCount: number;
  unsafeValueCount: number;
  mismatches: Array<{ id: string; tsHash: string; sqlHash: string; keyValues: Record<string, unknown> }>;
  unsafeRows: Array<{ id: string; keyValues: Record<string, unknown> }>;
  checks: Record<CheckKind, CheckSummary>;
  sessakuPieceSets: PieceSetSummary;
};

const keyValuesOf = (rowData: Record<string, unknown>): Record<string, unknown> => ({
  FSEIBAN: rowData.FSEIBAN,
  FHINCD: rowData.FHINCD,
  FSIGENCD: rowData.FSIGENCD,
  FKOJUN: rowData.FKOJUN,
  ProductNo: rowData.ProductNo,
});

type VerificationClient = Pick<PrismaClient, '$queryRaw'>;
const keyColumns = PRODUCTION_SCHEDULE_ROW_HASH_KEY_JSON_COLUMNS;
const keyValueSql = (column: typeof keyColumns[number]) => Prisma.raw(`r."rowData"->>'${column}'`);

async function readMigrationChecks(client: VerificationClient): Promise<Record<CheckKind, CheckSummary>> {
  // The migration permits an absent FSEIBAN. Its missing-field guard applies to the other four columns.
  const missingKey = Prisma.join(keyColumns.slice(1).map((column) =>
    Prisma.sql`nullif(btrim(coalesce(${keyValueSql(column)}, '')), '') IS NULL`), ' OR ');
  const invalidKeyType = Prisma.join(keyColumns.map((column) =>
    Prisma.sql`jsonb_typeof(r."rowData" -> ${column}::text) NOT IN ('string', 'null')`), ' OR ');
  const riskyCharacters = Prisma.join(keyColumns.map((column) =>
    Prisma.sql`${keyValueSql(column)} ~ ${RISKY_CHAR_REGEX}`), ' OR ');
  const hashSql = Prisma.raw(buildProductionScheduleRowHashSql('r'));

  const collisions = [
    ['overrideCollision', 'ProductionScheduleGrindingPlanningBoardOverride'],
    ['arrivalCollision', 'ProductionScheduleGrindingPlanningBoardArrival'],
    ['firstProcessArrivalCollision', 'ProductionScheduleGrindingPlanningBoardFirstProcessArrival'],
  ] as const;
  const collisionRows = collisions.map(([kind, table]) => Prisma.sql`
    SELECT ${kind}::text, old_row."id"
    FROM ${Prisma.raw(`"${table}"`)} AS old_row
    JOIN item_keys AS k ON k.legacy_item_key = old_row."itemKey"
    JOIN ${Prisma.raw(`"${table}"`)} AS new_row
      ON new_row."csvDashboardId" = old_row."csvDashboardId"
     AND new_row."siteKey" = old_row."siteKey"
     AND new_row."itemKey" = k.next_item_key
     AND new_row."id" <> old_row."id"
     ${kind === 'arrivalCollision' ? Prisma.sql`AND new_row."arrivalDate" = old_row."arrivalDate"` : Prisma.empty}
    WHERE old_row."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
  `);

  // Use the same raw key serialization, winner ordering, and base64url encoding as the rehash migration.
  const base64url = (json: Prisma.Sql) => Prisma.sql`
    'row:' || rtrim(translate(replace(encode(convert_to(${json}, 'UTF8'), 'base64'), chr(10), ''), '+/', '-_'), '=')
  `;
  const legacyJson = Prisma.join(keyColumns.slice(0, 4).map((column) =>
    Prisma.sql`to_json(coalesce(${keyValueSql(column)}, ''))::text`), " || ',' || ");
  const rows = await client.$queryRaw<Array<CheckSummary & { kind: CheckKind }>>(Prisma.sql`
    WITH schedule AS (
      SELECT r."id", r."createdAt", ${hashSql} AS next_hash,
        (${missingKey}) AS missing_key, (${invalidKeyType}) AS invalid_key_type,
        (${riskyCharacters}) AS risky_characters,
        coalesce(r."rowData"->>'ProductNo', '') AS product_no,
        '[' || ${legacyJson} || ']' AS legacy_json,
        btrim(coalesce(r."rowData"->>'FSEIBAN', '')) AS trimmed_fseiban
      FROM "CsvDashboardRow" AS r
      WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    ), item_keys AS (
      SELECT DISTINCT ON (legacy_json)
        ${base64url(Prisma.sql`legacy_json`)} AS legacy_item_key,
        ${base64url(Prisma.sql`left(legacy_json, length(legacy_json) - 1) || ',' || to_json(product_no)::text || ']'`)} AS next_item_key
      FROM schedule
      WHERE trimmed_fseiban <> '********'
      ORDER BY legacy_json, CASE WHEN product_no ~ '^[0-9]+$' THEN product_no::bigint ELSE -1 END DESC,
        "createdAt" DESC, "id" DESC
    ), findings(kind, id) AS (
      SELECT 'missingKey', "id" FROM schedule WHERE missing_key
      UNION ALL SELECT 'invalidKeyType', "id" FROM schedule WHERE invalid_key_type
      UNION ALL SELECT 'riskyCharacters', "id" FROM schedule WHERE risky_characters
      UNION ALL SELECT 'duplicateHash', "id"
        FROM schedule JOIN (SELECT next_hash FROM schedule GROUP BY next_hash HAVING count(*) > 1) AS duplicates USING (next_hash)
      UNION ALL ${Prisma.join(collisionRows, ' UNION ALL ')}
    )
    SELECT kind, count(*)::int AS count, (array_agg(id ORDER BY id COLLATE "C"))[1:${SAMPLE_LIMIT}] AS "sampleIds"
    FROM findings GROUP BY kind
  `);

  const byKind = new Map(rows.map(({ kind, ...summary }) => [kind, summary]));
  return Object.fromEntries(checkKinds.map((kind) => [kind, byKind.get(kind) ?? { count: 0, sampleIds: [] }])) as Record<CheckKind, CheckSummary>;
}

async function readPieceSetSummary(client: VerificationClient): Promise<PieceSetSummary> {
  const [counts] = await client.$queryRaw<PieceSetSummary[]>`
    SELECT count(*) FILTER (WHERE matches.count > 1)::int AS "multipleMatches",
      count(*) FILTER (WHERE matches.count = 0)::int AS "noMatch"
    FROM "ProductionScheduleSessakuPieceSet" AS s
    CROSS JOIN LATERAL (
      SELECT count(*) FROM (
        SELECT 1 FROM "CsvDashboardRow" AS r
        WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          AND coalesce(r."rowData"->>'FSEIBAN', '') = s."fseiban"
          AND coalesce(r."rowData"->>'FHINCD', '') = s."fhincd"
          AND coalesce(r."rowData"->>'FSIGENCD', '') = s."fsigencd"
          AND coalesce(r."rowData"->>'FKOJUN', '') = s."fkojun"
        LIMIT 2
      ) AS candidates
    ) AS matches
    WHERE s."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
  `;
  return counts;
}

export async function verifyProductionScheduleRowHash(
  client: VerificationClient
): Promise<ProductionScheduleRowHashVerification> {
  const result = {
    totalRows: 0,
    mismatchCount: 0,
    unsafeValueCount: 0,
    mismatches: [] as ProductionScheduleRowHashVerification['mismatches'],
    unsafeRows: [] as ProductionScheduleRowHashVerification['unsafeRows'],
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
  const checks = await readMigrationChecks(client);
  const sessakuPieceSets = await readPieceSetSummary(client);
  return { ...result, checks, sessakuPieceSets };
}

async function main(): Promise<void> {
  const { prisma } = await import('../lib/prisma.js');
  try {
    const result = await verifyProductionScheduleRowHash(prisma);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.mismatchCount > 0 || Object.values(result.checks).some(({ count }) => count > 0)) {
      process.exitCode = 1;
    }
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
