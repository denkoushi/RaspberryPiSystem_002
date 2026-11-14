import { BOARD_DUE_JOINS_SQL, BOARD_MANUAL_UPDATED_AT_SQL } from './d-schedule-minutes/board-due.sql.js';
import { ApiError } from '../../lib/errors.js';
import { Prisma } from '@prisma/client';
import { FKOJUNST_MAIL_LIST_VISIBLE_STATUS_CODES } from './completion/fkojunst-mail-status-completion.policy.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import type { FkojunstMailNormalizedRow } from './fkojunst-status-mail-sync.pipeline.js';
import { compareProcessOrder } from './process-order.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';

export const MISSING_STANDARD_HOURS_PREFIX = 'missing-standard-hours:';
export function assertWritablePlanningItemIds(ids: readonly (string | null | undefined)[]): void {
  if (ids.some((id) => id?.startsWith(MISSING_STANDARD_HOURS_PREFIX))) {
    throw new ApiError(400, '標準工数入力忘れの工程は編集できません', undefined, 'READ_ONLY_MISSING_STANDARD_HOURS');
  }
}
export function missingStandardHoursItemId(row: { fsezono: string; fkojun: string; fkoteicd: string }): string {
  return MISSING_STANDARD_HOURS_PREFIX + Buffer.from(JSON.stringify([row.fsezono, row.fkojun, row.fkoteicd])).toString('base64url');
}
export type MissingStandardHoursScheduleRow = { id: string; ProductNo: string | null; FKOJUN: string | null; FSIGENCD: string | null };
const token = (value: unknown) => String(value ?? '').trim();

/** Input mail rows are the existing latest-per-triple winners (including hidden/invalid statuses). */
export function buildMissingStandardHoursProcesses(
  mail: readonly FkojunstMailNormalizedRow[], schedule: readonly MissingStandardHoursScheduleRow[]
): Prisma.ProductionScheduleMissingStandardHoursProcessCreateManyInput[] {
  const donors = new Map<string, MissingStandardHoursScheduleRow>();
  const scheduledProcesses = new Set<string>();
  const resources = new Set<string>();
  const latestByProcess = new Map<string, number>();
  const processKey = (order: string, process: string) => JSON.stringify([order, process]);
  for (const row of schedule) {
    const data = row;
    const order = token(data.ProductNo), process = token(data.FKOJUN);
    resources.add(normalizeProductionScheduleResourceCd(token(data.FSIGENCD)));
    scheduledProcesses.add(processKey(order, process));
    const donor = donors.get(order);
    // Deterministic donor: minimum process order, then lexicographically smallest CSV row ID.
    const comparison = donor ? compareProcessOrder(process, token(donor.FKOJUN)) : -1;
    if (!donor || comparison < 0 || comparison === 0 && row.id < donor.id) donors.set(order, row);
  }
  for (const row of mail) {
    const key = processKey(row.fsezono, row.fkojun);
    latestByProcess.set(key, Math.max(latestByProcess.get(key) ?? -Infinity, row.sourceUpdatedAt.getTime()));
  }
  return mail.flatMap((row) => {
    const donor = donors.get(row.fsezono), key = processKey(row.fsezono, row.fkojun);
    if (!(FKOJUNST_MAIL_LIST_VISIBLE_STATUS_CODES as readonly string[]).includes(row.statusCode)
      || !donor || scheduledProcesses.has(key)
      || row.sourceUpdatedAt.getTime() < latestByProcess.get(key)!
      || !resources.has(row.fkoteicd)
      // Column widths (VARCHAR 32/20/40): an oversized mail value must not roll back the whole sync.
      || row.fsezono.length > 32 || row.fkojun.length > 20 || row.fkoteicd.length > 40) return [];
    return [{ csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: donor.id,
      fsezono: row.fsezono, fkojun: row.fkojun, fkoteicd: row.fkoteicd,
      statusCode: row.statusCode, sourceUpdatedAt: row.sourceUpdatedAt }];
  });
}

/** Caller holds the status-mail critical lock. Schedule resource membership is materialized here (condition 5). */
export async function replaceMissingStandardHoursProcesses(tx: Prisma.TransactionClient, mail: readonly FkojunstMailNormalizedRow[]): Promise<void> {
  const schedule = mail.length ? await tx.$queryRaw<MissingStandardHoursScheduleRow[]>(Prisma.sql`
    SELECT "id", "rowData"->>'ProductNo' AS "ProductNo", "rowData"->>'FKOJUN' AS "FKOJUN",
      "rowData"->>'FSIGENCD' AS "FSIGENCD"
    FROM "CsvDashboardRow"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
  `) : [];
  const inputs = buildMissingStandardHoursProcesses(mail, schedule);
  await tx.productionScheduleMissingStandardHoursProcess.deleteMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID } });
  for (let i = 0; i < inputs.length; i += 200) {
    await tx.productionScheduleMissingStandardHoursProcess.createMany({ data: inputs.slice(i, i + 200) });
  }
}

export type MissingStandardHoursBoardRow = {
  fsezono: string; fkojun: string; fkoteicd: string; sourceUpdatedAt: Date;
  rowData: Prisma.JsonValue; plannedQuantity: number | null; plannedEndDate: Date | null;
  dueDate: Date | null; excelDueDate: Date | null; excelChangedAt: Date | null; manualUpdatedAt: Date | null;
};

/** One evidence read, including donor due inputs; never joins item overrides, completion, ranks or splits. */
export async function readMissingStandardHoursBoardRows(client: Pick<Prisma.TransactionClient, '$queryRaw'>): Promise<MissingStandardHoursBoardRow[]> {
  return client.$queryRaw<MissingStandardHoursBoardRow[]>(Prisma.sql`
    SELECT m."fsezono", m."fkojun", m."fkoteicd", m."sourceUpdatedAt", "CsvDashboardRow"."rowData",
      s."plannedQuantity", s."plannedEndDate", "n"."dueDate",
      "excel_due"."partsCompleteDate" AS "excelDueDate", "excel_due"."excelChangedAt" AS "excelChangedAt",
      ${BOARD_MANUAL_UPDATED_AT_SQL} AS "manualUpdatedAt"
    FROM "ProductionScheduleMissingStandardHoursProcess" m
    JOIN "CsvDashboardRow" ON "CsvDashboardRow"."id" = m."csvDashboardRowId" AND "CsvDashboardRow"."csvDashboardId" = m."csvDashboardId"
    LEFT JOIN "ProductionScheduleOrderSupplement" s ON s."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND s."csvDashboardId" = m."csvDashboardId" AND s."productNo" = m."fsezono"
    LEFT JOIN LATERAL (
      SELECT "note"."dueDate", "note"."processingType"
      FROM "ProductionScheduleRowNote" AS "note"
      WHERE "note"."csvDashboardRowId" = "CsvDashboardRow"."id" AND "note"."csvDashboardId" = m."csvDashboardId"
      ORDER BY "note"."updatedAt" DESC
      LIMIT 1
    ) AS "n" ON TRUE
    ${BOARD_DUE_JOINS_SQL}
    WHERE m."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    ORDER BY m."fsezono", m."fkojun", m."fkoteicd"
  `);
}
