import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { buildMaxProductNoWinnerCondition } from '../production-schedule/row-resolver/index.js';
import { fetchSeibanProgressRows } from '../production-schedule/seiban-progress.service.js';

export type PartMeasurementScheduleRowCandidate = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  fsigencd: string;
  fkojun: number | null;
};

type RawRow = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  fsigencd: string;
  fkojun: number | null;
};

/**
 * 製造order番号（ProductNo）で日程行を列挙する。max ProductNo 勝者条件は生産スケジュール一覧と同一。
 */
export async function listScheduleRowsByProductNo(productNo: string): Promise<PartMeasurementScheduleRowCandidate[]> {
  const normalized = productNo.trim();
  if (normalized.length === 0) {
    return [];
  }

  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT
      "CsvDashboardRow"."id" AS "rowId",
      TRIM(COALESCE("CsvDashboardRow"."rowData"->>'FSEIBAN', '')) AS "fseiban",
      TRIM(COALESCE("CsvDashboardRow"."rowData"->>'ProductNo', '')) AS "productNo",
      TRIM(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) AS "fhincd",
      TRIM(COALESCE("CsvDashboardRow"."rowData"->>'FHINMEI', '')) AS "fhinmei",
      TRIM(COALESCE("CsvDashboardRow"."rowData"->>'FSIGENCD', '')) AS "fsigencd",
      (
        CASE
          WHEN ("CsvDashboardRow"."rowData"->>'FKOJUN') ~ '^[0-9]+$'
          THEN (("CsvDashboardRow"."rowData"->>'FKOJUN'))::int
          ELSE NULL
        END
      ) AS "fkojun"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND TRIM("CsvDashboardRow"."rowData"->>'ProductNo') = ${normalized}
    ORDER BY
      "fkojun" ASC NULLS LAST,
      "fhincd" ASC
  `;

  return rows.filter((r) => r.fseiban.length > 0 && r.fhincd.length > 0 && r.fsigencd.length > 0);
}

/**
 * 製番（FSEIBAN）で日程行を列挙する。max ProductNo 勝者条件は製造order検索と同一。
 */
export async function listScheduleRowsByFseiban(fseiban: string): Promise<PartMeasurementScheduleRowCandidate[]> {
  const normalized = fseiban.trim();
  if (normalized.length === 0) {
    return [];
  }

  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT
      "CsvDashboardRow"."id" AS "rowId",
      TRIM(COALESCE("CsvDashboardRow"."rowData"->>'FSEIBAN', '')) AS "fseiban",
      TRIM(COALESCE("CsvDashboardRow"."rowData"->>'ProductNo', '')) AS "productNo",
      TRIM(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) AS "fhincd",
      TRIM(COALESCE("CsvDashboardRow"."rowData"->>'FHINMEI', '')) AS "fhinmei",
      TRIM(COALESCE("CsvDashboardRow"."rowData"->>'FSIGENCD', '')) AS "fsigencd",
      (
        CASE
          WHEN ("CsvDashboardRow"."rowData"->>'FKOJUN') ~ '^[0-9]+$'
          THEN (("CsvDashboardRow"."rowData"->>'FKOJUN'))::int
          ELSE NULL
        END
      ) AS "fkojun"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND TRIM("CsvDashboardRow"."rowData"->>'FSEIBAN') = ${normalized}
    ORDER BY
      "fkojun" ASC NULLS LAST,
      "fhincd" ASC
  `;

  return rows.filter((r) => r.fseiban.length > 0 && r.fhincd.length > 0 && r.fsigencd.length > 0);
}

/**
 * 製番単位の機種名（MH/SH 行の FHINMEI 等、seiban-progress と同系の集約）。
 */
export async function resolveMachineNameForSeiban(fseiban: string): Promise<string | null> {
  const trimmed = fseiban.trim();
  if (trimmed.length === 0) return null;
  const progress = await fetchSeibanProgressRows([trimmed]);
  const row = progress[0];
  const mn = row?.machineName?.trim();
  return mn && mn.length > 0 ? mn : null;
}
