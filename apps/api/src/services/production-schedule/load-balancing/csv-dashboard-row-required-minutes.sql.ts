import { Prisma } from '@prisma/client';

/**
 * `CsvDashboardRow.rowData.FSIGENSHOYORYO` を分（number）に正規化する SQL スカラー。
 * 負荷調整の3タブ（俯瞰・機種別・着手日）で共通利用する。
 */
export function buildCsvDashboardRowRequiredMinutesSql(): Prisma.Sql {
  return Prisma.sql`(
    CASE
      WHEN ("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO') ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'
      THEN (("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO'))::numeric
      ELSE 0
    END
  )::double precision`;
}
