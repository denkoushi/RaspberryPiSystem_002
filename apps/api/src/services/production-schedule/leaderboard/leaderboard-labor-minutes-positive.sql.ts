import { Prisma } from '@prisma/client';

/**
 * `FSIGENSHOYORYO` を正の分のみ返す SQL スカラー（Web `parseLeaderBoardRequiredMinutes` と同等）。
 * 負値・0・非数値は 0。
 */
export function buildPositiveCsvDashboardRowRequiredMinutesSql(): Prisma.Sql {
  return Prisma.sql`(
    CASE
      WHEN ("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO') ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'
        AND (("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO'))::numeric > 0
      THEN (("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO'))::numeric
      ELSE 0
    END
  )::double precision`;
}
